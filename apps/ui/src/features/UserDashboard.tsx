import { useState } from "hono/jsx/dom";
import type { ContributionEntry, User, UserDashboardData } from "../core/types";

type UserDashboardProps = {
	data: UserDashboardData | null;
	user: User;
	token: string;
	linuxdoEnabled: boolean;
	onUnbind: () => void;
};

function formatCost(n: number): string {
	if (n === 0) return "$0.00";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

const ContributionBoard = ({ contributions }: { contributions: ContributionEntry[] }) => {
	const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

	return (
		<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
			<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
				贡献榜
			</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
							<th class="pb-2 pr-4 font-medium">#</th>
							<th class="pb-2 pr-4 font-medium">贡献者</th>
							<th class="pb-2 pr-4 text-right font-medium">渠道数</th>
							<th class="pb-2 pr-4 text-right font-medium">总请求</th>
							<th class="pb-2 text-right font-medium">总 Token</th>
						</tr>
					</thead>
					<tbody>
						{contributions.map((entry, idx) => {
							const isExpanded = expandedIdx === idx;
							return (
								<>
									<tr
										key={`row-${idx}`}
										class={`border-b border-stone-50 cursor-pointer transition-colors hover:bg-stone-50 ${isExpanded ? "bg-stone-50" : ""}`}
										onClick={() => setExpandedIdx(isExpanded ? null : idx)}
									>
										<td class="py-2.5 pr-4 text-stone-400">{idx + 1}</td>
										<td class="py-2.5 pr-4">
											<span class="font-medium text-stone-700">{entry.user_name}</span>
											{entry.linuxdo_id && (
												<span class="ml-1.5 text-xs text-stone-400">L{entry.linuxdo_id}</span>
											)}
										</td>
										<td class="py-2.5 pr-4 text-right text-stone-600">{entry.channel_count}</td>
										<td class="py-2.5 pr-4 text-right font-['Space_Grotesk'] text-stone-600">
											{formatNumber(entry.total_requests)}
										</td>
										<td class="py-2.5 text-right font-['Space_Grotesk'] text-stone-600">
											{formatNumber(entry.total_tokens)}
										</td>
									</tr>
									{isExpanded && entry.channels.length > 0 && (
										<tr key={`detail-${idx}`}>
											<td colSpan={5} class="pb-2">
												<div class="ml-8 rounded-lg bg-stone-50 p-3">
													<table class="w-full text-xs">
														<thead>
															<tr class="text-stone-400">
																<th class="pb-1 text-left font-medium">渠道名称</th>
																<th class="pb-1 text-right font-medium">请求</th>
																<th class="pb-1 text-right font-medium">Token</th>
															</tr>
														</thead>
														<tbody>
															{entry.channels.map((ch) => (
																<tr key={ch.name} class="border-t border-stone-100">
																	<td class="py-1 text-stone-600">
																		{ch.name}
																		{ch.tip_url && (
																			<a
																				href={ch.tip_url}
																				target="_blank"
																				rel="noopener noreferrer"
																				class="ml-1.5 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600 hover:bg-amber-100"
																				onClick={(e) => e.stopPropagation()}
																			>
																				打赏
																			</a>
																		)}
																	</td>
																	<td class="py-1 text-right font-['Space_Grotesk'] text-stone-500">
																		{formatNumber(ch.requests)}
																	</td>
																	<td class="py-1 text-right font-['Space_Grotesk'] text-stone-500">
																		{formatNumber(ch.total_tokens)}
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
											</td>
										</tr>
									)}
								</>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
};

export const UserDashboard = ({ data, user, token, linuxdoEnabled, onUnbind }: UserDashboardProps) => {
	if (!data) {
		return (
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<p class="text-sm text-stone-400">加载中...</p>
			</div>
		);
	}

	return (
		<div class="space-y-5">
			{/* Stats cards */}
			<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						余额
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						${user.balance.toFixed(2)}
					</p>
				</div>
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						总请求
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						{formatNumber(data.total_requests)}
					</p>
				</div>
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						总 Token
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						{formatNumber(data.total_tokens)}
					</p>
				</div>
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
					<p class="text-xs font-medium uppercase tracking-widest text-stone-400">
						总费用
					</p>
					<p class="mt-1 font-['Space_Grotesk'] text-2xl font-semibold text-stone-900">
						{formatCost(data.total_cost)}
					</p>
				</div>
			</div>

			{/* Account binding */}
			{linuxdoEnabled && (
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					账号绑定
				</h3>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-stone-700">Linux DO</p>
						<p class="text-xs text-stone-500">
							{user.linuxdo_id
								? `已绑定 (ID: ${user.linuxdo_id})`
								: "未绑定"}
						</p>
					</div>
					<div>
						{user.linuxdo_id ? (
							<button
								type="button"
								class="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition-all hover:border-red-200 hover:text-red-600"
								onClick={onUnbind}
							>
								解除绑定
							</button>
						) : (
							<a
								href={`/api/u/auth/linuxdo/bind?token=${encodeURIComponent(token)}`}
								class="inline-flex rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
							>
								绑定 Linux DO
							</a>
						)}
					</div>
				</div>
			</div>
			)}

			{/* Recent usage */}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
				<h3 class="mb-4 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
					最近使用
				</h3>
				{data.recent_usage.length === 0 ? (
					<p class="py-8 text-center text-sm text-stone-400">
						暂无使用记录
					</p>
				) : (
					<div class="overflow-x-auto">
						<table class="w-full text-left text-sm">
							<thead>
								<tr class="border-b border-stone-100 text-xs uppercase tracking-widest text-stone-400">
									<th class="pb-2 pr-4 font-medium">日期</th>
									<th class="pb-2 pr-4 font-medium">请求数</th>
									<th class="pb-2 font-medium">费用</th>
								</tr>
							</thead>
							<tbody>
								{data.recent_usage.map((item) => (
									<tr class="border-b border-stone-50">
										<td class="py-2 pr-4 text-stone-600">
											{item.day}
										</td>
										<td class="py-2 pr-4 text-stone-600">
											{item.requests}
										</td>
										<td class="py-2 text-stone-600">
											{formatCost(item.cost)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
			{/* Contribution leaderboard */}
			{data.contributions.length > 0 && (
				<ContributionBoard contributions={data.contributions} />
			)}
		</div>
	);
};
