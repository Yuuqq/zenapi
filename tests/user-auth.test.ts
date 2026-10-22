/**
 * User registration and login, against an in-memory stand-in for D1.
 *
 * Covers the behaviour that matters: new passwords are stored in the slow
 * format, existing SHA-256 rows keep working and upgrade on login, and a wrong
 * password is rejected.
 */

import { beforeEach, describe, expect, it } from "vitest";

import userAuthRoutes from "../apps/worker/src/routes/user-auth";
import {
	isLegacyHash,
	verifyPassword,
} from "../apps/worker/src/utils/password";

type Row = Record<string, unknown>;

class FakeDb {
	settings = new Map<string, string>();
	users: Row[] = [];
	sessions: Row[] = [];

	prepare(sql: string) {
		const db = this;
		const bind = (...params: unknown[]) => ({
			async first<T>(): Promise<T | undefined> {
				if (sql.includes("FROM settings")) {
					const value = db.settings.get(String(params[0]));
					return value === undefined ? undefined : ({ value } as T);
				}
				if (sql.includes("FROM users")) {
					const key = String(params[0]);
					return db.users.find(
						(u) => u.email === key || String(u.name).toLowerCase() === key,
					) as T | undefined;
				}
				if (sql.includes("SELECT id FROM users")) {
					const key = String(params[0]);
					return db.users.find(
						(u) => u.email === key || String(u.name).toLowerCase() === key,
					) as T | undefined;
				}
				return undefined;
			},
			async run() {
				if (sql.includes("INTO settings")) {
					db.settings.set(String(params[0]), String(params[1]));
				} else if (sql.includes("INTO users")) {
					db.users.push({
						id: params[0],
						email: params[1],
						name: params[2],
						password_hash: params[3],
						role: params[4],
						balance: params[5],
						status: params[6],
					});
				} else if (sql.includes("UPDATE users SET password_hash")) {
					const user = db.users.find((u) => u.id === params[1]);
					if (user) user.password_hash = params[0];
				} else if (sql.includes("INTO user_sessions")) {
					db.sessions.push({
						id: params[0],
						user_id: params[1],
						token_hash: params[2],
						expires_at: params[3],
					});
				}
				return { success: true };
			},
		});
		return { bind };
	}
}

function jsonRequest(path: string, body: unknown): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function call(db: FakeDb, path: string, body: unknown) {
	const res = await userAuthRoutes.fetch(jsonRequest(path, body), {
		DB: db,
	} as never);
	return { status: res.status, body: (await res.json()) as Row };
}

async function legacyHash(password: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(password),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function seedUser(db: FakeDb, passwordHash: string, overrides: Row = {}) {
	db.users.push({
		id: "u1",
		email: "user@example.com",
		name: "alice",
		password_hash: passwordHash,
		role: "user",
		balance: 0,
		status: "active",
		...overrides,
	});
}

describe("user registration", () => {
	let db: FakeDb;

	beforeEach(() => {
		db = new FakeDb();
		// Registration is refused in "personal" mode, which is the default.
		db.settings.set("site_mode", "shared");
	});

	it("stores a PBKDF2 hash for a new account", async () => {
		const { status } = await call(db, "/register", {
			email: "new@example.com",
			name: "newbie",
			password: "a-good-password",
		});

		expect(status).toBe(200);
		const stored = String(db.users[0].password_hash);
		expect(stored).toMatch(/^pbkdf2\$/);
		expect(stored).not.toContain("a-good-password");
		expect(await verifyPassword("a-good-password", stored)).toBe(true);
	});

	it("salts per account, so equal passwords differ", async () => {
		await call(db, "/register", {
			email: "a@example.com",
			name: "a",
			password: "same-password",
		});
		await call(db, "/register", {
			email: "b@example.com",
			name: "b",
			password: "same-password",
		});

		expect(db.users[0].password_hash).not.toBe(db.users[1].password_hash);
	});

	it("rejects a short password", async () => {
		const { status } = await call(db, "/register", {
			email: "x@example.com",
			name: "x",
			password: "short",
		});

		expect(status).toBe(400);
		expect(db.users).toHaveLength(0);
	});
});

describe("user login", () => {
	let db: FakeDb;

	beforeEach(() => {
		db = new FakeDb();
		db.settings.set("site_mode", "shared");
	});

	it("accepts the correct password", async () => {
		await call(db, "/register", {
			email: "user@example.com",
			name: "alice",
			password: "right-password",
		});
		const { status, body } = await call(db, "/login", {
			account: "user@example.com",
			password: "right-password",
		});

		expect(status).toBe(200);
		expect(body.token).toMatch(/^u_/);
	});

	it("accepts a username as well as an email", async () => {
		await call(db, "/register", {
			email: "user@example.com",
			name: "alice",
			password: "right-password",
		});
		const { status } = await call(db, "/login", {
			account: "alice",
			password: "right-password",
		});

		expect(status).toBe(200);
	});

	it("rejects a wrong password", async () => {
		await call(db, "/register", {
			email: "user@example.com",
			name: "alice",
			password: "right-password",
		});
		const { status } = await call(db, "/login", {
			account: "user@example.com",
			password: "wrong-password",
		});

		expect(status).toBe(401);
	});

	it("rejects an unknown account", async () => {
		const { status } = await call(db, "/login", {
			account: "nobody@example.com",
			password: "whatever",
		});

		expect(status).toBe(401);
	});

	it("keeps working for an account still on a legacy SHA-256 hash", async () => {
		seedUser(db, await legacyHash("old-password"));

		const { status } = await call(db, "/login", {
			account: "user@example.com",
			password: "old-password",
		});

		expect(status).toBe(200);
	});

	it("upgrades a legacy hash on the first successful login", async () => {
		seedUser(db, await legacyHash("old-password"));

		await call(db, "/login", {
			account: "user@example.com",
			password: "old-password",
		});

		const stored = String(db.users[0].password_hash);
		expect(isLegacyHash(stored)).toBe(false);
		expect(stored).toMatch(/^pbkdf2\$/);
		expect(await verifyPassword("old-password", stored)).toBe(true);
	});

	it("does not upgrade the hash when the password is wrong", async () => {
		const legacy = await legacyHash("old-password");
		seedUser(db, legacy);

		const { status } = await call(db, "/login", {
			account: "user@example.com",
			password: "wrong-password",
		});

		expect(status).toBe(401);
		expect(db.users[0].password_hash).toBe(legacy);
	});
});
