import { agentIsBusy } from "../page-watch/index.ts";
import type { TerminalAgentBinding } from "../terminal-agents";
import type { ChatDbSnapshot, InboundMessage } from "./types";

/**
 * Invisible separator prepended to every message the bridge sends. In the
 * self-chat every device writes `is_from_me = 1`, so this marker — not the
 * sender column — is what keeps the bridge from ingesting its own replies
 * and looping.
 */
export const OUTBOUND_MARKER = "⁣";

/** Texting surface, not a terminal — keep replies inside iMessage limits. */
export const MAX_OUTBOUND_CHARS = 1600;

// Control characters would reach the PTY verbatim. A body carrying the
// bracketed-paste terminator would close the paste early and land the rest as
// keystrokes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function quote(text: string): string {
	return text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Rows worth acting on. The self-chat accepts both directions (see
 * OUTBOUND_MARKER); any other watched chat only trusts genuine inbound rows.
 */
export function selectInbound(
	snapshot: ChatDbSnapshot,
): (InboundMessage & { text: string })[] {
	const own = new Set(snapshot.ownAccounts);
	const out: (InboundMessage & { text: string })[] = [];
	for (const row of snapshot.rows) {
		if (row.itemType !== 0) continue;
		const text = row.text?.trim();
		if (!text) continue;
		if (text.startsWith(OUTBOUND_MARKER)) continue;
		if (row.isFromMe && !own.has(row.chatIdentifier)) continue;
		out.push({ ...row, text });
	}
	return out;
}

/**
 * Messages keys the self-chat by whichever of the user's own addresses the
 * sending device picked (phone number vs iCloud email), so allowlisting one
 * own address must watch them all — otherwise a text from the phone lands in
 * a sibling chat the bridge filters out.
 */
export function effectiveWatchList(
	handles: string[],
	ownAccounts: string[],
): string[] {
	const isSelfMode = handles.some((handle) => ownAccounts.includes(handle));
	if (!isSelfMode) return handles;
	return [...new Set([...handles, ...ownAccounts])];
}

export type InboundAction =
	| { kind: "status" }
	| { kind: "help" }
	| { kind: "task"; text: string };

export function parseInbound(text: string): InboundAction {
	const word = text.trim().toLowerCase();
	if (word === "status" || word === "s") return { kind: "status" };
	if (word === "help" || word === "?") return { kind: "help" };
	return { kind: "task", text: text.trim() };
}

export function buildAgentPrompt(text: string): string {
	return [
		`iMessage from your user: "${quote(text)}"`,
		"",
		"Act on it, then text back with:",
		'  superset imessage reply "your message"',
		"Reply like a text message — a sentence or two, no markdown. Send one",
		"when you finish or when you are blocked on something only they can",
		"answer.",
	].join("\n");
}

export function buildHelpReply(): string {
	return [
		"Superset over iMessage:",
		'• Text anything to steer your most recent agent ("run the tests", "ship it").',
		'• "status" — what your agents are doing.',
		'• "help" — this message.',
	].join("\n");
}

function formatAgo(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

/** A long-lived host tracks dozens of sessions; a text lists the recent few. */
export const MAX_STATUS_AGENTS = 8;

export function buildStatusReply(
	agents: TerminalAgentBinding[],
	workspaceNameOf: (workspaceId: string) => string | null,
	now: number,
): string {
	if (agents.length === 0) {
		return "No agents running. Start one in Superset, then text your task here.";
	}
	const sorted = agents.slice().sort((a, b) => b.lastEventAt - a.lastEventAt);
	const lines = sorted.slice(0, MAX_STATUS_AGENTS).map((agent) => {
		const workspace =
			workspaceNameOf(agent.workspaceId) ?? agent.workspaceId.slice(0, 8);
		const activity = agentIsBusy(agent.lastEventType) ? "working" : "idle";
		return `• ${agent.agentId} in ${workspace} — ${activity} (${formatAgo(now - agent.lastEventAt)})`;
	});
	if (sorted.length > MAX_STATUS_AGENTS) {
		lines.push(`…and ${sorted.length - MAX_STATUS_AGENTS} more`);
	}
	return lines.join("\n");
}

export function buildRoutedAck(agentId: string, workspaceName: string): string {
	return `Sent to ${agentId} in ${workspaceName} — it will text back here.`;
}

export function buildNoAgentReply(): string {
	return 'No agent is running in Superset right now. Start one, then text again. ("status" shows what\'s live.)';
}

export function truncateOutbound(text: string): string {
	if (text.length <= MAX_OUTBOUND_CHARS) return text;
	return `${text.slice(0, MAX_OUTBOUND_CHARS - 1)}…`;
}
