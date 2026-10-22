/**
 * Admin login end to end, against an in-memory stand-in for D1.
 *
 * The unit tests cover the hash format; this covers the behaviour that matters
 * to a user: first login claims the account, the password is not stored in a
 * fast-to-crack form, existing SHA-256 rows keep working and get upgraded, and
 * a wrong password is rejected.
 */

import { beforeEach, describe, expect, it } from "vitest";

import auth from "../apps/worker/src/routes/auth";
import {
	isLegacyHash,
	verifyPassword,
} from "../apps/worker/src/utils/password";

type Row = Record<string, unknown>;

/**
 * Minimal D1 replacement covering the statements these routes issue.
 * Each `prepare` is matched on its SQL text, not parsed.
 */
class FakeDb {
	settings = new Map<string, string>();
	sessions: Row[] = [];
	log: string[] = [];

	prepare(sql: string) {
		const db = this;
		const bind = (...params: unknown[]) => ({
			async first<T>(): Promise<T | undefined> {
				db.log.push(sql);
				if (sql.includes("FROM settings")) {
					const value = db.settings.get(String(params[0]));
					return value === undefined ? undefined : ({ value } as T);
				}
				if (sql.includes("FROM admin_sessions")) {
					const hash = String(params[0]);
					return db.sessions.find((s) => s.token_hash === hash) as
						| T
						| undefined;
				}
				return undefined;
			},
			async run() {
				db.log.push(sql);
				if (sql.includes("INTO settings")) {
					db.settings.set(String(params[0]), String(params[1]));
				} else if (sql.includes("INTO admin_sessions")) {
					db.sessions.push({
						id: params[0],
						token_hash: params[1],
						expires_at: params[2],
						created_at: params[3],
					});
				} else if (sql.includes("DELETE FROM admin_sessions")) {
					db.sessions = db.sessions.filter((s) => s.id !== params[0]);
				}
				return { success: true };
			},
		});
		return { bind };
	}
}

function loginRequest(password: string): Request {
	return new Request("http://localhost/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password }),
	});
}

async function post(db: FakeDb, password: string) {
	const res = await auth.fetch(loginRequest(password), {
		DB: db,
	} as never);
	return { status: res.status, body: (await res.json()) as Row };
}

/** SHA-256 hex, the format rows written before this change used. */
async function legacyHash(password: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(password),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

describe("admin login", () => {
	let db: FakeDb;

	beforeEach(() => {
		db = new FakeDb();
	});

	it("claims the account on first login", async () => {
		const { status, body } = await post(db, "first-password");

		expect(status).toBe(200);
		expect(body.token).toMatch(/^admin_/);
		expect(db.settings.get("admin_password_hash")).toBeDefined();
	});

	it("stores a PBKDF2 hash, never the password or a bare digest", async () => {
		await post(db, "first-password");
		const stored = db.settings.get("admin_password_hash") ?? "";

		expect(stored).toMatch(/^pbkdf2\$/);
		expect(isLegacyHash(stored)).toBe(false);
		expect(stored).not.toContain("first-password");
		expect(await verifyPassword("first-password", stored)).toBe(true);
	});

	it("accepts the same password on a later login", async () => {
		await post(db, "my-admin-password");
		const { status } = await post(db, "my-admin-password");

		expect(status).toBe(200);
	});

	it("rejects a wrong password", async () => {
		await post(db, "my-admin-password");
		const { status } = await post(db, "not-my-password");

		expect(status).toBe(401);
	});

	it("rejects a missing password", async () => {
		const res = await auth.fetch(
			new Request("http://localhost/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			}),
			{ DB: db } as never,
		);

		expect(res.status).toBe(400);
	});

	it("keeps working for an account still on a legacy SHA-256 hash", async () => {
		db.settings.set("admin_password_hash", await legacyHash("old-password"));

		const { status } = await post(db, "old-password");
		expect(status).toBe(200);
	});

	it("upgrades a legacy hash on the first successful login", async () => {
		db.settings.set("admin_password_hash", await legacyHash("old-password"));

		await post(db, "old-password");
		const stored = db.settings.get("admin_password_hash") ?? "";

		expect(stored).toMatch(/^pbkdf2\$/);
		expect(await verifyPassword("old-password", stored)).toBe(true);
	});

	it("does not upgrade the hash when the password is wrong", async () => {
		const legacy = await legacyHash("old-password");
		db.settings.set("admin_password_hash", legacy);

		const { status } = await post(db, "wrong-password");

		expect(status).toBe(401);
		expect(db.settings.get("admin_password_hash")).toBe(legacy);
	});

	it("issues a session row that the token maps to", async () => {
		const { body } = await post(db, "session-password");
		const token = String(body.token);

		expect(db.sessions).toHaveLength(1);
		// The stored value is the hash of the token, never the token itself.
		expect(db.sessions[0].token_hash).not.toBe(token);
		expect(String(db.sessions[0].token_hash)).toMatch(/^[0-9a-f]{64}$/);
	});
});
