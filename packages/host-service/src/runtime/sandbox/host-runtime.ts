import {
	buildV2TerminalEnv,
	getShellLaunchArgs,
	getTerminalBaseEnv,
	resolveLaunchShell,
	shellLaunchExpectsReadyMarker,
	waitForTerminalBaseEnv,
} from "../../terminal/env.ts";
import type {
	PtyLaunchSpec,
	TerminalLaunchContext,
	WorkspaceRuntime,
} from "./workspace-runtime.ts";

/**
 * Build the host-service tRPC URL for the v2 agent hook. The agent shell
 * script POSTs to this; host-service fans out on the event bus so the
 * renderer (web or electron) can play the finish sound.
 */
export function getHostAgentHookUrl(): string {
	const port = process.env.HOST_SERVICE_PORT || process.env.PORT;
	if (!port) return "";
	return `http://127.0.0.1:${port}/trpc/notifications.hook`;
}

/**
 * Today's behavior: the PTY child is the user's shell running directly on
 * the host, wrapped with Superset's shell bootstrap (rc files under
 * SUPERSET_HOME_DIR) and the preserved login-shell env snapshot.
 */
export class HostRuntime implements WorkspaceRuntime {
	readonly kind = "host" as const;

	async prepare(): Promise<void> {
		// Nothing to provision for host execution.
	}

	async buildPtyLaunch(ctx: TerminalLaunchContext): Promise<PtyLaunchSpec> {
		// Use the preserved shell snapshot — never live process.env. Resolution
		// runs in the background at startup so the server can listen
		// immediately; wait for it here before the first PTY needs it.
		await waitForTerminalBaseEnv();
		const baseEnv = getTerminalBaseEnv();
		const supersetHomeDir = process.env.SUPERSET_HOME_DIR || "";
		const shell = resolveLaunchShell(baseEnv);
		const argv = getShellLaunchArgs({ shell, supersetHomeDir });
		const env = buildV2TerminalEnv({
			baseEnv,
			shell,
			supersetHomeDir,
			themeType: ctx.themeType,
			cwd: ctx.cwd,
			terminalId: ctx.terminalId,
			workspaceId: ctx.workspaceId,
			workspacePath: ctx.workspacePath,
			rootPath: ctx.rootPath,
			supersetEnv:
				process.env.NODE_ENV === "development" ? "development" : "production",
			agentHookPort: process.env.SUPERSET_AGENT_HOOK_PORT || "",
			agentHookVersion: process.env.SUPERSET_AGENT_HOOK_VERSION || "",
			hostAgentHookUrl: this.getAgentHookUrl(),
		});
		return {
			shell,
			argv,
			cwd: ctx.cwd,
			env,
			expectsReadyMarker: shellLaunchExpectsReadyMarker({
				shell,
				supersetHomeDir,
			}),
		};
	}

	getAgentHookUrl(): string {
		return getHostAgentHookUrl();
	}

	async destroy(): Promise<void> {
		// Nothing to tear down for host execution.
	}
}
