import { Hono } from "hono";
import type { AppEnv } from "../env";

const monitoring = new Hono<AppEnv>();

const RANGE_CONFIG: Record<string, { ms: number; sqlSlice: number }> = {
	"15m": { ms: 15 * 60_000, sqlSlice: 16 },
	"1h": { ms: 60 * 60_000, sqlSlice: 16 },
	"1d": { ms: 86_400_000, sqlSlice: 10 },
	"7d": { ms: 7 * 86_400_000, sqlSlice: 10 },
	"30d": { ms: 30 * 86_400_000, sqlSlice: 10 },
};

monitoring.get("/", async (c) => {
	const range = c.req.query("range") ?? "7d";
	const config = RANGE_CONFIG[range] ?? RANGE_CONFIG["7d"];
	const since = new Date(Date.now() - config.ms)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
	const slotExpr = `substr(created_at, 1, ${config.sqlSlice})`;

	const channelRows = await c.env.DB.prepare(
		`SELECT
			c.id AS channel_id,
			c.name AS channel_name,
			c.status AS channel_status,
			c.api_format,
			COUNT(u.id) AS total_requests,
			COALESCE(SUM(CASE WHEN u.status = 'ok' THEN 1 ELSE 0 END), 0) AS success_count,
			COALESCE(SUM(CASE WHEN u.status != 'ok' THEN 1 ELSE 0 END), 0) AS error_count,
			COALESCE(AVG(u.latency_ms), 0) AS avg_latency_ms,
			MAX(u.created_at) AS last_seen
		FROM channels c
		LEFT JOIN usage_logs u ON u.channel_id = c.id AND u.created_at >= ?
		GROUP BY c.id, c.name, c.status, c.api_format
		ORDER BY total_requests DESC`,
	)
		.bind(since)
		.all();

	const dailyRows = await c.env.DB.prepare(
		`SELECT
			channel_id,
			${slotExpr} AS day,
			COUNT(*) AS requests,
			SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS success,
			SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) AS errors,
			COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
		FROM usage_logs
		WHERE created_at >= ?
		GROUP BY channel_id, day
		ORDER BY day DESC, requests DESC`,
	)
		.bind(since)
		.all();

	const globalRow = await c.env.DB.prepare(
		`SELECT
			COUNT(*) AS total_requests,
			COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS total_success,
			COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS total_errors,
			COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
		FROM usage_logs
		WHERE created_at >= ?`,
	)
		.bind(since)
		.first();

	// Always query last 15 minutes for system status
	const recentSince = new Date(Date.now() - 15 * 60_000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
	const recentRow = await c.env.DB.prepare(
		`SELECT
			COUNT(*) AS total_requests,
			COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS total_success,
			COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS total_errors,
			COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
		FROM usage_logs
		WHERE created_at >= ?`,
	)
		.bind(recentSince)
		.first();

	const totalRequests = Number(globalRow?.total_requests ?? 0);
	const totalSuccess = Number(globalRow?.total_success ?? 0);
	const totalErrors = Number(globalRow?.total_errors ?? 0);

	const channels = (channelRows.results ?? []).map((row) => {
		const total = Number(row.total_requests);
		const success = Number(row.success_count);
		return {
			channel_id: row.channel_id,
			channel_name: row.channel_name,
			channel_status: row.channel_status,
			api_format: row.api_format,
			total_requests: total,
			success_count: success,
			error_count: Number(row.error_count),
			success_rate: total > 0 ? Math.round((success / total) * 10000) / 100 : null,
			avg_latency_ms: Math.round(Number(row.avg_latency_ms)),
			last_seen: row.last_seen ?? null,
		};
	});

	const dailyTrends = (dailyRows.results ?? []).map((row) => {
		const reqs = Number(row.requests);
		const succ = Number(row.success);
		return {
			channel_id: row.channel_id,
			day: row.day,
			requests: reqs,
			success: succ,
			errors: Number(row.errors),
			success_rate: reqs > 0 ? Math.round((succ / reqs) * 10000) / 100 : 0,
			avg_latency_ms: Math.round(Number(row.avg_latency_ms)),
		};
	});

	const activeChannels = channels.filter((ch) => ch.total_requests > 0).length;

	const recentRequests = Number(recentRow?.total_requests ?? 0);
	const recentSuccess = Number(recentRow?.total_success ?? 0);
	const recentErrors = Number(recentRow?.total_errors ?? 0);

	return c.json({
		summary: {
			total_requests: totalRequests,
			total_success: totalSuccess,
			total_errors: totalErrors,
			avg_latency_ms: Math.round(Number(globalRow?.avg_latency_ms ?? 0)),
			success_rate:
				totalRequests > 0
					? Math.round((totalSuccess / totalRequests) * 10000) / 100
					: 100,
			active_channels: activeChannels,
			total_channels: channels.length,
		},
		recentStatus: {
			total_requests: recentRequests,
			total_success: recentSuccess,
			total_errors: recentErrors,
			avg_latency_ms: Math.round(Number(recentRow?.avg_latency_ms ?? 0)),
			success_rate:
				recentRequests > 0
					? Math.round((recentSuccess / recentRequests) * 10000) / 100
					: 100,
		},
		channels,
		dailyTrends,
		range,
	});
});

export default monitoring;
