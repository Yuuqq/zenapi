import type { D1Database } from "@cloudflare/workers-types";
import { nowIso } from "../utils/time";

const DEFAULT_LOG_RETENTION_DAYS = 30;
const DEFAULT_SESSION_TTL_HOURS = 12;
const RETENTION_KEY = "log_retention_days";
const SESSION_TTL_KEY = "session_ttl_hours";
const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";

async function readSetting(
	db: D1Database,
	key: string,
): Promise<string | null> {
	const setting = await db
		.prepare("SELECT value FROM settings WHERE key = ?")
		.bind(key)
		.first<{ value?: string }>();
	return setting?.value ? String(setting.value) : null;
}

async function upsertSetting(
	db: D1Database,
	key: string,
	value: string,
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
		)
		.bind(key, value, nowIso())
		.run();
}

function parsePositiveNumber(value: string | null, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isNaN(parsed) && parsed > 0) {
		return parsed;
	}
	return fallback;
}

/**
 * Returns the log retention days from settings or default fallback.
 */
export async function getRetentionDays(db: D1Database): Promise<number> {
	const value = await readSetting(db, RETENTION_KEY);
	return parsePositiveNumber(value, DEFAULT_LOG_RETENTION_DAYS);
}

/**
 * Updates the log retention days setting.
 */
export async function setRetentionDays(
	db: D1Database,
	days: number,
): Promise<void> {
	const value = Math.max(1, Math.floor(days)).toString();
	await upsertSetting(db, RETENTION_KEY, value);
}

/**
 * Returns the session TTL hours from settings or default fallback.
 */
export async function getSessionTtlHours(db: D1Database): Promise<number> {
	const value = await readSetting(db, SESSION_TTL_KEY);
	return parsePositiveNumber(value, DEFAULT_SESSION_TTL_HOURS);
}

/**
 * Updates the session TTL hours setting.
 */
export async function setSessionTtlHours(
	db: D1Database,
	hours: number,
): Promise<void> {
	const value = Math.max(1, Math.floor(hours)).toString();
	await upsertSetting(db, SESSION_TTL_KEY, value);
}

/**
 * Returns the admin password hash.
 */
export async function getAdminPasswordHash(
	db: D1Database,
): Promise<string | null> {
	return readSetting(db, ADMIN_PASSWORD_HASH_KEY);
}

/**
 * Updates the admin password hash.
 */
export async function setAdminPasswordHash(
	db: D1Database,
	hash: string,
): Promise<void> {
	if (!hash) {
		return;
	}
	await upsertSetting(db, ADMIN_PASSWORD_HASH_KEY, hash);
}

/**
 * Returns whether the admin password is set.
 */
export async function isAdminPasswordSet(db: D1Database): Promise<boolean> {
	const hash = await getAdminPasswordHash(db);
	return Boolean(hash);
}

const SITE_MODE_KEY = "site_mode";
export type SiteMode = "personal" | "service" | "shared";
const VALID_SITE_MODES: SiteMode[] = ["personal", "service", "shared"];

const REGISTRATION_MODE_KEY = "registration_mode";
export type RegistrationMode = "open" | "linuxdo_only" | "closed";
const VALID_REGISTRATION_MODES: RegistrationMode[] = [
	"open",
	"linuxdo_only",
	"closed",
];

/**
 * Returns the site mode setting.
 */
export async function getSiteMode(db: D1Database): Promise<SiteMode> {
	const value = await readSetting(db, SITE_MODE_KEY);
	if (value && VALID_SITE_MODES.includes(value as SiteMode)) {
		return value as SiteMode;
	}
	return "personal";
}

/**
 * Updates the site mode setting.
 */
export async function setSiteMode(
	db: D1Database,
	mode: SiteMode,
): Promise<void> {
	if (!VALID_SITE_MODES.includes(mode)) {
		return;
	}
	await upsertSetting(db, SITE_MODE_KEY, mode);
}

/**
 * Returns the registration mode setting.
 */
export async function getRegistrationMode(
	db: D1Database,
): Promise<RegistrationMode> {
	const value = await readSetting(db, REGISTRATION_MODE_KEY);
	if (value && VALID_REGISTRATION_MODES.includes(value as RegistrationMode)) {
		return value as RegistrationMode;
	}
	return "open";
}

/**
 * Updates the registration mode setting.
 */
export async function setRegistrationMode(
	db: D1Database,
	mode: RegistrationMode,
): Promise<void> {
	if (!VALID_REGISTRATION_MODES.includes(mode)) {
		return;
	}
	await upsertSetting(db, REGISTRATION_MODE_KEY, mode);
}

/**
 * Loads generic settings as a key/value map.
 */
export async function listSettings(
	db: D1Database,
): Promise<Record<string, string>> {
	const result = await db.prepare("SELECT key, value FROM settings").all();
	const map: Record<string, string> = {};
	for (const row of result.results ?? []) {
		map[String(row.key)] = String(row.value);
	}
	return map;
}
