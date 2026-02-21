import type { D1Database } from "@cloudflare/workers-types";
import { safeJsonParse } from "../utils/json";
import { nowIso } from "../utils/time";
import { normalizeBaseUrl } from "../utils/url";
import { modelsToJson, normalizeModelsInput } from "./channel-models";
import type { ChannelApiFormat } from "./channel-types";

export type ChannelTestResult = {
	ok: boolean;
	elapsed: number;
	models: string[];
	payload?: unknown[] | { data?: unknown[] };
};

/**
 * Tests channel connectivity via GET /v1/models.
 * If the server responds (any status), the channel is considered reachable.
 * Models are only populated when the endpoint returns a valid list.
 * For custom format, probes the base_url directly.
 */
export async function fetchChannelModels(
	baseUrl: string,
	apiKey: string,
	apiFormat?: ChannelApiFormat,
	customHeadersJson?: string | null,
): Promise<ChannelTestResult> {
	const format = apiFormat ?? "openai";

	let target: string;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (format === "custom") {
		target = baseUrl;
	} else {
		target = `${normalizeBaseUrl(baseUrl)}/v1/models`;
	}

	if (format === "anthropic") {
		headers["x-api-key"] = apiKey;
		headers["anthropic-version"] = "2023-06-01";
	} else {
		headers.Authorization = `Bearer ${apiKey}`;
		headers["x-api-key"] = apiKey;
	}

	if (format === "custom" && customHeadersJson) {
		const custom = safeJsonParse<Record<string, string>>(customHeadersJson, {});
		for (const [key, value] of Object.entries(custom)) {
			headers[key] = value;
		}
	}

	const start = Date.now();
	try {
		const response = await fetch(target, { method: "GET", headers });
		const elapsed = Date.now() - start;

		if (!response.ok) {
			// Server responded — channel is reachable, just no model list
			return { ok: true, elapsed, models: [] };
		}

		const payload = (await response.json().catch(() => ({ data: [] }))) as
			| { data?: unknown[] }
			| unknown[];
		const models = normalizeModelsInput(
			Array.isArray(payload) ? payload : (payload.data ?? payload),
		);
		return { ok: true, elapsed, models, payload };
	} catch {
		// Network error — truly unreachable
		const elapsed = Date.now() - start;
		return { ok: false, elapsed, models: [] };
	}
}

export async function updateChannelTestResult(
	db: D1Database,
	id: string,
	result: {
		ok: boolean;
		elapsed: number;
		models?: string[];
		modelsJson?: string;
	},
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const status = result.ok ? "active" : "error";
	const modelsJson =
		result.modelsJson ??
		(result.models ? modelsToJson(result.models) : undefined);
	const sql = modelsJson
		? "UPDATE channels SET status = ?, models_json = ?, test_time = ?, response_time_ms = ?, updated_at = ? WHERE id = ?"
		: "UPDATE channels SET status = ?, test_time = ?, response_time_ms = ?, updated_at = ? WHERE id = ?";

	const stmt = db.prepare(sql);
	if (modelsJson) {
		await stmt
			.bind(status, modelsJson, now, result.elapsed, nowIso(), id)
			.run();
	} else {
		await stmt.bind(status, now, result.elapsed, nowIso(), id).run();
	}
}
