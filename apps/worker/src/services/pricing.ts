import { extractModelPricings } from "./channel-models";

export type ModelPriceInfo = {
	input_price: number; // per million tokens
	output_price: number;
};

/**
 * Looks up the price for a model from a channel's models_json.
 */
export function getModelPrice(
	modelsJson: string | null | undefined,
	modelId: string,
): ModelPriceInfo | null {
	if (!modelsJson || !modelId) return null;
	const pricings = extractModelPricings({ models_json: modelsJson });
	const match = pricings.find((p) => p.id === modelId);
	if (!match || (match.input_price == null && match.output_price == null)) {
		return null;
	}
	return {
		input_price: match.input_price ?? 0,
		output_price: match.output_price ?? 0,
	};
}

/**
 * Calculates cost for a single request.
 * When prompt/completion split is unavailable (both 0) but totalTokens > 0,
 * falls back to average of input/output price.
 */
export function calculateCost(
	price: ModelPriceInfo,
	promptTokens: number,
	completionTokens: number,
	totalTokens?: number,
): number {
	if (
		promptTokens === 0 &&
		completionTokens === 0 &&
		totalTokens &&
		totalTokens > 0
	) {
		const avgPrice = (price.input_price + price.output_price) / 2;
		return (totalTokens / 1_000_000) * avgPrice;
	}
	const inputCost = (promptTokens / 1_000_000) * price.input_price;
	const outputCost = (completionTokens / 1_000_000) * price.output_price;
	return inputCost + outputCost;
}
