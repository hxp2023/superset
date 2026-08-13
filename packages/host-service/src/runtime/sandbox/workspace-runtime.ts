/**
 * Workspace execution runtime abstraction.
 *
 * Every workspace PTY (user terminals, agent launches, setup, teardown,
 * CLI --command) is spawned from one chokepoint in terminal.ts. The runtime
 * decides WHERE that PTY's process tree lives: directly on the host (today's
 * behavior) or inside a per-workspace sandbox container (Docker runtime).
 */

export interface TerminalLaunchContext {
	terminalId: string;
	workspaceId: string;
	/**
	 * Workspace worktree path on the host. Sandbox runtimes bind-mount the
	 * worktree at this exact path so host-side git/diff/search keep working.
	 */
	workspacePath: string;
	/** Main repo path, or "" for session workspaces with no project. */
	rootPath: string;
	/** Resolved terminal cwd (inside the worktree). */
	cwd: string;
	themeType?: "dark" | "light";
}

/** Exactly what daemon.open needs, plus launch capability metadata. */
export interface PtyLaunchSpec {
	/** Host executable the pty-daemon forks (user shell, or e.g. `docker`). */
	shell: string;
	argv: string[];
	/** Host-valid cwd — pty-daemon stat()s it before spawning. */
	cwd: string;
	env: Record<string, string>;
	/**
	 * Whether this launch installs Superset's OSC 133;A prompt marker, so
	 * initial commands can safely wait for shell readiness before typing.
	 */
	expectsReadyMarker: boolean;
}

export interface WorkspaceRuntime {
	readonly kind: "host" | "docker";
	/**
	 * Ensure backing resources exist before a PTY launch. No-op for the host
	 * runtime; container ensure (create/start/pull) for sandbox runtimes.
	 */
	prepare(): Promise<void>;
	/** Build the daemon.open spec for a workspace PTY. Called after prepare(). */
	buildPtyLaunch(ctx: TerminalLaunchContext): Promise<PtyLaunchSpec>;
	/** Agent-hook callback URL reachable from where the PTY's shell runs. */
	getAgentHookUrl(): string;
	/** Tear down backing resources on workspace delete. No-op for host. */
	destroy(): Promise<void>;
}
