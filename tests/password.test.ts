/**
 * Password hashing: storage format, verification, and the legacy upgrade path.
 *
 * The requirement is not "the function hashes things" but "a stolen database
 * does not hand an attacker a table of fast-to-crack digests, and every
 * existing account keeps working".
 */

import { describe, expect, it } from "vitest";

import {
	hashPassword,
	isLegacyHash,
	needsRehash,
	verifyPassword,
} from "../apps/worker/src/utils/password";

/** SHA-256 hex, i.e. the format rows written before PBKDF2 used. */
async function legacyHash(password: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(password),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

describe("hashPassword", () => {
	it("produces a versioned, self-describing value", async () => {
		const hash = await hashPassword("correct-horse-battery-staple");

		expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
		expect(hash.split("$")[1]).toBe("100000");
	});

	it("never stores the plaintext", async () => {
		const password = "hunter2-and-then-some";
		const hash = await hashPassword(password);

		expect(hash).not.toContain(password);
		expect(hash).not.toContain(btoa(password));
	});

	it("salts each hash, so equal passwords differ", async () => {
		const a = await hashPassword("same-password");
		const b = await hashPassword("same-password");

		expect(a).not.toBe(b);
		expect(await verifyPassword("same-password", a)).toBe(true);
		expect(await verifyPassword("same-password", b)).toBe(true);
	});

	it("produces a 256-bit hash", async () => {
		const hash = await hashPassword("x");
		const encoded = hash.split("$")[3];

		// base64url of 32 bytes is 43 characters, unpadded.
		expect(encoded.length).toBe(43);
	});
});

describe("verifyPassword", () => {
	it("accepts the correct password", async () => {
		const hash = await hashPassword("s3cret-passphrase");
		expect(await verifyPassword("s3cret-passphrase", hash)).toBe(true);
	});

	it("rejects the wrong password", async () => {
		const hash = await hashPassword("s3cret-passphrase");
		expect(await verifyPassword("s3cret-passphras", hash)).toBe(false);
		expect(await verifyPassword("S3cret-passphrase", hash)).toBe(false);
		expect(await verifyPassword("", hash)).toBe(false);
	});

	it("handles non-ASCII passwords", async () => {
		const password = "密码-🔐-пароль";
		const hash = await hashPassword(password);

		expect(await verifyPassword(password, hash)).toBe(true);
		expect(await verifyPassword("密码", hash)).toBe(false);
	});

	it("handles a very long password", async () => {
		const password = "a".repeat(10_000);
		const hash = await hashPassword(password);

		expect(await verifyPassword(password, hash)).toBe(true);
	});

	it("treats a malformed stored value as a failed login, not a crash", async () => {
		for (const stored of [
			"",
			"garbage",
			"pbkdf2$notanumber$c2FsdA$aGFzaA",
			"pbkdf2$100000$$",
			"pbkdf2$100000$!!!$???",
			"bcrypt$12$abc$def",
			"$",
		]) {
			expect(await verifyPassword("anything", stored)).toBe(false);
		}
	});

	it("rejects a hash whose iteration count is zero or negative", async () => {
		const hash = await hashPassword("x");
		const parts = hash.split("$");

		for (const iterations of ["0", "-1", "NaN", "1.5"]) {
			const tampered = [parts[0], iterations, parts[2], parts[3]].join("$");
			expect(await verifyPassword("x", tampered)).toBe(false);
		}
	});
});

describe("legacy SHA-256 hashes", () => {
	it("are recognised as legacy", async () => {
		expect(isLegacyHash(await legacyHash("x"))).toBe(true);
		expect(isLegacyHash(await hashPassword("x"))).toBe(false);
	});

	it("still verify, so existing accounts keep working", async () => {
		const stored = await legacyHash("old-password");

		expect(await verifyPassword("old-password", stored)).toBe(true);
		expect(await verifyPassword("wrong-password", stored)).toBe(false);
	});

	it("are flagged for rehashing after a successful login", async () => {
		expect(needsRehash(await legacyHash("x"))).toBe(true);
		expect(needsRehash(await hashPassword("x"))).toBe(false);
	});

	it("upgrade to PBKDF2 and then verify against the new value", async () => {
		const legacy = await legacyHash("upgrade-me");
		expect(await verifyPassword("upgrade-me", legacy)).toBe(true);

		const upgraded = await hashPassword("upgrade-me");
		expect(needsRehash(upgraded)).toBe(false);
		expect(await verifyPassword("upgrade-me", upgraded)).toBe(true);
		expect(await verifyPassword("upgrade-me", legacy)).toBe(true);
	});
});

describe("needsRehash", () => {
	it("flags a PBKDF2 hash with a lower iteration count", async () => {
		// Simulate a row written when the cost was lower: derive the hash with
		// the parameters the row claims, the way an older version would have.
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode("x"),
			"PBKDF2",
			false,
			["deriveBits"],
		);
		const bits = new Uint8Array(
			await crypto.subtle.deriveBits(
				{ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" },
				key,
				256,
			),
		);
		const b64 = (bytes: Uint8Array) =>
			btoa(String.fromCharCode(...bytes))
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
		const weak = `pbkdf2$1000$${b64(salt)}$${b64(bits)}`;

		expect(needsRehash(weak)).toBe(true);
		expect(await verifyPassword("x", weak)).toBe(true);
		expect(await verifyPassword("y", weak)).toBe(false);
	});

	it("flags an unparseable value so it gets replaced on next login", () => {
		expect(needsRehash("garbage")).toBe(true);
		expect(needsRehash("")).toBe(true);
	});
});
