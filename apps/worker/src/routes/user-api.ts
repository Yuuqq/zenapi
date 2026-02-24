import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { UserRecord } from "../middleware/userAuth";
import { userAuth } from "../middleware/userAuth";
import { extractModelPricings, extractSharedModelPricings } from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import { loadPrimaryNameMap } from "../services/model-aliases";
import { getSiteMode } from "../services/settings";
import { generateToken, sha256Hex } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";

const userApi = new Hono<AppEnv>();

// All routes require user authentication
userApi.use("/*", userAuth);

/**
 * Returns models visible to users (with pricing info for service mode).
 */
userApi.get("/models", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	const channels = await listActiveChannels(c.env.DB);

	const modelMap = new Map<
		string,
		Array<{
			id: string;
			name: string;
			input_price: number | null;
			output_price: number | null;
		}>
	>();

	for (const channel of channels) {
		const pricings = siteMode === "shared"
			? extractSharedModelPricings(channel)
			: extractModelPricings(channel);
		for (const p of pricings) {
			const existing = modelMap.get(p.id) ?? [];
			if (siteMode === "shared") {
				existing.push({
					id: channel.id,
					name: "共享渠道",
					input_price: null,
					output_price: null,
				});
			} else {
				existing.push({
					id: channel.id,
					name: channel.name,
					input_price: p.input_price ?? null,
					output_price: p.output_price ?? null,
				});
			}
			modelMap.set(p.id, existing);
		}
	}

	const primaryNames = await loadPrimaryNameMap(c.env.DB);

	const models = Array.from(modelMap.entries()).map(([id, chs]) => ({
		id,
		display_name: primaryNames.get(id) ?? id,
		channels: chs,
	}));

	return c.json({ models, site_mode: siteMode });
});

/**
 * Lists the current user's tokens.
 */
userApi.get("/tokens", async (c) => {
	const userId = c.get("userId") as string;
	const result = await c.env.DB.prepare(
		"SELECT id, name, key_prefix, quota_total, quota_used, status, created_at, updated_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all();
	return c.json({ tokens: result.results ?? [] });
});

/**
 * Creates a new token for the current user.
 */
userApi.post("/tokens", async (c) => {
	const userId = c.get("userId") as string;
	const body = await c.req.json().catch(() => null);
	if (!body?.name) {
		return jsonError(c, 400, "name_required", "name_required");
	}

	const rawToken = generateToken("sk-");
	const tokenHash = await sha256Hex(rawToken);
	const id = crypto.randomUUID();
	const now = nowIso();
	const keyPrefix = rawToken.slice(0, 8);

	await c.env.DB.prepare(
		"INSERT INTO tokens (id, name, key_hash, key_prefix, token_plain, quota_total, quota_used, status, allowed_channels, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(id, body.name, tokenHash, keyPrefix, rawToken, null, 0, "active", null, userId, now, now)
		.run();

	return c.json({ id, token: rawToken });
});

/**
 * Deletes a user's token.
 */
userApi.delete("/tokens/:id", async (c) => {
	const userId = c.get("userId") as string;
	const tokenId = c.req.param("id");

	const existing = await c.env.DB.prepare(
		"SELECT id FROM tokens WHERE id = ? AND user_id = ?",
	)
		.bind(tokenId, userId)
		.first();

	if (!existing) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	await c.env.DB.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?")
		.bind(tokenId, userId)
		.run();

	return c.json({ ok: true });
});

/**
 * Reveals a user's token.
 */
userApi.get("/tokens/:id/reveal", async (c) => {
	const userId = c.get("userId") as string;
	const tokenId = c.req.param("id");

	const record = await c.env.DB.prepare(
		"SELECT token_plain FROM tokens WHERE id = ? AND user_id = ?",
	)
		.bind(tokenId, userId)
		.first<{ token_plain?: string | null }>();

	if (!record) {
		return jsonError(c, 404, "token_not_found", "token_not_found");
	}

	return c.json({ token: record.token_plain ?? null });
});

/**
 * Returns usage logs for the current user's tokens.
 */
userApi.get("/usage", async (c) => {
	const userId = c.get("userId") as string;
	const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);

	const result = await c.env.DB.prepare(
		`SELECT u.id, u.model, u.channel_id, u.token_id, u.total_tokens, u.prompt_tokens, u.completion_tokens, u.cost, u.latency_ms, u.first_token_latency_ms, u.stream, u.reasoning_effort, u.status, u.created_at,
		t.name as token_name
		FROM usage_logs u
		LEFT JOIN tokens t ON u.token_id = t.id
		WHERE t.user_id = ?
		ORDER BY u.created_at DESC
		LIMIT ?`,
	)
		.bind(userId, limit)
		.all();

	return c.json({ logs: result.results ?? [] });
});

/**
 * Returns dashboard data for the current user.
 */
userApi.get("/dashboard", async (c) => {
	const userId = c.get("userId") as string;
	const user = c.get("userRecord") as UserRecord;

	const summary = await c.env.DB.prepare(
		`SELECT
			COUNT(*) as total_requests,
			COALESCE(SUM(u.total_tokens), 0) as total_tokens,
			COALESCE(SUM(u.cost), 0) as total_cost
		FROM usage_logs u
		JOIN tokens t ON u.token_id = t.id
		WHERE t.user_id = ?`,
	)
		.bind(userId)
		.first<{ total_requests: number; total_tokens: number; total_cost: number }>();

	const recentUsage = await c.env.DB.prepare(
		`SELECT
			DATE(u.created_at) as day,
			COUNT(*) as requests,
			COALESCE(SUM(u.cost), 0) as cost
		FROM usage_logs u
		JOIN tokens t ON u.token_id = t.id
		WHERE t.user_id = ?
		GROUP BY DATE(u.created_at)
		ORDER BY day DESC
		LIMIT 30`,
	)
		.bind(userId)
		.all();

	const siteMode = await getSiteMode(c.env.DB);
	let contributions: Array<{
		user_name: string;
		linuxdo_id: string | null;
		channel_count: number;
		channels: Array<{ name: string; requests: number; total_tokens: number }>;
		total_requests: number;
		total_tokens: number;
	}> = [];

	if (siteMode === "shared") {
		const contribRows = await c.env.DB.prepare(
			`SELECT
				u.id AS user_id,
				u.name AS user_name,
				u.linuxdo_id,
				COUNT(DISTINCT c.id) AS channel_count,
				COALESCE(SUM(CASE WHEN ul.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS total_requests,
				COALESCE(SUM(ul.total_tokens), 0) AS total_tokens
			FROM channels c
			JOIN users u ON c.contributed_by = u.id
			LEFT JOIN usage_logs ul ON ul.channel_id = c.id
			WHERE c.contributed_by IS NOT NULL AND c.status = 'active'
			GROUP BY u.id, u.name, u.linuxdo_id
			ORDER BY total_requests DESC`,
		).all();

		const contributorIds = (contribRows.results ?? []).map((r) => String(r.user_id));

		let channelDetailMap = new Map<string, Array<{ name: string; tip_url: string | null; requests: number; total_tokens: number }>>();
		if (contributorIds.length > 0) {
			const channelRows = await c.env.DB.prepare(
				`SELECT
					c.contributed_by,
					c.name,
					c.tip_url,
					COALESCE(SUM(CASE WHEN ul.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS requests,
					COALESCE(SUM(ul.total_tokens), 0) AS total_tokens
				FROM channels c
				LEFT JOIN usage_logs ul ON ul.channel_id = c.id
				WHERE c.contributed_by IS NOT NULL AND c.status = 'active'
				GROUP BY c.id, c.contributed_by, c.name, c.tip_url
				ORDER BY requests DESC`,
			).all();

			for (const row of channelRows.results ?? []) {
				const uid = String(row.contributed_by);
				const arr = channelDetailMap.get(uid) ?? [];
				arr.push({
					name: String(row.name),
					tip_url: row.tip_url ? String(row.tip_url) : null,
					requests: Number(row.requests),
					total_tokens: Number(row.total_tokens),
				});
				channelDetailMap.set(uid, arr);
			}
		}

		contributions = (contribRows.results ?? []).map((row) => ({
			user_name: String(row.user_name),
			linuxdo_id: row.linuxdo_id ? String(row.linuxdo_id) : null,
			channel_count: Number(row.channel_count),
			channels: channelDetailMap.get(String(row.user_id)) ?? [],
			total_requests: Number(row.total_requests),
			total_tokens: Number(row.total_tokens),
		}));
	}

	return c.json({
		balance: user.balance,
		total_requests: summary?.total_requests ?? 0,
		total_tokens: summary?.total_tokens ?? 0,
		total_cost: summary?.total_cost ?? 0,
		recent_usage: recentUsage.results ?? [],
		contributions,
	});
});

export default userApi;
