import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
	buildContainerCreateArgs,
	CONFIG_HASH_LABEL,
	LOCAL_SANDBOX_IMAGE,
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
	CONTAINER_HOME_DIR,
	CONTAINER_HOST_DIR,
	CONTAINER_SUPERSET_DIR,
	getSandboxContainerName,
	getWorkspaceSandboxPaths,
} from "./paths.ts";
import { selectPublishablePorts } from "./port-probe.ts";
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

/**
 * Host agent config mounted read-write so agents inside the sandbox reuse
 * host auth (and OAuth refreshes stay coherent both ways). Accepted v1
 * trade-off — documented in the sandbox config; per-workspace agent homes
 * with in-container login are the hardening follow-up.
 */
function buildAgentConfigMounts(): MountSpec[] {
	const home = homedir();
	return [".claude", ".claude.json", ".codex"]
		.map((entry) => join(home, entry))
		.filter((source) => existsSync(source))
		.map((source) => ({
			source,
			target: `${CONTAINER_HOME_DIR}/${basename(source)}`,
		}));
}

function buildWorkspaceMounts(
	params: EnsureContainerParams,
	cliTokenHostDir: string,
): MountSpec[] {
	const paths = getWorkspaceSandboxPaths(params.workspaceId);
	return [
		...(params.settings.mountAgentConfig ? buildAgentConfigMounts() : []),
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

export type SandboxProvisioningState = "provisioning" | "ready" | "error";

/**
 * In-memory container-provision state per workspace, surfaced on
 * WorkspaceSnapshot so the renderer can show "Initializing sandbox…" during
 * eager bootstrap. Not persisted: after a host restart the state is unknown
 * until the next ensure, which is exactly when it becomes interesting again.
 */
const provisioningStates = new Map<string, SandboxProvisioningState>();

export function getSandboxProvisioningState(
	workspaceId: string,
): SandboxProvisioningState | undefined {
	return provisioningStates.get(workspaceId);
}

/** Flag the workspace as provisioning before its ensure work is scheduled,
 * so a snapshot emitted in the same tick already shows the step. */
export function markSandboxProvisioning(workspaceId: string): void {
	if (provisioningStates.get(workspaceId) !== "ready") {
		provisioningStates.set(workspaceId, "provisioning");
	}
}

/**
 * Ensure the workspace's sandbox container exists and is running.
 * Single-flight per workspace: concurrent terminal opens (agent + setup
 * racing at workspace create) coalesce onto one ensure.
 */
export function ensureContainer(params: EnsureContainerParams): Promise<void> {
	const existing = ensureInFlight.get(params.workspaceId);
	if (existing) return existing;
	provisioningStates.set(params.workspaceId, "provisioning");
	const promise = doEnsureContainer(params)
		.then(() => {
			provisioningStates.set(params.workspaceId, "ready");
		})
		.catch((error) => {
			provisioningStates.set(params.workspaceId, "error");
			throw error;
		})
		.finally(() => {
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

	const portSelection = await selectPublishablePorts(params.settings.ports);
	if (portSelection.skipped.length > 0) {
		console.warn(
			`[sandbox] host port(s) ${portSelection.skipped.join(", ")} busy; ` +
				`not published for workspace ${params.workspaceId}`,
		);
	}

	if (!(await imageExists(params.settings.image))) {
		console.log(
			`[sandbox] pulling image ${params.settings.image} for workspace ${params.workspaceId}`,
		);
		try {
			await pullImage(params.settings.image);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const hint =
				params.settings.image === LOCAL_SANDBOX_IMAGE
					? " Build it locally: bun run --cwd packages/sandbox-image build:image"
					: " Set sandbox.image in .superset/config.json to a reachable image.";
			throw new SandboxError(
				`Failed to pull sandbox image ${params.settings.image}: ${message}.${hint}`,
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
			publishedPorts: portSelection.published,
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
	options?: {
		/**
		 * Keep the on-disk sandbox state (notably the isolated git dir).
		 * Set when exporting sandbox commits failed — deleting the git dir
		 * then would destroy the only copy of the agent's commits.
		 */
		preserveState?: boolean;
	},
): Promise<void> {
	dropHookToken(workspaceId);
	dropCliToken(workspaceId);
	provisioningStates.delete(workspaceId);
	const availability = await checkDockerAvailable();
	if (availability.ok) {
		await removeContainer(getSandboxContainerName(workspaceId));
	} else {
		console.warn(
			`[sandbox] docker unavailable during destroy of ${workspaceId}; ` +
				"container (if any) will be removed by the startup reconcile",
		);
	}
	if (options?.preserveState) return;
	await rm(getWorkspaceSandboxPaths(workspaceId).stateDir, {
		recursive: true,
		force: true,
	});
}
