import { HostRuntime } from "./host-runtime.ts";
import type { WorkspaceRuntime } from "./workspace-runtime.ts";

const hostRuntime = new HostRuntime();

/**
 * Resolve the execution runtime for a workspace.
 *
 * Always the host runtime today. Once per-workspace sandbox config lands,
 * workspaces with sandboxing enabled resolve to a Docker runtime instead.
 */
export function getWorkspaceRuntime(_workspaceId: string): WorkspaceRuntime {
	return hostRuntime;
}
