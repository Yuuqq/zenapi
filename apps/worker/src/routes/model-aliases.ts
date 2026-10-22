import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
	type AliasInput,
	deleteAliasesForModel,
	listAllAliases,
	saveAliasesForModel,
} from "../services/model-aliases";
import { jsonError } from "../utils/http";

const modelAliasRoutes = new Hono<AppEnv>();

/**
 * List all aliases grouped by model_id.
 */
modelAliasRoutes.get("/", async (c) => {
	const aliasMap = await listAllAliases(c.env.DB);
	const result: Record<
		string,
		{
			aliases: Array<{ alias: string; is_primary: boolean }>;
			alias_only: boolean;
		}
	> = {};
	for (const [modelId, aliases] of aliasMap) {
		const aliasOnly = aliases.length > 0 && aliases[0].alias_only;
		result[modelId] = {
			aliases: aliases.map((a) => ({
				alias: a.alias,
				is_primary: a.is_primary,
			})),
			alias_only: aliasOnly,
		};
	}
	return c.json({ aliases: result });
});

/**
 * Save aliases for a specific model (replace all).
 */
modelAliasRoutes.put("/:modelId", async (c) => {
	const modelId = c.req.param("modelId");
	const body = await c.req.json().catch(() => null);
	if (!body || !Array.isArray(body.aliases)) {
		return jsonError(c, 400, "invalid_body", "body must contain aliases array");
	}

	const aliases: AliasInput[] = [];
	let hasPrimary = false;
	for (const item of body.aliases) {
		if (!item.alias || typeof item.alias !== "string") {
			return jsonError(
				c,
				400,
				"invalid_alias",
				"each alias must have a non-empty string alias field",
			);
		}
		const isPrimary = !!item.is_primary;
		if (isPrimary) {
			if (hasPrimary) {
				return jsonError(
					c,
					400,
					"multiple_primary",
					"only one alias can be marked as primary",
				);
			}
			hasPrimary = true;
		}
		aliases.push({ alias: item.alias.trim(), is_primary: isPrimary });
	}

	const aliasOnly = !!body.alias_only;

	try {
		await saveAliasesForModel(c.env.DB, modelId, aliases, aliasOnly);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		if (message.includes("UNIQUE")) {
			return jsonError(
				c,
				409,
				"alias_conflict",
				"one or more aliases are already in use by another model",
			);
		}
		throw error;
	}

	return c.json({ ok: true });
});

/**
 * Delete all aliases for a model.
 */
modelAliasRoutes.delete("/:modelId", async (c) => {
	const modelId = c.req.param("modelId");
	await deleteAliasesForModel(c.env.DB, modelId);
	return c.json({ ok: true });
});

export default modelAliasRoutes;
