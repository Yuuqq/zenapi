/**
 * Bidirectional format conversion between OpenAI and Anthropic APIs.
 */

type OpenAIMessage = {
	role: string;
	content:
		| string
		| Array<{ type: string; text?: string; [k: string]: unknown }>;
	[k: string]: unknown;
};

type OpenAIChatRequest = {
	model?: string;
	messages?: OpenAIMessage[];
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	stop?: string | string[];
	[k: string]: unknown;
};

type AnthropicContentBlock = {
	type: string;
	text?: string;
	[k: string]: unknown;
};

type AnthropicMessage = {
	role: string;
	content: string | AnthropicContentBlock[];
};

type AnthropicRequest = {
	model?: string;
	messages?: AnthropicMessage[];
	system?: string | Array<{ type: string; text: string }>;
	max_tokens?: number;
	stream?: boolean;
	temperature?: number;
	top_p?: number;
	stop_sequences?: string[];
	[k: string]: unknown;
};

// --- Request converters ---

/**
 * Converts an OpenAI chat completion request body to an Anthropic Messages request body.
 */
export function openaiToAnthropicRequest(
	body: OpenAIChatRequest,
): AnthropicRequest {
	const result: AnthropicRequest = {};
	if (body.model) {
		result.model = body.model;
	}
	if (body.stream !== undefined) {
		result.stream = body.stream;
	}
	result.max_tokens = body.max_tokens ?? 4096;
	if (body.temperature !== undefined) {
		result.temperature = body.temperature;
	}
	if (body.top_p !== undefined) {
		result.top_p = body.top_p;
	}
	if (body.stop) {
		result.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
	}

	const systemParts: string[] = [];
	const messages: AnthropicMessage[] = [];

	for (const msg of body.messages ?? []) {
		if (msg.role === "system") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: (msg.content as Array<{ text?: string }>)
							.map((c) => c.text ?? "")
							.join("\n");
			systemParts.push(text);
		} else {
			const role = msg.role === "assistant" ? "assistant" : "user";
			const content =
				typeof msg.content === "string"
					? msg.content
					: (msg.content as AnthropicContentBlock[]);
			messages.push({ role, content });
		}
	}

	if (systemParts.length > 0) {
		result.system = systemParts.join("\n\n");
	}
	result.messages = messages;
	return result;
}

/**
 * Converts an Anthropic Messages request body to an OpenAI chat completion request body.
 */
export function anthropicToOpenaiRequest(
	body: AnthropicRequest,
): OpenAIChatRequest {
	const result: OpenAIChatRequest = {};
	if (body.model) {
		result.model = body.model;
	}
	if (body.stream !== undefined) {
		result.stream = body.stream;
	}
	if (body.max_tokens !== undefined) {
		result.max_tokens = body.max_tokens;
	}
	if (body.temperature !== undefined) {
		result.temperature = body.temperature;
	}
	if (body.top_p !== undefined) {
		result.top_p = body.top_p;
	}
	if (body.stop_sequences) {
		result.stop = body.stop_sequences;
	}

	const messages: OpenAIMessage[] = [];

	if (body.system) {
		const systemText =
			typeof body.system === "string"
				? body.system
				: body.system.map((s) => s.text).join("\n\n");
		messages.push({ role: "system", content: systemText });
	}

	for (const msg of body.messages ?? []) {
		const content =
			typeof msg.content === "string"
				? msg.content
				: (msg.content as AnthropicContentBlock[])
						.map((block) => {
							if (block.type === "text") {
								return block.text ?? "";
							}
							return "";
						})
						.join("");
		messages.push({ role: msg.role, content });
	}

	result.messages = messages;
	return result;
}

// --- Response converters ---

function mapStopReason(stopReason: string | null | undefined): string {
	if (!stopReason) return "stop";
	switch (stopReason) {
		case "end_turn":
		case "stop_sequence":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "tool_calls";
		default:
			return "stop";
	}
}

function mapFinishReason(finishReason: string | null | undefined): string {
	if (!finishReason) return "end_turn";
	switch (finishReason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		default:
			return "end_turn";
	}
}

/**
 * Converts an Anthropic Messages API response to an OpenAI chat completion response.
 */
export function anthropicToOpenaiResponse(
	anthropicBody: Record<string, unknown>,
): Record<string, unknown> {
	const content = anthropicBody.content as AnthropicContentBlock[] | undefined;
	const textParts = (content ?? [])
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "");
	const text = textParts.join("");

	const usage = anthropicBody.usage as Record<string, unknown> | undefined;

	return {
		id: `chatcmpl-${(anthropicBody.id as string) ?? crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: anthropicBody.model as string,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: text,
				},
				finish_reason: mapStopReason(
					anthropicBody.stop_reason as string | undefined,
				),
			},
		],
		usage: usage
			? {
					prompt_tokens: (usage.input_tokens as number) ?? 0,
					completion_tokens: (usage.output_tokens as number) ?? 0,
					total_tokens:
						((usage.input_tokens as number) ?? 0) +
						((usage.output_tokens as number) ?? 0),
				}
			: undefined,
	};
}

/**
 * Converts an OpenAI chat completion response to an Anthropic Messages API response.
 */
export function openaiToAnthropicResponse(
	openaiBody: Record<string, unknown>,
): Record<string, unknown> {
	const choices = openaiBody.choices as
		| Array<Record<string, unknown>>
		| undefined;
	const firstChoice = choices?.[0];
	const message = firstChoice?.message as Record<string, unknown> | undefined;
	const contentText = (message?.content as string) ?? "";
	const usage = openaiBody.usage as Record<string, unknown> | undefined;

	return {
		id:
			((openaiBody.id as string) ?? "").replace("chatcmpl-", "msg_") ||
			`msg_${crypto.randomUUID()}`,
		type: "message",
		role: "assistant",
		model: openaiBody.model as string,
		content: [{ type: "text", text: contentText }],
		stop_reason: mapFinishReason(
			firstChoice?.finish_reason as string | undefined,
		),
		usage: usage
			? {
					input_tokens: (usage.prompt_tokens as number) ?? 0,
					output_tokens: (usage.completion_tokens as number) ?? 0,
				}
			: { input_tokens: 0, output_tokens: 0 },
	};
}

// --- Stream converters ---

/**
 * Creates a TransformStream that converts Anthropic SSE events to OpenAI SSE chunks.
 */
export function createAnthropicToOpenaiStreamTransform(): TransformStream<
	Uint8Array,
	Uint8Array
> {
	let buffer = "";
	let currentEventType = "";
	let messageId = "";
	let model = "";
	let sentDone = false;
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			let newlineIndex = buffer.indexOf("\n");

			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (line.startsWith("event:")) {
					currentEventType = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					const payload = line.slice(5).trim();
					if (!payload) {
						newlineIndex = buffer.indexOf("\n");
						continue;
					}

					try {
						const data = JSON.parse(payload);
						const openaiChunk = convertAnthropicEventToOpenaiChunk(
							currentEventType,
							data,
							messageId,
							model,
						);

						if (data.type === "message_start" && data.message) {
							messageId = data.message.id ?? messageId;
							model = data.message.model ?? model;
						}

						if (openaiChunk) {
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`),
							);
						}

						if (
							currentEventType === "message_stop" ||
							data.type === "message_stop"
						) {
							sentDone = true;
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						}
					} catch {
						// Skip invalid JSON
					}
				}

				newlineIndex = buffer.indexOf("\n");
			}
		},
		flush(controller) {
			if (buffer.trim()) {
				// Process any remaining data
				const line = buffer.trim();
				if (line.startsWith("data:")) {
					const payload = line.slice(5).trim();
					if (payload && payload !== "[DONE]") {
						try {
							const data = JSON.parse(payload);
							const openaiChunk = convertAnthropicEventToOpenaiChunk(
								currentEventType,
								data,
								messageId,
								model,
							);
							if (openaiChunk) {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`),
								);
							}
						} catch {
							// Skip
						}
					}
				}
			}
			// Avoid a second [DONE] when message_stop already emitted one.
			if (!sentDone) {
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			}
		},
	});
}

function convertAnthropicEventToOpenaiChunk(
	eventType: string,
	data: Record<string, unknown>,
	messageId: string,
	model: string,
): Record<string, unknown> | null {
	const id = `chatcmpl-${messageId || crypto.randomUUID()}`;
	const base = {
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
	};

	switch (eventType) {
		case "message_start": {
			const msg = data.message as Record<string, unknown> | undefined;
			const usage = msg?.usage as Record<string, unknown> | undefined;
			return {
				...base,
				model: (msg?.model as string) ?? model,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "" },
						finish_reason: null,
					},
				],
				usage: usage
					? {
							prompt_tokens: usage.input_tokens ?? 0,
							completion_tokens: 0,
							total_tokens: (usage.input_tokens as number) ?? 0,
						}
					: undefined,
			};
		}
		case "content_block_delta": {
			const delta = data.delta as Record<string, unknown> | undefined;
			if (delta?.type === "text_delta") {
				return {
					...base,
					choices: [
						{
							index: 0,
							delta: { content: delta.text ?? "" },
							finish_reason: null,
						},
					],
				};
			}
			return null;
		}
		case "message_delta": {
			const delta = data.delta as Record<string, unknown> | undefined;
			const usage = data.usage as Record<string, unknown> | undefined;
			return {
				...base,
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason: mapStopReason(
							delta?.stop_reason as string | undefined,
						),
					},
				],
				usage: usage
					? {
							prompt_tokens: 0,
							completion_tokens: usage.output_tokens ?? 0,
							total_tokens: (usage.output_tokens as number) ?? 0,
						}
					: undefined,
			};
		}
		default:
			return null;
	}
}

/**
 * Creates a TransformStream that converts OpenAI SSE chunks to Anthropic SSE events.
 */
export function createOpenaiToAnthropicStreamTransform(
	model: string,
): TransformStream<Uint8Array, Uint8Array> {
	let buffer = "";
	let sentMessageStart = false;
	let sentMessageStop = false;
	let contentBlockIndex = 0;
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });
			let newlineIndex = buffer.indexOf("\n");

			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (!line.startsWith("data:")) {
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				const payload = line.slice(5).trim();
				if (!payload || payload === "[DONE]") {
					if (payload === "[DONE]") {
						sentMessageStop = true;
						controller.enqueue(
							encoder.encode(
								`event: message_stop\ndata: {"type":"message_stop"}\n\n`,
							),
						);
					}
					newlineIndex = buffer.indexOf("\n");
					continue;
				}

				try {
					const data = JSON.parse(payload);
					const events = convertOpenaiChunkToAnthropicEvents(
						data,
						model,
						sentMessageStart,
						contentBlockIndex,
					);

					for (const event of events) {
						controller.enqueue(encoder.encode(event));
						// Match on the wire event name, not the whole payload: model
						// output can legitimately contain these literal strings.
						if (
							!sentMessageStart &&
							event.startsWith("event: message_start\n")
						) {
							sentMessageStart = true;
						}
						if (event.startsWith("event: content_block_start\n")) {
							contentBlockIndex++;
						}
					}
				} catch {
					// Skip invalid JSON
				}

				newlineIndex = buffer.indexOf("\n");
			}
		},
		flush(controller) {
			// Upstream may already have emitted its own terminator via [DONE].
			if (!sentMessageStart || sentMessageStop) {
				return;
			}
			controller.enqueue(
				encoder.encode(
					`event: message_stop\ndata: {"type":"message_stop"}\n\n`,
				),
			);
		},
	});
}

function convertOpenaiChunkToAnthropicEvents(
	data: Record<string, unknown>,
	model: string,
	sentMessageStart: boolean,
	contentBlockIndex: number,
): string[] {
	const events: string[] = [];
	const choices = data.choices as Array<Record<string, unknown>> | undefined;
	const firstChoice = choices?.[0];
	const delta = firstChoice?.delta as Record<string, unknown> | undefined;
	const finishReason = firstChoice?.finish_reason as string | null | undefined;
	const usage = data.usage as Record<string, unknown> | undefined;

	if (!sentMessageStart) {
		const messageStart = {
			type: "message_start",
			message: {
				id: `msg_${crypto.randomUUID()}`,
				type: "message",
				role: "assistant",
				model: (data.model as string) ?? model,
				content: [],
				stop_reason: null,
				usage: {
					input_tokens: (usage?.prompt_tokens as number) ?? 0,
					output_tokens: 0,
				},
			},
		};
		events.push(
			`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`,
		);
		events.push(
			`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: contentBlockIndex, content_block: { type: "text", text: "" } })}\n\n`,
		);
	}

	if (delta?.content) {
		const textDelta = {
			type: "content_block_delta",
			index: Math.max(0, contentBlockIndex - (sentMessageStart ? 1 : 0)),
			delta: { type: "text_delta", text: delta.content as string },
		};
		events.push(
			`event: content_block_delta\ndata: ${JSON.stringify(textDelta)}\n\n`,
		);
	}

	if (finishReason) {
		events.push(
			`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: Math.max(0, contentBlockIndex - (sentMessageStart ? 1 : 0)) })}\n\n`,
		);
		const messageDelta = {
			type: "message_delta",
			delta: { stop_reason: mapFinishReason(finishReason) },
			usage: { output_tokens: (usage?.completion_tokens as number) ?? 0 },
		};
		events.push(
			`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`,
		);
	} else if (
		usage &&
		(!choices || choices.length === 0)
	) {
		// OpenAI often sends a final usage-only chunk with empty choices.
		// Emit message_delta with full usage so clients/billing don't see 0 tokens.
		const messageDelta = {
			type: "message_delta",
			delta: {},
			usage: {
				input_tokens: (usage.prompt_tokens as number) ?? 0,
				output_tokens: (usage.completion_tokens as number) ?? 0,
			},
		};
		events.push(
			`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`,
		);
	}

	return events;
}
