import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
	getRegistrationMode,
	getRetentionDays,
	getSessionTtlHours,
	getSiteMode,
	isAdminPasswordSet,
	type RegistrationMode,
	type SiteMode,
	setAdminPasswordHash,
	setRegistrationMode,
	setRetentionDays,
	setSessionTtlHours,
	setSiteMode,
} from "../services/settings";
import { jsonError } from "../utils/http";
import { hashPassword } from "../utils/password";

const settings = new Hono<AppEnv>();

/**
 * Returns settings values.
 */
settings.get("/", async (c) => {
	const retention = await getRetentionDays(c.env.DB);
	const sessionTtlHours = await getSessionTtlHours(c.env.DB);
	const adminPasswordSet = await isAdminPasswordSet(c.env.DB);
	const siteMode = await getSiteMode(c.env.DB);
	const registrationMode = await getRegistrationMode(c.env.DB);
	return c.json({
		log_retention_days: retention,
		session_ttl_hours: sessionTtlHours,
		admin_password_set: adminPasswordSet,
		site_mode: siteMode,
		registration_mode: registrationMode,
	});
});

/**
 * Updates settings values.
 */
settings.put("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "settings_required", "settings_required");
	}

	let touched = false;

	if (body.log_retention_days !== undefined) {
		const days = Number(body.log_retention_days);
		if (Number.isNaN(days) || days < 1) {
			return jsonError(
				c,
				400,
				"invalid_log_retention_days",
				"invalid_log_retention_days",
			);
		}
		await setRetentionDays(c.env.DB, days);
		touched = true;
	}

	if (body.session_ttl_hours !== undefined) {
		const hours = Number(body.session_ttl_hours);
		if (Number.isNaN(hours) || hours < 1) {
			return jsonError(
				c,
				400,
				"invalid_session_ttl_hours",
				"invalid_session_ttl_hours",
			);
		}
		await setSessionTtlHours(c.env.DB, hours);
		touched = true;
	}

	if (typeof body.admin_password === "string" && body.admin_password.trim()) {
		const hash = await hashPassword(body.admin_password.trim());
		await setAdminPasswordHash(c.env.DB, hash);
		touched = true;
	}

	if (body.site_mode !== undefined) {
		const validModes: SiteMode[] = ["personal", "service", "shared"];
		if (!validModes.includes(body.site_mode)) {
			return jsonError(c, 400, "invalid_site_mode", "invalid_site_mode");
		}
		await setSiteMode(c.env.DB, body.site_mode);
		touched = true;
	}

	if (body.registration_mode !== undefined) {
		const validModes: RegistrationMode[] = ["open", "linuxdo_only", "closed"];
		if (!validModes.includes(body.registration_mode)) {
			return jsonError(
				c,
				400,
				"invalid_registration_mode",
				"invalid_registration_mode",
			);
		}
		await setRegistrationMode(c.env.DB, body.registration_mode);
		touched = true;
	}

	if (!touched) {
		return jsonError(c, 400, "settings_empty", "settings_empty");
	}

	return c.json({ ok: true });
});

export default settings;
