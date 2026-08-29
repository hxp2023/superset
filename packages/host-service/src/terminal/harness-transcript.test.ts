import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTail, readHarnessTranscript } from "./harness-transcript";

/**
 * The adapter reads from `~/.claude/projects/<encoded cwd>/`, so the fixture
 * lives under a temp worktree path that encodes into a directory of its own.
 */
const created: string[] = [];

function seedClaudeSession(lines: string[]): {
	worktreePath: string;
	sessionId: string;
} {
	const worktreePath = mkdtempSync(join(tmpdir(), "handoff-fixture-"));
	const sessionId = "11111111-2222-4333-8444-555555555555";
	const encoded = worktreePath.replaceAll(/[/.]/g, "-");
	const dir = join(homedir(), ".claude", "projects", encoded);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
	created.push(dir, worktreePath);
	return { worktreePath, sessionId };
}

afterEach(() => {
	for (const path of created.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("readHarnessTranscript", () => {
	test("reads the conversation out of Claude's own store", () => {
		const { worktreePath, sessionId } = seedClaudeSession([
			JSON.stringify({ type: "mode", mode: "normal" }),
			JSON.stringify({
				type: "user",
				message: { role: "user", content: "rename the widget" },
			}),
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "Renamed it in three files." },
						{ type: "tool_use", name: "Edit" },
					],
				},
			}),
		]);

		const result = readHarnessTranscript({
			agentId: "claude",
			agentSessionId: sessionId,
			worktreePath,
		});

		expect(result?.harness).toBe("claude");
		expect(result?.text).toBe(
			"User: rename the widget\n\nAssistant: Renamed it in three files.",
		);
	});

	test("survives the half-written last line of a live session", () => {
		const { worktreePath, sessionId } = seedClaudeSession([
			JSON.stringify({
				type: "user",
				message: { role: "user", content: "first" },
			}),
			'{"type":"assistant","message":{"role":"assist',
		]);

		const result = readHarnessTranscript({
			agentId: "claude",
			agentSessionId: sessionId,
			worktreePath,
		});
		expect(result?.text).toBe("User: first");
	});

	test("reads only the tail of a file past the byte bound", () => {
		const dir = mkdtempSync(join(tmpdir(), "tail-fixture-"));
		created.push(dir);
		const path = join(dir, "big.jsonl");
		writeFileSync(path, `${"x".repeat(5000)}TAIL-MARKER`);

		const tail = readFileTail(path, 100);
		expect(tail).toBe(`${"x".repeat(89)}TAIL-MARKER`);
		expect(tail?.length).toBe(100);
	});

	test("reads only the tail of a very large session file", () => {
		// A long session's JSONL runs to megabytes; the host must not load and
		// parse all of it to answer one handoff.
		const filler = Array.from({ length: 80_000 }, (_, i) =>
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: `old turn ${i}` }],
				},
			}),
		);
		const { worktreePath, sessionId } = seedClaudeSession([
			...filler,
			JSON.stringify({
				type: "user",
				message: { role: "user", content: "the newest thing said" },
			}),
		]);

		const result = readHarnessTranscript({
			agentId: "claude",
			agentSessionId: sessionId,
			worktreePath,
		});
		expect(result?.text).toContain("the newest thing said");
		// The oldest turns fall off the front rather than being parsed.
		expect(result?.text).not.toContain("old turn 0\n");
		expect(result?.text).not.toContain("old turn 1000\n");
	});

	test("declines harnesses with no store, so the PTY stream is used", () => {
		const { worktreePath, sessionId } = seedClaudeSession([
			JSON.stringify({
				type: "user",
				message: { role: "user", content: "hello" },
			}),
		]);

		expect(
			readHarnessTranscript({
				agentId: "codex",
				agentSessionId: sessionId,
				worktreePath,
			}),
		).toBeNull();
	});

	test("declines an unbound terminal", () => {
		expect(
			readHarnessTranscript({
				agentId: "claude",
				agentSessionId: null,
				worktreePath: "/tmp",
			}),
		).toBeNull();
	});

	test("refuses a session id that could escape the transcript directory", () => {
		expect(
			readHarnessTranscript({
				agentId: "claude",
				agentSessionId: "../../../../etc/passwd",
				worktreePath: "/tmp",
			}),
		).toBeNull();
	});
});
