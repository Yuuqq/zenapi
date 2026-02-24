import { Hono } from "hono";
import type { AppEnv } from "../env";
import { userAuth } from "../middleware/userAuth";
import { saveAliasesForModel } from "../services/model-aliases";
import { getSiteMode } from "../services/settings";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";

type AliasConfig = {
	aliases: Array<{ alias: string; is_primary: boolean }>;
	alias_only: boolean;
};

const userChannels = new Hono<AppEnv>();

// All routes require user authentication
userChannels.use("/*", userAuth);

/**
 * Lists channels contributed by the current user.
 */
userChannels.get("/", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const result = await c.env.DB.prepare(
		"SELECT id, name, base_url, api_key, models_json, api_format, status, tip_url, created_at FROM channels WHERE contributed_by = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all();

	const channels = result.results ?? [];

	// Collect all model IDs across user's channels
	const allModelIds = new Set<string>();
	for (const ch of channels) {
		const modelsJson = ch.models_json as string | null;
		if (!modelsJson) continue;
		try {
			const parsed = JSON.parse(modelsJson);
			const arr = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.data)
					? parsed.data
					: [];
			for (const m of arr) {
				const id = typeof m === "string" ? m : m?.id;
				if (id) allModelIds.add(id);
			}
		} catch {
			// skip malformed JSON
		}
	}

	// Batch-query aliases for all model IDs (D1 limits bind params to 100)
	const modelAliases: Record<string, AliasConfig> = {};
	if (allModelIds.size > 0) {
		const ids = [...allModelIds];
		const BATCH_SIZE = 80;
		for (let i = 0; i < ids.length; i += BATCH_SIZE) {
			const batch = ids.slice(i, i + BATCH_SIZE);
			const placeholders = batch.map(() => "?").join(",");
			const aliasRows = await c.env.DB.prepare(
				`SELECT model_id, alias, is_primary, alias_only FROM model_aliases WHERE model_id IN (${placeholders}) ORDER BY model_id, is_primary DESC, alias`,
			)
				.bind(...batch)
				.all<{ model_id: string; alias: string; is_primary: number; alias_only: number }>();

			for (const row of aliasRows.results ?? []) {
				if (!modelAliases[row.model_id]) {
					modelAliases[row.model_id] = { aliases: [], alias_only: false };
				}
				modelAliases[row.model_id].aliases.push({
					alias: row.alias,
					is_primary: row.is_primary === 1,
				});
				if (row.alias_only === 1) {
					modelAliases[row.model_id].alias_only = true;
				}
			}
		}
	}

	return c.json({ channels, model_aliases: modelAliases });
});

/**
 * Contributes a new channel (shared mode only).
 */
userChannels.post("/", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const body = await c.req.json().catch(() => null);
	if (!body?.name || !body?.base_url) {
		return jsonError(c, 400, "missing_fields", "name, base_url required");
	}

	const id = crypto.randomUUID();
	const now = nowIso();

	let modelsJson: string | null = null;
	if (body.models && Array.isArray(body.models)) {
		modelsJson = JSON.stringify(body.models);
	}

	await c.env.DB.prepare(
		"INSERT INTO channels (id, name, base_url, api_key, weight, status, api_format, models_json, custom_headers_json, contributed_by, tip_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			id,
			String(body.name).trim(),
			String(body.base_url).trim(),
			String(body.api_key ?? "").trim(),
			body.weight ?? 1,
			"active",
			body.api_format ?? "openai",
			modelsJson,
			body.custom_headers ? String(body.custom_headers) : null,
			userId,
			body.tip_url ? String(body.tip_url).trim() : null,
			now,
			now,
		)
		.run();

	// Save model aliases if provided
	if (body.model_aliases && typeof body.model_aliases === "object") {
		const modelIds = modelsJson
			? (JSON.parse(modelsJson) as Array<{ id?: string } | string>).map(
					(m) => (typeof m === "string" ? m : m?.id ?? ""),
				).filter(Boolean)
			: [];
		for (const [modelId, config] of Object.entries(body.model_aliases)) {
			if (!modelIds.includes(modelId)) continue;
			const cfg = config as AliasConfig;
			if (cfg.aliases && cfg.aliases.length > 0) {
				await saveAliasesForModel(
					c.env.DB,
					modelId,
					cfg.aliases.map((a) => ({ alias: a.alias, is_primary: a.is_primary })),
					cfg.alias_only ?? false,
				);
			}
		}
	}

	return c.json({ id });
});

/**
 * Updates a channel contributed by the current user.
 */
userChannels.patch("/:id", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const channelId = c.req.param("id");

	const existing = await c.env.DB.prepare(
		"SELECT id, name, base_url, api_key, api_format, models_json, tip_url FROM channels WHERE id = ? AND contributed_by = ?",
	)
		.bind(channelId, userId)
		.first();

	if (!existing) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const now = nowIso();
	let modelsJson = existing.models_json as string | null;
	if (body.models && Array.isArray(body.models)) {
		modelsJson = JSON.stringify(body.models);
	}

	await c.env.DB.prepare(
		"UPDATE channels SET name = ?, base_url = ?, api_key = ?, api_format = ?, models_json = ?, tip_url = ?, updated_at = ? WHERE id = ? AND contributed_by = ?",
	)
		.bind(
			body.name ? String(body.name).trim() : existing.name,
			body.base_url ? String(body.base_url).trim() : existing.base_url,
			body.api_key ? String(body.api_key).trim() : existing.api_key,
			body.api_format ?? existing.api_format ?? "openai",
			modelsJson,
			body.tip_url !== undefined ? (String(body.tip_url).trim() || null) : (existing.tip_url as string | null),
			now,
			channelId,
			userId,
		)
		.run();

	// Save model aliases if provided
	if (body.model_aliases && typeof body.model_aliases === "object") {
		const modelIds = modelsJson
			? (JSON.parse(modelsJson) as Array<{ id?: string } | string>).map(
					(m) => (typeof m === "string" ? m : m?.id ?? ""),
				).filter(Boolean)
			: [];
		for (const [modelId, config] of Object.entries(body.model_aliases)) {
			if (!modelIds.includes(modelId)) continue;
			const cfg = config as AliasConfig;
			await saveAliasesForModel(
				c.env.DB,
				modelId,
				cfg.aliases?.map((a) => ({ alias: a.alias, is_primary: a.is_primary })) ?? [],
				cfg.alias_only ?? false,
			);
		}
	}

	return c.json({ ok: true });
});

/**
 * Deletes a channel contributed by the current user.
 */
userChannels.delete("/:id", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	if (siteMode !== "shared") {
		return jsonError(c, 403, "shared_mode_only", "shared_mode_only");
	}

	const userId = c.get("userId") as string;
	const channelId = c.req.param("id");

	const existing = await c.env.DB.prepare(
		"SELECT id FROM channels WHERE id = ? AND contributed_by = ?",
	)
		.bind(channelId, userId)
		.first();

	if (!existing) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	await c.env.DB.prepare(
		"DELETE FROM channels WHERE id = ? AND contributed_by = ?",
	)
		.bind(channelId, userId)
		.run();

	return c.json({ ok: true });
});

export default userChannels;
