import { describe, expect, it, mock } from "bun:test";

// Fake webContents registry — `webContents.fromId` resolves these.
const fakeById = new Map<number, FakeWebContents>();

interface FakeDebugger {
	attach: (v: string) => void;
	detach: ReturnType<typeof mock>;
	on: (ev: "message" | "detach", h: (...a: unknown[]) => void) => void;
	off: (ev: "message" | "detach", h: (...a: unknown[]) => void) => void;
	sendCommand: ReturnType<typeof mock>;
	_handlers: {
		message: Array<(...a: unknown[]) => void>;
		detach: Array<(...a: unknown[]) => void>;
	};
}
interface FakeWebContents {
	id: number;
	debugger: FakeDebugger;
	isDestroyed: () => boolean;
	isLoading: () => boolean;
	getURL: () => string;
	getTitle: () => string;
	setBackgroundThrottling: () => void;
	setWindowOpenHandler: () => void;
	on: () => void;
	off: () => void;
	copy: () => void;
	paste: () => void;
	selectAll: () => void;
}

function makeFakeWc(id: number, url: string, title: string): FakeWebContents {
	const _handlers = {
		message: [] as Array<(...a: unknown[]) => void>,
		detach: [] as Array<(...a: unknown[]) => void>,
	};
	return {
		id,
		isDestroyed: () => false,
		isLoading: () => false,
		getURL: () => url,
		getTitle: () => title,
		setBackgroundThrottling: () => {},
		setWindowOpenHandler: () => {},
		on: () => {},
		off: () => {},
		copy: () => {},
		paste: () => {},
		selectAll: () => {},
		debugger: {
			attach: () => {},
			detach: mock(() => {}),
			on: (ev, h) => _handlers[ev].push(h),
			off: (ev, h) => {
				_handlers[ev] = _handlers[ev].filter((x) => x !== h);
			},
			sendCommand: mock(() => Promise.resolve({ ok: true })),
			_handlers,
		},
	};
}

mock.module("electron", () => ({
	webContents: { fromId: (id: number) => fakeById.get(id) ?? null },
	clipboard: {},
	Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
	shell: { openExternal: () => Promise.resolve() },
	app: { getVersion: () => "test", isPackaged: false },
}));

const { browserManager } = await import("./browser-manager");

// A browser-level CDP client (browser-use, Playwright) attaches to the CDP
// endpoint, calls Target.getTargets, and attaches to the first `page` target.
// Without the Target-domain shim it would land on the Electron app shell; these
// tests pin the shim that makes the pane present as a single page target and
// binds the synthetic flatten session to the debugger's root channel.
describe("browser-manager attachCdp Target-domain emulation", () => {
	it("presents the pane as one page target and maps the flatten session to root", async () => {
		const wc = makeFakeWc(101, "http://127.0.0.1:8755/", "Demo");
		fakeById.set(101, wc);
		browserManager.register("paneA", 101, "wsA");
		const out: Array<Record<string, unknown>> = [];
		const session = browserManager.attachCdp(
			"paneA",
			"wsA",
			(m) => out.push(JSON.parse(m)),
			() => {},
		);
		const send = (msg: unknown) => session.send(JSON.stringify(msg));
		const reply = (id: number) => out.find((m) => m.id === id) as any;

		// Target.getTargets -> exactly one synthetic page target for this pane.
		send({ id: 1, method: "Target.getTargets" });
		const targets = reply(1).result.targetInfos;
		expect(targets).toHaveLength(1);
		expect(targets[0]).toMatchObject({
			targetId: "pane-paneA",
			type: "page",
			url: "http://127.0.0.1:8755/",
			title: "Demo",
		});

		// Attach hands back the synthetic flatten session id.
		send({
			id: 2,
			method: "Target.attachToTarget",
			params: { targetId: "pane-paneA", flatten: true },
		});
		expect(reply(2).result).toEqual({ sessionId: "pane-session-paneA" });

		// A command tagged with that session is forwarded to the debugger root
		// (sessionId stripped) while the response still echoes the session.
		out.length = 0;
		send({ id: 3, method: "Runtime.enable", sessionId: "pane-session-paneA" });
		await new Promise((r) => setTimeout(r, 0));
		const fwd = (wc.debugger.sendCommand as any).mock.calls.find(
			(c: unknown[]) => c[0] === "Runtime.enable",
		);
		expect(fwd[2]).toBeUndefined();
		expect(reply(3).sessionId).toBe("pane-session-paneA");

		// Root events (no sessionId) are tagged with the synthetic session so the
		// client's per-session event routing matches.
		out.length = 0;
		for (const h of wc.debugger._handlers.message)
			h({}, "Page.loadEventFired", {}, undefined);
		expect(
			(out.find((m) => m.method === "Page.loadEventFired") as any).sessionId,
		).toBe("pane-session-paneA");

		// setAutoAttach synthesizes attachedToTarget for the pane.
		out.length = 0;
		send({
			id: 5,
			method: "Target.setAutoAttach",
			params: { autoAttach: true, flatten: true },
		});
		const attached = out.find(
			(m) => m.method === "Target.attachedToTarget",
		) as any;
		expect(attached.params.sessionId).toBe("pane-session-paneA");
		expect(attached.params.targetInfo.targetId).toBe("pane-paneA");
		expect(reply(5).result).toEqual({});

		// createTarget can't spawn a tab on a single pane, so it reuses this one.
		send({
			id: 6,
			method: "Target.createTarget",
			params: { url: "about:blank" },
		});
		expect(reply(6).result).toEqual({ targetId: "pane-paneA" });

		session.detach();
	});

	it("acknowledges closeTarget without destroying the pane", () => {
		const wc = makeFakeWc(102, "https://example.com/", "Example");
		fakeById.set(102, wc);
		browserManager.register("paneB", 102, "wsB");
		const out: Array<Record<string, unknown>> = [];
		const session = browserManager.attachCdp(
			"paneB",
			"wsB",
			(m) => out.push(JSON.parse(m)),
			() => {},
		);
		session.send(
			JSON.stringify({
				id: 1,
				method: "Target.closeTarget",
				params: { targetId: "pane-paneB" },
			}),
		);
		expect((out.find((m) => m.id === 1) as any).result).toEqual({
			success: true,
		});
		expect(wc.debugger.detach).not.toHaveBeenCalled();
		expect(browserManager.getWebContents("paneB", "wsB") as unknown).toBe(wc);
		session.detach();
	});
});
