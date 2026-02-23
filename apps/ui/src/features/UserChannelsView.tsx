import { useCallback, useEffect, useMemo, useState } from "hono/jsx/dom";
import { createApiFetch } from "../core/api";
import type { ChannelApiFormat } from "../core/types";

type ChannelItem = {
	id: string;
	name: string;
	base_url: string;
	api_key?: string;
	models_json?: string;
	api_format: string;
	status: string;
	created_at: string;
};

type ChannelFormData = {
	name: string;
	base_url: string;
	api_key: string;
	api_format: ChannelApiFormat;
	models: string;
};

const emptyForm: ChannelFormData = {
	name: "",
	base_url: "",
	api_key: "",
	api_format: "openai",
	models: "",
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
};

export const UserChannelsView = ({
	token,
	updateToken,
}: UserChannelsViewProps) => {
	const [channels, setChannels] = useState<ChannelItem[]>([]);
	const [showModal, setShowModal] = useState(false);
	const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(null);
	const [notice, setNotice] = useState("");
	const [form, setForm] = useState<ChannelFormData>({ ...emptyForm });

	const apiFetch = useMemo(
		() => createApiFetch(token, () => updateToken(null)),
		[token, updateToken],
	);

	const loadChannels = useCallback(async () => {
		try {
			const result = await apiFetch<{ channels: ChannelItem[] }>(
				"/api/u/channels",
			);
			setChannels(result.channels);
		} catch (error) {
			setNotice((error as Error).message);
		}
	}, [apiFetch]);

	useEffect(() => {
		loadChannels();
	}, [loadChannels]);

	const openCreate = useCallback(() => {
		setEditingChannel(null);
		setForm({ ...emptyForm });
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
		});
		setShowModal(true);
		setNotice("");
	}, []);

	const closeModal = useCallback(() => {
		setShowModal(false);
		setEditingChannel(null);
		setForm({ ...emptyForm });
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
				const payload = {
					name: form.name.trim(),
					base_url: form.base_url.trim(),
					api_key: form.api_key.trim(),
					api_format: form.api_format,
					models: models.length > 0 ? models : undefined,
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
				await loadChannels();
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, form, editingChannel, closeModal, loadChannels],
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (!window.confirm("确定要删除该渠道吗？此操作不可撤销。")) return;
			try {
				await apiFetch(`/api/u/channels/${id}`, { method: "DELETE" });
				setNotice("渠道已删除");
				await loadChannels();
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, loadChannels],
	);

	const isEditing = Boolean(editingChannel);

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
									<option value="openai">OpenAI</option>
									<option value="anthropic">Anthropic</option>
									<option value="custom">Custom</option>
								</select>
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
