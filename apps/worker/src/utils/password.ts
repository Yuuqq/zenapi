/**
 * Password hashing for user and admin credentials.
 *
 * Passwords are stored as PBKDF2-HMAC-SHA256 with a per-password random salt,
 * which WebCrypto provides natively in Workers. The format is
 *
 *     pbkdf2$<iterations>$<salt-b64url>$<hash-b64url>
 *
 * so the parameters travel with the hash and can be raised later without
 * invalidating existing rows.
 *
 * Rows written before this module existed hold a bare hex SHA-256 digest.
 * Those are still accepted on login and are re-hashed to PBKDF2 the first time
 * they verify, so the table upgrades itself without a migration.
 */

const SCHEME = "pbkdf2";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const encoder = new TextEncoder();

/** A bare lowercase hex digest, i.e. the pre-PBKDF2 storage format. */
const LEGACY_HEX = /^[0-9a-f]{64}$/;

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function derive(
	password: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		key,
		KEY_BITS,
	);
	return new Uint8Array(bits);
}

/** Compares two byte arrays without leaking where they first differ. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

/** Hashes a password for storage. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, ITERATIONS);
	return `${SCHEME}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** True when the stored value predates PBKDF2 and needs upgrading. */
export function isLegacyHash(stored: string): boolean {
	return LEGACY_HEX.test(stored);
}

/**
 * Verifies a password against a stored hash.
 *
 * `maxIterations` bounds the work a stored value can demand. Login passes the
 * full budget; the per-request admin-password check passes the same, because a
 * tampered iteration count must not turn every request into a CPU burn.
 *
 * Returns `true` only when the password matches. Never throws on a malformed
 * stored value: an unreadable hash is treated as a failed login.
 */
async function verify(
	password: string,
	stored: string,
	maxIterations: number,
): Promise<boolean> {
	const parts = stored.split("$");

	if (parts.length === 4 && parts[0] === SCHEME) {
		const iterations = Number(parts[1]);
		if (!Number.isInteger(iterations) || iterations < 1) {
			return false;
		}
		if (iterations > maxIterations) {
			return false;
		}
		try {
			const salt = fromBase64Url(parts[2]);
			const expected = fromBase64Url(parts[3]);
			const actual = await derive(password, salt, iterations);
			return timingSafeEqual(actual, expected);
		} catch {
			return false;
		}
	}

	if (isLegacyHash(stored)) {
		const actual = new Uint8Array(
			await crypto.subtle.digest("SHA-256", encoder.encode(password)),
		);
		const expected = new Uint8Array(
			stored.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
		);
		return timingSafeEqual(actual, expected);
	}

	return false;
}

/** Verifies a password at login time, with the full iteration budget. */
export function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	return verify(password, stored, ITERATIONS);
}

/**
 * Reports whether a stored value needs re-hashing after a successful login.
 *
 * Call this only after `verifyPassword` returned true, so the plaintext is
 * known to be correct.
 */
export function needsRehash(stored: string): boolean {
	if (isLegacyHash(stored)) {
		return true;
	}
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== SCHEME) {
		return true;
	}
	return Number(parts[1]) < ITERATIONS;
}
