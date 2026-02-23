import { Hono } from "hono";
import type { AppEnv } from "../env";
import { userAuth } from "../middleware/userAuth";
import { getSiteMode } from "../services/settings";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";

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
		"SELECT id, name, base_url, api_key, models_json, api_format, status, created_at FROM channels WHERE contributed_by = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all();

	return c.json({ channels: result.results ?? [] });
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
		"INSERT INTO channels (id, name, base_url, api_key, weight, status, api_format, models_json, custom_headers_json, contributed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
			now,
			now,
		)
		.run();

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
		"SELECT id, name, base_url, api_key, api_format, models_json FROM channels WHERE id = ? AND contributed_by = ?",
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
		"UPDATE channels SET name = ?, base_url = ?, api_key = ?, api_format = ?, models_json = ?, updated_at = ? WHERE id = ? AND contributed_by = ?",
	)
		.bind(
			body.name ? String(body.name).trim() : existing.name,
			body.base_url ? String(body.base_url).trim() : existing.base_url,
			body.api_key ? String(body.api_key).trim() : existing.api_key,
			body.api_format ?? existing.api_format ?? "openai",
			modelsJson,
			now,
			channelId,
			userId,
		)
		.run();

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
