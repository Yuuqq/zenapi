import { useCallback, useState } from "hono/jsx/dom";
import { createApiFetch } from "../core/api";
import { apiBase } from "../core/constants";
import type { MonitoringData } from "../core/types";

type MonitoringViewProps = {
	monitoring: MonitoringData | null;
	token: string;
	onLoaded: (data: MonitoringData) => void;
};

const rateColor = (rate: number | null) => {
	if (rate === null) return "text-stone-400";
	if (rate >= 99) return "text-green-600";
	if (rate >= 95) return "text-yellow-600";
	return "text-red-600";
};

const rateBg = (rate: number | null) => {
	if (rate === null) return "bg-stone-100";
	if (rate >= 99) return "bg-green-50";
	if (rate >= 95) return "bg-yellow-50";
	return "bg-red-50";
};

export const MonitoringView = ({
	monitoring,
	token,
	onLoaded,
}: MonitoringViewProps) => {
	const [days, setDays] = useState(7);
	const [loading, setLoading] = useState(false);

	const fetchData = useCallback(
		async (d: number) => {
			setLoading(true);
			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (token) headers.Authorization = `Bearer ${token}`;
				const res = await fetch(
					`${apiBase}/api/monitoring?days=${d}`,
					{ headers },
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as MonitoringData;
				onLoaded(data);
			} catch {
				/* silently ignore — parent handles errors */
			} finally {
				setLoading(false);
			}
		},
		[token, onLoaded],
	);

	const handleDaysChange = useCallback(
		(d: number) => {
			setDays(d);
			fetchData(d);
		},
		[fetchData],
	);

	if (!monitoring) {
		return (
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				暂无数据
			</div>
		);
	}

	const { summary, channels, dailyTrends } = monitoring;

	return (
		<div class="space-y-5">
			{/* Time range selector */}
			<div class="flex items-center gap-2">
				{[1, 7, 30].map((d) => (
					<button
						key={d}
						type="button"
						onClick={() => handleDaysChange(d)}
						disabled={loading}
						class={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
							days === d
								? "bg-stone-900 text-white"
								: "bg-stone-100 text-stone-600 hover:bg-stone-200"
						} ${loading ? "opacity-50" : ""}`}
					>
						{d === 1 ? "1 天" : d === 7 ? "7 天" : "30 天"}
					</button>
				))}
				{loading && (
					<span class="text-xs text-stone-400">加载中...</span>
				)}
			</div>

			{/* Global overview cards */}
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						整体成功率
					</span>
					<div class={`text-2xl font-semibold ${rateColor(summary.success_rate)}`}>
						{summary.success_rate}%
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						{summary.total_requests} 次请求
					</span>
				</div>
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						活跃渠道
					</span>
					<div class="text-2xl font-semibold text-stone-900">
						{summary.active_channels}{" "}
						<span class="text-base font-normal text-stone-400">
							/ {summary.total_channels}
						</span>
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						有流量渠道数
					</span>
				</div>
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						平均延迟
					</span>
					<div class="text-2xl font-semibold text-stone-900">
						{summary.avg_latency_ms} ms
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						成功 {summary.total_success} / 错误 {summary.total_errors}
					</span>
				</div>
			</div>

			{/* Channel status table */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					渠道状态
				</h3>
				{/* Desktop table */}
				<div class="hidden md:block">
					<table class="w-full border-collapse text-sm">
						<thead>
							<tr>
								<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
									渠道
								</th>
								<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
									格式
								</th>
								<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
									状态
								</th>
								<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
									成功率
								</th>
								<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
									平均延迟
								</th>
								<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
									最近活动
								</th>
							</tr>
						</thead>
						<tbody>
							{channels.map((ch) => (
								<tr class="hover:bg-stone-50" key={ch.channel_id}>
									<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
										{ch.channel_name}
									</td>
									<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-500">
										{ch.api_format}
									</td>
									<td class="border-b border-stone-200 px-3 py-2.5 text-sm">
										<span
											class={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
												ch.channel_status === "active"
													? "bg-green-100 text-green-700"
													: "bg-stone-100 text-stone-500"
											}`}
										>
											{ch.channel_status === "active" ? "启用" : "停用"}
										</span>
									</td>
									<td
										class={`border-b border-stone-200 px-3 py-2.5 text-sm font-medium ${rateColor(ch.success_rate)}`}
									>
										{ch.success_rate !== null ? `${ch.success_rate}%` : "-"}
									</td>
									<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
										{ch.total_requests > 0 ? `${ch.avg_latency_ms} ms` : "-"}
									</td>
									<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-500">
										{ch.last_seen
											? ch.last_seen.slice(0, 16).replace("T", " ")
											: "-"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{/* Mobile cards */}
				<div class="space-y-3 md:hidden">
					{channels.map((ch) => (
						<div
							key={ch.channel_id}
							class={`rounded-xl border border-stone-200 p-4 ${rateBg(ch.success_rate)}`}
						>
							<div class="mb-2 flex items-center justify-between">
								<span class="font-medium text-stone-900">
									{ch.channel_name}
								</span>
								<span
									class={`rounded-full px-2 py-0.5 text-xs font-medium ${
										ch.channel_status === "active"
											? "bg-green-100 text-green-700"
											: "bg-stone-100 text-stone-500"
									}`}
								>
									{ch.channel_status === "active" ? "启用" : "停用"}
								</span>
							</div>
							<div class="grid grid-cols-3 gap-2 text-xs">
								<div>
									<div class="text-stone-400">成功率</div>
									<div class={`font-medium ${rateColor(ch.success_rate)}`}>
										{ch.success_rate !== null ? `${ch.success_rate}%` : "-"}
									</div>
								</div>
								<div>
									<div class="text-stone-400">延迟</div>
									<div class="text-stone-700">
										{ch.total_requests > 0 ? `${ch.avg_latency_ms}ms` : "-"}
									</div>
								</div>
								<div>
									<div class="text-stone-400">格式</div>
									<div class="text-stone-700">{ch.api_format}</div>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Daily trends table */}
			{dailyTrends.length > 0 && (
				<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						每日趋势
					</h3>
					<div class="overflow-x-auto">
						<table class="w-full border-collapse text-sm">
							<thead>
								<tr>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										日期
									</th>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										渠道
									</th>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										请求
									</th>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										成功
									</th>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										错误
									</th>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										成功率
									</th>
									<th class="border-b border-stone-200 px-3 py-2.5 text-left text-xs uppercase tracking-widest text-stone-500">
										延迟
									</th>
								</tr>
							</thead>
							<tbody>
								{dailyTrends.map((row) => {
									const chName =
										channels.find(
											(ch) => ch.channel_id === row.channel_id,
										)?.channel_name ?? row.channel_id ?? "-";
									return (
										<tr class="hover:bg-stone-50" key={`${row.day}-${row.channel_id}`}>
											<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
												{row.day}
											</td>
											<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
												{chName}
											</td>
											<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
												{row.requests}
											</td>
											<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
												{row.success}
											</td>
											<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
												{row.errors}
											</td>
											<td
												class={`border-b border-stone-200 px-3 py-2.5 text-sm font-medium ${rateColor(row.success_rate)}`}
											>
												{row.success_rate}%
											</td>
											<td class="border-b border-stone-200 px-3 py-2.5 text-sm text-stone-700">
												{row.avg_latency_ms} ms
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
};
