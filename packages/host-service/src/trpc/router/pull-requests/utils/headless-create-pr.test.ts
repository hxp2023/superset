import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import {
	initTerminalBaseEnv,
	resetTerminalBaseEnvForTests,
} from "../../../../terminal/env";
import {
	getHeadlessCreatePrRun,
	HeadlessCreatePrAlreadyRunning,
	type HeadlessCreatePrRun,
	resetHeadlessCreatePrRunsForTests,
	startHeadlessCreatePr,
} from "./headless-create-pr";

function finished(
	args: Omit<Parameters<typeof startHeadlessCreatePr>[0], "onFinished">,
): Promise<HeadlessCreatePrRun> {
	return new Promise((resolve, reject) => {
		startHeadlessCreatePr({ ...args, onFinished: resolve }).catch(reject);
	});
}

describe("startHeadlessCreatePr", () => {
	beforeEach(() => {
		initTerminalBaseEnv({
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: process.env.HOME ?? tmpdir(),
			SHELL: "/bin/sh",
			AUTH_TOKEN: "should-be-stripped",
			HOST_SERVICE_SECRET: "should-be-stripped",
		});
	});
	afterEach(() => {
		resetHeadlessCreatePrRunsForTests();
		resetTerminalBaseEnvForTests();
	});

	test("runs with the terminal base env plus the agent env, never host secrets", async () => {
		const run = await finished({
			workspaceId: "ws",
			presetId: "claude",
			command:
				'sh -c \'printf "%s|%s|%s" "$AUTH_TOKEN" "$HOST_SERVICE_SECRET" "$CLAUDE_CONFIG_DIR"\' sh',
			env: { CLAUDE_CONFIG_DIR: "/tmp/claude-alt" },
			prompt: "p",
			cwd: tmpdir(),
		});
		expect(run.status).toBe("succeeded");
		expect(run.outputTail).toBe("|| /tmp/claude-alt".replace(" ", ""));
	});

	test("each run gets its own id", async () => {
		const first = await finished({
			workspaceId: "ws",
			presetId: "claude",
			command: "true",
			prompt: "p",
			cwd: tmpdir(),
		});
		const second = await finished({
			workspaceId: "ws",
			presetId: "claude",
			command: "true",
			prompt: "p",
			cwd: tmpdir(),
		});
		expect(first.runId).not.toBe(second.runId);
		expect(getHeadlessCreatePrRun("ws")?.runId).toBe(second.runId);
	});

	test("tracks a clean exit as succeeded and passes the prompt as the last argument", async () => {
		const run = await finished({
			workspaceId: "ws",
			presetId: "claude",
			command: "printf '%s'",
			prompt: "hello\nworld",
			cwd: tmpdir(),
		});
		expect(run.status).toBe("succeeded");
		expect(run.outputTail).toBe("hello\nworld");
		expect(getHeadlessCreatePrRun("ws")?.status).toBe("succeeded");
	});

	test("a non-zero exit is failed with the stderr tail", async () => {
		const run = await finished({
			workspaceId: "ws",
			presetId: "claude",
			command: "sh -c 'echo boom >&2; exit 3' sh",
			prompt: "p",
			cwd: tmpdir(),
		});
		expect(run.status).toBe("failed");
		expect(run.error).toBe("claude exited with 3: boom");
	});

	test("a run past the timeout is killed with its whole tree and failed", async () => {
		// The shell writes its grandchild's pid, then that grandchild sleeps
		// well past the timeout; a shell-only kill would leave it alive.
		const run = await finished({
			workspaceId: "ws",
			presetId: "claude",
			command: "sh -c 'sleep 30 & echo $!; wait' sh",
			prompt: "p",
			cwd: tmpdir(),
			timeoutMs: 300,
		});
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/^Timed out/);
		const grandchild = Number.parseInt(run.outputTail?.trim() ?? "", 10);
		expect(Number.isFinite(grandchild)).toBe(true);
		await new Promise((r) => setTimeout(r, 100));
		expect(() => process.kill(grandchild, 0)).toThrow();
	});

	test("one run per workspace at a time", async () => {
		const first = new Promise<HeadlessCreatePrRun>((resolve, reject) => {
			startHeadlessCreatePr({
				workspaceId: "ws",
				presetId: "claude",
				command: "sh -c 'sleep 0.3' sh",
				prompt: "p",
				cwd: tmpdir(),
				onFinished: resolve,
			}).catch(reject);
		});
		await new Promise((r) => setTimeout(r, 20));
		await expect(
			startHeadlessCreatePr({
				workspaceId: "ws",
				presetId: "claude",
				command: "true",
				prompt: "p",
				cwd: tmpdir(),
			}),
		).rejects.toBeInstanceOf(HeadlessCreatePrAlreadyRunning);
		expect(getHeadlessCreatePrRun("ws")?.status).toBe("running");
		await first;
		expect(getHeadlessCreatePrRun("other")).toBeNull();
	});
});
