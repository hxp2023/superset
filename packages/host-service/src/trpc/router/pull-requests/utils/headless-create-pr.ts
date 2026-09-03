import { spawn } from "node:child_process";
import { signalProcessTreeAndGroups } from "@superset/pty-daemon/process-tree";
import {
	getBuiltinAgentDefinition,
	isBuiltinAgentId,
	isTerminalAgentDefinition,
} from "@superset/shared/agent-catalog";
import { quoteSingleShell } from "@superset/shared/agent-prompt-launch";
import type { HostDb } from "../../../../db";
import {
	getTerminalBaseEnv,
	waitForTerminalBaseEnv,
} from "../../../../terminal/env";
import { resolveLaunchShell } from "../../../../terminal/shell-launch";
import { resolveHostAgentConfig } from "../../agents/agents";
import {
	buildHeadlessAgentCommand,
	HEADLESS_SMALL_MODELS,
} from "../../agents/headless-command";
import { resolveDefaultAccountEnv } from "../../usage/default-account";

/**
 * Headless one-shot commands that can run git and gh, per preset. The
 * catalog's `nonInteractiveCommand` is deliberately read-only for most CLIs
 * (plan modes, `--no-tools`) because workspace naming needs no tools; a PR
 * has to push and call `gh`, so only presets with a verified permission
 * bypass are listed. Anything else degrades to "open an agent terminal".
 */
export const HEADLESS_TOOL_COMMANDS: Record<string, string> = {
	claude: "claude --dangerously-skip-permissions -p",
	codex:
		"codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check",
	gemini: "gemini --skip-trust --approval-mode=yolo -p",
	copilot: "copilot --allow-all-tools -p",
};

/** Long enough for a push plus `gh pr create` on a slow network; the
 * renderer gives up on its own well before this. */
export const HEADLESS_CREATE_PR_TIMEOUT_MS = 10 * 60 * 1000;

/** Finished runs linger so a renderer that polled late still sees the
 * outcome, then drop out of memory. */
const FINISHED_RUN_TTL_MS = 30 * 60 * 1000;

const OUTPUT_TAIL_CHARS = 2_000;

export interface HeadlessCreatePrRun {
	/** Distinguishes this run from an earlier one for the same workspace, so
	 * a renderer polling after a retry can ignore the stale outcome. */
	runId: string;
	workspaceId: string;
	presetId: string;
	startedAt: number;
	status: "running" | "succeeded" | "failed";
	finishedAt?: number;
	error?: string;
	outputTail?: string;
}

export interface HeadlessCreatePrCommand {
	presetId: string;
	label: string;
	command: string;
	/** The agent's account selection and per-config env, overlaid on the
	 * terminal base env the same way an interactive launch does it. */
	env: Record<string, string>;
}

/**
 * Resolves `agent` (a host agent config id or a preset id) to a headless
 * command with tool access, or null when the preset has no known one.
 */
export function resolveHeadlessCreatePrCommand(
	db: HostDb,
	agent: string,
): HeadlessCreatePrCommand | null {
	const config = resolveHostAgentConfig(db, agent);
	const presetId = config?.presetId ?? agent;
	if (!isBuiltinAgentId(presetId)) return null;
	const definition = getBuiltinAgentDefinition(presetId);
	if (!isTerminalAgentDefinition(definition)) return null;
	const base = HEADLESS_TOOL_COMMANDS[presetId];
	if (!base) return null;
	return {
		presetId,
		label: config?.label ?? definition.label,
		command: buildHeadlessAgentCommand(
			presetId,
			base,
			HEADLESS_SMALL_MODELS[presetId],
		),
		env: { ...resolveDefaultAccountEnv(db, presetId), ...(config?.env ?? {}) },
	};
}

const runs = new Map<string, HeadlessCreatePrRun>();
const livePids = new Map<string, number>();

export function getHeadlessCreatePrRun(
	workspaceId: string,
): HeadlessCreatePrRun | null {
	return runs.get(workspaceId) ?? null;
}

export class HeadlessCreatePrAlreadyRunning extends Error {
	constructor(workspaceId: string) {
		super(`A headless create-PR run is already in progress for ${workspaceId}`);
		this.name = "HeadlessCreatePrAlreadyRunning";
	}
}

function tail(text: string): string {
	return text.length > OUTPUT_TAIL_CHARS
		? text.slice(-OUTPUT_TAIL_CHARS)
		: text;
}

function killTree(pid: number | undefined): void {
	if (!pid) return;
	try {
		signalProcessTreeAndGroups(pid, "SIGKILL");
	} catch {
		// Already gone.
	}
}

// The agent CLIs are children of a login shell in their own process group;
// nothing reparents them to the host, so a host that exits (update, quit,
// crash the runtime can still observe) takes its in-flight runs down rather
// than leaving an agent pushing into a workspace nobody is watching.
let exitHookInstalled = false;
function installExitHook(): void {
	if (exitHookInstalled) return;
	exitHookInstalled = true;
	process.once("exit", () => {
		for (const pid of livePids.values()) killTree(pid);
	});
}

/**
 * Spawns the agent CLI in the worktree with the prompt as its positional
 * argument and tracks the run per workspace. Returns once the process has
 * started; `onFinished` fires when it exits or is killed for exceeding the
 * timeout — which signals the whole process tree, since the CLI and its
 * git/gh children hang off the login shell we actually spawned.
 *
 * The environment is the one an agent terminal in this workspace would get:
 * the preserved login-shell snapshot (host-service runtime keys and desktop
 * auth tokens already stripped) with the agent's account and per-config env
 * on top. A login shell so the binary resolves the way it does in the
 * user's terminal (nvm/bun-global paths a GUI-launched host lacks).
 */
export async function startHeadlessCreatePr({
	workspaceId,
	presetId,
	command,
	env: agentEnv,
	prompt,
	cwd,
	timeoutMs = HEADLESS_CREATE_PR_TIMEOUT_MS,
	onFinished,
}: {
	workspaceId: string;
	presetId: string;
	command: string;
	env?: Record<string, string>;
	prompt: string;
	cwd: string;
	timeoutMs?: number;
	onFinished?: (run: HeadlessCreatePrRun) => void;
}): Promise<HeadlessCreatePrRun> {
	const existing = runs.get(workspaceId);
	if (existing?.status === "running") {
		throw new HeadlessCreatePrAlreadyRunning(workspaceId);
	}

	await waitForTerminalBaseEnv();
	const baseEnv = getTerminalBaseEnv();
	const env = { ...baseEnv, ...agentEnv };
	const shell = resolveLaunchShell(baseEnv);

	const run: HeadlessCreatePrRun = {
		runId: crypto.randomUUID(),
		workspaceId,
		presetId,
		startedAt: Date.now(),
		status: "running",
	};
	runs.set(workspaceId, run);
	installExitHook();

	const child = spawn(
		shell,
		["-lc", `${command} ${quoteSingleShell(prompt)}`],
		{
			cwd,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	if (child.pid) livePids.set(run.runId, child.pid);

	let stdout = "";
	let stderr = "";
	let settled = false;
	const settle = (status: "succeeded" | "failed", error?: string) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		livePids.delete(run.runId);
		run.status = status;
		run.finishedAt = Date.now();
		run.outputTail = tail(stdout + (stderr ? `\n${stderr}` : ""));
		if (error) run.error = error;
		if (status === "failed") {
			console.warn(
				`[headless-create-pr] ${presetId} failed for ${workspaceId}: ${error}; output tail: ${run.outputTail}`,
			);
		}
		// Identity-checked so a newer run for the workspace is never evicted
		// by its predecessor's timer.
		setTimeout(() => {
			if (runs.get(workspaceId) === run) runs.delete(workspaceId);
		}, FINISHED_RUN_TTL_MS).unref();
		onFinished?.(run);
	};
	const timer = setTimeout(() => {
		killTree(child.pid);
		settle("failed", `Timed out after ${Math.round(timeoutMs / 1000)}s`);
	}, timeoutMs);

	child.stdout.on("data", (chunk: Buffer) => {
		stdout = tail(stdout + chunk.toString());
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = tail(stderr + chunk.toString());
	});
	child.on("error", (error) => {
		settle("failed", `Could not start ${presetId}: ${error.message}`);
	});
	child.on("close", (code, signal) => {
		if (code === 0) settle("succeeded");
		else
			settle(
				"failed",
				`${presetId} exited with ${code ?? signal}${stderr.trim() ? `: ${tail(stderr).trim().split("\n").slice(-3).join(" ")}` : ""}`,
			);
	});

	return run;
}

/** Test seam: forget every tracked run. */
export function resetHeadlessCreatePrRunsForTests(): void {
	runs.clear();
}
