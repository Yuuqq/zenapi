/**
 * Format conversion between the OpenAI and Anthropic wire formats.
 *
 * The converter is the seam every cross-provider request passes through, so
 * the tests are organised by requirement rather than by function: each block
 * covers one thing a client can legitimately send and asserts on the shape the
 * upstream provider will receive.
 */

import { describe, expect, it } from "vitest";

import {
	anthropicToOpenaiRequest,
	anthropicToOpenaiResponse,
	createAnthropicToOpenaiStreamTransform,
	createOpenaiToAnthropicStreamTransform,
	openaiToAnthropicRequest,
	openaiToAnthropicResponse,
} from "../apps/worker/src/services/format-converter";

/** Collect the decoded output of a TransformStream fed the given chunks. */
async function runTransform(
	stream: TransformStream<Uint8Array, Uint8Array>,
	chunks: string[],
): Promise<string> {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	const writer = stream.writable.getWriter();
	const reader = stream.readable.getReader();

	const writePromise = (async () => {
		for (const chunk of chunks) {
			await writer.write(encoder.encode(chunk));
		}
		await writer.close();
	})();

	let output = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		output += decoder.decode(value, { stream: true });
	}
	await writePromise;
	return output;
}

/** Pull the JSON payloads out of an SSE transcript, skipping [DONE]. */
function parseSseData(output: string): Array<Record<string, unknown>> {
	return output
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => line.slice("data: ".length).trim())
		.filter((payload) => payload && payload !== "[DONE]")
		.map((payload) => JSON.parse(payload) as Record<string, unknown>);
}

describe("openaiToAnthropicRequest", () => {
	it("hoists system messages into a single system field", () => {
		const result = openaiToAnthropicRequest({
			model: "claude-3-5-sonnet",
			messages: [
				{ role: "system", content: "Be brief." },
				{ role: "system", content: "Answer in French." },
				{ role: "user", content: "Hello" },
			],
		});

		expect(result.system).toBe("Be brief.\n\nAnswer in French.");
		expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
	});

	it("flattens system messages whose content is an array of parts", () => {
		const result = openaiToAnthropicRequest({
			messages: [
				{
					role: "system",
					content: [
						{ type: "text", text: "Part one" },
						{ type: "text", text: "Part two" },
					],
				},
			],
		});

		expect(result.system).toBe("Part one\nPart two");
	});

	it("omits the system field when no system message is present", () => {
		const result = openaiToAnthropicRequest({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result).not.toHaveProperty("system");
	});

	it("maps an unknown role to user", () => {
		const result = openaiToAnthropicRequest({
			messages: [{ role: "tool", content: "result" }],
		});

		expect(result.messages).toEqual([{ role: "user", content: "result" }]);
	});

	it("preserves the assistant role", () => {
		const result = openaiToAnthropicRequest({
			messages: [{ role: "assistant", content: "Sure" }],
		});

		expect(result.messages).toEqual([{ role: "assistant", content: "Sure" }]);
	});

	it("defaults max_tokens to 4096 when absent", () => {
		expect(openaiToAnthropicRequest({}).max_tokens).toBe(4096);
	});

	it("keeps an explicit max_tokens", () => {
		expect(openaiToAnthropicRequest({ max_tokens: 256 }).max_tokens).toBe(256);
	});

	it("turns a string stop into a one-element stop_sequences", () => {
		expect(openaiToAnthropicRequest({ stop: "\n" }).stop_sequences).toEqual([
			"\n",
		]);
	});

	it("passes an array stop through unchanged", () => {
		expect(
			openaiToAnthropicRequest({ stop: ["a", "b"] }).stop_sequences,
		).toEqual(["a", "b"]);
	});

	it("omits stop_sequences when stop is absent", () => {
		expect(openaiToAnthropicRequest({})).not.toHaveProperty("stop_sequences");
	});

	it("copies sampling parameters", () => {
		const result = openaiToAnthropicRequest({
			model: "m",
			stream: true,
			temperature: 0.2,
			top_p: 0.9,
		});

		expect(result.model).toBe("m");
		expect(result.stream).toBe(true);
		expect(result.temperature).toBe(0.2);
		expect(result.top_p).toBe(0.9);
	});

	it("treats missing messages as an empty conversation", () => {
		expect(openaiToAnthropicRequest({}).messages).toEqual([]);
	});

	it("keeps temperature 0 rather than dropping it", () => {
		// 0 is falsy, so a truthiness check here would silently drop it.
		expect(openaiToAnthropicRequest({ temperature: 0 }).temperature).toBe(0);
	});
});

describe("anthropicToOpenaiRequest", () => {
	it("converts a string system prompt into a leading system message", () => {
		const result = anthropicToOpenaiRequest({
			system: "Be terse.",
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result.messages).toEqual([
			{ role: "system", content: "Be terse." },
			{ role: "user", content: "Hi" },
		]);
	});

	it("joins an array system prompt with blank lines", () => {
		const result = anthropicToOpenaiRequest({
			system: [
				{ type: "text", text: "One" },
				{ type: "text", text: "Two" },
			],
		});

		expect(result.messages?.[0]).toEqual({
			role: "system",
			content: "One\n\nTwo",
		});
	});

	it("flattens text content blocks into a single string", () => {
		const result = anthropicToOpenaiRequest({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Hello " },
						{ type: "text", text: "world" },
					],
				},
			],
		});

		expect(result.messages).toEqual([{ role: "user", content: "Hello world" }]);
	});

	it("drops non-text content blocks", () => {
		const result = anthropicToOpenaiRequest({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "before" },
						{ type: "image", source: {} },
						{ type: "text", text: "after" },
					],
				},
			],
		});

		expect(result.messages?.[0].content).toBe("beforeafter");
	});

	it("copies max_tokens, stop_sequences and sampling parameters", () => {
		const result = anthropicToOpenaiRequest({
			model: "claude",
			stream: false,
			max_tokens: 100,
			temperature: 0.5,
			top_p: 0.8,
			stop_sequences: ["END"],
		});

		expect(result.model).toBe("claude");
		expect(result.stream).toBe(false);
		expect(result.max_tokens).toBe(100);
		expect(result.temperature).toBe(0.5);
		expect(result.top_p).toBe(0.8);
		expect(result.stop).toEqual(["END"]);
	});

	it("emits no system message when none was supplied", () => {
		const result = anthropicToOpenaiRequest({
			messages: [{ role: "user", content: "Hi" }],
		});

		expect(result.messages).toEqual([{ role: "user", content: "Hi" }]);
	});

	it("treats a missing messages array as an empty conversation", () => {
		expect(anthropicToOpenaiRequest({}).messages).toEqual([]);
	});
});

describe("anthropicToOpenaiResponse", () => {
	it("maps a normal completion onto the OpenAI response shape", () => {
		const result = anthropicToOpenaiResponse({
			id: "msg_123",
			model: "claude-3-5-sonnet",
			content: [
				{ type: "text", text: "Hello " },
				{ type: "text", text: "there" },
			],
			stop_reason: "end_turn",
			usage: { input_tokens: 11, output_tokens: 7 },
		});

		expect(result.id).toBe("chatcmpl-msg_123");
		expect(result.object).toBe("chat.completion");
		expect(result.model).toBe("claude-3-5-sonnet");
		expect(result.choices).toEqual([
			{
				index: 0,
				message: { role: "assistant", content: "Hello there" },
				finish_reason: "stop",
			},
		]);
		expect(result.usage).toEqual({
			prompt_tokens: 11,
			completion_tokens: 7,
			total_tokens: 18,
		});
	});

	it.each([
		["end_turn", "stop"],
		["stop_sequence", "stop"],
		["max_tokens", "length"],
		["tool_use", "tool_calls"],
		["something_new", "stop"],
	])("maps stop_reason %s to finish_reason %s", (anthropic, openai) => {
		const result = anthropicToOpenaiResponse({
			content: [{ type: "text", text: "x" }],
			stop_reason: anthropic,
		});

		expect(
			(result.choices as Array<Record<string, unknown>>)[0].finish_reason,
		).toBe(openai);
	});

	it("defaults a missing stop_reason to stop", () => {
		const result = anthropicToOpenaiResponse({ content: [] });

		expect(
			(result.choices as Array<Record<string, unknown>>)[0].finish_reason,
		).toBe("stop");
	});

	it("ignores non-text content blocks", () => {
		const result = anthropicToOpenaiResponse({
			content: [
				{ type: "tool_use", id: "t1" },
				{ type: "text", text: "visible" },
			],
		});

		expect(
			(
				(result.choices as Array<Record<string, unknown>>)[0].message as Record<
					string,
					unknown
				>
			).content,
		).toBe("visible");
	});

	it("omits usage when the upstream response has none", () => {
		expect(anthropicToOpenaiResponse({ content: [] }).usage).toBeUndefined();
	});

	it("generates an id when the upstream response has none", () => {
		const result = anthropicToOpenaiResponse({ content: [] });

		expect(result.id).toMatch(/^chatcmpl-/);
	});
});

describe("openaiToAnthropicResponse", () => {
	it("maps a normal completion onto the Anthropic response shape", () => {
		const result = openaiToAnthropicResponse({
			id: "chatcmpl-abc",
			model: "gpt-4o",
			choices: [{ message: { content: "Hi there" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 5, completion_tokens: 3 },
		});

		expect(result.id).toBe("msg_abc");
		expect(result.type).toBe("message");
		expect(result.role).toBe("assistant");
		expect(result.model).toBe("gpt-4o");
		expect(result.content).toEqual([{ type: "text", text: "Hi there" }]);
		expect(result.stop_reason).toBe("end_turn");
		expect(result.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
	});

	it.each([
		["stop", "end_turn"],
		["length", "max_tokens"],
		["tool_calls", "tool_use"],
		["content_filter", "end_turn"],
	])("maps finish_reason %s to stop_reason %s", (openai, anthropic) => {
		const result = openaiToAnthropicResponse({
			choices: [{ message: { content: "x" }, finish_reason: openai }],
		});

		expect(result.stop_reason).toBe(anthropic);
	});

	it("falls back to zero usage when the upstream response has none", () => {
		const result = openaiToAnthropicResponse({
			choices: [{ message: { content: "x" } }],
		});

		expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
	});

	it("survives a response with no choices", () => {
		const result = openaiToAnthropicResponse({ id: "chatcmpl-xyz" });

		expect(result.content).toEqual([{ type: "text", text: "" }]);
		expect(result.stop_reason).toBe("end_turn");
	});

	it("generates an id when the upstream response has none", () => {
		const result = openaiToAnthropicResponse({});

		expect(result.id).toMatch(/^msg_/);
	});
});

describe("createAnthropicToOpenaiStreamTransform", () => {
	const messageStart = `event: message_start\ndata: ${JSON.stringify({
		type: "message_start",
		message: {
			id: "msg_1",
			model: "claude-3-5-sonnet",
			usage: { input_tokens: 9 },
		},
	})}\n\n`;

	it("converts a text delta into an OpenAI chunk", async () => {
		const stream = createAnthropicToOpenaiStreamTransform();
		const output = await runTransform(stream, [
			messageStart,
			`event: content_block_delta\ndata: ${JSON.stringify({
				type: "content_block_delta",
				delta: { type: "text_delta", text: "Hello" },
			})}\n\n`,
		]);

		const chunks = parseSseData(output);
		const deltaChunk = chunks.find((chunk) => {
			const choices = chunk.choices as
				| Array<Record<string, unknown>>
				| undefined;
			const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
			return delta?.content === "Hello";
		});

		expect(deltaChunk).toBeDefined();
		expect(deltaChunk?.object).toBe("chat.completion.chunk");
		expect(deltaChunk?.model).toBe("claude-3-5-sonnet");
	});

	it("reassembles an event split across chunk boundaries", async () => {
		const stream = createAnthropicToOpenaiStreamTransform();
		const event = `event: content_block_delta\ndata: ${JSON.stringify({
			type: "content_block_delta",
			delta: { type: "text_delta", text: "split" },
		})}\n\n`;
		// Split mid-JSON so the parser has to buffer across writes.
		const cut = event.indexOf("text_delta") + 4;

		const output = await runTransform(stream, [
			event.slice(0, cut),
			event.slice(cut),
		]);
		const chunks = parseSseData(output);

		expect(
			chunks.some((chunk) => {
				const choices = chunk.choices as
					| Array<Record<string, unknown>>
					| undefined;
				return (
					(choices?.[0]?.delta as Record<string, unknown> | undefined)
						?.content === "split"
				);
			}),
		).toBe(true);
	});

	it("emits exactly one [DONE] after message_stop", async () => {
		const stream = createAnthropicToOpenaiStreamTransform();
		const output = await runTransform(stream, [
			messageStart,
			`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
		]);

		const doneCount = output.split("data: [DONE]").length - 1;
		expect(doneCount).toBe(1);
	});

	it("emits [DONE] at flush when the upstream never sent message_stop", async () => {
		const stream = createAnthropicToOpenaiStreamTransform();
		const output = await runTransform(stream, [messageStart]);

		expect(output).toContain("data: [DONE]");
	});

	it("skips malformed JSON without dropping the stream", async () => {
		const stream = createAnthropicToOpenaiStreamTransform();
		const output = await runTransform(stream, [
			"event: content_block_delta\ndata: {not json}\n\n",
			messageStart,
		]);

		expect(output).toContain("data: [DONE]");
	});

	it("maps message_delta usage and stop reason", async () => {
		const stream = createAnthropicToOpenaiStreamTransform();
		const output = await runTransform(stream, [
			messageStart,
			`event: message_delta\ndata: ${JSON.stringify({
				type: "message_delta",
				delta: { stop_reason: "max_tokens" },
				usage: { output_tokens: 4 },
			})}\n\n`,
		]);

		const chunk = parseSseData(output).find((entry) => {
			const choices = entry.choices as
				| Array<Record<string, unknown>>
				| undefined;
			return choices?.[0]?.finish_reason === "length";
		});

		expect(chunk).toBeDefined();
		expect(chunk?.usage).toEqual({
			prompt_tokens: 0,
			completion_tokens: 4,
			total_tokens: 4,
		});
	});
});

describe("createOpenaiToAnthropicStreamTransform", () => {
	const firstChunk = `data: ${JSON.stringify({
		id: "chatcmpl-1",
		model: "gpt-4o",
		choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }],
	})}\n\n`;

	it("emits message_start before the first content delta", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("fallback-model");
		const output = await runTransform(stream, [firstChunk]);

		const startIndex = output.indexOf("event: message_start");
		const deltaIndex = output.indexOf("event: content_block_delta");

		expect(startIndex).toBeGreaterThanOrEqual(0);
		expect(deltaIndex).toBeGreaterThan(startIndex);
	});

	it("emits message_start only once across many chunks", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("fallback-model");
		const second = `data: ${JSON.stringify({
			choices: [{ index: 0, delta: { content: " there" } }],
		})}\n\n`;
		const output = await runTransform(stream, [firstChunk, second]);

		expect(output.split("event: message_start").length - 1).toBe(1);
	});

	it("uses the model from the upstream chunk when present", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("fallback-model");
		const output = await runTransform(stream, [firstChunk]);

		expect(output).toContain('"model":"gpt-4o"');
	});

	it("maps a finish_reason onto content_block_stop and message_delta", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("m");
		const finishChunk = `data: ${JSON.stringify({
			choices: [{ index: 0, delta: {}, finish_reason: "length" }],
		})}\n\n`;
		const output = await runTransform(stream, [firstChunk, finishChunk]);

		expect(output).toContain("event: content_block_stop");
		expect(output).toContain('"stop_reason":"max_tokens"');
	});

	it("does not emit a second message_stop when [DONE] already terminated the stream", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("m");
		const output = await runTransform(stream, [firstChunk, "data: [DONE]\n\n"]);

		expect(output.split("event: message_stop").length - 1).toBe(1);
	});

	it("emits message_stop at flush when the upstream just stops", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("m");
		const output = await runTransform(stream, [firstChunk]);

		expect(output.split("event: message_stop").length - 1).toBe(1);
	});

	it("forwards a usage-only trailing chunk as message_delta", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("m");
		const usageChunk = `data: ${JSON.stringify({
			choices: [],
			usage: { prompt_tokens: 6, completion_tokens: 2 },
		})}\n\n`;
		const output = await runTransform(stream, [firstChunk, usageChunk]);

		expect(output).toContain('"input_tokens":6');
		expect(output).toContain('"output_tokens":2');
	});

	it("stays silent when the upstream sent nothing at all", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("m");
		const output = await runTransform(stream, []);

		expect(output).toBe("");
	});

	it("ignores malformed JSON", async () => {
		const stream = createOpenaiToAnthropicStreamTransform("m");
		const output = await runTransform(stream, ["data: {oops}\n\n", firstChunk]);

		expect(output).toContain("event: message_start");
	});
});
