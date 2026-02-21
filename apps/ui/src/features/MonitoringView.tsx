import { useCallback, useMemo, useState } from "hono/jsx/dom";
import { apiBase } from "../core/constants";
import type { MonitoringChannelData, MonitoringData, MonitoringDailyTrend } from "../core/types";

type MonitoringViewProps = {
	monitoring: MonitoringData | null;
	token: string;
	onLoaded: (data: MonitoringData) => void;
};

const RANGE_OPTIONS = ["15m", "1h", "1d", "7d", "30d"] as const;
const RANGE_LABELS: Record<string, string> = {
	"15m": "15 分钟",
	"1h": "1 小时",
	"1d": "1 天",
	"7d": "7 天",
	"30d": "30 天",
};

const barColor = (rate: number | null) => {
	if (rate === null) return "#e7e5e4"; // stone-200, no data
	if (rate >= 99) return "#22c55e"; // green-500
	if (rate >= 95) return "#eab308"; // yellow-500
	return "#ef4444"; // red-500
};

const rateColor = (rate: number | null) => {
	if (rate === null) return "text-stone-400";
	if (rate >= 99) return "text-green-600";
	if (rate >= 95) return "text-yellow-600";
	return "text-red-600";
};

const statusLabel = (rate: number | null) => {
	if (rate === null) return "无数据";
	if (rate >= 99) return "正常";
	if (rate >= 95) return "降级";
	return "异常";
};

const statusDot = (rate: number | null) => {
	if (rate === null) return "bg-stone-300";
	if (rate >= 99) return "bg-green-500";
	if (rate >= 95) return "bg-yellow-500";
	return "bg-red-500";
};

/** Generate time slot strings for a given range. */
const generateSlots = (range: string): string[] => {
	const result: string[] = [];
	const now = new Date();
	if (range === "15m" || range === "1h") {
		const minutes = range === "15m" ? 15 : 60;
		// Round down to current minute
		now.setSeconds(0, 0);
		for (let i = minutes - 1; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 60_000);
			// YYYY-MM-DDTHH:MM — matches SQL substr(created_at, 1, 16) on ISO strings
			result.push(d.toISOString().slice(0, 16));
		}
	} else {
		const days = range === "30d" ? 30 : range === "7d" ? 7 : 1;
		for (let i = days - 1; i >= 0; i--) {
			const d = new Date(now.getTime() - i * 86_400_000);
			result.push(d.toISOString().slice(0, 10));
		}
	}
	return result;
};

/** Format a slot key for display in labels/tooltips (converts UTC to local time). */
const formatSlotLabel = (slot: string, range: string): string => {
	if (range === "15m" || range === "1h") {
		// slot is "YYYY-MM-DDTHH:MM" in UTC — convert to local time
		const date = new Date(`${slot}:00.000Z`);
		const hh = String(date.getHours()).padStart(2, "0");
		const mm = String(date.getMinutes()).padStart(2, "0");
		return `${hh}:${mm}`;
	}
	return slot;
};

type ChannelBarProps = {
	channel: MonitoringChannelData;
	slots: string[];
	range: string;
	trendMap: Map<string, MonitoringDailyTrend>;
};

const ChannelBar = ({ channel, slots, range, trendMap }: ChannelBarProps) => {
	const [hoveredSlot, setHoveredSlot] = useState<string | null>(null);

	const hoveredTrend = hoveredSlot ? trendMap.get(`${channel.channel_id}|${hoveredSlot}`) : null;

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			{/* Header row */}
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2.5">
					<span class={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(channel.success_rate)}`} />
					<span class="font-medium text-stone-900">{channel.channel_name}</span>
					<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
						{channel.api_format}
					</span>
					{channel.channel_status !== "active" && (
						<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-400">
							停用
						</span>
					)}
				</div>
				<div class="flex items-center gap-3 text-xs text-stone-500">
					<span class={`font-medium ${rateColor(channel.success_rate)}`}>
						{channel.success_rate !== null ? `${channel.success_rate}%` : "-"}
					</span>
					<span>{channel.total_requests > 0 ? `${channel.avg_latency_ms}ms` : "-"}</span>
					<span class={`font-medium ${rateColor(channel.success_rate)}`}>
						{statusLabel(channel.success_rate)}
					</span>
				</div>
			</div>

			{/* Uptime bars */}
			<div class="flex gap-px">
				{slots.map((slot) => {
					const trend = trendMap.get(`${channel.channel_id}|${slot}`);
					const rate = trend ? trend.success_rate : null;
					return (
						<div
							key={slot}
							class="relative flex-1 cursor-pointer"
							onMouseEnter={() => setHoveredSlot(slot)}
							onMouseLeave={() => setHoveredSlot(null)}
						>
							<div
								class="h-8 rounded-sm transition-opacity hover:opacity-80"
								style={{ backgroundColor: barColor(rate) }}
							/>
						</div>
					);
				})}
			</div>

			{/* Slot labels */}
			<div class="mt-1 flex justify-between text-xs text-stone-400">
				<span>{formatSlotLabel(slots[0], range)}</span>
				<span>{formatSlotLabel(slots[slots.length - 1], range)}</span>
			</div>

			{/* Hover tooltip */}
			{hoveredSlot && (
				<div class="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
					<span class="font-medium text-stone-800">{formatSlotLabel(hoveredSlot, range)}</span>
					{hoveredTrend ? (
						<span>
							{" "}&mdash; {hoveredTrend.requests} 请求, 成功率{" "}
							<span class={`font-medium ${rateColor(hoveredTrend.success_rate)}`}>
								{hoveredTrend.success_rate}%
							</span>
							, 延迟 {hoveredTrend.avg_latency_ms}ms
							{hoveredTrend.errors > 0 && (
								<span class="text-red-500"> ({hoveredTrend.errors} 错误)</span>
							)}
						</span>
					) : (
						<span class="text-stone-400"> &mdash; 无请求</span>
					)}
				</div>
			)}
		</div>
	);
};

export const MonitoringView = ({
	monitoring,
	token,
	onLoaded,
}: MonitoringViewProps) => {
	const [range, setRange] = useState("15m");
	const [loading, setLoading] = useState(false);

	const fetchData = useCallback(
		async (r: string) => {
			setLoading(true);
			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (token) headers.Authorization = `Bearer ${token}`;
				const res = await fetch(`${apiBase}/api/monitoring?range=${r}`, {
					headers,
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as MonitoringData;
				onLoaded(data);
			} catch {
				/* silently ignore */
			} finally {
				setLoading(false);
			}
		},
		[token, onLoaded],
	);

	const handleRangeChange = useCallback(
		(r: string) => {
			setRange(r);
			fetchData(r);
		},
		[fetchData],
	);

	const slots = useMemo(() => generateSlots(range), [range]);

	const trendMap = useMemo(() => {
		const map = new Map<string, MonitoringDailyTrend>();
		if (!monitoring) return map;
		for (const t of monitoring.dailyTrends) {
			map.set(`${t.channel_id}|${t.day}`, t);
		}
		return map;
	}, [monitoring]);

	if (!monitoring) {
		return (
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				暂无数据
			</div>
		);
	}

	const { summary, channels } = monitoring;
	const recent = monitoring.recentStatus;

	// Overall status based on last 15 minutes
	const overallStatus = recent.success_rate >= 99 ? "所有系统正常运行" : recent.success_rate >= 95 ? "部分系统降级" : "系统异常";

	return (
		<div class="space-y-5">
			{/* Time range selector */}
			<div class="flex items-center gap-2">
				{RANGE_OPTIONS.map((r) => (
					<button
						key={r}
						type="button"
						onClick={() => handleRangeChange(r)}
						disabled={loading}
						class={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
							range === r
								? "bg-stone-900 text-white"
								: "bg-stone-100 text-stone-600 hover:bg-stone-200"
						} ${loading ? "opacity-50" : ""}`}
					>
						{RANGE_LABELS[r]}
					</button>
				))}
				{loading && <span class="text-xs text-stone-400">加载中...</span>}
			</div>

			{/* Overall status banner (always based on last 15 minutes) */}
			<div class={`flex items-center gap-3 rounded-2xl border p-5 shadow-lg ${
				recent.success_rate >= 99
					? "border-green-200 bg-green-50"
					: recent.success_rate >= 95
						? "border-yellow-200 bg-yellow-50"
						: "border-red-200 bg-red-50"
			}`}>
				<span class={`inline-block h-3 w-3 rounded-full ${statusDot(recent.success_rate)}`} />
				<span class={`text-lg font-semibold ${rateColor(recent.success_rate)}`}>
					{overallStatus}
				</span>
				<span class="ml-auto text-sm text-stone-500">
					近 15 分钟: {recent.total_requests} 请求 &middot; {recent.success_rate}% 成功率 &middot; {recent.avg_latency_ms}ms 延迟
				</span>
			</div>

			{/* Global overview cards */}
			<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						整体成功率
					</span>
					<div class={`text-2xl font-semibold ${rateColor(summary.success_rate)}`}>
						{summary.success_rate}%
					</div>
					<span class="font-['Space_Grotesk'] text-xs text-stone-500">
						成功 {summary.total_success} / 错误 {summary.total_errors}
					</span>
				</div>
				<div class="flex flex-col gap-1.5 rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
						活跃渠道
					</span>
					<div class="text-2xl font-semibold text-stone-900">
						{summary.active_channels}
						<span class="text-base font-normal text-stone-400">
							{" "}/ {summary.total_channels}
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
						{summary.total_requests} 次请求
					</span>
				</div>
			</div>

			{/* Per-channel uptime bars */}
			{channels.map((ch) => (
				<ChannelBar
					key={ch.channel_id}
					channel={ch}
					slots={slots}
					range={range}
					trendMap={trendMap}
				/>
			))}

			{/* Legend */}
			<div class="flex flex-wrap items-center gap-4 px-1 text-xs text-stone-400">
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-green-500" /> 正常 (&ge;99%)
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-yellow-500" /> 降级 (&ge;95%)
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-red-500" /> 异常 (&lt;95%)
				</div>
				<div class="flex items-center gap-1.5">
					<span class="inline-block h-3 w-3 rounded-sm bg-stone-200" /> 无数据
				</div>
			</div>
		</div>
	);
};
