import { describe, expect, it } from "bun:test";
import type { TerminalAgentBinding } from "../terminal-agents";
import { ImessageBridge, MAX_SENDS_PER_MINUTE } from "./imessage-bridge.ts";
import type { ChatDbSnapshot, InboundMessage } from "./types.ts";

const T0 = 1_800_000_000_000;
const HANDLE = "+15551234567";
const SELF = "me@example.com";

function inbound(overrides: Partial<InboundMessage>): InboundMessage {
	return {
		rowId: 11,
		guid: "guid-11",
		chatIdentifier: HANDLE,
		senderHandle: HANDLE,
		isFromMe: false,
		itemType: 0,
		text: "run the tests",
		sentAt: T0,
		...overrides,
	};
}

function liveAgent(
	overrides: Partial<TerminalAgentBinding> = {},
): TerminalAgentBinding {
	return {
		terminalId: "term-1",
		workspaceId: "ws-1",
		agentId: "claude",
		startedAt: T0 - 600_000,
		lastEventAt: T0 - 60_000,
		lastEventType: "Stop",
		...overrides,
	} as TerminalAgentBinding;
}

function harness(
	options: {
		rows?: InboundMessage[];
		maxRowId?: number;
		agents?: TerminalAgentBinding[];
		cursor?: number | null;
		readError?: Error;
		platform?: NodeJS.Platform;
		ownAccounts?: string[];
	} = {},
) {
	const sent: { to: string; text: string }[] = [];
	const delivered: { terminalId: string; text: string }[] = [];
	const savedCursors: number[] = [];
	const readCalls: string[][] = [];
	let rows = options.rows ?? [];
	let now = T0;

	const bridge = new ImessageBridge({
		readChatDb: (sinceRowId, chatIdentifiers): ChatDbSnapshot => {
			if (options.readError) throw options.readError;
			readCalls.push(chatIdentifiers);
			return {
				rows: rows.filter(
					(row) =>
						row.rowId > sinceRowId &&
						chatIdentifiers.includes(row.chatIdentifier),
				),
				maxRowId: options.maxRowId ?? 10,
				ownAccounts: options.ownAccounts ?? [SELF],
			};
		},
		sendMessage: async (to, text) => {
			sent.push({ to, text });
		},
		sendToTerminal: async ({ terminalId, text }) => {
			delivered.push({ terminalId, text });
		},
		listLiveAgents: () => options.agents ?? [],
		isTerminalAlive: () => true,
		hasAgent: () => true,
		getWorkspaceName: () => "lavender-meal",
		loadCursor: () => (options.cursor === undefined ? 10 : options.cursor),
		saveCursor: (cursor) => {
			savedCursors.push(cursor);
		},
		platform: options.platform ?? "darwin",
		now: () => now,
		setIntervalFn: (() => ({ unref() {} })) as unknown as typeof setInterval,
		clearIntervalFn: (() => {}) as unknown as typeof clearInterval,
	});

	return {
		bridge,
		sent,
		delivered,
		savedCursors,
		readCalls,
		setRows(next: InboundMessage[]) {
			rows = next;
		},
		advance(ms: number) {
			now += ms;
		},
	};
}

function enable(h: ReturnType<typeof harness>) {
	h.bridge.applySettings({ enabled: true, handles: [HANDLE, SELF] });
}

describe("ImessageBridge", () => {
	it("initializes the cursor to the tail on first enable — no history replay", () => {
		const h = harness({
			cursor: null,
			maxRowId: 42,
			rows: [inbound({ rowId: 7 })],
		});
		enable(h);
		expect(h.savedCursors).toEqual([42]);
		expect(h.delivered).toHaveLength(0);
	});

	it("routes a task to the most recent live agent and acks once", async () => {
		const h = harness({ rows: [inbound({})], agents: [liveAgent()] });
		enable(h);
		await h.bridge.tick();
		expect(h.delivered).toHaveLength(1);
		expect(h.delivered[0]?.terminalId).toBe("term-1");
		expect(h.delivered[0]?.text).toContain("run the tests");
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0]?.text).toContain("claude in lavender-meal");

		// A follow-up to the bound session must not re-ack.
		h.setRows([inbound({ rowId: 12, text: "also lint it" })]);
		await h.bridge.tick();
		expect(h.delivered).toHaveLength(2);
		expect(h.sent).toHaveLength(1);
	});

	it("answers status without touching a terminal", async () => {
		const h = harness({
			rows: [inbound({ text: "status" })],
			agents: [liveAgent()],
		});
		enable(h);
		await h.bridge.tick();
		expect(h.delivered).toHaveLength(0);
		expect(h.sent).toHaveLength(1);
		expect(h.sent[0]?.text).toContain("claude");
	});

	it("explains itself when no agent is live", async () => {
		const h = harness({ rows: [inbound({})], agents: [] });
		enable(h);
		await h.bridge.tick();
		expect(h.delivered).toHaveLength(0);
		expect(h.sent[0]?.text).toContain("No agent is running");
	});

	it("persists the cursor past processed rows", async () => {
		const h = harness({
			rows: [inbound({ rowId: 11 })],
			agents: [liveAgent()],
		});
		enable(h);
		await h.bridge.tick();
		expect(h.savedCursors).toEqual([11]);

		// Nothing new and the tail is behind the cursor: no write.
		h.setRows([]);
		await h.bridge.tick();
		expect(h.savedCursors).toEqual([11]);
	});

	it("watches every own account once one is allowlisted", async () => {
		// Messages keyed this user's self-chat by phone number even though the
		// allowlist held the email — the bridge must widen to all own accounts.
		const PHONE = "+15550001111";
		const h = harness({
			ownAccounts: [SELF, PHONE],
			rows: [
				inbound({ chatIdentifier: PHONE, isFromMe: true, text: "from phone" }),
			],
			agents: [liveAgent()],
		});
		h.bridge.applySettings({ enabled: true, handles: [SELF] });
		await h.bridge.tick();
		expect(h.readCalls.at(-1)).toEqual([SELF, PHONE]);
		expect(h.delivered).toHaveLength(1);
		expect(h.delivered[0]?.text).toContain("from phone");

		// Replies may also target the sibling self-chat.
		await expect(h.bridge.reply({ text: "done", to: PHONE })).resolves.toEqual({
			to: PHONE,
		});
	});

	it("does not widen the watch list for a non-self allowlist", async () => {
		const h = harness({
			ownAccounts: [SELF],
			rows: [inbound({})],
			agents: [liveAgent()],
		});
		h.bridge.applySettings({ enabled: true, handles: [HANDLE] });
		await h.bridge.tick();
		expect(h.readCalls.at(-1)).toEqual([HANDLE]);
	});

	it("does not tick off macOS", () => {
		const h = harness({ platform: "linux" });
		enable(h);
		expect(h.bridge.status().state).toBe("unsupported-platform");
	});

	it("reports read failures and keeps ticking until the failure cap", async () => {
		const h = harness({ readError: new Error("SQLITE_CANTOPEN") });
		enable(h);
		await h.bridge.tick();
		expect(h.bridge.status().lastError).toContain("SQLITE_CANTOPEN");
	});

	it("replies only to allowlisted handles, defaulting to the active chat", async () => {
		const h = harness({ rows: [inbound({})], agents: [liveAgent()] });
		enable(h);
		await h.bridge.tick();

		const result = await h.bridge.reply({ text: "done" });
		expect(result.to).toBe(HANDLE);
		expect(h.sent.at(-1)?.text).toBe("done");

		await expect(
			h.bridge.reply({ text: "hi", to: "+19998887777" }),
		).rejects.toThrow("not an allowlisted");
	});

	it("refuses to reply while disabled or with no active conversation", async () => {
		const h = harness();
		await expect(h.bridge.reply({ text: "hi" })).rejects.toThrow("disabled");
		enable(h);
		await expect(h.bridge.reply({ text: "hi" })).rejects.toThrow(
			"No active iMessage conversation",
		);
	});

	it("rate-limits outbound sends", async () => {
		const h = harness({ rows: [inbound({})], agents: [liveAgent()] });
		enable(h);
		await h.bridge.tick();
		for (let i = h.sent.length; i < MAX_SENDS_PER_MINUTE; i++) {
			await h.bridge.reply({ text: `update ${i}` });
		}
		await expect(h.bridge.reply({ text: "one too many" })).rejects.toThrow(
			"rate limit",
		);
		h.advance(61_000);
		await expect(h.bridge.reply({ text: "fresh window" })).resolves.toEqual({
			to: HANDLE,
		});
	});
});
