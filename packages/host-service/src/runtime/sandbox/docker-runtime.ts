import { buildContainerTerminalEnv } from "./container-env.ts";
import {
	destroyWorkspaceSandbox,
	ensureContainer,
} from "./container-manager.ts";
import { buildExecArgs, type ResolvedSandboxSettings } from "./docker-args.ts";
import { getDockerCliEnv } from "./docker-cli.ts";
import { getHostAgentHookUrl } from "./host-runtime.ts";
import { CONTAINER_BASH_RCFILE, getSandboxContainerName } from "./paths.ts";
import type {
	PtyLaunchSpec,
	TerminalLaunchContext,
	WorkspaceRuntime,
} from "./workspace-runtime.ts";

export interface DockerRuntimeParams {
	workspaceId: string;
	worktreePath: string;
	repoPath: string;
	branch: string;
	settings: ResolvedSandboxSettings;
}

/**
 * Runs every workspace PTY inside one persistent per-workspace container.
 * The pty-daemon's child is the docker CLI: `docker exec -it` under a PTY
 * forwards bytes, resize (SIGWINCH → exec-resize API), and the inner
 * process's exit code, so terminal persistence/adoption work unchanged.
 */
export class DockerRuntime implements WorkspaceRuntime {
	readonly kind = "docker" as const;

	constructor(private readonly params: DockerRuntimeParams) {}

	async prepare(): Promise<void> {
		await ensureContainer(this.params);
	}

	async buildPtyLaunch(ctx: TerminalLaunchContext): Promise<PtyLaunchSpec> {
		const env = buildContainerTerminalEnv({
			ctx,
			hostAgentHookUrl: this.getAgentHookUrl(),
			envPassthrough: this.params.settings.envPassthrough,
			hostEnv: process.env,
		});
		return {
			shell: "docker",
			argv: buildExecArgs({
				containerName: getSandboxContainerName(this.params.workspaceId),
				cwd: ctx.cwd,
				env,
				command: ["/bin/bash", "--rcfile", CONTAINER_BASH_RCFILE],
			}),
			// pty-daemon stat()s the spawn cwd on the host; the container cwd
			// rides in `docker exec -w` instead.
			cwd: ctx.workspacePath,
			env: getDockerCliEnv(),
			// The generated container rcfile always installs the OSC 133;A
			// prompt marker (sandbox-home.ts owns the contract).
			expectsReadyMarker: true,
		};
	}

	getAgentHookUrl(): string {
		// host.docker.internal reaches the host's loopback from containers on
		// Docker Desktop natively; the container is created with
		// `--add-host host.docker.internal:host-gateway` for Linux engines.
		return getHostAgentHookUrl().replace("127.0.0.1", "host.docker.internal");
	}

	async destroy(): Promise<void> {
		await destroyWorkspaceSandbox(this.params.workspaceId);
	}
}
