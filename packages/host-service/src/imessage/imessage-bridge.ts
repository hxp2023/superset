import type { TerminalAgentBinding } from "../terminal-agents";
import {
	buildAgentPrompt,
	buildHelpReply,
	buildNoAgentReply,
	buildRoutedAck,
	buildStatusReply,
	parseInbound,
	selectInbound,
} from "./messages";
import type {
	ImessageBridgeDeps,
	ImessageBridgeStatus,
	ImessageSettings,
} from "./types";

export const TICK_INTERVAL_MS = 3_000;
export const MAX_CONSECUTIVE_FAILURES = 5;
/** Outbound cap per rolling minute — a stuck agent must not text-storm. */
export const MAX_SENDS_PER_MINUTE = 10;
const SEND_WINDOW_MS = 60_000;

interface ConversationBinding {
	workspaceId: string;
	terminalId: string;
}

/**
 * Texts from allowlisted iMessage conversations become follow-ups to the
 * user's coding agents; agents text back via `superset imessage reply`
 * (the `imessage.reply` host procedure). Same shape as PageWatchManager:
 * constructed once in createApp, deps injected, `.stop()` on dispose.
 */
export class ImessageBridge {
	private readonly deps: ImessageBridgeDeps;
	private readonly now: () => number;
	private readonly setIntervalFn: typeof setInterval;
	private readonly clearIntervalFn: typeof clearInterval;
	private readonly platform: NodeJS.Platform;

	private settings: ImessageSettings = { enabled: false, handles: [] };
	private cursor: number | null = null;
	private readonly bindings = new Map<string, ConversationBinding>();
	private activeChatIdentifier: string | null = null;
	private lastError: string | null = null;
	private failures = 0;
	private sendTimestamps: number[] = [];

	private ticker: ReturnType<typeof setInterval> | null = null;
	private ticking = false;
	private tickRequested = false;

	constructor(deps: ImessageBridgeDeps) {
		this.deps = deps;
		this.now = deps.now ?? Date.now;
		this.setIntervalFn = deps.setIntervalFn ?? setInterval;
		this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
		this.platform = deps.platform ?? process.platform;
	}

	applySettings(settings: ImessageSettings): void {
		this.settings = {
			enabled: settings.enabled,
			handles: settings.handles.map((handle) => handle.trim()).filter(Boolean),
		};
		this.lastError = null;
		this.failures = 0;

		if (!this.shouldRun()) {
			this.stopTicking();
			return;
		}

		// First enable: start at the tail — the bridge answers new texts, it
		// does not replay history.
		this.cursor ??= this.deps.loadCursor();
		if (this.cursor === null) {
			try {
				this.cursor = this.deps.readChatDb(
					Number.MAX_SAFE_INTEGER,
					[],
				).maxRowId;
				this.deps.saveCursor(this.cursor);
			} catch (error) {
				this.recordFailure(error, "open");
				return;
			}
		}
		this.ensureTicking();
	}

	status(): ImessageBridgeStatus {
		return {
			state:
				this.platform !== "darwin" && this.settings.enabled
					? "unsupported-platform"
					: this.lastError !== null
						? "error"
						: this.ticker !== null
							? "running"
							: "disabled",
			settings: this.settings,
			activeChatIdentifier: this.activeChatIdentifier,
			bindings: [...this.bindings.entries()].map(
				([chatIdentifier, binding]) => ({ chatIdentifier, ...binding }),
			),
			lastError: this.lastError,
		};
	}

	/**
	 * Outbound reply — the `imessage.reply` procedure agents call. Only ever
	 * texts an allowlisted conversation; an agent cannot use it to reach an
	 * arbitrary number.
	 */
	async reply(input: { text: string; to?: string }): Promise<{ to: string }> {
		if (!this.settings.enabled) {
			throw new Error("iMessage bridge is disabled on this host");
		}
		const to = input.to ?? this.activeChatIdentifier;
		if (!to) {
			throw new Error(
				"No active iMessage conversation — pass --to with an allowlisted handle",
			);
		}
		if (!this.settings.handles.includes(to)) {
			throw new Error(`${to} is not an allowlisted iMessage handle`);
		}
		await this.send(to, input.text);
		return { to };
	}

	stop(): void {
		this.stopTicking();
		this.bindings.clear();
	}

	private shouldRun(): boolean {
		return (
			this.settings.enabled &&
			this.settings.handles.length > 0 &&
			this.platform === "darwin"
		);
	}

	private ensureTicking(): void {
		if (this.ticker) return;
		this.ticker = this.setIntervalFn(() => {
			void this.tick();
		}, TICK_INTERVAL_MS);
		this.ticker.unref?.();
	}

	private stopTicking(): void {
		this.tickRequested = false;
		if (this.ticker) {
			this.clearIntervalFn(this.ticker);
			this.ticker = null;
		}
	}

	async tick(): Promise<void> {
		if (this.ticking) {
			this.tickRequested = true;
			return;
		}
		this.ticking = true;
		try {
			await this.poll();
		} finally {
			this.ticking = false;
		}

		if (!this.tickRequested) return;
		this.tickRequested = false;
		if (this.ticker !== null) await this.tick();
	}

	private async poll(): Promise<void> {
		if (!this.shouldRun() || this.cursor === null) return;

		let snapshot: ReturnType<ImessageBridgeDeps["readChatDb"]>;
		try {
			snapshot = this.deps.readChatDb(this.cursor, this.settings.handles);
		} catch (error) {
			this.recordFailure(error, "read");
			return;
		}
		this.failures = 0;

		for (const message of selectInbound(snapshot)) {
			try {
				await this.handleInbound(message.chatIdentifier, message.text);
			} catch (error) {
				console.warn("[imessage] failed to handle inbound message", error);
			}
		}

		// A non-empty batch may have been truncated at the read limit, so only
		// advance past what was actually read; an empty batch can jump straight
		// to the tail.
		const nextCursor =
			snapshot.rows.length > 0
				? Math.max(this.cursor, ...snapshot.rows.map((row) => row.rowId))
				: Math.max(this.cursor, snapshot.maxRowId);
		if (nextCursor !== this.cursor) {
			this.cursor = nextCursor;
			this.deps.saveCursor(nextCursor);
		}
	}

	private async handleInbound(
		chatIdentifier: string,
		text: string,
	): Promise<void> {
		this.activeChatIdentifier = chatIdentifier;
		const action = parseInbound(text);

		if (action.kind === "help") {
			await this.send(chatIdentifier, buildHelpReply());
			return;
		}
		if (action.kind === "status") {
			await this.send(
				chatIdentifier,
				buildStatusReply(
					this.deps.listLiveAgents(),
					this.deps.getWorkspaceName,
					this.now(),
				),
			);
			return;
		}

		const target = this.resolveTarget(chatIdentifier);
		if (!target) {
			await this.send(chatIdentifier, buildNoAgentReply());
			return;
		}
		await this.deps.sendToTerminal({
			workspaceId: target.binding.workspaceId,
			terminalId: target.binding.terminalId,
			text: buildAgentPrompt(action.text),
		});
		if (target.isNew) {
			const workspaceName =
				this.deps.getWorkspaceName(target.binding.workspaceId) ?? "a workspace";
			await this.send(
				chatIdentifier,
				buildRoutedAck(target.agentId, workspaceName),
			);
		}
	}

	private resolveTarget(chatIdentifier: string): {
		binding: ConversationBinding;
		agentId: string;
		isNew: boolean;
	} | null {
		const existing = this.bindings.get(chatIdentifier);
		if (
			existing &&
			this.deps.isTerminalAlive(existing.terminalId) &&
			this.deps.hasAgent(existing.terminalId)
		) {
			return { binding: existing, agentId: "agent", isNew: false };
		}
		this.bindings.delete(chatIdentifier);

		const candidates = this.deps
			.listLiveAgents()
			.filter(
				(agent) =>
					this.deps.isTerminalAlive(agent.terminalId) &&
					this.deps.hasAgent(agent.terminalId),
			)
			.sort((a, b) => b.lastEventAt - a.lastEventAt);
		const best: TerminalAgentBinding | undefined = candidates[0];
		if (!best) return null;

		const binding: ConversationBinding = {
			workspaceId: best.workspaceId,
			terminalId: best.terminalId,
		};
		this.bindings.set(chatIdentifier, binding);
		return { binding, agentId: best.agentId, isNew: true };
	}

	private async send(to: string, text: string): Promise<void> {
		const at = this.now();
		this.sendTimestamps = this.sendTimestamps.filter(
			(sentAt) => at - sentAt < SEND_WINDOW_MS,
		);
		if (this.sendTimestamps.length >= MAX_SENDS_PER_MINUTE) {
			throw new Error(
				`iMessage send rate limit hit (${MAX_SENDS_PER_MINUTE}/min) — dropping message`,
			);
		}
		this.sendTimestamps.push(at);
		await this.deps.sendMessage(to, text);
	}

	private recordFailure(error: unknown, stage: "open" | "read"): void {
		this.failures += 1;
		this.lastError = error instanceof Error ? error.message : String(error);
		if (this.failures < MAX_CONSECUTIVE_FAILURES && stage !== "open") return;
		console.error(
			`[imessage] disabling bridge after ${stage} failure — likely missing Full Disk Access for chat.db`,
			{ error: this.lastError },
		);
		this.stopTicking();
	}
}
