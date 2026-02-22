import { useCallback, useEffect, useState } from "hono/jsx/dom";
import { createApiFetch } from "./core/api";
import { UserLoginView } from "./features/UserLoginView";
import { UserRegisterView } from "./features/UserRegisterView";

const normalizePath = (path: string) => {
	if (path.length <= 1) return "/";
	return path.replace(/\/+$/, "") || "/";
};

type PublicAppProps = {
	onUserLogin: (token: string) => void;
	onNavigate: (path: string) => void;
};

export const PublicApp = ({ onUserLogin, onNavigate }: PublicAppProps) => {
	const [page, setPage] = useState<"login" | "register">(() => {
		const normalized = normalizePath(window.location.pathname);
		if (normalized === "/register") return "register";
		return "login";
	});
	const [notice, setNotice] = useState("");

	const apiFetch = useCallback(
		() => createApiFetch(null, () => {}),
		[],
	);

	useEffect(() => {
		const handlePopState = () => {
			const normalized = normalizePath(window.location.pathname);
			if (normalized === "/register") setPage("register");
			else setPage("login");
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const navigate = useCallback((target: "login" | "register") => {
		const paths = { login: "/login", register: "/register" };
		history.pushState(null, "", paths[target]);
		setPage(target);
		setNotice("");
	}, []);

	const handleLogin = useCallback(
		async (email: string, password: string) => {
			try {
				const api = apiFetch();
				const result = await api<{ token: string }>("/api/u/auth/login", {
					method: "POST",
					body: JSON.stringify({ email, password }),
				});
				onUserLogin(result.token);
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, onUserLogin],
	);

	const handleRegister = useCallback(
		async (email: string, name: string, password: string) => {
			try {
				const api = apiFetch();
				const result = await api<{ token: string }>(
					"/api/u/auth/register",
					{
						method: "POST",
						body: JSON.stringify({ email, name, password }),
					},
				);
				onUserLogin(result.token);
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, onUserLogin],
	);

	if (page === "register") {
		return (
			<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
				<nav class="border-b border-stone-200 bg-white px-6 py-3">
					<div class="mx-auto flex max-w-6xl items-center justify-between">
						<button
							type="button"
							class="font-['Space_Grotesk'] text-lg font-semibold tracking-tight text-stone-900"
							onClick={() => navigate("login")}
						>
							ZenApi
						</button>
						<div class="flex gap-3">
							<button
								type="button"
								class="rounded-lg px-4 py-2 text-sm text-stone-500 hover:text-stone-900"
								onClick={() => navigate("login")}
							>
								登录
							</button>
							<button
								type="button"
								class="rounded-lg px-4 py-2 text-sm text-stone-400 hover:text-stone-600"
								onClick={() => onNavigate("/admin")}
							>
								管理后台
							</button>
						</div>
					</div>
				</nav>
				<UserRegisterView
					notice={notice}
					siteMode={"service"}
					onSubmit={handleRegister}
					onGoLogin={() => navigate("login")}
				/>
			</div>
		);
	}

	// Login page (default)
	return (
		<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
			<nav class="border-b border-stone-200 bg-white px-6 py-3">
				<div class="mx-auto flex max-w-6xl items-center justify-between">
					<button
						type="button"
						class="font-['Space_Grotesk'] text-lg font-semibold tracking-tight text-stone-900"
						onClick={() => navigate("login")}
					>
						ZenApi
					</button>
					<div class="flex gap-3">
						<button
							type="button"
							class="rounded-lg px-4 py-2 text-sm text-stone-500 hover:text-stone-900"
							onClick={() => navigate("register")}
						>
							注册
						</button>
						<button
							type="button"
							class="rounded-lg px-4 py-2 text-sm text-stone-400 hover:text-stone-600"
							onClick={() => onNavigate("/admin")}
						>
							管理后台
						</button>
					</div>
				</div>
			</nav>
			<UserLoginView
				notice={notice}
				onSubmit={handleLogin}
				onGoRegister={() => navigate("register")}
			/>
		</div>
	);
};
