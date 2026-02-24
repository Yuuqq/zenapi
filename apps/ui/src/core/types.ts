export type ChannelApiFormat = "openai" | "anthropic" | "custom";

export type Channel = {
	id: string;
	name: string;
	base_url: string;
	api_key: string;
	weight: number;
	status: string;
	models_json?: string;
	api_format: ChannelApiFormat;
	custom_headers_json?: string | null;
	contributed_by?: string | null;
};

export type Token = {
	id: string;
	name: string;
	key_prefix: string;
	quota_total: number | null;
	quota_used: number;
	status: string;
	user_id?: string | null;
	user_name?: string | null;
	user_email?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
};

export type UsageLog = {
	id: string;
	model: string | null;
	channel_id: string | null;
	channel_name?: string | null;
	token_id: string | null;
	token_name?: string | null;
	user_name?: string | null;
	user_email?: string | null;
	total_tokens: number | null;
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	cost?: number | null;
	latency_ms: number | null;
	first_token_latency_ms?: number | null;
	stream?: boolean | number | null;
	reasoning_effort?: string | number | null;
	status: string;
	created_at: string;
};

export type DashboardData = {
	summary: {
		total_requests: number;
		total_tokens: number;
		avg_latency: number;
		total_errors: number;
	};
	byDay: Array<{ day: string; requests: number; tokens: number }>;
	byModel: Array<{ model: string; requests: number; tokens: number }>;
	byChannel: Array<{ channel_name: string; requests: number; tokens: number }>;
	byToken: Array<{ token_name: string; requests: number; tokens: number }>;
};

export type MonitoringChannelData = {
	channel_id: string;
	channel_name: string;
	channel_status: string;
	api_format: string;
	total_requests: number;
	success_count: number;
	error_count: number;
	success_rate: number | null;
	avg_latency_ms: number;
	last_seen: string | null;
	recent_success_rate: number | null;
	recent_avg_latency_ms: number | null;
};

export type MonitoringDailyTrend = {
	channel_id: string;
	day: string;
	requests: number;
	success: number;
	errors: number;
	success_rate: number;
	avg_latency_ms: number;
};

export type MonitoringErrorDetail = {
	id: string;
	model: string | null;
	channel_id: string | null;
	error_code: number | null;
	error_message: string | null;
	latency_ms: number | null;
	created_at: string;
};

export type MonitoringSlotModel = {
	model: string;
	requests: number;
	success: number;
	errors: number;
	avg_latency_ms: number;
};

export type MonitoringData = {
	summary: {
		total_requests: number;
		total_success: number;
		total_errors: number;
		avg_latency_ms: number;
		success_rate: number;
		active_channels: number;
		total_channels: number;
	};
	recentStatus: {
		total_requests: number;
		total_success: number;
		total_errors: number;
		avg_latency_ms: number;
		success_rate: number;
	};
	channels: MonitoringChannelData[];
	dailyTrends: MonitoringDailyTrend[];
	range: string;
};

export type SiteMode = "personal" | "service" | "shared";

export type RegistrationMode = "open" | "linuxdo_only" | "closed";

export type Settings = {
	log_retention_days: number;
	session_ttl_hours: number;
	admin_password_set?: boolean;
	site_mode: SiteMode;
	registration_mode: RegistrationMode;
};

export type ModelChannel = {
	id: string;
	name: string;
	input_price: number | null;
	output_price: number | null;
	avg_latency_ms: number | null;
};

export type ModelAlias = { alias: string; is_primary: boolean };

export type ModelAliasGroup = {
	aliases: ModelAlias[];
	alias_only: boolean;
};

export type ModelItem = {
	id: string;
	display_name: string;
	aliases: ModelAlias[];
	alias_only: boolean;
	channels: ModelChannel[];
	total_requests: number;
	total_tokens: number;
	total_cost: number;
	avg_latency_ms: number | null;
	daily: { day: string; requests: number; tokens: number }[];
};

export type AdminData = {
	channels: Channel[];
	tokens: Token[];
	models: ModelItem[];
	usage: UsageLog[];
	dashboard: DashboardData | null;
	monitoring: MonitoringData | null;
	settings: Settings | null;
};

export type TabId =
	| "dashboard"
	| "monitoring"
	| "channels"
	| "models"
	| "tokens"
	| "usage"
	| "settings"
	| "users"
	| "playground";

export type TabItem = {
	id: TabId;
	label: string;
};

export type ChannelForm = {
	name: string;
	base_url: string;
	api_key: string;
	weight: number;
	api_format: ChannelApiFormat;
	custom_headers: string;
	models: string;
};

export type SettingsForm = {
	log_retention_days: string;
	session_ttl_hours: string;
	admin_password: string;
	site_mode: SiteMode;
	registration_mode: RegistrationMode;
};

// User types
export type User = {
	id: string;
	email: string;
	name: string;
	role: string;
	balance: number;
	status: string;
	created_at: string;
	updated_at: string;
	linuxdo_id?: string | null;
};

export type ContributionChannel = {
	name: string;
	tip_url: string | null;
	requests: number;
	total_tokens: number;
};

export type ContributionEntry = {
	user_name: string;
	linuxdo_id: string | null;
	channel_count: number;
	channels: ContributionChannel[];
	total_requests: number;
	total_tokens: number;
};

export type UserDashboardData = {
	balance: number;
	total_requests: number;
	total_tokens: number;
	total_cost: number;
	recent_usage: Array<{ day: string; requests: number; cost: number }>;
	contributions: ContributionEntry[];
};

export type UserTabId =
	| "dashboard"
	| "models"
	| "tokens"
	| "usage"
	| "channels";

export type UserTabItem = {
	id: UserTabId;
	label: string;
};

export type PublicModelItem = {
	id: string;
	display_name: string;
	channels: Array<{
		id: string;
		name: string;
		input_price: number | null;
		output_price: number | null;
	}>;
};
