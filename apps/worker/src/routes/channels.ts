import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
	channelExists,
	deleteChannel,
	getChannelById,
	insertChannel,
	listChannels,
	updateChannel,
} from "../services/channel-repo";
import {
	fetchChannelModels,
	updateChannelTestResult,
} from "../services/channel-testing";
import type { ChannelApiFormat } from "../services/channel-types";
import { generateToken } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { safeJsonParse } from "../utils/json";
import { nowIso } from "../utils/time";
import { normalizeBaseUrl } from "../utils/url";

const channels = new Hono<AppEnv>();

type ChannelPayload = {
	id?: string | number;
	channel_id?: string | number;
	channelId?: string | number;
	name?: string;
	base_url?: string;
	api_key?: string;
	weight?: number;
	status?: string;
	rate_limit?: number;
	models?: unknown[];
	api_format?: string;
	custom_headers?: string;
};

/**
 * Resolves a channel id from request payload.
 *
 * Args:
 *   body: Request payload.
 *
 * Returns:
 *   Channel id if provided.
 */
function resolveChannelId(body: ChannelPayload | null): string | null {
	const candidate = body?.id ?? body?.channel_id ?? body?.channelId;
	if (!candidate) {
		return null;
	}
	const normalized = String(candidate).trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * Lists all channels.
 */
channels.get("/", async (c) => {
	const rows = await listChannels(c.env.DB, {
		orderBy: "created_at",
		order: "DESC",
	});
	return c.json({ channels: rows });
});

/**
 * Creates a new channel.
 */
channels.post("/", async (c) => {
	const body = (await c.req.json().catch(() => null)) as ChannelPayload | null;
	if (!body?.name || !body?.base_url || !body?.api_key) {
		return jsonError(c, 400, "missing_fields", "missing_fields");
	}

	const requestedId = resolveChannelId(body);
	if (requestedId) {
		const exists = await channelExists(c.env.DB, requestedId);
		if (exists) {
			return jsonError(c, 409, "channel_id_exists", "channel_id_exists");
		}
	}

	const id = requestedId ?? generateToken("ch_");
	const now = nowIso();
	const apiFormat = (body.api_format ?? "openai") as ChannelApiFormat;
	const customHeadersJson = body.custom_headers?.trim() || null;

	await insertChannel(c.env.DB, {
		id,
		name: body.name,
		base_url:
			apiFormat === "custom"
				? String(body.base_url)
				: normalizeBaseUrl(String(body.base_url)),
		api_key: body.api_key,
		weight: Number(body.weight ?? 1),
		status: body.status ?? "active",
		rate_limit: body.rate_limit ?? 0,
		models_json: JSON.stringify(body.models ?? []),
		type: 1,
		group_name: null,
		priority: 0,
		metadata_json: null,
		api_format: apiFormat,
		custom_headers_json: customHeadersJson,
		created_at: now,
		updated_at: now,
	});

	return c.json({ id });
});

/**
 * Updates a channel.
 */
channels.patch("/:id", async (c) => {
	const body = (await c.req.json().catch(() => null)) as ChannelPayload | null;
	const id = c.req.param("id");
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const current = await getChannelById(c.env.DB, id);
	if (!current) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	const models = body.models ?? safeJsonParse(current.models_json, []);
	const apiFormat = (body.api_format ??
		current.api_format ??
		"openai") as ChannelApiFormat;
	const customHeadersJson =
		body.custom_headers !== undefined
			? body.custom_headers?.trim() || null
			: (current.custom_headers_json ?? null);
	const baseUrl =
		apiFormat === "custom"
			? String(body.base_url ?? current.base_url)
			: normalizeBaseUrl(String(body.base_url ?? current.base_url));

	await updateChannel(c.env.DB, id, {
		name: body.name ?? current.name,
		base_url: baseUrl,
		api_key: body.api_key ?? current.api_key,
		weight: Number(body.weight ?? current.weight ?? 1),
		status: body.status ?? current.status,
		rate_limit: body.rate_limit ?? current.rate_limit ?? 0,
		models_json: JSON.stringify(models),
		type: current.type ?? 1,
		group_name: current.group_name ?? null,
		priority: current.priority ?? 0,
		metadata_json: current.metadata_json ?? null,
		api_format: apiFormat,
		custom_headers_json: customHeadersJson,
		updated_at: nowIso(),
	});

	return c.json({ ok: true });
});

/**
 * Deletes a channel.
 */
channels.delete("/:id", async (c) => {
	const id = c.req.param("id");
	await deleteChannel(c.env.DB, id);
	return c.json({ ok: true });
});

/**
 * Tests channel connectivity and updates model list.
 */
channels.post("/:id/test", async (c) => {
	const id = c.req.param("id");
	const channel = await getChannelById(c.env.DB, id);
	if (!channel) {
		return jsonError(c, 404, "channel_not_found", "channel_not_found");
	}

	const result = await fetchChannelModels(
		String(channel.base_url),
		String(channel.api_key),
		channel.api_format,
		channel.custom_headers_json,
	);

	if (!result.ok) {
		await updateChannelTestResult(c.env.DB, id, {
			ok: false,
			elapsed: result.elapsed,
		});
		return jsonError(c, 502, "channel_unreachable", "channel_unreachable");
	}

	// Only overwrite models_json when the test actually returned models
	const hasModels = result.models.length > 0;
	const updateData: {
		ok: boolean;
		elapsed: number;
		modelsJson?: string;
	} = { ok: true, elapsed: result.elapsed };
	if (hasModels && result.payload) {
		updateData.modelsJson = JSON.stringify(result.payload);
	}
	await updateChannelTestResult(c.env.DB, id, updateData);

	const models = hasModels
		? result.models
		: safeJsonParse(channel.models_json, []);
	return c.json({ ok: true, models });
});

export default channels;
