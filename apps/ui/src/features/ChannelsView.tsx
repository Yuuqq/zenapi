import type { Channel, ChannelApiFormat, ChannelForm, SiteMode } from "../core/types";
import { buildPageItems } from "../core/utils";

type ParsedModel = {
	id: string;
	input_price: string;
	output_price: string;
	shared: boolean;
	enabled: boolean;
};

function parseModelLines(text: string, defaultShared = false): ParsedModel[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const parts = line.split("|");
			const hasExplicitShared = parts.length > 3 && parts[3].trim() !== "";
			const hasExplicitEnabled = parts.length > 4 && parts[4].trim() !== "";
			return {
				id: parts[0].trim(),
				input_price: parts[1]?.trim() ?? "",
				output_price: parts[2]?.trim() ?? "",
				shared: hasExplicitShared ? parts[3].trim() === "1" : defaultShared,
				enabled: hasExplicitEnabled ? parts[4].trim() !== "0" : true,
			};
		});
}

function rebuildModelsText(models: ParsedModel[]): string {
	return models
		.map((m) => {
			if (m.input_price || m.output_price || m.shared === true || m.shared === false || m.enabled === false) {
				return `${m.id}|${m.input_price}|${m.output_price}|${m.shared ? "1" : "0"}|${m.enabled ? "1" : "0"}`;
			}
			return m.id;
		})
		.join("\n");
}

type ModelPricingEditorProps = {
	models: string;
	siteMode: SiteMode;
	onModelsChange: (value: string) => void;
};

const ModelPricingEditor = ({
	models,
	siteMode,
	onModelsChange,
}: ModelPricingEditorProps) => {
	const defaultShared = siteMode === "shared";
	const parsed = parseModelLines(models, defaultShared);
	if (parsed.length === 0) return null;

	const sharedCount = parsed.filter((m) => m.shared).length;
	const allShared = sharedCount === parsed.length;
	const noneShared = sharedCount === 0;

	const enabledCount = parsed.filter((m) => m.enabled).length;
	const allEnabled = enabledCount === parsed.length;
	const noneEnabled = enabledCount === 0;

	const updatePrice = (
		index: number,
		field: "input_price" | "output_price",
		value: string,
	) => {
		const updated = [...parsed];
		updated[index] = { ...updated[index], [field]: value };
		onModelsChange(rebuildModelsText(updated));
	};

	const updateShared = (index: number, value: boolean) => {
		const updated = [...parsed];
		updated[index] = { ...updated[index], shared: value };
		onModelsChange(rebuildModelsText(updated));
	};

	const updateEnabled = (index: number, value: boolean) => {
		const updated = [...parsed];
		updated[index] = { ...updated[index], enabled: value };
		onModelsChange(rebuildModelsText(updated));
	};

	const toggleAll = (value: boolean) => {
		const updated = parsed.map((m) => ({ ...m, shared: value }));
		onModelsChange(rebuildModelsText(updated));
	};

	const toggleAllEnabled = (value: boolean) => {
		const updated = parsed.map((m) => ({ ...m, enabled: value }));
		onModelsChange(rebuildModelsText(updated));
	};

	return (
		<div class="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
			<div class="mb-2 flex items-center justify-between flex-wrap gap-2">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						模型定价 & 共享设置
					</p>
					<div class="flex items-center gap-1.5 flex-wrap">
						<span class="text-xs text-stone-400">
							{enabledCount}/{parsed.length} 启用
						</span>
						<button
							type="button"
							class={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
								allEnabled
									? "bg-stone-200 text-stone-500"
									: "bg-blue-100 text-blue-700 hover:bg-blue-200"
							}`}
							onClick={() => toggleAllEnabled(true)}
							disabled={allEnabled}
						>
							全部启用
						</button>
						<button
							type="button"
							class={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
								noneEnabled
									? "bg-stone-200 text-stone-500"
									: "bg-stone-100 text-stone-600 hover:bg-stone-200"
							}`}
							onClick={() => toggleAllEnabled(false)}
							disabled={noneEnabled}
						>
							全部禁用
						</button>
						<span class="text-xs text-stone-300">|</span>
						<span class="text-xs text-stone-400">
							{sharedCount}/{parsed.length} 共享
						</span>
						<button
							type="button"
							class={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
								allShared
									? "bg-stone-200 text-stone-500"
									: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
							}`}
							onClick={() => toggleAll(true)}
							disabled={allShared}
						>
							全部共享
						</button>
						<button
							type="button"
							class={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
								noneShared
									? "bg-stone-200 text-stone-500"
									: "bg-stone-100 text-stone-600 hover:bg-stone-200"
							}`}
							onClick={() => toggleAll(false)}
							disabled={noneShared}
						>
							全部取消
						</button>
					</div>
				</div>
				<div class="space-y-2">
					{parsed.map((m, i) => (
						<div
							key={`${m.id}-${i}`}
							class={`flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2 ${!m.enabled ? "opacity-50" : ""}`}
						>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<button
									type="button"
									class={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors ${
										m.enabled
											? "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100"
											: "border-stone-200 bg-white text-stone-400 hover:bg-stone-100 hover:text-stone-600"
									}`}
									onClick={() => updateEnabled(i, !m.enabled)}
								>
									{m.enabled ? "启用" : "禁用"}
								</button>
								<button
									type="button"
									class={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors ${
										m.shared
											? "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
											: "border-stone-200 bg-white text-stone-400 hover:bg-stone-100 hover:text-stone-600"
									}`}
									onClick={() => updateShared(i, !m.shared)}
								>
									{m.shared ? "共享" : "私有"}
								</button>
								<span class={`min-w-0 truncate text-xs font-medium ${m.enabled ? "text-stone-700" : "text-stone-400 line-through"}`}>
									{m.id}
								</span>
							</div>
							<div class="flex shrink-0 items-center gap-1.5">
								<label class="text-xs text-stone-400">输入</label>
								<input
									class="w-20 rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-900 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
									type="number"
									min="0"
									step="0.01"
									placeholder="0"
									value={m.input_price}
									onInput={(e) =>
										updatePrice(
											i,
											"input_price",
											(e.currentTarget as HTMLInputElement).value,
										)
									}
								/>
								<label class="text-xs text-stone-400">输出</label>
								<input
									class="w-20 rounded border border-stone-200 bg-white px-2 py-1 text-xs text-stone-900 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
									type="number"
									min="0"
									step="0.01"
									placeholder="0"
									value={m.output_price}
									onInput={(e) =>
										updatePrice(
											i,
											"output_price",
											(e.currentTarget as HTMLInputElement).value,
										)
									}
								/>
							</div>
						</div>
					))}
			</div>
		</div>
	);
};

type ChannelsViewProps = {
	channelForm: ChannelForm;
	channelPage: number;
	channelPageSize: number;
	channelTotal: number;
	channelTotalPages: number;
	pagedChannels: Channel[];
	channelSearch: string;
	editingChannel: Channel | null;
	isChannelModalOpen: boolean;
	siteMode: SiteMode;
	onCreate: () => void;
	onCloseModal: () => void;
	onEdit: (channel: Channel) => void;
	onSubmit: (event: Event) => void;
	onTest: (id: string) => void;
	onToggle: (id: string, status: string) => void;
	onDelete: (id: string) => void;
	onPageChange: (next: number) => void;
	onPageSizeChange: (next: number) => void;
	onSearchChange: (value: string) => void;
	onFormChange: (patch: Partial<ChannelForm>) => void;
};

const pageSizeOptions = [10, 20, 50];

const formatLabels: Record<ChannelApiFormat, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	custom: "Custom",
};

const formatBadgeColors: Record<ChannelApiFormat, string> = {
	openai: "border-blue-100 bg-blue-50 text-blue-600",
	anthropic: "border-orange-100 bg-orange-50 text-orange-600",
	custom: "border-purple-100 bg-purple-50 text-purple-600",
};

const baseUrlPlaceholders: Record<ChannelApiFormat, string> = {
	openai: "https://api.openai.com/v1",
	anthropic: "https://api.anthropic.com/anthropic",
	custom: "https://example.com/v1/chat/completions",
};

/**
 * Renders the channels management view.
 */
export const ChannelsView = ({
	channelForm,
	channelPage,
	channelPageSize,
	channelTotal,
	channelTotalPages,
	pagedChannels,
	channelSearch,
	editingChannel,
	isChannelModalOpen,
	siteMode,
	onCreate,
	onCloseModal,
	onEdit,
	onSubmit,
	onTest,
	onToggle,
	onDelete,
	onPageChange,
	onPageSizeChange,
	onSearchChange,
	onFormChange,
}: ChannelsViewProps) => {
	const isEditing = Boolean(editingChannel);
	const pageItems = buildPageItems(channelPage, channelTotalPages);
	return (
		<div class="space-y-5">
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 class="mb-1 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							渠道列表
						</h3>
						<p class="text-xs text-stone-500">状态、权重与操作入口集中展示。</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<input
							class="h-10 md:h-9 w-full rounded-full border border-stone-200 bg-white px-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 sm:w-52"
							type="text"
							placeholder="搜索渠道..."
							value={channelSearch}
							onInput={(e) =>
								onSearchChange(
									(e.currentTarget as HTMLInputElement).value,
								)
							}
						/>
						<button
							class="h-10 md:h-9 rounded-full bg-stone-900 px-4 text-xs font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
							type="button"
							onClick={onCreate}
						>
							新增渠道
						</button>
					</div>
				</div>

				{/* Desktop table layout */}
				<div class="mt-4 hidden md:block overflow-hidden rounded-xl border border-stone-200">
					<div class="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,1.6fr)] gap-3 bg-stone-50 px-4 py-3 text-xs uppercase tracking-widest text-stone-500">
						<div>渠道</div>
						<div>格式</div>
						<div>状态</div>
						<div>权重</div>
						<div>操作</div>
					</div>
					{pagedChannels.length === 0 ? (
						<div class="px-4 py-10 text-center text-sm text-stone-500">
							暂无渠道，请先创建。
						</div>
					) : (
						<div class="divide-y divide-stone-100">
							{pagedChannels.map((channel) => {
								const isActive = channel.status === "active";
								const fmt = (channel.api_format ??
									"openai") as ChannelApiFormat;
								return (
									<div
										class={`grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,1.6fr)] items-center gap-3 px-4 py-4 text-sm ${
											editingChannel?.id === channel.id
												? "bg-amber-50/60"
												: "bg-white"
										}`}
										key={channel.id}
									>
										<div class="flex min-w-0 flex-col">
											<span class="truncate font-semibold text-stone-900">
												{channel.name}
											</span>
											<span
												class="truncate text-xs text-stone-500"
												title={channel.base_url}
											>
												{channel.base_url}
											</span>
										</div>
										<div>
											<span
												class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${formatBadgeColors[fmt]}`}
											>
												{formatLabels[fmt]}
											</span>
										</div>
										<div>
											<span
												class={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
													isActive
														? "border-emerald-100 bg-emerald-50 text-emerald-600"
														: "border-stone-200 bg-stone-100 text-stone-500"
												}`}
											>
												{isActive ? "启用" : "禁用"}
											</span>
										</div>
										<div class="text-sm font-semibold text-stone-700">
											{channel.weight}
										</div>
										<div class="flex flex-wrap gap-2">
											<button
												class="h-9 rounded-full border border-stone-200 bg-stone-100 px-3 text-xs font-semibold text-stone-900 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
												type="button"
												onClick={() => onTest(channel.id)}
											>
												连通测试
											</button>
											<button
												class="h-9 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
												type="button"
												onClick={() => onToggle(channel.id, channel.status)}
											>
												{isActive ? "禁用" : "启用"}
											</button>
											<button
												class="h-9 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
												type="button"
												onClick={() => onEdit(channel)}
											>
												编辑
											</button>
											<button
												class="h-9 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-500 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
												type="button"
												onClick={() => onDelete(channel.id)}
											>
												删除
											</button>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Mobile card layout */}
				<div class="mt-4 md:hidden space-y-3">
					{pagedChannels.length === 0 ? (
						<div class="px-4 py-10 text-center text-sm text-stone-500 rounded-xl border border-stone-200">
							暂无渠道，请先创建。
						</div>
					) : (
						pagedChannels.map((channel) => {
							const isActive = channel.status === "active";
							const fmt = (channel.api_format ?? "openai") as ChannelApiFormat;
							return (
								<div
									class={`rounded-xl border border-stone-200 p-4 ${
										editingChannel?.id === channel.id
											? "bg-amber-50/60"
											: "bg-white"
									}`}
									key={channel.id}
								>
									<div class="flex items-start justify-between gap-2">
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2 flex-wrap">
												<span class="truncate font-semibold text-stone-900 text-sm">
													{channel.name}
												</span>
												<span
													class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${formatBadgeColors[fmt]}`}
												>
													{formatLabels[fmt]}
												</span>
											</div>
											<span
												class="block truncate text-xs text-stone-500 mt-1"
												title={channel.base_url}
											>
												{channel.base_url}
											</span>
										</div>
										<span
											class={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
												isActive
													? "border-emerald-100 bg-emerald-50 text-emerald-600"
													: "border-stone-200 bg-stone-100 text-stone-500"
											}`}
										>
											{isActive ? "启用" : "禁用"}
										</span>
									</div>
									<div class="mt-2 text-xs text-stone-500">
										权重:{" "}
										<span class="font-semibold text-stone-700">
											{channel.weight}
										</span>
									</div>
									<div class="mt-3 flex flex-wrap gap-2">
										<button
											class="h-10 rounded-full border border-stone-200 bg-stone-100 px-3 text-xs font-semibold text-stone-900 transition-all duration-200 ease-in-out hover:shadow-lg"
											type="button"
											onClick={() => onTest(channel.id)}
										>
											连通测试
										</button>
										<button
											class="h-10 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:text-stone-900 hover:shadow-lg"
											type="button"
											onClick={() => onToggle(channel.id, channel.status)}
										>
											{isActive ? "禁用" : "启用"}
										</button>
										<button
											class="h-10 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:text-stone-900 hover:shadow-lg"
											type="button"
											onClick={() => onEdit(channel)}
										>
											编辑
										</button>
										<button
											class="h-10 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-500 transition-all duration-200 ease-in-out hover:text-stone-900 hover:shadow-lg"
											type="button"
											onClick={() => onDelete(channel.id)}
										>
											删除
										</button>
									</div>
								</div>
							);
						})
					)}
				</div>

				<div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs text-stone-500">
							共 {channelTotal} 条 · {channelTotalPages} 页
						</span>
						<button
							class="h-10 w-10 md:h-8 md:w-8 rounded-full border border-stone-200 bg-white text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
							type="button"
							disabled={channelPage <= 1}
							onClick={() => onPageChange(Math.max(1, channelPage - 1))}
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
										item === channelPage
											? "border-stone-900 bg-stone-900 text-white shadow-md"
											: "border-stone-200 bg-white text-stone-600 hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-md"
									}`}
									type="button"
									key={item}
									onClick={() => onPageChange(item)}
								>
									{item}
								</button>
							),
						)}
						<button
							class="h-10 w-10 md:h-8 md:w-8 rounded-full border border-stone-200 bg-white text-xs font-semibold text-stone-600 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
							type="button"
							disabled={channelPage >= channelTotalPages}
							onClick={() =>
								onPageChange(Math.min(channelTotalPages, channelPage + 1))
							}
						>
							&gt;
						</button>
					</div>
					<label class="flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-500">
						每页条数
						<select
							class="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
							value={channelPageSize}
							onChange={(event) => {
								onPageSizeChange(
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
			</div>
			{isChannelModalOpen && (
				<div class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-900/40 px-0 md:px-4 py-0 md:py-8">
					<div class="w-full max-w-3xl rounded-t-2xl md:rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h3 class="mb-1 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
									{isEditing ? "编辑渠道" : "新增渠道"}
								</h3>
								<p class="text-xs text-stone-500">
									{isEditing
										? `正在编辑：${editingChannel?.name ?? ""}`
										: "填写渠道信息并保存。"}
								</p>
							</div>
							<button
								class="h-10 md:h-9 rounded-full border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-500 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
								type="button"
								onClick={onCloseModal}
							>
								关闭
							</button>
						</div>
						<form class="mt-4 grid gap-3.5" onSubmit={onSubmit}>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="channel-name"
								>
									名称
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="channel-name"
									name="name"
									value={channelForm.name}
									required
									onInput={(event) =>
										onFormChange({
											name: (event.currentTarget as HTMLInputElement).value,
										})
									}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="channel-format"
								>
									API 格式
								</label>
								<select
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="channel-format"
									value={channelForm.api_format}
									onChange={(event) =>
										onFormChange({
											api_format: (event.currentTarget as HTMLSelectElement)
												.value as ChannelApiFormat,
										})
									}
								>
									<option value="openai">OpenAI</option>
									<option value="anthropic">Anthropic (Claude)</option>
									<option value="custom">Custom</option>
								</select>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="channel-base"
								>
									{channelForm.api_format === "custom"
										? "完整请求 URL"
										: "Base URL（含版本路径，如 /v1）"}
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="channel-base"
									name="base_url"
									placeholder={
										baseUrlPlaceholders[channelForm.api_format] ??
										baseUrlPlaceholders.openai
									}
									value={channelForm.base_url}
									required
									onInput={(event) =>
										onFormChange({
											base_url: (event.currentTarget as HTMLInputElement).value,
										})
									}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="channel-key"
								>
									API Key
								</label>
								<textarea
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono"
									id="channel-key"
									name="api_key"
									rows={3}
									placeholder={"每行一个 API Key（可留空）"}
									value={channelForm.api_key}
									onInput={(event) =>
										onFormChange({
											api_key: (event.currentTarget as HTMLTextAreaElement).value,
										})
									}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="channel-weight"
								>
									权重
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									id="channel-weight"
									name="weight"
									type="number"
									min="0"
									step="any"
									value={channelForm.weight}
									onInput={(event) =>
										onFormChange({
											weight: Number(
												(event.currentTarget as HTMLInputElement).value || 0,
											),
										})
									}
								/>
							</div>
							<div>
								<label
									class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
									for="channel-models"
								>
									模型列表
								</label>
								<textarea
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono"
									id="channel-models"
									rows={3}
									placeholder="每行一个模型 ID，如：&#10;gpt-4o&#10;claude-sonnet-4-20250514"
									value={channelForm.models}
									onInput={(event) =>
										onFormChange({
											models: (event.currentTarget as HTMLTextAreaElement)
												.value,
										})
									}
								/>
								<p class="mt-1 text-xs text-stone-400">
									每行一个模型 ID，留空则由连通测试自动获取。
								</p>
								<ModelPricingEditor
									models={channelForm.models}
									siteMode={siteMode}
									onModelsChange={(value) =>
										onFormChange({ models: value })
									}
								/>
							</div>
							{channelForm.api_format === "custom" && (
								<div>
									<label
										class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500"
										for="channel-custom-headers"
									>
										自定义请求头 (JSON)
									</label>
									<textarea
										class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono"
										id="channel-custom-headers"
										rows={3}
										placeholder={'{"X-Custom-Header": "value"}'}
										value={channelForm.custom_headers}
										onInput={(event) =>
											onFormChange({
												custom_headers: (
													event.currentTarget as HTMLTextAreaElement
												).value,
											})
										}
									/>
								</div>
							)}
							<div class="flex flex-wrap items-center justify-end gap-2 pt-2">
								<button
									class="h-10 rounded-full border border-stone-200 bg-stone-50 px-4 text-xs font-semibold text-stone-500 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
									type="button"
									onClick={onCloseModal}
								>
									取消
								</button>
								<button
									class="h-10 rounded-full bg-stone-900 px-5 text-xs font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
									type="submit"
								>
									{isEditing ? "保存修改" : "创建渠道"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
};
