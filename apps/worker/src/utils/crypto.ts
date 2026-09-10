const encoder = new TextEncoder();

/**
 * Creates a SHA-256 hex digest from input text.
 */
export async function sha256Hex(input: string): Promise<string> {
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Creates a secure PBKDF2 hash of a password.
 * Returns in format "saltHex:hashHex".
 */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"]
	);
	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations: 100000,
			hash: "SHA-256"
		},
		keyMaterial,
		256
	);
	const hashHex = Array.from(new Uint8Array(derivedBits))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const saltHex = Array.from(salt)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `${saltHex}:${hashHex}`;
}

/**
 * Verifies a password against a stored hash (PBKDF2 or legacy SHA-256).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	const parts = storedHash.split(":");
	if (parts.length === 2) {
		const [saltHex, hashHex] = parts;
		const saltArray = saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [];
		const saltBuffer = new Uint8Array(saltArray);

		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			encoder.encode(password),
			{ name: "PBKDF2" },
			false,
			["deriveBits"]
		);
		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				salt: saltBuffer,
				iterations: 100000,
				hash: "SHA-256"
			},
			keyMaterial,
			256
		);
		const derivedHex = Array.from(new Uint8Array(derivedBits))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		return derivedHex === hashHex;
	}

	// Legacy fallback
	const oldHash = await sha256Hex(password);
	return oldHash === storedHash;
}

/**
 * Generates a URL-safe random token with an optional prefix.
 */
export function generateToken(prefix = ""): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	const base = btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return `${prefix}${base}`;
}
