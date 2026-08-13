import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { projects, workspaces } from "../../db/schema.ts";
import { loadSetupConfig } from "../setup/config.ts";
import { computeConfigHash } from "./container-manager.ts";
import { resolveSandboxSettings } from "./docker-args.ts";
import { DockerRuntime } from "./docker-runtime.ts";
import { HostRuntime } from "./host-runtime.ts";
import type { WorkspaceRuntime } from "./workspace-runtime.ts";

const hostRuntime = new HostRuntime();
const dockerRuntimes = new Map<
	string,
	{ configHash: string; runtime: DockerRuntime }
>();

/**
 * Resolve the execution runtime for a workspace.
 *
 * The workspace row's sticky `sandboxEnabled` (snapshotted at create time)
 * decides host vs docker; the sandbox details (image, resources, mounts)
 * are re-read from config on every resolution so edits apply to the next
 * container recreation without flipping a live workspace's mode.
 */
export function getWorkspaceRuntime(
	db: HostDb,
	workspaceId: string,
): WorkspaceRuntime {
	const workspace = db.query.workspaces
		.findFirst({ where: eq(workspaces.id, workspaceId) })
		.sync();
	if (!workspace?.sandboxEnabled || !workspace.projectId) return hostRuntime;

	const project = db.query.projects
		.findFirst({ where: eq(projects.id, workspace.projectId) })
		.sync();
	if (!project) return hostRuntime;

	const sandboxConfig =
		loadSetupConfig({
			repoPath: project.repoPath,
			projectId: project.id,
			worktreePath: workspace.worktreePath,
		})?.sandbox ?? {};
	const settings = resolveSandboxSettings(sandboxConfig);
	const configHash = computeConfigHash(settings);

	const cached = dockerRuntimes.get(workspaceId);
	if (cached && cached.configHash === configHash) return cached.runtime;

	const runtime = new DockerRuntime({
		workspaceId,
		worktreePath: workspace.worktreePath,
		repoPath: project.repoPath,
		branch: workspace.branch,
		settings,
	});
	dockerRuntimes.set(workspaceId, { configHash, runtime });
	return runtime;
}

/** Drop the cached runtime after a workspace is destroyed. */
export function evictWorkspaceRuntime(workspaceId: string): void {
	dockerRuntimes.delete(workspaceId);
}

/**
 * The sticky sandbox decision for a NEW workspace, resolved from the
 * project's sandbox config at create time and persisted on the row.
 */
export function resolveSandboxEnabledForNewWorkspace(
	db: HostDb,
	projectId: string,
	worktreePath: string,
): boolean {
	const project = db.query.projects
		.findFirst({ where: eq(projects.id, projectId) })
		.sync();
	if (!project) return false;
	const config = loadSetupConfig({
		repoPath: project.repoPath,
		projectId,
		worktreePath,
	});
	return config?.sandbox?.enabled === true;
}
