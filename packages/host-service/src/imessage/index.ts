export { buildSendArgs, sendImessage } from "./applescript";
export { extractTextFromAttributedBody } from "./attributed-body";
export { defaultChatDbPath, readChatDb } from "./chat-db";
export {
	ImessageBridge,
	MAX_CONSECUTIVE_FAILURES,
	MAX_SENDS_PER_MINUTE,
	TICK_INTERVAL_MS,
} from "./imessage-bridge";
export {
	buildAgentPrompt,
	MAX_OUTBOUND_CHARS,
	OUTBOUND_MARKER,
	parseInbound,
	selectInbound,
} from "./messages";
export type {
	ChatDbSnapshot,
	ImessageBridgeDeps,
	ImessageBridgeStatus,
	ImessageSettings,
	InboundMessage,
} from "./types";
