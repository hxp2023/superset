import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read a session transcript from the harness's own store when it keeps one.
 *
 * The PTY stream is the universal source, but it is a reconstruction: rows as
 * they were painted, capped by a retention ring, with tool output and UI
 * chrome interleaved. A harness that already writes its conversation to disk
 * has the same content structured, complete, and free of redraw artefacts, so
 * prefer it where it exists and fall back to the stream everywhere else.
 */

/** Newest turns first would invert the conversation; keep source order. */
const MAX_HARNESS_TRANSCRIPT_CHARS = 400_000;
/**
 * Bytes read off the end of a session file. A long-running session's JSONL
 * runs to megabytes (this repo's own dev session reached 3.9 MB), and the
 * host must not load, split, and parse all of it on the event loop to answer
 * one handoff. Generous next to the character cap the turns are trimmed to.
 */
const MAX_HARNESS_SOURCE_BYTES = 4 * 1024 * 1024;

export interface HarnessTranscript {
	text: string;
	/** Which harness store answered, for the caller to report. */
	harness: "claude";
}

/**
 * Claude Code stores one JSONL file per session under a directory named after
 * the working directory with every `/` and `.` replaced by `-`.
 */
function claudeTranscriptPath(
	worktreePath: string,
	sessionId: string,
): string | null {
	if (!/^[\w-]+$/.test(sessionId)) return null;
	const encoded = worktreePath.replaceAll(/[/.]/g, "-");
	const path = join(
		homedir(),
		".claude",
		"projects",
		encoded,
		`${sessionId}.jsonl`,
	);
	return existsSync(path) ? path : null;
}

/**
 * The last `maxBytes` of a file. A cut lands mid-line, and the parser already
 * skips lines it cannot parse, so the only casualty is the oldest turn.
 */
export function readFileTail(path: string, maxBytes: number): string | null {
	let fd: number | undefined;
	try {
		const { size } = statSync(path);
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.allocUnsafe(length);
		fd = openSync(path, "r");
		readSync(fd, buffer, 0, length, Math.max(0, size - length));
		return buffer.toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// best effort
			}
		}
	}
}

interface ClaudeEvent {
	type?: string;
	message?: {
		role?: string;
		content?: string | Array<{ type?: string; text?: string }>;
	};
}

function textOf(event: ClaudeEvent): string | null {
	const content = event.message?.content;
	if (typeof content === "string") return content.trim() || null;
	if (!Array.isArray(content)) return null;
	const parts = content
		.filter((block) => block.type === "text" && block.text)
		.map((block) => (block.text ?? "").trim())
		.filter(Boolean);
	return parts.length > 0 ? parts.join("\n") : null;
}

function readClaudeTranscript(
	worktreePath: string,
	sessionId: string,
): string | null {
	const path = claudeTranscriptPath(worktreePath, sessionId);
	if (!path) return null;
	const raw = readFileTail(path, MAX_HARNESS_SOURCE_BYTES);
	if (raw === null) return null;

	const turns: string[] = [];
	for (const line of raw.split("\n")) {
		if (!line) continue;
		let event: ClaudeEvent;
		try {
			event = JSON.parse(line) as ClaudeEvent;
		} catch {
			continue; // a partially written final line while the session runs
		}
		if (event.type !== "user" && event.type !== "assistant") continue;
		const text = textOf(event);
		if (!text) continue;
		turns.push(`${event.type === "user" ? "User" : "Assistant"}: ${text}`);
	}
	if (turns.length === 0) return null;

	const joined = turns.join("\n\n");
	return joined.length > MAX_HARNESS_TRANSCRIPT_CHARS
		? joined.slice(-MAX_HARNESS_TRANSCRIPT_CHARS)
		: joined;
}

/**
 * The harness's own transcript for a bound session, or null when the harness
 * keeps none, the id is unknown, or the file cannot be read.
 */
export function readHarnessTranscript(input: {
	agentId: string | null | undefined;
	agentSessionId: string | null | undefined;
	worktreePath: string | null | undefined;
}): HarnessTranscript | null {
	const { agentId, agentSessionId, worktreePath } = input;
	if (!agentId || !agentSessionId || !worktreePath) return null;
	if (agentId !== "claude") return null;
	const text = readClaudeTranscript(worktreePath, agentSessionId);
	return text ? { text, harness: "claude" } : null;
}
