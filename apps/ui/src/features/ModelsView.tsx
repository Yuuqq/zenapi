import { useEffect, useMemo, useState } from "hono/jsx/dom";
import type { ModelItem } from "../core/types";
import { buildPageItems } from "../core/utils";

type ModelsViewProps = {
	models: ModelItem[];
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

const ModelCard = ({ model }: { model: ModelItem }) => (
	<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
		<div class="mb-2 flex items-start justify-between gap-2">
			<h4 class="break-all font-['Space_Grotesk'] text-sm font-semibold tracking-tight text-stone-900">
				{model.id}
			</h4>
			<span class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
				{model.channels.length} 渠道
			</span>
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

const pageSizeOptions = [12, 24, 48];

export const ModelsView = ({ models }: ModelsViewProps) => {
	const [search, setSearch] = useState("");
	const [pageSize, setPageSize] = useState(12);
	const [page, setPage] = useState(1);

	const filtered = search
		? models.filter((m) =>
				m.id.toLowerCase().includes(search.toLowerCase()),
			)
		: models;

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

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex items-center gap-3">
					<h3 class="mb-0 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						模型广场
					</h3>
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						{filtered.length} / {models.length} 个模型
					</span>
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
							<ModelCard key={model.id} model={model} />
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
		</div>
	);
};
