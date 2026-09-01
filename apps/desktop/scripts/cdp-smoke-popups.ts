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

const PORT = process.env.RENDERER_REMOTE_DEBUG_PORT ?? "9222";
const FIXTURE_PORT = Number(process.env.POPUP_FIXTURE_PORT ?? "8797");
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
	/** Whether `window.open` must hand the page a usable handle. */
	handle?: boolean;
	note: string;
}

const EXPECT: Record<string, Expectation> = {
	noArgs: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "window.open() with no arguments",
	},
	blankFragment: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "about:blank with a fragment",
	},
	oauthBare: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "bare window.open of a sign-in URL (Deel's shape)",
	},
	oauthBlankTarget: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "sign-in URL with a _blank name",
	},
	oauthNamed: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "sign-in URL, named, no features",
	},
	withFeatures: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "window.open with features (Firebase's shape)",
	},
	oidcHybrid: {
		popups: 1,
		panes: 0,
		opener: true,
		handle: true,
		note: "OIDC hybrid response_type",
	},
	noopener: {
		popups: 1,
		panes: 0,
		opener: false,
		handle: false,
		note: "noopener severs the opener and nulls the handle, per spec",
	},
	nested: {
		popups: 2,
		panes: 0,
		opener: true,
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
const popupsNow = async () =>
	(await targets()).filter(
		(t) => t.type === "page" && !/^https?:\/\/localhost:\d+\/#/.test(t.url),
	);
const panesNow = async () =>
	(await targets()).filter((t) => t.type === "webview");

async function main() {
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
		const pane = (await panesNow())[0];
		if (!pane?.webSocketDebuggerUrl) {
			console.error(
				`FAIL: no browser pane found on port ${PORT}.\n` +
					"Open a workspace and press Cmd+Shift+B, then re-run.",
			);
			return 1;
		}

		const g = await Cdp.connect(pane.webSocketDebuggerUrl);
		await g.send("Page.enable");
		await g.send("Runtime.enable");
		await g.send("Page.navigate", { url: `${ORIGIN}/` });
		await sleep(2500);

		const failures: string[] = [];
		console.log(
			`${"case".padEnd(19)}${"popups".padEnd(8)}${"opener".padEnd(8)}${"jar".padEnd(6)}${"handle".padEnd(8)}panes  verdict`,
		);

		for (const [name, script] of Object.entries(CASES)) {
			const want = EXPECT[name];
			if (!want) continue;
			const panesBefore = (await panesNow()).length;
			await g.eval(`window.__handle = null; ${script}; 1`).catch(() => {});
			await sleep(name === "nested" || name === "selfClosing" ? 3000 : 2000);

			const live = await popupsNow();
			const panesAfter = (await panesNow()).length;
			let opener: boolean | null = null;
			let jar: boolean | null = null;
			for (const p of live) {
				if (!p.webSocketDebuggerUrl) continue;
				const c = await Cdp.connect(p.webSocketDebuggerUrl);
				await c.send("Runtime.enable");
				// Read the opener off the popup itself rather than the fixture's
				// snapshot: an `about:blank` popup never loads the fixture, and
				// relying on that snapshot silently skipped the assertion for the
				// two blank cases.
				const has = await c.eval<boolean>("!!window.opener").catch(() => null);
				if (has !== null) opener = opener === false ? false : has;
				const info = await c
					.eval<{ sharesCookieJar: boolean } | null>("window.__info ?? null")
					.catch(() => null);
				if (info) jar = info.sharesCookieJar;
				c.close();
			}
			const handle = await g
				.eval<string>("String(window.__handle)")
				.catch(() => "?");

			const bad: string[] = [];
			if (live.length !== want.popups)
				bad.push(`popups ${live.length}!=${want.popups}`);
			if (panesAfter - panesBefore !== want.panes)
				bad.push(`panes +${panesAfter - panesBefore}!=+${want.panes}`);
			if (
				want.opener !== undefined &&
				opener !== null &&
				opener !== want.opener
			)
				bad.push(`opener ${opener}!=${want.opener}`);
			// Every popup that keeps its opener must also keep the pane's jar.
			if (want.opener === true && jar === false)
				bad.push("cookie jar not shared");
			if (want.handle !== undefined) {
				const got = handle === "HANDLE";
				if (got !== want.handle) bad.push(`handle ${handle}`);
			}
			if (bad.length)
				failures.push(`${name}: ${bad.join(", ")} (${want.note})`);

			console.log(
				`${name.padEnd(19)}${String(live.length).padEnd(8)}${String(opener ?? "-").padEnd(8)}${String(jar ?? "-").padEnd(6)}${handle.padEnd(8)}+${panesAfter - panesBefore}     ${bad.length ? `FAIL ${bad.join(", ")}` : "ok"}`,
			);

			for (const p of live) {
				if (!p.webSocketDebuggerUrl) continue;
				const c = await Cdp.connect(p.webSocketDebuggerUrl).catch(() => null);
				await c?.send("Page.close").catch(() => {});
				c?.close();
			}
			await sleep(800);
		}

		const msgs = await g.eval<string[]>("window.__msgs ?? []").catch(() => []);
		if (!msgs.some((m) => m.startsWith("ok:"))) {
			failures.push("no postMessage reached the opener");
		}
		console.log(`\npostMessage callbacks delivered to opener: ${msgs.length}`);
		g.close();

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
