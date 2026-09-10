import { Hono } from "hono";
import type { AppEnv } from "../env";
import { generateToken, sha256Hex, hashPassword, verifyPassword } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { safeJsonParse } from "../utils/json";
import { nowIso } from "../utils/time";

const tokens = new Hono<AppEnv>();

type TokenRow = {
	id: string;
	name: string;
	key_prefix: string;
	quota_total: number | null;
	quota_used: number;
	status: string;
	allowed_channels: string | null;
};

/**
 * Lists API tokens.
 */
tokens.get("/", async (c) => {
	const result = await c.env.DB.prepare(
		"SELECT tokens.id, tokens.name, tokens.key_prefix, tokens.quota_total, tokens.quota_used, tokens.status, tokens.allowed_channels, tokens.user_id, tokens.created_at, tokens.updated_at, users.name as user_name, users.email as user_email FROM tokens LEFT JOIN users ON users.id = tokens.user_id ORDER BY tokens.created_at DESC",
	).all();
	return c.json({ tokens: result.results ?? [] });
});

/**
 * Creates a new API token.
 */
tokens.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.name) {
		return jsonError(c, 400, "name_required", "name_required");
	}

	const rawToken = generateToken("sk-");
	const tokenHash = await sha256Hex(rawToken);
	const id = crypto.randomUUID();
	const now = nowIso();
	const keyPrefix = rawToken.slice(0, 8);
	const quotaTotal =
		body.quota_total === null || body.quota_total === undefined
			? null
			: Number(body.quota_total);

	await c.env.DB.prepare(
		"INSERT INTO tokens (id, name, key_hash, key_prefix, quota_total, quota_used, status, allowed_channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			id,
			body.name,
			tokenHash,
			keyPrefix,
			Number.isNaN(quotaTotal) ? null : quotaTotal,
			0,
			body.status ?? "active",
			JSON.stringify(body.allowed_channels ?? null),
			now,
			now,
		)
		.run();

	return c.json({
		id,
		token: rawToken,
	});
});

/**
 * Updates an API token.
 */
tokens.patch("/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const existing = await c.env.DB.prepare("SELECT * FROM tokens WHERE id = ?")
		.bind(id)
		.first<TokenRow>();
	if (!existing) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	const existingAllowed = safeJsonParse(existing.allowed_channels, null);
	const quotaTotalUpdate =
		body.quota_total === null || body.quota_total === undefined
			? existing.quota_total
			: Number(body.quota_total);
	const quotaUsedUpdate =
		body.quota_used === null || body.quota_used === undefined
			? existing.quota_used
			: Number(body.quota_used);

	await c.env.DB.prepare(
		"UPDATE tokens SET name = ?, quota_total = ?, quota_used = ?, status = ?, allowed_channels = ?, updated_at = ? WHERE id = ?",
	)
		.bind(
			body.name ?? existing.name,
			Number.isNaN(quotaTotalUpdate) ? existing.quota_total : quotaTotalUpdate,
			Number.isNaN(quotaUsedUpdate) ? existing.quota_used : quotaUsedUpdate,
			body.status ?? existing.status,
			JSON.stringify(body.allowed_channels ?? existingAllowed ?? null),
			nowIso(),
			id,
		)
		.run();

	return c.json({ ok: true });
});


/**
 * Deletes an API token.
 */
tokens.delete("/:id", async (c) => {
	const id = c.req.param("id");
	await c.env.DB.prepare("DELETE FROM tokens WHERE id = ?").bind(id).run();
	return c.json({ ok: true });
});

export default tokens;
