import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import {
	buildContainerCreateArgs,
	CONFIG_HASH_LABEL,
	type MountSpec,
	type ResolvedSandboxSettings,
} from "./docker-args.ts";
import {
	checkDockerAvailable,
	createContainer,
	imageExists,
	inspectContainer,
	pullImage,
	removeContainer,
	startContainer,
} from "./docker-cli.ts";
import { ensureSandboxGit } from "./git-bootstrap.ts";
import {
	CONTAINER_GIT_DIR,
	CONTAINER_HOST_DIR,
	CONTAINER_SUPERSET_DIR,
	getSandboxContainerName,
	getWorkspaceSandboxPaths,
} from "./paths.ts";
import { dropCliToken, ensureCliTokenFile } from "./sandbox-cli-tokens.ts";
import { ensureSandboxHome } from "./sandbox-home.ts";
import { dropHookToken } from "./sandbox-tokens.ts";

/** Thrown for user-actionable sandbox failures (docker down, pull failed). */
export class SandboxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SandboxError";
	}
}

export interface EnsureContainerParams {
	workspaceId: string;
	worktreePath: string;
	repoPath: string;
	branch: string;
	settings: ResolvedSandboxSettings;
}

export function computeConfigHash(settings: ResolvedSandboxSettings): string {
	return createHash("sha256")
		.update(JSON.stringify(settings))
		.digest("hex")
		.slice(0, 16);
}

function buildWorkspaceMounts(
	params: EnsureContainerParams,
	cliTokenHostDir: string,
): MountSpec[] {
	const paths = getWorkspaceSandboxPaths(params.workspaceId);
	return [
		// Per-workspace CLI token for the bundled `superset` binary. Not
		// nested under the read-only /opt/superset mount — docker can't
		// create a mountpoint inside a read-only bind mount.
		{
			source: cliTokenHostDir,
			target: CONTAINER_HOST_DIR,
			readOnly: true,
		},
		// Worktree at its host path — path identity keeps host-side git,
		// search, and diff working against the same absolute paths.
		{ source: params.worktreePath, target: params.worktreePath },
		{
			source: ensureSandboxHome(),
			target: CONTAINER_SUPERSET_DIR,
			readOnly: true,
		},
		{ source: paths.gitDir, target: CONTAINER_GIT_DIR },
		// File-over-file mask: hides the worktree's real .git pointer (which
		// targets the unmounted main repo) behind the sandbox git dir path.
		{
			source: paths.dotGitFile,
			target: `${params.worktreePath}/.git`,
			readOnly: true,
		},
		...params.settings.extraMounts,
	];
}

const ensureInFlight = new Map<string, Promise<void>>();

/**
 * Ensure the workspace's sandbox container exists and is running.
 * Single-flight per workspace: concurrent terminal opens (agent + setup
 * racing at workspace create) coalesce onto one ensure.
 */
export function ensureContainer(params: EnsureContainerParams): Promise<void> {
	const existing = ensureInFlight.get(params.workspaceId);
	if (existing) return existing;
	const promise = doEnsureContainer(params).finally(() => {
		ensureInFlight.delete(params.workspaceId);
	});
	ensureInFlight.set(params.workspaceId, promise);
	return promise;
}

async function doEnsureContainer(params: EnsureContainerParams): Promise<void> {
	const availability = await checkDockerAvailable();
	if (!availability.ok) {
		throw new SandboxError(
			`Workspace sandbox unavailable: ${availability.error}`,
		);
	}

	await ensureSandboxGit({
		workspaceId: params.workspaceId,
		repoPath: params.repoPath,
		branch: params.branch,
		worktreePath: params.worktreePath,
		cloneDepth: params.settings.cloneDepth,
	});
	// Also re-registers the token in-memory after host-service restarts.
	const cliToken = await ensureCliTokenFile(params.workspaceId);

	const name = getSandboxContainerName(params.workspaceId);
	const configHash = computeConfigHash(params.settings);
	const inspection = await inspectContainer(name);

	if (inspection.exists) {
		const staleConfig = inspection.labels[CONFIG_HASH_LABEL] !== configHash;
		if (inspection.running && !staleConfig) return;
		if (!inspection.running && staleConfig) {
			// Stopped + outdated: recreate. A RUNNING container with stale
			// config keeps serving — never kill live terminals implicitly.
			await removeContainer(name);
		} else {
			await startContainer(name);
			return;
		}
	}

	if (!(await imageExists(params.settings.image))) {
		console.log(
			`[sandbox] pulling image ${params.settings.image} for workspace ${params.workspaceId}`,
		);
		try {
			await pullImage(params.settings.image);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new SandboxError(
				`Failed to pull sandbox image ${params.settings.image}: ${message}`,
			);
		}
	}

	await createContainer(
		buildContainerCreateArgs({
			name,
			workspaceId: params.workspaceId,
			configHash,
			image: params.settings.image,
			runtime: params.settings.runtime,
			network: params.settings.network,
			resources: params.settings.resources,
			mounts: buildWorkspaceMounts(params, cliToken.hostDir),
		}),
	);
	await startContainer(name);
	console.log(
		`[sandbox] container ${name} running (image ${params.settings.image})`,
	);
}

/** Remove the workspace's container, tokens, and host-side sandbox state. */
export async function destroyWorkspaceSandbox(
	workspaceId: string,
): Promise<void> {
	dropHookToken(workspaceId);
	dropCliToken(workspaceId);
	const availability = await checkDockerAvailable();
	if (availability.ok) {
		await removeContainer(getSandboxContainerName(workspaceId));
	} else {
		console.warn(
			`[sandbox] docker unavailable during destroy of ${workspaceId}; ` +
				"container (if any) will be removed by the startup reconcile",
		);
	}
	await rm(getWorkspaceSandboxPaths(workspaceId).stateDir, {
		recursive: true,
		force: true,
	});
}
