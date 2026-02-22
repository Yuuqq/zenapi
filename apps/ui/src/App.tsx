import "./styles.css";
import { render, useCallback, useEffect, useState } from "hono/jsx/dom";
import { createApiFetch } from "./core/api";
import type { SiteMode, User } from "./core/types";
import { AdminApp } from "./AdminApp";
import { LoginView } from "./features/LoginView";
import { PublicApp } from "./PublicApp";
import { UserApp } from "./UserApp";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
	throw new Error("Missing #app root");
}

const normalizePath = (path: string) => {
	if (path.length <= 1) return "/";
	return path.replace(/\/+$/, "") || "/";
};

const App = () => {
	const [adminToken, setAdminToken] = useState<string | null>(() =>
		localStorage.getItem("admin_token"),
	);
	const [userToken, setUserToken] = useState<string | null>(() =>
		localStorage.getItem("user_token"),
	);
	const [userRecord, setUserRecord] = useState<User | null>(null);
	const [siteMode, setSiteMode] = useState<SiteMode | null>(null);
	const [notice, setNotice] = useState("");
	const [path, setPath] = useState(() =>
		normalizePath(window.location.pathname),
	);

	const updateAdminToken = useCallback((next: string | null) => {
		setAdminToken(next);
		if (next) {
			localStorage.setItem("admin_token", next);
		} else {
			localStorage.removeItem("admin_token");
		}
	}, []);

	const updateUserToken = useCallback((next: string | null) => {
		setUserToken(next);
		if (next) {
			localStorage.setItem("user_token", next);
		} else {
			localStorage.removeItem("user_token");
			setUserRecord(null);
		}
	}, []);

	// Fetch site mode on mount
	useEffect(() => {
		const api = createApiFetch(null, () => {});
		api<{ site_mode: SiteMode }>("/api/public/site-info")
			.then((result) => setSiteMode(result.site_mode))
			.catch(() => setSiteMode("personal"));
	}, []);

	// Load user record when user token is available
	useEffect(() => {
		if (!userToken) {
			setUserRecord(null);
			return;
		}
		const api = createApiFetch(userToken, () => updateUserToken(null));
		api<{ user: User }>("/api/u/auth/me")
			.then((result) => {
				setUserRecord(result.user);
				// If on login/register page, redirect to user panel
				const current = normalizePath(window.location.pathname);
				if (current === "/login" || current === "/register") {
					navigateTo("/user");
				}
			})
			.catch(() => {
				updateUserToken(null);
			});
	}, [userToken, updateUserToken]);

	useEffect(() => {
		const handlePopState = () => {
			setPath(normalizePath(window.location.pathname));
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const navigateTo = useCallback((target: string) => {
		history.pushState(null, "", target);
		setPath(normalizePath(target));
	}, []);

	const handleUserLogin = useCallback(
		(token: string) => {
			updateUserToken(token);
			navigateTo("/user");
		},
		[updateUserToken, navigateTo],
	);

	const handleUserLogout = useCallback(() => {
		updateUserToken(null);
		navigateTo("/login");
	}, [updateUserToken, navigateTo]);

	const handleAdminLogin = useCallback(
		async (event: Event) => {
			event.preventDefault();
			const form = event.currentTarget as HTMLFormElement;
			const formData = new FormData(form);
			const password = String(formData.get("password") ?? "");
			try {
				const api = createApiFetch(null, () => {});
				const result = await api<{ token: string }>("/api/auth/login", {
					method: "POST",
					body: JSON.stringify({ password }),
				});
				updateAdminToken(result.token);
				setNotice("");
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[updateAdminToken],
	);

	// Homepage redirect logic
	if (path === "/" && siteMode !== null) {
		if (siteMode === "personal") {
			history.replaceState(null, "", "/admin");
			setPath("/admin");
		} else if (userToken && userRecord) {
			history.replaceState(null, "", "/user");
			setPath("/user");
		} else {
			history.replaceState(null, "", "/login");
			setPath("/login");
		}
	}

	// Personal mode: redirect all non-admin paths to admin
	if (siteMode === "personal" && !path.startsWith("/admin")) {
		history.replaceState(null, "", "/admin");
		setPath("/admin");
	}

	// Admin routes
	if (path.startsWith("/admin")) {
		if (!adminToken) {
			return (
				<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
					<LoginView notice={notice} onSubmit={handleAdminLogin} />
				</div>
			);
		}
		return (
			<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
				<AdminApp token={adminToken} updateToken={updateAdminToken} />
			</div>
		);
	}

	// User routes
	if (path.startsWith("/user")) {
		if (!userToken || !userRecord) {
			// Redirect to login
			if (path !== "/login") {
				history.replaceState(null, "", "/login");
				setPath("/login");
			}
			return (
				<PublicApp onUserLogin={handleUserLogin} onNavigate={navigateTo} />
			);
		}
		return (
			<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
				<UserApp
					token={userToken}
					user={userRecord}
					updateToken={updateUserToken}
					onNavigate={navigateTo}
				/>
			</div>
		);
	}

	// Public routes (/login, /register)
	return <PublicApp onUserLogin={handleUserLogin} onNavigate={navigateTo} />;
};

render(<App />, root);
