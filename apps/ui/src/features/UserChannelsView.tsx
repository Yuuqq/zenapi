import { useCallback, useMemo, useState } from "hono/jsx/dom";
import { createApiFetch } from "../core/api";
import type { ChannelApiFormat } from "../core/types";
import type { ModelAliasConfig, ModelAliasesMap } from "../UserApp";

type ChannelItem = {
	id: string;
	name: string;
	base_url: string;
	api_key?: string;
	models_json?: string;
	api_format: string;
	status: string;
	tip_url?: string;
	created_at: string;
};

type ChannelFormData = {
	name: string;
	base_url: string;
	api_key: string;
	api_format: ChannelApiFormat;
	models: string;
	tip_url: string;
};

const emptyForm: ChannelFormData = {
	name: "",
	base_url: "",
	api_key: "",
	api_format: "openai",
	models: "",
	tip_url: "",
};

function parseModelsJsonToText(modelsJson?: string): string {
	if (!modelsJson) return "";
	try {
		const parsed = JSON.parse(modelsJson);
		const arr = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed?.data)
				? parsed.data
				: [];
		return arr
			.map((m: unknown) => {
				if (typeof m === "string") return m;
				const obj = m as { id?: string };
				return obj?.id ?? "";
			})
			.filter(Boolean)
			.join("\n");
	} catch {
		return "";
	}
}

type UserChannelsViewProps = {
	token: string;
	updateToken: (next: string | null) => void;
	channels: ChannelItem[];
	modelAliases: ModelAliasesMap;
	onRefresh: () => Promise<void>;
};

export const UserChannelsView = ({
	token,
	updateToken,
	channels,
	modelAliases,
	onRefresh,
}: UserChannelsViewProps) => {
	const [showModal, setShowModal] = useState(false);
	const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(null);
	const [notice, setNotice] = useState("");
	const [form, setForm] = useState<ChannelFormData>({ ...emptyForm });
	// Per-model alias state: Record<modelId, { aliases, alias_only }>
	const [aliasState, setAliasState] = useState<Record<string, ModelAliasConfig>>({});
	// Track which models have their alias editor expanded
	const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

	const apiFetch = useMemo(
		() => createApiFetch(token, () => updateToken(null)),
		[token, updateToken],
	);

	const openCreate = useCallback(() => {
		setEditingChannel(null);
		setForm({ ...emptyForm });
		setAliasState({});
		setExpandedModels(new Set());
		setShowModal(true);
		setNotice("");
	}, []);

	const openEdit = useCallback((ch: ChannelItem) => {
		setEditingChannel(ch);
		setForm({
			name: ch.name ?? "",
			base_url: ch.base_url ?? "",
			api_key: ch.api_key ?? "",
			api_format: (ch.api_format ?? "openai") as ChannelApiFormat,
			models: parseModelsJsonToText(ch.models_json),
			tip_url: ch.tip_url ?? "",
		});
		// Initialize alias state from modelAliases for this channel's models
		const models = parseModelsJsonToText(ch.models_json)
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		const initial: Record<string, ModelAliasConfig> = {};
		for (const m of models) {
			if (modelAliases[m]) {
				initial[m] = {
					aliases: modelAliases[m].aliases.map((a) => ({ ...a })),
					alias_only: modelAliases[m].alias_only,
				};
			}
		}
		setAliasState(initial);
		setExpandedModels(new Set());
		setShowModal(true);
		setNotice("");
	}, [modelAliases]);

	const closeModal = useCallback(() => {
		setShowModal(false);
		setEditingChannel(null);
		setForm({ ...emptyForm });
		setAliasState({});
		setExpandedModels(new Set());
	}, []);

	const handleSubmit = useCallback(
		async (e: Event) => {
			e.preventDefault();
			try {
				const models = form.models
					.split("\n")
					.map((l) => l.trim())
					.filter(Boolean)
					.map((id) => ({ id }));
				// Build model_aliases payload: only include models that have aliases configured
				const modelAliasPayload: Record<string, ModelAliasConfig> = {};
				const modelIds = models.map((m) => m.id);
				for (const mid of modelIds) {
					const cfg = aliasState[mid];
					if (cfg) {
						modelAliasPayload[mid] = cfg;
					}
				}
				const payload = {
					name: form.name.trim(),
					base_url: form.base_url.trim(),
					api_key: form.api_key.trim(),
					api_format: form.api_format,
					models: models.length > 0 ? models : undefined,
					model_aliases: Object.keys(modelAliasPayload).length > 0 ? modelAliasPayload : undefined,
					tip_url: form.tip_url.trim() || "",
				};
				if (editingChannel) {
					await apiFetch(`/api/u/channels/${editingChannel.id}`, {
						method: "PATCH",
						body: JSON.stringify(payload),
					});
					setNotice("渠道已更新");
				} else {
					await apiFetch("/api/u/channels", {
						method: "POST",
						body: JSON.stringify(payload),
					});
					setNotice("渠道已贡献");
				}
				closeModal();
				await onRefresh();
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, form, aliasState, editingChannel, closeModal, onRefresh],
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (!window.confirm("确定要删除该渠道吗？此操作不可撤销。")) return;
			try {
				await apiFetch(`/api/u/channels/${id}`, { method: "DELETE" });
				setNotice("渠道已删除");
				await onRefresh();
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, onRefresh],
	);

	const isEditing = Boolean(editingChannel);

	// Parse models from textarea in real-time for the alias editor
	const parsedModels = useMemo(
		() =>
			form.models
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean),
		[form.models],
	);

	const toggleModelExpanded = useCallback((modelId: string) => {
		setExpandedModels((prev) => {
			const next = new Set(prev);
			if (next.has(modelId)) {
				next.delete(modelId);
			} else {
				next.add(modelId);
			}
			return next;
		});
	}, []);

	const addAlias = useCallback((modelId: string, alias: string) => {
		const trimmed = alias.trim();
		if (!trimmed) return;
		setAliasState((prev) => {
			const existing = prev[modelId] ?? { aliases: [], alias_only: false };
			if (existing.aliases.some((a) => a.alias === trimmed)) return prev;
			return {
				...prev,
				[modelId]: {
					...existing,
					aliases: [...existing.aliases, { alias: trimmed, is_primary: false }],
				},
			};
		});
	}, []);

	const removeAlias = useCallback((modelId: string, index: number) => {
		setAliasState((prev) => {
			const existing = prev[modelId];
			if (!existing) return prev;
			return {
				...prev,
				[modelId]: {
					...existing,
					aliases: existing.aliases.filter((_, i) => i !== index),
				},
			};
		});
	}, []);

	const setPrimary = useCallback((modelId: string, index: number) => {
		setAliasState((prev) => {
			const existing = prev[modelId];
			if (!existing) return prev;
			return {
				...prev,
				[modelId]: {
					...existing,
					aliases: existing.aliases.map((a, i) => ({
						...a,
						is_primary: i === index,
					})),
				},
			};
		});
	}, []);

	const toggleAliasOnly = useCallback((modelId: string, checked: boolean) => {
		setAliasState((prev) => {
			const existing = prev[modelId] ?? { aliases: [], alias_only: false };
			return {
				...prev,
				[modelId]: { ...existing, alias_only: checked },
			};
		});
	}, []);

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<h3 class="font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						贡献渠道
					</h3>
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						{channels.length} 个
					</span>
				</div>
				<button
					class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
					type="button"
					onClick={openCreate}
				>
					贡献渠道
				</button>
			</div>

			{notice && (
				<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
					{notice}
				</div>
			)}

			{channels.length === 0 ? (
				<p class="py-8 text-center text-sm text-stone-400">
					暂无贡献渠道，点击上方按钮贡献。
				</p>
			) : (
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
								<th class="pb-2 pr-4 font-medium">名称</th>
								<th class="pb-2 pr-4 font-medium">格式</th>
								<th class="pb-2 pr-4 font-medium">状态</th>
								<th class="pb-2 font-medium">操作</th>
							</tr>
						</thead>
						<tbody>
							{channels.map((ch) => (
								<tr class="border-b border-stone-50">
									<td class="py-2.5 pr-4 font-medium text-stone-700">
										{ch.name}
									</td>
									<td class="py-2.5 pr-4 text-stone-600">
										{ch.api_format}
									</td>
									<td class="py-2.5 pr-4">
										<span
											class={`rounded-full px-2 py-0.5 text-xs ${
												ch.status === "active"
													? "bg-emerald-50 text-emerald-600"
													: "bg-stone-100 text-stone-500"
											}`}
										>
											{ch.status === "active"
												? "启用"
												: "停用"}
										</span>
									</td>
									<td class="py-2.5">
										<div class="flex gap-2">
											<button
												type="button"
												class="text-xs text-amber-600 hover:text-amber-700"
												onClick={() => openEdit(ch)}
											>
												编辑
											</button>
											<button
												type="button"
												class="text-xs text-red-500 hover:text-red-600"
												onClick={() => handleDelete(ch.id)}
											>
												删除
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Create / Edit modal */}
			{showModal && (
				<div class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-900/40 px-0 md:px-4 py-0 md:py-8">
					<div class="relative z-10 w-full max-w-lg rounded-t-2xl md:rounded-2xl border border-stone-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
						<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
							{isEditing ? "编辑渠道" : "贡献渠道"}
						</h3>
						<form class="grid gap-4" onSubmit={handleSubmit}>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									渠道名称
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="text"
									required
									value={form.name}
									onInput={(e) =>
										setForm((prev) => ({
											...prev,
											name:
												(
													e.currentTarget as HTMLInputElement
												)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									{form.api_format === "custom"
										? "完整请求 URL"
										: "Base URL（含版本路径，如 /v1）"}
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="url"
									required
									placeholder={form.api_format === "anthropic" ? "https://api.anthropic.com/anthropic" : form.api_format === "custom" ? "https://example.com/v1/chat/completions" : "https://api.openai.com/v1"}
									value={form.base_url}
									onInput={(e) =>
										setForm((prev) => ({
											...prev,
											base_url:
												(
													e.currentTarget as HTMLInputElement
												)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									API Key
								</label>
								<textarea
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 font-mono"
									rows={3}
									placeholder={isEditing ? "留空不修改" : "每行一个 API Key（可留空）"}
									value={form.api_key}
									onInput={(e) =>
										setForm((prev) => ({
											...prev,
											api_key:
												(
													e.currentTarget as HTMLTextAreaElement
												)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									API 格式
								</label>
								<select
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									value={form.api_format}
									onChange={(e) =>
										setForm((prev) => ({
											...prev,
											api_format: (
												e.currentTarget as HTMLSelectElement
											)?.value as ChannelApiFormat,
										}))
									}
								>
									<option value="openai" selected={form.api_format === "openai"}>OpenAI</option>
									<option value="anthropic" selected={form.api_format === "anthropic"}>Anthropic</option>
									<option value="custom" selected={form.api_format === "custom"}>Custom</option>
								</select>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									打赏链接（选填）
								</label>
								<input
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									type="url"
									placeholder="https://example.com/tip"
									value={form.tip_url}
									onInput={(e) =>
										setForm((prev) => ({
											...prev,
											tip_url:
												(
													e.currentTarget as HTMLInputElement
												)?.value ?? "",
										}))
									}
								/>
							</div>
							<div>
								<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
									模型列表（每行一个）
								</label>
								<textarea
									class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
									rows={4}
									value={form.models}
									onInput={(e) =>
										setForm((prev) => ({
											...prev,
											models:
												(
													e.currentTarget as HTMLTextAreaElement
												)?.value ?? "",
										}))
									}
								/>
							</div>
							{/* Per-model alias editor */}
							{parsedModels.length > 0 && (
								<div>
									<label class="mb-1.5 block text-xs uppercase tracking-widest text-stone-500">
										模型别名配置
									</label>
									<div class="space-y-1">
										{parsedModels.map((modelId) => {
											const config = aliasState[modelId];
											const aliasCount = config?.aliases?.length ?? 0;
											const isExpanded = expandedModels.has(modelId);
											return (
												<div class="rounded-lg border border-stone-200">
													<button
														type="button"
														class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50"
														onClick={() => toggleModelExpanded(modelId)}
													>
														<span class="text-xs text-stone-400">{isExpanded ? "▼" : "▶"}</span>
														<span class="flex-1 truncate font-mono text-xs text-stone-800">{modelId}</span>
														{aliasCount > 0 && (
															<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
																{aliasCount} 个别名
															</span>
														)}
													</button>
													{isExpanded && (
														<div class="border-t border-stone-100 px-3 py-2.5">
															{/* Existing aliases */}
															{config?.aliases && config.aliases.length > 0 && (
																<div class="mb-2 space-y-1.5">
																	{config.aliases.map((alias, index) => (
																		<div class="flex items-center gap-2 rounded border border-stone-100 bg-stone-50 px-2 py-1.5">
																			<label class="flex cursor-pointer items-center gap-1 text-xs text-stone-500">
																				<input
																					type="radio"
																					name={`primary-${modelId}`}
																					checked={alias.is_primary}
																					onChange={() => setPrimary(modelId, index)}
																					class="accent-amber-500"
																				/>
																				主名
																			</label>
																			<span class="flex-1 break-all font-mono text-xs text-stone-700">{alias.alias}</span>
																			<button
																				type="button"
																				class="rounded px-1.5 py-0.5 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
																				onClick={() => removeAlias(modelId, index)}
																			>
																				删除
																			</button>
																		</div>
																	))}
																</div>
															)}
															{/* Add new alias */}
															<div class="flex gap-1.5">
																<input
																	type="text"
																	class="flex-1 rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
																	placeholder="输入别名..."
																	onKeyDown={(e) => {
																		if (e.key === "Enter") {
																			e.preventDefault();
																			const input = e.currentTarget as HTMLInputElement;
																			addAlias(modelId, input.value);
																			input.value = "";
																		}
																	}}
																/>
																<button
																	type="button"
																	class="rounded border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
																	onClick={(e) => {
																		const input = (e.currentTarget as HTMLElement).previousElementSibling as HTMLInputElement;
																		addAlias(modelId, input.value);
																		input.value = "";
																	}}
																>
																	添加
																</button>
															</div>
															{/* Alias-only checkbox */}
															{(config?.aliases?.length ?? 0) > 0 && (
																<label class="mt-2 flex cursor-pointer items-center gap-2 rounded border border-stone-100 bg-stone-50 px-2 py-1.5">
																	<input
																		type="checkbox"
																		checked={config?.alias_only ?? false}
																		onChange={(e) => toggleAliasOnly(modelId, (e.currentTarget as HTMLInputElement).checked)}
																		class="accent-amber-500"
																	/>
																	<span class="text-xs text-stone-700">仅限别名</span>
																	<span class="text-xs text-stone-400">— 隐藏原始模型名</span>
																</label>
															)}
														</div>
													)}
												</div>
											);
										})}
									</div>
								</div>
							)}
							<div class="flex justify-end gap-3">
								<button
									type="button"
									class="h-10 rounded-lg border border-stone-200 px-4 text-sm text-stone-500 hover:text-stone-900"
									onClick={closeModal}
								>
									取消
								</button>
								<button
									type="submit"
									class="h-10 rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-all hover:shadow-lg"
								>
									{isEditing ? "保存修改" : "提交"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
};
