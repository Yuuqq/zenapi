import { Hono } from "hono";
import type { AppEnv } from "../env";
import { extractModelPricings, extractSharedModelPricings } from "../services/channel-models";
import { listActiveChannels } from "../services/channel-repo";
import { getSiteMode } from "../services/settings";

const publicRoutes = new Hono<AppEnv>();

/**
 * Lightweight site info endpoint — always accessible.
 */
publicRoutes.get("/site-info", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);
	return c.json({ site_mode: siteMode });
});

/**
 * Public models endpoint — controlled by site mode.
 *
 * personal → 403, not public
 * service  → show models with prices (users pay per usage)
 * shared   → show shared-flagged models only, hide prices and channel names
 */
publicRoutes.get("/models", async (c) => {
	const siteMode = await getSiteMode(c.env.DB);

	if (siteMode === "personal") {
		return c.json({ error: "模型信息不公开" }, 403);
	}

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

	const models = Array.from(modelMap.entries()).map(([id, chs]) => ({
		id,
		channels: chs,
	}));

	return c.json({ models, site_mode: siteMode });
});

export default publicRoutes;
