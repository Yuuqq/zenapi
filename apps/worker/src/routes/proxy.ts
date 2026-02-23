import { Hono } from "hono";
import type { AppEnv } from "../env";
import { type TokenRecord, tokenAuth } from "../middleware/tokenAuth";
import {
	type ChannelRecord,
	createWeightedOrder,
	extractModels,
} from "../services/channels";
import {
	collectUniqueModelIds,
	collectUniqueSharedModelIds,
	extractSharedModels,
} from "../services/channel-models";
import {
	anthropicToOpenaiResponse,
	createAnthropicToOpenaiStreamTransform,
	openaiToAnthropicRequest,
} from "../services/format-converter";
import { recordUsage } from "../services/usage";
import { calculateCost, getModelPrice } from "../services/pricing";
import { getSiteMode } from "../services/settings";
import { jsonError } from "../utils/http";
import { safeJsonParse } from "../utils/json";
import { extractReasoningEffort } from "../utils/reasoning";
import { parseApiKeys, shuffleArray } from "../utils/keys";
import { isRetryableStatus, sleep } from "../utils/retry";
import { resolveChannelRoute } from "../services/channel-route";
import { resolveModelNames, loadAliasMap } from "../services/model-aliases";
import { normalizeBaseUrl } from "../utils/url";
import {
	type NormalizedUsage,
	parseUsageFromHeaders,
	parseUsageFromJson,
	parseUsageFromSse,
} from "../utils/usage";

const proxy = new Hono<AppEnv>();

type ExecutionContextLike = {
	waitUntil: (promise: Promise<unknown>) => void;
};

export function channelSupportsModel(
	channel: ChannelRecord,
	model?: string | null,
): boolean {
	if (!model) {
		return true;
	}
	const models = extractModels(channel);
	return models.some((entry) => entry.id === model);
}

export function channelSupportsSharedModel(
	channel: ChannelRecord,
	model?: string | null,
): boolean {
	const models = extractSharedModels(
		channel as unknown as { id: string; name: string; models_json: string },
	);
	if (!model) {
		// No specific model requested — channel qualifies if it has any shared model
		return models.length > 0;
	}
	return models.some((entry) => entry.id === model);
}

/**
 * Returns true if the channel supports ANY of the given model names.
 */
export function channelSupportsAnyModel(
	channel: ChannelRecord,
	names: string[],
): boolean {
	const models = extractModels(channel);
	return names.some((name) => models.some((entry) => entry.id === name));
}

/**
 * Returns true if the channel supports ANY of the given model names (shared only).
 */
export function channelSupportsAnySharedModel(
	channel: ChannelRecord,
	names: string[],
): boolean {
	const models = extractSharedModels(
		channel as unknown as { id: string; name: string; models_json: string },
	);
	return names.some((name) => models.some((entry) => entry.id === name));
}

/**
 * Finds which model name from the resolved set the channel actually supports.
 * Returns the first match, or the first name as fallback.
 */
export function findChannelModelName(
	channel: ChannelRecord,
	names: string[],
): string {
	const models = extractModels(channel);
	for (const name of names) {
		if (models.some((entry) => entry.id === name)) {
			return name;
		}
	}
	return names[0];
}

export function filterAllowedChannels(
	channels: ChannelRecord[],
	tokenRecord: TokenRecord,
): ChannelRecord[] {
	const allowed = safeJsonParse<string[] | null>(
		tokenRecord.allowed_channels,
		null,
	);
	if (!allowed || allowed.length === 0) {
		return channels;
	}
	const allowedSet = new Set(allowed);
	return channels.filter((channel) => allowedSet.has(channel.id));
}

// Chat endpoint paths — only these are compatible with anthropic-format channels
const CHAT_PATHS = ["/v1/chat/completions", "/v1/responses"];

function isChatPath(path: string): boolean {
	const lower = path.toLowerCase();
	return CHAT_PATHS.some((p) => lower.startsWith(p));
}

/**
 * Builds per-channel fetch target and body based on channel api_format.
 * Returns the target URL, headers, and request body.
 */
export function buildChannelRequest(
	channel: ChannelRecord,
	targetPath: string,
	querySuffix: string,
	incomingHeaders: Headers,
	requestText: string,
	parsedBody: Record<string, unknown> | null,
	isStream: boolean,
	apiKey?: string,
): { target: string; headers: Headers; body: string | undefined } {
	const effectiveKey = apiKey ?? channel.api_key;
	const apiFormat = channel.api_format ?? "openai";
	const headers = new Headers(incomingHeaders);
	headers.delete("host");
	headers.delete("content-length");

	if (apiFormat === "anthropic") {
		const baseUrl = normalizeBaseUrl(channel.base_url);
		const target = `${baseUrl}/v1/messages`;
		headers.set("x-api-key", String(effectiveKey));
		headers.set("anthropic-version", "2023-06-01");
		headers.set("content-type", "application/json");
		headers.delete("Authorization");

		const anthropicBody = parsedBody
			? openaiToAnthropicRequest(parsedBody)
			: {};
		if (isStream) {
			(anthropicBody as Record<string, unknown>).stream = true;
		}
		return { target, headers, body: JSON.stringify(anthropicBody) };
	}

	if (apiFormat === "custom") {
		// For custom format, base_url IS the full target URL
		const target = `${channel.base_url}${querySuffix}`;
		headers.set("Authorization", `Bearer ${effectiveKey}`);
		headers.set("x-api-key", String(effectiveKey));

		// Merge custom headers
		if (channel.custom_headers_json) {
			const customHeaders = safeJsonParse<Record<string, string>>(
				channel.custom_headers_json,
				{},
			);
			for (const [key, value] of Object.entries(customHeaders)) {
				headers.set(key, value);
			}
		}
		return { target, headers, body: requestText || undefined };
	}

	// Default: openai pass-through
	// base_url already includes version path (e.g. /v1), so strip /v1 from incoming path
	const baseUrl = channel.base_url.replace(/\/+$/, "");
	const subPath = targetPath.replace(/^\/v1\b/, "");
	const target = `${baseUrl}${subPath}${querySuffix}`;
	headers.set("Authorization", `Bearer ${effectiveKey}`);
	headers.set("x-api-key", String(effectiveKey));
	return { target, headers, body: requestText || undefined };
}

/**
 * Converts upstream response based on channel format back to OpenAI format.
 */
export async function convertResponse(
	channel: ChannelRecord,
	response: Response,
	isStream: boolean,
): Promise<Response> {
	const apiFormat = channel.api_format ?? "openai";

	if (apiFormat === "anthropic" && response.ok) {
		if (isStream && response.body) {
			const transform = createAnthropicToOpenaiStreamTransform();
			const transformed = response.body.pipeThrough(transform);
			return new Response(transformed, {
				status: response.status,
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
				},
			});
		}

		const anthropicData = (await response.json()) as Record<string, unknown>;
		const openaiData = anthropicToOpenaiResponse(anthropicData);
		return new Response(JSON.stringify(openaiData), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}

	// openai or custom: pass through as-is
	return response;
}

/**
 * OpenAI-compatible /models endpoint.
 * Returns all unique models from active channels.
 */
proxy.get("/models", tokenAuth, async (c) => {
	const tokenRecord = c.get("tokenRecord") as TokenRecord;
	const channelResult = await c.env.DB.prepare(
		"SELECT * FROM channels WHERE status = ?",
	)
		.bind("active")
		.all();
	const activeChannels = (channelResult.results ?? []) as ChannelRecord[];
	const allowed = filterAllowedChannels(activeChannels, tokenRecord);

	const siteMode = await getSiteMode(c.env.DB);
	const useSharedFilter = siteMode === "shared" && !!tokenRecord.user_id;
	const modelIds = useSharedFilter
		? collectUniqueSharedModelIds(allowed)
		: collectUniqueModelIds(allowed);

	const now = Math.floor(Date.now() / 1000);
	const modelData = modelIds.map((id) => ({
		id,
		object: "model",
		created: now,
		owned_by: "system",
	}));

	// Add aliases that point to models in the list
	const modelIdSet = new Set(modelIds);
	const aliasMap = await loadAliasMap(c.env.DB);
	for (const [alias, targetModelId] of aliasMap) {
		if (modelIdSet.has(targetModelId) && !modelIdSet.has(alias)) {
			modelData.push({
				id: alias,
				object: "model",
				created: now,
				owned_by: "system",
			});
		}
	}

	return c.json({
		object: "list",
		data: modelData,
	});
});

/**
 * OpenAI-compatible proxy handler.
 */
proxy.all("/*", tokenAuth, async (c) => {
	const tokenRecord = c.get("tokenRecord") as TokenRecord;
	let requestText = await c.req.text();
	const originalRequestText = requestText;
	const parsedBody = requestText
		? safeJsonParse<Record<string, unknown> | null>(requestText, null)
		: null;
	const model =
		parsedBody?.model !== undefined && parsedBody?.model !== null
			? String(parsedBody.model)
			: null;
	const isStream = parsedBody?.stream === true;

	// Resolve model aliases — returns all model IDs this name can route to
	const resolvedNames = model ? await resolveModelNames(c.env.DB, model) : [];

	const reasoningEffort = extractReasoningEffort(parsedBody);
	let mutatedStreamOptions = false;
	if (isStream && parsedBody && typeof parsedBody === "object") {
		const streamOptions = (parsedBody as Record<string, unknown>)
			.stream_options;
		if (!streamOptions || typeof streamOptions !== "object") {
			(parsedBody as Record<string, unknown>).stream_options = {
				include_usage: true,
			};
			mutatedStreamOptions = true;
		} else if (
			(streamOptions as Record<string, unknown>).include_usage !== true
		) {
			(streamOptions as Record<string, unknown>).include_usage = true;
			mutatedStreamOptions = true;
		}
		requestText = JSON.stringify(parsedBody);
	}

	const channelResult = await c.env.DB.prepare(
		"SELECT * FROM channels WHERE status = ?",
	)
		.bind("active")
		.all();
	const activeChannels = (channelResult.results ?? []) as ChannelRecord[];

	const siteMode = await getSiteMode(c.env.DB);
	const useSharedFilter = siteMode === "shared" && !!tokenRecord.user_id;

	// Resolve channel/model routing syntax (uses original model name)
	const { targetChannel, actualModel } = resolveChannelRoute(model, activeChannels);
	const effectiveModel = targetChannel ? actualModel : model;

	// If channel routing matched, replace model in the request body
	if (targetChannel && parsedBody && actualModel !== null) {
		parsedBody.model = actualModel;
		requestText = JSON.stringify(parsedBody);
	}

	let candidates: ChannelRecord[];
	if (targetChannel) {
		// Explicit channel routing — verify the model exists on this channel
		if (useSharedFilter) {
			if (!channelSupportsSharedModel(targetChannel, actualModel)) {
				return jsonError(c, 403, "model_not_shared", "model_not_shared");
			}
		} else if (!channelSupportsModel(targetChannel, actualModel)) {
			return jsonError(
				c,
				404,
				"model_not_found",
				`The model '${actualModel}' does not exist on channel '${targetChannel.name}'.`,
			);
		}
		candidates = [targetChannel];
	} else {
		const allowedChannels = filterAllowedChannels(activeChannels, tokenRecord);
		if (resolvedNames.length > 0) {
			const supportsFn = useSharedFilter
				? channelSupportsAnySharedModel
				: channelSupportsAnyModel;
			candidates = allowedChannels.filter((channel) =>
				supportsFn(channel, resolvedNames),
			);
		} else {
			// No model specified — all channels qualify
			const supportsFn = useSharedFilter
				? channelSupportsSharedModel
				: channelSupportsModel;
			candidates = allowedChannels.filter((channel) =>
				supportsFn(channel, null),
			);
		}
	}

	if (candidates.length === 0) {
		if (model) {
			return jsonError(
				c,
				404,
				"model_not_found",
				`The model '${model}' does not exist or is not available.`,
			);
		}
		return jsonError(c, 503, "no_available_channels", "no_available_channels");
	}

	const targetPath = c.req.path;

	// Non-chat endpoints should not be routed to anthropic-format channels
	if (!isChatPath(targetPath)) {
		candidates = candidates.filter(
			(ch) => (ch.api_format ?? "openai") !== "anthropic",
		);
		if (candidates.length === 0) {
			return jsonError(c, 503, "no_available_channels", "no_available_channels");
		}
	}

	const ordered = createWeightedOrder(candidates);
	const fallbackSubPath =
		targetPath.toLowerCase() === "/v1/responses" ? "/responses" : null;
	const querySuffix = c.req.url.includes("?")
		? `?${c.req.url.split("?")[1]}`
		: "";
	const retryRounds = Math.max(1, Number(c.env.PROXY_RETRY_ROUNDS ?? "1"));
	const retryDelayMs = Math.max(0, Number(c.env.PROXY_RETRY_DELAY_MS ?? "200"));
	let lastResponse: Response | null = null;
	let lastChannel: ChannelRecord | null = null;
	let lastRequestPath = targetPath;
	const start = Date.now();
	let selectedChannel: ChannelRecord | null = null;
	let selectedModelName: string | null = effectiveModel;

	let round = 0;
	while (round < retryRounds && !selectedChannel) {
		let shouldRetry = false;
		for (const channel of ordered) {
			lastChannel = channel;
			const keys = shuffleArray(parseApiKeys(channel.api_key));
			let channelRetryable = false;

			// Determine the model name this channel actually supports
			// and prepare a channel-specific request body if needed
			let channelRequestText = requestText;
			let channelParsedBody = parsedBody;
			let channelModelName = effectiveModel;
			if (!targetChannel && resolvedNames.length > 1 && parsedBody) {
				channelModelName = findChannelModelName(channel, resolvedNames);
				if (channelModelName !== model) {
					channelParsedBody = { ...parsedBody, model: channelModelName };
					channelRequestText = JSON.stringify(channelParsedBody);
				}
			}

			for (const apiKey of keys) {
				const incomingHeaders = new Headers(c.req.header());

				const {
					target,
					headers,
					body: channelBody,
				} = buildChannelRequest(
					channel,
					targetPath,
					querySuffix,
					incomingHeaders,
					channelRequestText,
					channelParsedBody,
					isStream,
					apiKey,
				);

				try {
					let response = await fetch(target, {
						method: c.req.method,
						headers,
						body: channelBody,
					});
					let responsePath = targetPath;

					// Fallback only applies to openai-format channels
					if (
						(channel.api_format ?? "openai") === "openai" &&
						(response.status === 400 || response.status === 404) &&
						fallbackSubPath
					) {
						const strippedBase = normalizeBaseUrl(channel.base_url);
						const fallbackTarget = `${strippedBase}${fallbackSubPath}${querySuffix}`;
						const fallbackBody = mutatedStreamOptions
							? originalRequestText
							: channelRequestText;
						response = await fetch(fallbackTarget, {
							method: c.req.method,
							headers,
							body: fallbackBody || undefined,
						});
						responsePath = fallbackSubPath;
					}

					lastResponse = response;
					lastRequestPath = responsePath;
					if (response.ok) {
						// Convert response based on channel format
						lastResponse = await convertResponse(channel, response, isStream);
						selectedChannel = channel;
						selectedModelName = channelModelName;
						break;
					}

					if (isRetryableStatus(response.status)) {
						channelRetryable = true;
					} else {
						// Non-retryable error — skip remaining keys for this channel
						break;
					}
				} catch {
					lastResponse = null;
					channelRetryable = true;
				}
			}

			if (selectedChannel) {
				break;
			}
			if (channelRetryable) {
				shouldRetry = true;
			}
		}

		if (selectedChannel || !shouldRetry) {
			break;
		}

		round += 1;
		if (round < retryRounds) {
			await sleep(retryDelayMs);
		}
	}

	const latencyMs = Date.now() - start;

	if (!lastResponse) {
		await recordUsage(c.env.DB, {
			tokenId: tokenRecord.id,
			model: effectiveModel,
			requestPath: lastRequestPath,
			totalTokens: 0,
			latencyMs,
			firstTokenLatencyMs: isStream ? null : latencyMs,
			stream: isStream,
			reasoningEffort,
			status: "error",
			errorMessage: "upstream_unavailable",
		});
		return jsonError(c, 502, "upstream_unavailable", "upstream_unavailable");
	}

	const channelForUsage = selectedChannel ?? lastChannel;
	if (channelForUsage && lastResponse) {
		const price = getModelPrice(channelForUsage.models_json, selectedModelName ?? "");
		let errorCode: number | null = null;
		let errorMessage: string | null = null;
		if (!lastResponse.ok) {
			errorCode = lastResponse.status;
			try {
				const errText = await lastResponse.clone().text();
				errorMessage = errText.slice(0, 512);
			} catch {
				errorMessage = null;
			}
		}
		const record = async (
			usage: NormalizedUsage | null,
			firstTokenLatencyMs?: number | null,
		) => {
			const normalized = usage ?? {
				totalTokens: 0,
				promptTokens: 0,
				completionTokens: 0,
			};
			const cost = price
				? calculateCost(price, normalized.promptTokens, normalized.completionTokens, normalized.totalTokens)
				: 0;
			const resolvedFirstTokenLatencyMs =
				firstTokenLatencyMs ?? (isStream ? null : latencyMs);
			await recordUsage(c.env.DB, {
				tokenId: tokenRecord.id,
				channelId: channelForUsage.id,
				model: effectiveModel,
				requestPath: lastRequestPath,
				totalTokens: normalized.totalTokens,
				promptTokens: normalized.promptTokens,
				completionTokens: normalized.completionTokens,
				cost,
				latencyMs,
				firstTokenLatencyMs: resolvedFirstTokenLatencyMs,
				stream: isStream,
				reasoningEffort,
				status: lastResponse.ok ? "ok" : "error",
				errorCode,
				errorMessage,
			});
			// Deduct user balance
			if (cost > 0 && tokenRecord.user_id) {
				const now = new Date().toISOString();
				await c.env.DB.prepare(
					"UPDATE users SET balance = balance - ?, updated_at = ? WHERE id = ?",
				)
					.bind(cost, now, tokenRecord.user_id)
					.run();
			}
		};
		const logUsage = (
			label: string,
			usage: NormalizedUsage | null,
			source: string,
		) => {
			console.log(`[usage] ${label}`, {
				source,
				total_tokens: usage?.totalTokens ?? 0,
				prompt_tokens: usage?.promptTokens ?? 0,
				completion_tokens: usage?.completionTokens ?? 0,
				stream: isStream,
				status: lastResponse.status,
				model: effectiveModel,
				path: targetPath,
			});
		};

		const headerUsage = parseUsageFromHeaders(lastResponse.headers);
		let jsonUsage: NormalizedUsage | null = null;
		if (
			!isStream &&
			lastResponse.ok &&
			lastResponse.headers.get("content-type")?.includes("application/json")
		) {
			const data = await lastResponse
				.clone()
				.json()
				.catch(() => null);
			jsonUsage = parseUsageFromJson(data);
		}
		const immediateUsage = jsonUsage ?? headerUsage;
		const immediateSource = jsonUsage
			? "json"
			: headerUsage
				? "header"
				: "none";

		if (isStream) {
			const executionCtx = (c as { executionCtx?: ExecutionContextLike })
				.executionCtx;
			const task = parseUsageFromSse(lastResponse.clone())
				.then((streamUsage) => {
					const usageValue = immediateUsage ?? streamUsage.usage;
					const source = immediateUsage
						? immediateSource
						: streamUsage.usage
							? "sse"
							: "sse-none";
					logUsage("stream", usageValue, source);
					return record(usageValue, streamUsage.firstTokenLatencyMs);
				})
				.catch(async () => {
					// SSE parsing failed (stream interrupted, etc.) — still record with whatever we have
					try {
						logUsage("stream-fallback", immediateUsage, immediateSource);
						await record(immediateUsage, null);
					} catch { /* truly lost */ }
				});
			if (executionCtx?.waitUntil) {
				executionCtx.waitUntil(task);
			} else {
				task.catch(() => undefined);
			}
		} else {
			logUsage("immediate", immediateUsage, immediateSource);
			await record(immediateUsage, latencyMs);
		}
	}

	return lastResponse;
});

export default proxy;
