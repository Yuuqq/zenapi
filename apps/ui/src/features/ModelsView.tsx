import { useEffect, useMemo, useState } from "hono/jsx/dom";
import type { ModelAlias, ModelItem } from "../core/types";
import { buildPageItems } from "../core/utils";

type ModelsViewProps = {
	models: ModelItem[];
	onAliasSave?: (
		modelId: string,
		aliases: Array<{ alias: string; is_primary: boolean }>,
	) => Promise<void>;
	onPriceSave?: (
		modelId: string,
		prices: Array<{ channel_id: string; input_price: number; output_price: number }>,
	) => Promise<void>;
};

const MiniSparkline = ({
	data,
}: { data: { day: string; requests: number; tokens: number }[] }) => {
	if (data.length === 0) return null;
	const values = data.map((d) => d.requests);
	const max = Math.max(...values, 1);
	const width = 120;
	const height = 32;
	const padding = 2;
	const step = (width - padding * 2) / Math.max(values.length - 1, 1);

	const points = values
		.map((v, i) => {
			const x = padding + i * step;
			const y = height - padding - ((v / max) * (height - padding * 2));
			return `${x},${y}`;
		})
		.join(" ");

	const areaPoints = `${padding},${height - padding} ${points} ${padding + (values.length - 1) * step},${height - padding}`;

	return (
		<svg
			width={width}
			height={height}
			class="inline-block"
			viewBox={`0 0 ${width} ${height}`}
		>
			<polygon points={areaPoints} fill="rgba(245,158,11,0.15)" />
			<polyline
				points={points}
				fill="none"
				stroke="rgb(245,158,11)"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
};

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function formatCost(n: number): string {
	if (n === 0) return "$0";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

function formatPrice(n: number | null): string {
	if (n == null) return "-";
	return `$${n}`;
}

const ModelCard = ({
	model,
	onAliasClick,
	onPriceClick,
	compact,
}: { model: ModelItem; onAliasClick?: () => void; onPriceClick?: () => void; compact?: boolean }) => {
	const showSubtitle = !compact && model.display_name !== model.id;
	return (
		<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
			<div class="mb-2 flex items-start justify-between gap-2">
				<div class="min-w-0 flex-1">
					<h4 class="break-all font-['Space_Grotesk'] text-sm font-semibold tracking-tight text-stone-900">
						{model.display_name}
					</h4>
					{showSubtitle && (
						<p class="mt-0.5 break-all text-xs text-stone-400">{model.id}</p>
					)}
				</div>
				<div class="flex shrink-0 items-center gap-1.5">
					{onAliasClick && (
						<button
							type="button"
							class="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-500 transition-colors hover:border-amber-300 hover:text-amber-600"
							onClick={onAliasClick}
						>
							别名
						</button>
					)}
					{onPriceClick && (
						<button
							type="button"
							class="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-500 transition-colors hover:border-emerald-300 hover:text-emerald-600"
							onClick={onPriceClick}
						>
							定价
						</button>
					)}
					<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
						{model.channels.length} 渠道
					</span>
				</div>
			</div>

			{model.avg_latency_ms != null && (
				<p class="mb-3 text-xs text-stone-400">
					平均延迟 {model.avg_latency_ms}ms
				</p>
			)}

			{model.channels.length > 0 && (
				<div class="mb-3 rounded-lg bg-stone-50 p-2.5">
					<p class="mb-1.5 text-xs font-medium uppercase tracking-widest text-stone-400">
						渠道价格
					</p>
					<div class="space-y-1">
						{model.channels.map((ch) => (
							<div
								key={ch.id}
								class="flex items-center justify-between text-xs"
							>
								<span class="truncate text-stone-600">{ch.name}</span>
								<span class="shrink-0 pl-2 text-stone-500">
									{ch.input_price != null || ch.output_price != null ? (
										<>
											<span class="text-emerald-600">
												{formatPrice(ch.input_price)}
											</span>
											{" / "}
											<span class="text-blue-600">
												{formatPrice(ch.output_price)}
											</span>
											<span class="ml-1 text-stone-400">/1M</span>
										</>
									) : (
										<span class="text-stone-300">未设置</span>
									)}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{model.daily.length > 0 && (
				<div class="mb-3">
					<MiniSparkline data={model.daily} />
				</div>
			)}

			<div class="flex flex-wrap gap-x-3 gap-y-1 border-t border-stone-100 pt-2.5 text-xs text-stone-500">
				<span>
					请求{" "}
					<span class="font-medium text-stone-700">
						{formatNumber(model.total_requests)}
					</span>
				</span>
				<span>
					Token{" "}
					<span class="font-medium text-stone-700">
						{formatNumber(model.total_tokens)}
					</span>
				</span>
				<span>
					费用{" "}
					<span class="font-medium text-stone-700">
						{formatCost(model.total_cost)}
					</span>
				</span>
			</div>
		</div>
	);
};

const AliasEditModal = ({
	modelId,
	initialAliases,
	onSave,
	onClose,
}: {
	modelId: string;
	initialAliases: ModelAlias[];
	onSave: (aliases: Array<{ alias: string; is_primary: boolean }>) => Promise<void>;
	onClose: () => void;
}) => {
	const [aliases, setAliases] = useState<
		Array<{ alias: string; is_primary: boolean }>
	>(() => initialAliases.map((a) => ({ ...a })));
	const [newAlias, setNewAlias] = useState("");
	const [saving, setSaving] = useState(false);

	const handleAdd = () => {
		const trimmed = newAlias.trim();
		if (!trimmed) return;
		if (aliases.some((a) => a.alias === trimmed)) return;
		setAliases((prev) => [...prev, { alias: trimmed, is_primary: false }]);
		setNewAlias("");
	};

	const handleRemove = (index: number) => {
		setAliases((prev) => prev.filter((_, i) => i !== index));
	};

	const handlePrimaryChange = (index: number) => {
		setAliases((prev) =>
			prev.map((a, i) => ({ ...a, is_primary: i === index })),
		);
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await onSave(aliases);
			onClose();
		} finally {
			setSaving(false);
		}
	};

	return (
		<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 px-0 py-0 md:items-center md:px-4 md:py-8">
			<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-6 shadow-2xl md:rounded-2xl">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h3 class="mb-1 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							编辑别名
						</h3>
						<p class="break-all text-xs text-stone-500">
							模型：{modelId}
						</p>
					</div>
					<button
						type="button"
						class="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
						onClick={onClose}
					>
						关闭
					</button>
				</div>

				<div class="mt-4 space-y-2">
					{aliases.length === 0 && (
						<p class="py-4 text-center text-sm text-stone-400">
							暂无别名，在下方添加
						</p>
					)}
					{aliases.map((alias, index) => (
						<div
							key={alias.alias}
							class="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
						>
							<label class="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500">
								<input
									type="radio"
									name="primary-alias"
									checked={alias.is_primary}
									onChange={() => handlePrimaryChange(index)}
									class="accent-amber-500"
								/>
								主名
							</label>
							<span class="flex-1 break-all font-mono text-sm text-stone-800">
								{alias.alias}
							</span>
							<button
								type="button"
								class="rounded-full px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
								onClick={() => handleRemove(index)}
							>
								删除
							</button>
						</div>
					))}
				</div>

				<div class="mt-4 flex gap-2">
					<input
						type="text"
						class="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
						placeholder="输入别名..."
						value={newAlias}
						onInput={(e) =>
							setNewAlias(
								(e.currentTarget as HTMLInputElement)?.value ?? "",
							)
						}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								handleAdd();
							}
						}}
					/>
					<button
						type="button"
						class="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
						onClick={handleAdd}
					>
						添加
					</button>
				</div>

				<div class="mt-5 flex items-center justify-end gap-2">
					<button
						type="button"
						class="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
						onClick={onClose}
					>
						取消
					</button>
					<button
						type="button"
						class="rounded-lg border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
						disabled={saving}
						onClick={handleSave}
					>
						{saving ? "保存中..." : "保存"}
					</button>
				</div>
			</div>
		</div>
	);
};

const PriceEditModal = ({
	modelId,
	channels,
	onSave,
	onClose,
}: {
	modelId: string;
	channels: Array<{ id: string; name: string; input_price: number | null; output_price: number | null }>;
	onSave: (prices: Array<{ channel_id: string; input_price: number; output_price: number }>) => Promise<void>;
	onClose: () => void;
}) => {
	const [prices, setPrices] = useState(() =>
		channels.map((ch) => ({
			channel_id: ch.id,
			name: ch.name,
			input_price: ch.input_price != null ? String(ch.input_price) : "",
			output_price: ch.output_price != null ? String(ch.output_price) : "",
		})),
	);
	const [batchInput, setBatchInput] = useState("");
	const [batchOutput, setBatchOutput] = useState("");
	const [saving, setSaving] = useState(false);

	const handleFieldChange = (index: number, field: "input_price" | "output_price", value: string) => {
		setPrices((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
	};

	const handleBatchApply = () => {
		setPrices((prev) =>
			prev.map((p) => ({
				...p,
				input_price: batchInput !== "" ? batchInput : p.input_price,
				output_price: batchOutput !== "" ? batchOutput : p.output_price,
			})),
		);
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			const payload = prices.map((p) => ({
				channel_id: p.channel_id,
				input_price: p.input_price !== "" ? Number(p.input_price) : 0,
				output_price: p.output_price !== "" ? Number(p.output_price) : 0,
			}));
			await onSave(payload);
			onClose();
		} finally {
			setSaving(false);
		}
	};

	return (
		<div class="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 px-0 py-0 md:items-center md:px-4 md:py-8">
			<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-6 shadow-2xl md:rounded-2xl">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h3 class="mb-1 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							编辑价格
						</h3>
						<p class="break-all text-xs text-stone-500">
							模型：{modelId}
						</p>
					</div>
					<button
						type="button"
						class="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
						onClick={onClose}
					>
						关闭
					</button>
				</div>

				<div class="mt-4 space-y-2">
					<div class="grid grid-cols-[1fr_5rem_5rem] gap-2 text-xs font-medium text-stone-400">
						<span>渠道</span>
						<span class="text-center">输入价格</span>
						<span class="text-center">输出价格</span>
					</div>
					{prices.map((p, index) => (
						<div
							key={p.channel_id}
							class="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
						>
							<span class="truncate text-sm text-stone-700">{p.name}</span>
							<input
								type="number"
								step="any"
								class="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								value={p.input_price}
								onInput={(e) =>
									handleFieldChange(index, "input_price", (e.currentTarget as HTMLInputElement)?.value ?? "")
								}
							/>
							<input
								type="number"
								step="any"
								class="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								value={p.output_price}
								onInput={(e) =>
									handleFieldChange(index, "output_price", (e.currentTarget as HTMLInputElement)?.value ?? "")
								}
							/>
						</div>
					))}
				</div>

				<div class="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3">
					<p class="mb-2 text-xs font-medium text-stone-500">批量设置</p>
					<div class="flex items-center gap-2">
						<input
							type="number"
							step="any"
							class="w-24 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							placeholder="输入价格"
							value={batchInput}
							onInput={(e) => setBatchInput((e.currentTarget as HTMLInputElement)?.value ?? "")}
						/>
						<input
							type="number"
							step="any"
							class="w-24 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							placeholder="输出价格"
							value={batchOutput}
							onInput={(e) => setBatchOutput((e.currentTarget as HTMLInputElement)?.value ?? "")}
						/>
						<button
							type="button"
							class="rounded-lg border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50"
							onClick={handleBatchApply}
						>
							应用全部
						</button>
					</div>
				</div>

				<div class="mt-5 flex items-center justify-end gap-2">
					<button
						type="button"
						class="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
						onClick={onClose}
					>
						取消
					</button>
					<button
						type="button"
						class="rounded-lg border border-stone-900 bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-60"
						disabled={saving}
						onClick={handleSave}
					>
						{saving ? "保存中..." : "保存"}
					</button>
				</div>
			</div>
		</div>
	);
};

const pageSizeOptions = [12, 24, 48];

/** Merge models that share the same display_name into single virtual cards. */
function mergeByDisplayName(models: ModelItem[]): ModelItem[] {
	const groups = new Map<string, ModelItem[]>();
	for (const m of models) {
		const key = m.display_name;
		const arr = groups.get(key) ?? [];
		arr.push(m);
		groups.set(key, arr);
	}
	const merged: ModelItem[] = [];
	for (const [displayName, group] of groups) {
		if (group.length === 1) {
			merged.push(group[0]);
			continue;
		}
		// Deduplicate channels by id
		const seenChannels = new Set<string>();
		const channels: ModelItem["channels"] = [];
		for (const m of group) {
			for (const ch of m.channels) {
				if (!seenChannels.has(ch.id)) {
					seenChannels.add(ch.id);
					channels.push(ch);
				}
			}
		}
		// Merge daily data by day
		const dailyMap = new Map<string, { requests: number; tokens: number }>();
		for (const m of group) {
			for (const d of m.daily) {
				const existing = dailyMap.get(d.day);
				if (existing) {
					existing.requests += d.requests;
					existing.tokens += d.tokens;
				} else {
					dailyMap.set(d.day, { requests: d.requests, tokens: d.tokens });
				}
			}
		}
		const daily = Array.from(dailyMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([day, v]) => ({ day, ...v }));
		// Merge all aliases from all sub-models
		const allAliases: ModelItem["aliases"] = [];
		for (const m of group) {
			allAliases.push(...m.aliases);
		}
		// Sum numeric stats
		const totalRequests = group.reduce((s, m) => s + m.total_requests, 0);
		const totalTokens = group.reduce((s, m) => s + m.total_tokens, 0);
		const totalCost = group.reduce((s, m) => s + m.total_cost, 0);
		const latencies = group
			.map((m) => m.avg_latency_ms)
			.filter((v): v is number => v != null);
		const avgLatency =
			latencies.length > 0
				? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
				: null;

		merged.push({
			id: displayName,
			display_name: displayName,
			aliases: allAliases,
			channels,
			total_requests: totalRequests,
			total_tokens: totalTokens,
			total_cost: totalCost,
			avg_latency_ms: avgLatency,
			daily,
		});
	}
	return merged;
}

export const ModelsView = ({ models, onAliasSave, onPriceSave }: ModelsViewProps) => {
	const [search, setSearch] = useState("");
	const [pageSize, setPageSize] = useState(12);
	const [page, setPage] = useState(1);
	const [aliasModelId, setAliasModelId] = useState<string | null>(null);
	const [priceModelId, setPriceModelId] = useState<string | null>(null);
	const [primaryMode, setPrimaryMode] = useState(false);

	const displayModels = useMemo(
		() => (primaryMode ? mergeByDisplayName(models) : models),
		[models, primaryMode],
	);

	const filtered = search
		? displayModels.filter((m) => {
				const lower = search.toLowerCase();
				return (
					m.id.toLowerCase().includes(lower) ||
					m.display_name.toLowerCase().includes(lower) ||
					m.aliases.some((a) => a.alias.toLowerCase().includes(lower))
				);
			})
		: displayModels;

	const total = filtered.length;
	const totalPages = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total, pageSize],
	);

	// Reset page when search or pageSize changes
	useEffect(() => {
		setPage(1);
	}, [search, pageSize]);

	useEffect(() => {
		setPage((prev) => Math.min(prev, totalPages));
	}, [totalPages]);

	const pagedModels = useMemo(() => {
		const start = (page - 1) * pageSize;
		return filtered.slice(start, start + pageSize);
	}, [filtered, page, pageSize]);

	const pageItems = useMemo(
		() => buildPageItems(page, totalPages),
		[page, totalPages],
	);

	const aliasModel = aliasModelId
		? models.find((m) => m.id === aliasModelId) ?? null
		: null;

	const priceModel = priceModelId
		? models.find((m) => m.id === priceModelId) ?? null
		: null;

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex flex-wrap items-center gap-3">
					<h3 class="mb-0 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						模型广场
					</h3>
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						{filtered.length} / {displayModels.length} 个模型
					</span>
					<button
						type="button"
						class={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
							primaryMode
								? "border-amber-400 bg-amber-50 text-amber-700"
								: "border-stone-200 bg-white text-stone-500 hover:border-stone-300"
						}`}
						onClick={() => setPrimaryMode((v) => !v)}
					>
						{primaryMode ? "主名模式" : "普通模式"}
					</button>
				</div>
				<input
					class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 sm:w-64"
					type="text"
					placeholder="搜索模型..."
					value={search}
					onInput={(e) => {
						const target = e.currentTarget as HTMLInputElement | null;
						setSearch(target?.value ?? "");
					}}
				/>
			</div>
			{filtered.length === 0 ? (
				<div class="py-12 text-center text-sm text-stone-400">
					{models.length === 0 ? "暂无模型数据" : "未找到匹配的模型"}
				</div>
			) : (
				<>
					<div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
						{pagedModels.map((model) => (
							<ModelCard
								key={model.id}
								model={model}
								compact={primaryMode}
								onAliasClick={
									onAliasSave && !primaryMode
										? () => setAliasModelId(model.id)
										: undefined
								}
								onPriceClick={
									onPriceSave && !primaryMode
										? () => setPriceModelId(model.id)
										: undefined
								}
							/>
						))}
					</div>
					{/* Pagination */}
					<div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-xs text-stone-500">
								共 {total} 条 · {totalPages} 页
							</span>
							<button
								class="h-10 w-10 md:h-8 md:w-8 rounded-full border border-stone-200 bg-white text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
								type="button"
								disabled={page <= 1}
								onClick={() => setPage(Math.max(1, page - 1))}
							>
								&lt;
							</button>
							{pageItems.map((item, index) =>
								item === "ellipsis" ? (
									<span class="px-2 text-xs text-stone-400" key={`e-${index}`}>
										...
									</span>
								) : (
									<button
										class={`h-10 min-w-10 md:h-8 md:min-w-8 rounded-full border px-3 text-xs font-semibold transition-all duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
											item === page
												? "border-stone-900 bg-stone-900 text-white shadow-md"
												: "border-stone-200 bg-white text-stone-600 hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-md"
										}`}
										type="button"
										key={item}
										onClick={() => setPage(item)}
									>
										{item}
									</button>
								),
							)}
							<button
								class="h-10 w-10 md:h-8 md:w-8 rounded-full border border-stone-200 bg-white text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
								type="button"
								disabled={page >= totalPages}
								onClick={() => setPage(Math.min(totalPages, page + 1))}
							>
								&gt;
							</button>
						</div>
						<label class="flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-500">
							每页条数
							<select
								class="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
								value={pageSize}
								onChange={(event) => {
									setPageSize(
										Number((event.currentTarget as HTMLSelectElement).value),
									);
								}}
							>
								{pageSizeOptions.map((size) => (
									<option key={size} value={size}>
										{size}
									</option>
								))}
							</select>
						</label>
					</div>
				</>
			)}
			{aliasModel && onAliasSave && (
				<AliasEditModal
					modelId={aliasModel.id}
					initialAliases={aliasModel.aliases}
					onSave={(aliases) => onAliasSave(aliasModel.id, aliases)}
					onClose={() => setAliasModelId(null)}
				/>
			)}
			{priceModel && onPriceSave && (
				<PriceEditModal
					modelId={priceModel.id}
					channels={priceModel.channels}
					onSave={(prices) => onPriceSave(priceModel.id, prices)}
					onClose={() => setPriceModelId(null)}
				/>
			)}
		</div>
	);
};
