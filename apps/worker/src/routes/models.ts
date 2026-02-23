import { Hono } from "hono";
import type { AppEnv } from "../env";
import { extractModelPricings, modelsToJson } from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import { listAllAliases } from "../services/model-aliases";
import { jsonError } from "../utils/http";

const models = new Hono<AppEnv>();

type ChannelInfo = {
	id: string;
	name: string;
	input_price: number | null;
	output_price: number | null;
	avg_latency_ms: number | null;
};

type DailyUsage = { day: string; requests: number; tokens: number };

type ModelResult = {
	id: string;
	display_name: string;
	aliases: Array<{ alias: string; is_primary: boolean }>;
	channels: ChannelInfo[];
	total_requests: number;
	total_tokens: number;
	total_cost: number;
	avg_latency_ms: number | null;
	daily: DailyUsage[];
};

/**
 * Returns aggregated models with pricing, latency, and usage stats.
 */
models.get("/", async (c) => {
	const channels = await listActiveChannels(c.env.DB);

	// Build model -> channels map with pricing
	const modelMap = new Map<string, ChannelInfo[]>();
	for (const channel of channels) {
		const pricings = extractModelPricings(channel);
		for (const p of pricings) {
			const existing = modelMap.get(p.id) ?? [];
			existing.push({
				id: channel.id,
				name: channel.name,
				input_price: p.input_price ?? null,
				output_price: p.output_price ?? null,
				avg_latency_ms: null,
			});
			modelMap.set(p.id, existing);
		}
	}

	// Aggregate usage stats from last 30 days
	const usageAgg = await c.env.DB.prepare(
		`SELECT model,
			COUNT(*) as total_requests,
			SUM(total_tokens) as total_tokens,
			SUM(cost) as total_cost,
			AVG(latency_ms) as avg_latency_ms
		FROM usage_logs
		WHERE created_at > datetime('now', '-30 days') AND model IS NOT NULL
		GROUP BY model`,
	).all<{
		model: string;
		total_requests: number;
		total_tokens: number;
		total_cost: number;
		avg_latency_ms: number;
	}>();

	const usageMap = new Map<
		string,
		{
			total_requests: number;
			total_tokens: number;
			total_cost: number;
			avg_latency_ms: number | null;
		}
	>();
	for (const row of usageAgg.results ?? []) {
		usageMap.set(row.model, {
			total_requests: row.total_requests,
			total_tokens: row.total_tokens,
			total_cost: row.total_cost,
			avg_latency_ms: row.avg_latency_ms,
		});
	}

	// Daily usage for last 7 days
	const dailyAgg = await c.env.DB.prepare(
		`SELECT model,
			DATE(created_at) as day,
			COUNT(*) as requests,
			SUM(total_tokens) as tokens
		FROM usage_logs
		WHERE created_at > datetime('now', '-7 days') AND model IS NOT NULL
		GROUP BY model, DATE(created_at)
		ORDER BY day`,
	).all<{
		model: string;
		day: string;
		requests: number;
		tokens: number;
	}>();

	const dailyMap = new Map<string, DailyUsage[]>();
	for (const row of dailyAgg.results ?? []) {
		const existing = dailyMap.get(row.model) ?? [];
		existing.push({
			day: row.day,
			requests: row.requests,
			tokens: row.tokens,
		});
		dailyMap.set(row.model, existing);
	}

	// Per-channel avg latency
	const channelLatency = await c.env.DB.prepare(
		`SELECT model, channel_id, AVG(latency_ms) as avg_latency_ms
		FROM usage_logs
		WHERE created_at > datetime('now', '-30 days') AND model IS NOT NULL AND channel_id IS NOT NULL
		GROUP BY model, channel_id`,
	).all<{
		model: string;
		channel_id: string;
		avg_latency_ms: number;
	}>();

	const channelLatencyMap = new Map<string, number>();
	for (const row of channelLatency.results ?? []) {
		channelLatencyMap.set(`${row.model}:${row.channel_id}`, row.avg_latency_ms);
	}

	// Load aliases for display_name
	const aliasMap = await listAllAliases(c.env.DB);

	// Build result
	const results: ModelResult[] = [];
	for (const [modelId, channelInfos] of modelMap) {
		const usage = usageMap.get(modelId);
		// Enrich channels with per-channel latency
		const enrichedChannels = channelInfos.map((ch) => ({
			...ch,
			avg_latency_ms:
				channelLatencyMap.get(`${modelId}:${ch.id}`) != null
					? Math.round(channelLatencyMap.get(`${modelId}:${ch.id}`)!)
					: null,
		}));

		const aliases = aliasMap.get(modelId) ?? [];
		const primary = aliases.find((a) => a.is_primary);
		const displayName = primary ? primary.alias : modelId;

		results.push({
			id: modelId,
			display_name: displayName,
			aliases,
			channels: enrichedChannels,
			total_requests: usage?.total_requests ?? 0,
			total_tokens: usage?.total_tokens ?? 0,
			total_cost: usage?.total_cost ?? 0,
			avg_latency_ms: usage?.avg_latency_ms
				? Math.round(usage.avg_latency_ms)
				: null,
			daily: dailyMap.get(modelId) ?? [],
		});
	}

	return c.json({ models: results });
});

/**
 * Batch-update prices for a single model across multiple channels.
 */
models.put("/prices/:modelId", async (c) => {
	const modelId = c.req.param("modelId");
	const body = await c.req.json().catch(() => null);
	if (!body || !Array.isArray(body.prices)) {
		return jsonError(c, 400, "body must contain prices array", "invalid_body");
	}

	const db = c.env.DB;
	const stmts: ReturnType<typeof db.prepare>[] = [];
	const now = new Date().toISOString();

	for (const item of body.prices) {
		if (!item.channel_id || typeof item.channel_id !== "string") {
			return jsonError(c, 400, "each price entry must have a channel_id", "invalid_body");
		}

		const row = await db
			.prepare("SELECT models_json FROM channels WHERE id = ?")
			.bind(item.channel_id)
			.first<{ models_json: string | null }>();

		if (!row) {
			return jsonError(c, 404, `channel ${item.channel_id} not found`, "not_found");
		}

		const pricings = extractModelPricings({ models_json: row.models_json });
		const entry = pricings.find((p) => p.id === modelId);
		if (!entry) {
			return jsonError(
				c,
				404,
				`model ${modelId} not found in channel ${item.channel_id}`,
				"not_found",
			);
		}

		entry.input_price = item.input_price != null ? Number(item.input_price) : entry.input_price;
		entry.output_price = item.output_price != null ? Number(item.output_price) : entry.output_price;

		const updatedJson = modelsToJson(pricings);
		stmts.push(
			db
				.prepare("UPDATE channels SET models_json = ?, updated_at = ? WHERE id = ?")
				.bind(updatedJson, now, item.channel_id),
		);
	}

	if (stmts.length > 0) {
		await db.batch(stmts);
	}

	return c.json({ ok: true });
});

export default models;
