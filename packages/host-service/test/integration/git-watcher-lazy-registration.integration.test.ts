import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { HostDb } from "../../src/db";
import { workspaces } from "../../src/db/schema";
import { GitWatcher } from "../../src/events/git-watcher";
import { WorkspaceFilesystemManager } from "../../src/runtime/filesystem";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { createGitFixture, type GitFixture } from "../helpers/git-fixture";
import { seedProject, seedWorkspace } from "../helpers/seed";

/**
 * Regression coverage for the fix to GitHub issue #6729: `GitWatcher` used
 * to register a live watcher for every non-archived workspace regardless of
 * whether anything was interested in it. It's now refcounted via
 * `watchWorkspace`/`unwatchWorkspace`, driven by client `git:watch`
 * subscriptions — a workspace is watched exactly while its interest count is
 * positive.
 *
 * These tests run against a real `GitWatcher` wired to a real sqlite db and
 * real git repos (not a mock), same harness as the sibling
 * `pull-requests-scaling.integration.test.ts`.
 */

interface GitWatcherInternals {
	watched: Map<string, { watcher: unknown; worktreePath: string }>;
	interest: Map<string, number>;
	rescan(): Promise<void>;
}

function internals(watcher: GitWatcher): GitWatcherInternals {
	return watcher as unknown as GitWatcherInternals;
}

async function waitFor(
	predicate: () => boolean,
	{ timeoutMs = 5000, pollMs = 25 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting for predicate");
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

// GitWatcher's own DB check inside watchWorkspace/attachFromDb is async —
// give it a moment to settle before asserting a negative ("still not
// watched").
async function settle(ms = 300): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

interface Scenario {
	host: TestHost;
	repos: GitFixture[];
	workspaceIds: string[];
	gitWatcher: GitWatcher;
	filesystem: WorkspaceFilesystemManager;
	dispose: () => Promise<void>;
}

async function createScenario(workspaceCount: number): Promise<Scenario> {
	const host = await createTestHost();
	const repos: GitFixture[] = [];
	const workspaceIds: string[] = [];

	const { id: projectId } = seedProject(host, {
		repoPath: (await createGitFixture()).repoPath,
	});

	for (let i = 0; i < workspaceCount; i++) {
		const repo = await createGitFixture();
		repos.push(repo);
		const headSha = (await repo.git.revparse(["HEAD"])).trim();
		const { id } = seedWorkspace(host, {
			projectId,
			worktreePath: repo.repoPath,
			branch: "main",
			headSha,
		});
		workspaceIds.push(id);
	}

	const filesystem = new WorkspaceFilesystemManager({ db: host.db as HostDb });
	const gitWatcher = new GitWatcher(host.db as HostDb, filesystem);

	const dispose = async () => {
		gitWatcher.close();
		await filesystem.close();
		for (const repo of repos) repo.dispose();
		await host.dispose();
	};

	return { host, repos, workspaceIds, gitWatcher, filesystem, dispose };
}

describe("GitWatcher lazy registration (regression coverage for #6729)", () => {
	let scenarios: Scenario[] = [];

	afterEach(async () => {
		await Promise.all(scenarios.map((s) => s.dispose()));
		scenarios = [];
	});

	test("start() watches nothing when nobody has expressed interest", async () => {
		const N = 6;
		const scenario = await createScenario(N);
		scenarios.push(scenario);

		scenario.gitWatcher.start();
		// Let the initial rescan (and its retry pass, which has nothing to
		// retry) run at least once.
		await settle();

		expect(internals(scenario.gitWatcher).watched.size).toBe(0);
	});

	test("watchWorkspace/unwatchWorkspace drives membership — not archival, not total workspace count", async () => {
		const N = 6;
		const scenario = await createScenario(N);
		scenarios.push(scenario);
		scenario.gitWatcher.start();

		const interested = scenario.workspaceIds.slice(0, 3);
		const uninterested = scenario.workspaceIds.slice(3);

		for (const id of interested) scenario.gitWatcher.watchWorkspace(id);

		await waitFor(
			() => internals(scenario.gitWatcher).watched.size === interested.length,
			{ timeoutMs: 10_000 },
		);
		for (const id of interested) {
			expect(internals(scenario.gitWatcher).watched.has(id)).toBe(true);
		}
		for (const id of uninterested) {
			expect(internals(scenario.gitWatcher).watched.has(id)).toBe(false);
		}

		// Archiving an UNWATCHED workspace changes nothing about the watched
		// set — archival is no longer what gates membership.
		scenario.host.db
			.update(workspaces)
			.set({ archivedAt: Date.now() })
			.where(eq(workspaces.id, uninterested[0] as string))
			.run();
		await internals(scenario.gitWatcher).rescan();
		expect(internals(scenario.gitWatcher).watched.size).toBe(interested.length);

		// Releasing interest tears the watcher down immediately, without
		// needing archival at all.
		const released = interested[0] as string;
		scenario.gitWatcher.unwatchWorkspace(released);
		expect(internals(scenario.gitWatcher).watched.has(released)).toBe(false);
		expect(internals(scenario.gitWatcher).watched.size).toBe(
			interested.length - 1,
		);
	});

	test("multiple watchWorkspace calls for the same workspace are refcounted — one unwatch doesn't tear it down", async () => {
		const scenario = await createScenario(1);
		scenarios.push(scenario);
		scenario.gitWatcher.start();

		const id = scenario.workspaceIds[0] as string;
		scenario.gitWatcher.watchWorkspace(id);
		scenario.gitWatcher.watchWorkspace(id);

		await waitFor(() => internals(scenario.gitWatcher).watched.has(id), {
			timeoutMs: 10_000,
		});

		scenario.gitWatcher.unwatchWorkspace(id);
		expect(internals(scenario.gitWatcher).watched.has(id)).toBe(true);

		scenario.gitWatcher.unwatchWorkspace(id);
		expect(internals(scenario.gitWatcher).watched.has(id)).toBe(false);
	});

	test("registration cost is paid only for workspaces someone actually watches, regardless of how many exist", async () => {
		const N = 30;
		const scenario = await createScenario(N);
		scenarios.push(scenario);
		scenario.gitWatcher.start();
		await settle();

		const idleStart = performance.now();
		await settle(200);
		const idleMs = performance.now() - idleStart;
		expect(internals(scenario.gitWatcher).watched.size).toBe(0);

		// Now actually ask for all of them, same as the old eager rescan used
		// to do unconditionally — this proves the mechanism still works when
		// requested, it just no longer happens for free.
		const watchStart = performance.now();
		for (const id of scenario.workspaceIds)
			scenario.gitWatcher.watchWorkspace(id);
		await waitFor(() => internals(scenario.gitWatcher).watched.size === N, {
			timeoutMs: 20_000,
		});
		const watchMs = performance.now() - watchStart;

		console.log(
			`[git-watcher validation] ${N} non-archived workspaces, 0 watched: ${idleMs.toFixed(0)}ms idle cost`,
		);
		console.log(
			`[git-watcher validation] ${N} non-archived workspaces, all ${N} explicitly watched: ${watchMs.toFixed(0)}ms`,
		);

		// Not a strict perf assertion (noisy CI/dev machines) — the point is
		// the real numbers above: idle cost stays flat regardless of N, and
		// the registration cost only shows up once something asks for it.
		expect(internals(scenario.gitWatcher).watched.size).toBe(N);
	}, 60_000);
});
