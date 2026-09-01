/**
 * Smoke test for browser-pane popups against a running dev build.
 *
 *   RENDERER_REMOTE_DEBUG_PORT=9222 bun run dev:desktop   # then, with a
 *   # browser pane open in a workspace (Cmd+Shift+B):
 *   bun run apps/desktop/scripts/cdp-smoke-popups.ts
 *
 * Covers the contract in `main/lib/browser/popup-window.ts`: a `window.open`
 * that a sign-in flow depends on becomes a real popup window that keeps
 * `window.opener`, the window name, the pane's cookie jar and `window.close()`,
 * while an ordinary `target="_blank"` link still opens as a split pane.
 *
 * Regressions here are close to invisible in unit tests: the pieces that break
 * (opener identity, session inheritance, whether Electron hands the URL to the
 * system browser) only exist in a real Electron window. See SUPER-1272.
 *
 * Serves its own fixture, so it needs no network. Exits 0 on PASS, 1 on FAIL.
 * Dependency-free (Bun WebSocket + fetch).
 */

const PORT = process.env.RENDERER_REMOTE_DEBUG_PORT;
const VITE_PORT = process.env.DESKTOP_VITE_PORT;
const FIXTURE_PORT = Number(process.env.POPUP_FIXTURE_PORT ?? "8797");
const ONLY_CASE = process.env.POPUP_CASE;
const OBSERVE_MS = process.env.POPUP_OBSERVE_MS
	? Number(process.env.POPUP_OBSERVE_MS)
	: null;
const ORIGIN = `http://localhost:${FIXTURE_PORT}`;

const OAUTH = `${ORIGIN}/popup?client_id=a&redirect_uri=${encodeURIComponent(
	`${ORIGIN}/cb`,
)}&response_type=code&scope=email`;

/** Each case runs in the pane; `rec` stores what `window.open` handed back. */
const CASES: Record<string, string> = {
	noArgs: `rec(window.open())`,
	blankFragment: `rec(window.open("about:blank#state=1"))`,
	oauthBare: `rec(window.open(${JSON.stringify(OAUTH)}))`,
	oauthBlankTarget: `rec(window.open(${JSON.stringify(OAUTH)}, "_blank"))`,
	oauthNamed: `rec(window.open(${JSON.stringify(OAUTH)}, "authwin"))`,
	withFeatures: `rec(window.open(${JSON.stringify(
		`${ORIGIN}/popup`,
	)}, "authpopup", "width=500,height=600"))`,
	oidcHybrid: `rec(window.open(${JSON.stringify(
		`${ORIGIN}/popup?client_id=a&redirect_uri=b&response_type=${encodeURIComponent("code id_token")}`,
	)}))`,
	noopener: `rec(window.open(${JSON.stringify(OAUTH)}, "n", "noopener"))`,
	nested: `rec(window.open(${JSON.stringify(
		`${ORIGIN}/popup?nest=1`,
	)}, "outer", "width=500,height=500"))`,
	selfClosing: `rec(window.open(${JSON.stringify(
		`${ORIGIN}/popup?close=1`,
	)}, "c", "width=400,height=400"))`,
	blankLink: `document.getElementById("lnk").click()`,
	plainScriptedOpen: `rec(window.open(${JSON.stringify(`${ORIGIN}/popup`)}))`,
	disallowedScheme: `rec(window.open("file:///etc/passwd"))`,
};

interface Expectation {
	/** Popup windows expected to exist while the case is live. */
	popups: number;
	/** Extra split panes the case should create. */
	panes: number;
	/** Whether the popup must still see its opener. */
	opener?: boolean;
	/** Whether every live popup must share the opener's cookie jar. */
	jar?: boolean;
	/** Exact live window names, sorted because CDP target order is unspecified. */
	names?: string[];
	/** Whether `window.open` must hand the page a usable handle. */
	handle?: boolean;
	note: string;
}

const EXPECT: Record<string, Expectation> = {
	noArgs: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: [""],
		handle: true,
		note: "window.open() with no arguments",
	},
	blankFragment: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: [""],
		handle: true,
		note: "about:blank with a fragment",
	},
	oauthBare: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: [""],
		handle: true,
		note: "bare window.open of a sign-in URL (Deel's shape)",
	},
	oauthBlankTarget: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: [""],
		handle: true,
		note: "sign-in URL with a _blank name",
	},
	oauthNamed: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: ["authwin"],
		handle: true,
		note: "sign-in URL, named, no features",
	},
	withFeatures: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: ["authpopup"],
		handle: true,
		note: "window.open with features (Firebase's shape)",
	},
	oidcHybrid: {
		popups: 1,
		panes: 0,
		opener: true,
		jar: true,
		names: [""],
		handle: true,
		note: "OIDC hybrid response_type",
	},
	noopener: {
		popups: 1,
		panes: 0,
		opener: false,
		jar: true,
		names: ["n"],
		handle: false,
		note: "noopener severs the opener and nulls the handle, per spec",
	},
	nested: {
		popups: 2,
		panes: 0,
		opener: true,
		jar: true,
		names: ["inner", "outer"],
		handle: true,
		note: "a popup opening its own popup (Google's consent step)",
	},
	selfClosing: {
		popups: 0,
		panes: 0,
		handle: true,
		note: "window.close() from inside the popup",
	},
	blankLink: {
		popups: 0,
		panes: 1,
		note: "a plain target=_blank link still opens a split pane",
	},
	plainScriptedOpen: {
		popups: 0,
		panes: 1,
		handle: false,
		note: "KNOWN GAP: indistinguishable from a _blank link, so null + a pane",
	},
	disallowedScheme: {
		popups: 0,
		panes: 0,
		handle: false,
		note: "file: is refused outright",
	},
};

const FIXTURE = `<!doctype html><meta charset="utf-8"><title>popup fixture</title>
<body style="font:14px system-ui;background:#111;color:#eee;padding:20px">
<a id="lnk" href="${ORIGIN}/popup" target="_blank">blank link</a>
<script>
  window.__handle = null; window.__msgs = [];
  window.rec = (w) => { window.__handle = (w === null ? "NULL" : "HANDLE"); };
  addEventListener("message", (e) => window.__msgs.push(String(e.data)));
  document.cookie = "paneprobe=1; path=/";
</script>`;

const POPUP = (q: URLSearchParams) => `<!doctype html><meta charset="utf-8">
<body style="font:13px ui-monospace;background:#022;color:#9fd;padding:16px">
<script>
  window.__info = {
    hasOpener: !!window.opener,
    name: window.name,
    // Same origin as the pane: proves the popup inherited its cookie jar
    // rather than landing in a separate session (the SUPER-1272 symptom).
    sharesCookieJar: document.cookie.includes("paneprobe=1"),
  };
  try { if (window.opener) window.opener.postMessage("ok:" + (window.name || "(anon)"), "*"); } catch {}
  ${q.get("nest") === "1" ? `setTimeout(() => window.open("${ORIGIN}/popup?inner=1", "inner", "width=380,height=380"), 500);` : ""}
  ${q.get("close") === "1" ? "setTimeout(() => window.close(), 800);" : ""}
</script>`;

interface CdpTarget {
	id: string;
	type: string;
	url: string;
	webSocketDebuggerUrl?: string;
}

class Cdp {
	private id = 0;
	private pending = new Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();
	private constructor(private ws: WebSocket) {
		ws.addEventListener("message", (ev) => {
			const m = JSON.parse(String(ev.data)) as {
				id?: number;
				result?: unknown;
				error?: { message: string };
			};
			if (m.id == null) return;
			const p = this.pending.get(m.id);
			if (!p) return;
			this.pending.delete(m.id);
			m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
		});
	}
	static async connect(url: string): Promise<Cdp> {
		const ws = new WebSocket(url);
		await new Promise<void>((res, rej) => {
			ws.addEventListener("open", () => res(), { once: true });
			ws.addEventListener("error", () => rej(new Error("ws error")), {
				once: true,
			});
		});
		return new Cdp(ws);
	}
	send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const id = ++this.id;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: resolve as (v: unknown) => void,
				reject,
			});
			this.ws.send(JSON.stringify({ id, method, params }));
			setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`));
			}, 20_000);
		});
	}
	async eval<T>(expression: string): Promise<T> {
		const r = await this.send<{
			result?: { value?: T };
			exceptionDetails?: { text: string };
		}>("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result?.value as T;
	}
	close() {
		this.ws.close();
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const targets = async (): Promise<CdpTarget[]> =>
	(await (
		await fetch(`http://127.0.0.1:${PORT}/json/list`)
	).json()) as CdpTarget[];
function formatObservations(values: Array<boolean | string | null>): string {
	return values.length ? values.map((value) => value ?? "?").join(",") : "-";
}

async function closeFocusedPane(renderer: Cdp): Promise<void> {
	// The split action focuses the new pane. Drive the host's real CLOSE_PANE
	// hotkey rather than Page.close on the guest target: the latter destroys a
	// WebContents without updating the renderer's pane layout.
	const isMac = process.platform === "darwin";
	const modifiers = isMac ? 4 : 2 | 8; // Meta, or Control + Shift.
	await renderer.send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		key: isMac ? "w" : "W",
		code: "KeyW",
		windowsVirtualKeyCode: 87,
		modifiers,
	});
	await renderer.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: isMac ? "w" : "W",
		code: "KeyW",
		windowsVirtualKeyCode: 87,
		modifiers,
	});
}

async function main() {
	if (!PORT || !VITE_PORT) {
		console.error(
			"FAIL: set RENDERER_REMOTE_DEBUG_PORT explicitly and load this workspace's DESKTOP_VITE_PORT from .env.",
		);
		return 1;
	}
	if (ONLY_CASE && !(ONLY_CASE in CASES)) {
		console.error(`FAIL: unknown POPUP_CASE ${ONLY_CASE}`);
		return 1;
	}
	if (OBSERVE_MS !== null && (!Number.isFinite(OBSERVE_MS) || OBSERVE_MS < 0)) {
		console.error("FAIL: POPUP_OBSERVE_MS must be a non-negative number.");
		return 1;
	}

	const server = Bun.serve({
		port: FIXTURE_PORT,
		fetch(req) {
			const u = new URL(req.url);
			const body = u.pathname.startsWith("/popup")
				? POPUP(u.searchParams)
				: FIXTURE;
			return new Response(body, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});

	try {
		const allTargets = await targets();
		const rendererOrigin = new URL(`http://localhost:${VITE_PORT}`).origin;
		const renderer = allTargets.find(
			(target) =>
				target.type === "page" &&
				target.webSocketDebuggerUrl &&
				target.url.startsWith(`${rendererOrigin}/`),
		);
		if (!renderer) {
			console.error(
				`FAIL: no renderer for ${rendererOrigin} on CDP port ${PORT}.`,
			);
			return 1;
		}

		const pane = allTargets.find(
			(target) => target.type === "webview" && target.webSocketDebuggerUrl,
		);
		if (!pane?.webSocketDebuggerUrl) {
			console.error(
				`FAIL: no browser pane found on port ${PORT}.\n` +
					"Open a workspace and press Cmd+Shift+B, then re-run.",
			);
			return 1;
		}
		const originalPaneUrl = pane.url;
		console.log(
			`Renderer ${renderer.url}; pane ${pane.id} initially ${originalPaneUrl}`,
		);

		const g = await Cdp.connect(pane.webSocketDebuggerUrl);
		const host = await Cdp.connect(renderer.webSocketDebuggerUrl as string);
		const failures: string[] = [];
		try {
			await g.send("Page.enable");
			await g.send("Runtime.enable");
			await g.send("Page.navigate", { url: `${ORIGIN}/` });
			await sleep(2500);

			console.log(
				`${"case".padEnd(19)}${"popups".padEnd(8)}${"opener".padEnd(12)}${"jar".padEnd(10)}${"name".padEnd(20)}${"handle".padEnd(8)}panes  verdict`,
			);

			for (const [name, script] of Object.entries(CASES)) {
				if (ONLY_CASE && name !== ONLY_CASE) continue;
				const want = EXPECT[name];
				if (!want) continue;
				const before = await targets();
				const pageIdsBefore = new Set(
					before
						.filter((target) => target.type === "page")
						.map((target) => target.id),
				);
				const paneIdsBefore = new Set(
					before
						.filter((target) => target.type === "webview")
						.map((target) => target.id),
				);
				const createdPopups = new Map<string, CdpTarget>();
				const createdPanes = new Map<string, CdpTarget>();
				try {
					let actionError: string | null = null;
					await g
						.eval(`window.__handle = null; ${script}; 1`)
						.catch((error) => {
							actionError =
								error instanceof Error ? error.message : String(error);
						});
					await sleep(
						OBSERVE_MS ??
							(name === "nested" || name === "selfClosing" ? 3000 : 2000),
					);

					const after = await targets();
					const live = after.filter(
						(target) => target.type === "page" && !pageIdsBefore.has(target.id),
					);
					const livePanes = after.filter(
						(target) =>
							target.type === "webview" && !paneIdsBefore.has(target.id),
					);
					for (const target of live) createdPopups.set(target.id, target);
					for (const target of livePanes) createdPanes.set(target.id, target);
					const opener: Array<boolean | null> = [];
					const jar: Array<boolean | null> = [];
					const windowNames: Array<string | null> = [];
					const observationErrors: string[] = [];
					for (const p of live) {
						if (!p.webSocketDebuggerUrl) {
							observationErrors.push(`popup ${p.id} has no debugger URL`);
							continue;
						}
						const c = await Cdp.connect(p.webSocketDebuggerUrl).catch(
							(error) => {
								observationErrors.push(`popup ${p.id}: ${String(error)}`);
								return null;
							},
						);
						if (!c) continue;
						try {
							await c.send("Runtime.enable");
							// Probe the popup directly. This also covers about:blank, which never
							// loads the fixture's window.__info snapshot.
							opener.push(
								await c.eval<boolean>("!!window.opener").catch(() => null),
							);
							jar.push(
								await c
									.eval<boolean>('document.cookie.includes("paneprobe=1")')
									.catch(() => null),
							);
							windowNames.push(
								await c.eval<string>("window.name").catch(() => null),
							);
						} finally {
							c.close();
						}
					}
					const handle = await g
						.eval<string>("String(window.__handle)")
						.catch(() => "?");

					const bad: string[] = [];
					if (actionError) bad.push(`action failed: ${actionError}`);
					bad.push(...observationErrors);
					if (live.length !== want.popups)
						bad.push(`popups ${live.length}!=${want.popups}`);
					if (livePanes.length !== want.panes)
						bad.push(`panes +${livePanes.length}!=+${want.panes}`);
					if (want.opener !== undefined) {
						if (
							opener.length !== live.length ||
							opener.some((value) => value !== want.opener)
						) {
							bad.push(`opener ${formatObservations(opener)}!=${want.opener}`);
						}
					}
					if (want.jar !== undefined) {
						if (
							jar.length !== live.length ||
							jar.some((value) => value !== want.jar)
						) {
							bad.push(`jar ${formatObservations(jar)}!=${want.jar}`);
						}
					}
					if (want.names) {
						const gotNames = windowNames
							.filter((value): value is string => value != null)
							.sort();
						const wantedNames = [...want.names].sort();
						if (
							gotNames.length !== live.length ||
							JSON.stringify(gotNames) !== JSON.stringify(wantedNames)
						) {
							bad.push(
								`names ${JSON.stringify(windowNames)}!=${JSON.stringify(want.names)}`,
							);
						}
					}
					if (want.handle !== undefined) {
						const got = handle === "HANDLE";
						if (got !== want.handle) bad.push(`handle ${handle}`);
					}
					if (bad.length)
						failures.push(`${name}: ${bad.join(", ")} (${want.note})`);

					console.log(
						`${name.padEnd(19)}${String(live.length).padEnd(8)}${formatObservations(opener).padEnd(12)}${formatObservations(jar).padEnd(10)}${formatObservations(windowNames).padEnd(20)}${handle.padEnd(8)}+${livePanes.length}     ${bad.length ? `FAIL ${bad.join(", ")}` : "ok"}`,
					);
				} catch (error) {
					failures.push(`${name}: case failed unexpectedly: ${String(error)}`);
				} finally {
					await targets()
						.then((current) => {
							for (const target of current) {
								if (target.type === "page" && !pageIdsBefore.has(target.id)) {
									createdPopups.set(target.id, target);
								}
								if (
									target.type === "webview" &&
									!paneIdsBefore.has(target.id)
								) {
									createdPanes.set(target.id, target);
								}
							}
						})
						.catch((error) => {
							failures.push(
								`${name}: could not enumerate targets for cleanup: ${String(error)}`,
							);
						});

					for (const p of createdPopups.values()) {
						if (!p.webSocketDebuggerUrl) {
							failures.push(
								`${name}: could not close popup ${p.id}: no debugger URL`,
							);
							continue;
						}
						const c = await Cdp.connect(p.webSocketDebuggerUrl).catch(
							(error) => {
								failures.push(
									`${name}: could not connect to popup for cleanup: ${String(error)}`,
								);
								return null;
							},
						);
						await c?.send("Page.close").catch((error) => {
							failures.push(
								`${name}: could not close popup ${p.id}: ${String(error)}`,
							);
						});
						c?.close();
					}
					for (let index = 0; index < createdPanes.size; index += 1) {
						await closeFocusedPane(host).catch((error) => {
							failures.push(
								`${name}: could not close created pane: ${String(error)}`,
							);
						});
					}
					await sleep(800);
					await targets()
						.then((current) => {
							const remainingIds = new Set(current.map((target) => target.id));
							for (const createdPane of createdPanes.values()) {
								if (remainingIds.has(createdPane.id)) {
									failures.push(
										`${name}: created pane ${createdPane.id} remained after cleanup`,
									);
								}
							}
							for (const popup of createdPopups.values()) {
								if (remainingIds.has(popup.id)) {
									failures.push(
										`${name}: popup ${popup.id} remained after cleanup`,
									);
								}
							}
						})
						.catch((error) => {
							failures.push(
								`${name}: could not verify target cleanup: ${String(error)}`,
							);
						});
				}
			}

			const msgs = await g
				.eval<string[]>("window.__msgs ?? []")
				.catch(() => []);
			const expectsCallback = Object.entries(EXPECT).some(
				([name, expectation]) =>
					(!ONLY_CASE || name === ONLY_CASE) &&
					expectation.opener === true &&
					name !== "noArgs" &&
					name !== "blankFragment",
			);
			if (expectsCallback && !msgs.some((m) => m.startsWith("ok:"))) {
				failures.push("no postMessage reached the opener");
			}
			console.log(
				`\npostMessage callbacks delivered to opener: ${msgs.length}`,
			);
		} finally {
			try {
				await g
					.send("Page.navigate", { url: originalPaneUrl })
					.catch((error) => {
						failures.push(`could not restore pane URL: ${String(error)}`);
					});
				await sleep(1500);
				const restored = (await targets()).find(
					(target) => target.id === pane.id,
				);
				if (restored?.url !== originalPaneUrl) {
					failures.push(
						`pane URL not restored: ${restored?.url ?? "missing"} != ${originalPaneUrl}`,
					);
				}
			} catch (error) {
				failures.push(`could not verify pane restoration: ${String(error)}`);
			} finally {
				g.close();
				host.close();
			}
		}

		if (failures.length) {
			console.error(`\nFAIL (${failures.length}):`);
			for (const f of failures) console.error(`  - ${f}`);
			return 1;
		}
		console.log("\nPASS: every popup shape behaved as specified.");
		return 0;
	} finally {
		server.stop(true);
	}
}

process.exit(await main());
