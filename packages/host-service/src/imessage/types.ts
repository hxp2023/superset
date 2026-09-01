import type { TerminalAgentBinding } from "../terminal-agents";

/** One row read from chat.db, already reduced to what routing needs. */
export interface InboundMessage {
	rowId: number;
	guid: string;
	/** 1:1 chat identifier — the other party's handle, or the user's own
	 * address for the "Messages to yourself" chat. */
	chatIdentifier: string;
	senderHandle: string | null;
	isFromMe: boolean;
	itemType: number;
	text: string | null;
	sentAt: number;
}

export interface ChatDbSnapshot {
	rows: InboundMessage[];
	maxRowId: number;
	/** Addresses the Mac's own Messages accounts are signed in as. A watched
	 * chat with one of these identifiers is the self-chat, where every device
	 * writes `is_from_me = 1` and sender filtering must rely on the outbound
	 * marker instead. */
	ownAccounts: string[];
}

export interface ImessageSettings {
	enabled: boolean;
	/** Allowlisted 1:1 chat identifiers (phone in E.164 or email). */
	handles: string[];
}

export type ImessageBridgeState =
	| "disabled"
	| "running"
	| "unsupported-platform"
	| "error";

export interface ImessageBridgeStatus {
	state: ImessageBridgeState;
	settings: ImessageSettings;
	/** Chat the last accepted inbound came from; default target for replies. */
	activeChatIdentifier: string | null;
	bindings: {
		chatIdentifier: string;
		workspaceId: string;
		terminalId: string;
	}[];
	lastError: string | null;
}

export interface ImessageBridgeDeps {
	/** One call per tick; opens chat.db read-only and closes it. Throws when
	 * the DB is unreadable (missing Full Disk Access, no Messages history). */
	readChatDb(sinceRowId: number, chatIdentifiers: string[]): ChatDbSnapshot;
	/** Deliver one iMessage. Implementations prepend OUTBOUND_MARKER. */
	sendMessage(to: string, text: string): Promise<void>;
	sendToTerminal(input: {
		workspaceId: string;
		terminalId: string;
		text: string;
	}): Promise<void>;
	listLiveAgents(): TerminalAgentBinding[];
	isTerminalAlive(terminalId: string): boolean;
	hasAgent(terminalId: string): boolean;
	getWorkspaceName(workspaceId: string): string | null;
	loadCursor(): number | null;
	saveCursor(cursor: number): void;
	platform?: NodeJS.Platform;
	now?: () => number;
	setIntervalFn?: typeof setInterval;
	clearIntervalFn?: typeof clearInterval;
}
