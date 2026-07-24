import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import { pullRequests } from "../../db/schema";
import {
	deletePullRequestIfOrphaned,
	ORPHANED_PULL_REQUEST_GRACE_MS,
	pruneOrphanedPullRequests,
} from "./prune-orphaned";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../../drizzle");
const PROJECT_ID = "project-1";
const NOW = 1_750_000_000_000;
const STALE = NOW - ORPHANED_PULL_REQUEST_GRACE_MS - 1;

function createRealDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function seedProject(db: HostDb) {
	db.insert(schema.projects)
		.values({ id: PROJECT_ID, repoPath: "/repo", createdAt: NOW })
		.run();
}

function seedPullRequest(
	db: HostDb,
	pr: { id: string; prNumber: number; updatedAt: number },
) {
	db.insert(schema.pullRequests)
		.values({
			id: pr.id,
			projectId: PROJECT_ID,
			repoProvider: "github",
			repoOwner: "owner",
			repoName: "repo",
			prNumber: pr.prNumber,
			url: `https://github.com/owner/repo/pull/${pr.prNumber}`,
			title: `PR ${pr.prNumber}`,
			state: "open",
			headBranch: `branch-${pr.prNumber}`,
			headSha: "a".repeat(40),
			createdAt: pr.updatedAt,
			updatedAt: pr.updatedAt,
		})
		.run();
}

function seedWorkspace(
	db: HostDb,
	w: { id: string; pullRequestId?: string | null },
) {
	db.insert(schema.workspaces)
		.values({
			id: w.id,
			projectId: PROJECT_ID,
			worktreePath: `/repo/.worktrees/${w.id}`,
			branch: w.id,
			createdAt: NOW,
			pullRequestId: w.pullRequestId ?? null,
		})
		.run();
}

function prIds(db: HostDb): string[] {
	return db
		.select({ id: pullRequests.id })
		.from(pullRequests)
		.all()
		.map((row) => row.id)
		.sort();
}

describe("pruneOrphanedPullRequests", () => {
	test("deletes stale unreferenced rows, keeps linked and fresh rows", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, { id: "pr-orphan", prNumber: 1, updatedAt: STALE });
		seedPullRequest(db, { id: "pr-linked", prNumber: 2, updatedAt: STALE });
		// Fresh row simulates an upsert whose link assignment hasn't landed yet.
		seedPullRequest(db, { id: "pr-fresh", prNumber: 3, updatedAt: NOW });
		seedWorkspace(db, { id: "ws", pullRequestId: "pr-linked" });

		expect(pruneOrphanedPullRequests(db, NOW)).toBe(1);
		expect(prIds(db)).toEqual(["pr-fresh", "pr-linked"]);
	});

	test("returns 0 and deletes nothing when every row is referenced", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, { id: "pr-1", prNumber: 1, updatedAt: STALE });
		seedWorkspace(db, { id: "ws-a", pullRequestId: "pr-1" });
		seedWorkspace(db, { id: "ws-b", pullRequestId: "pr-1" });

		expect(pruneOrphanedPullRequests(db, NOW)).toBe(0);
		expect(prIds(db)).toEqual(["pr-1"]);
	});
});

describe("deletePullRequestIfOrphaned", () => {
	test("deletes an unreferenced row regardless of freshness", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, { id: "pr-1", prNumber: 1, updatedAt: NOW });

		expect(deletePullRequestIfOrphaned(db, "pr-1")).toBe(true);
		expect(prIds(db)).toEqual([]);
	});

	test("keeps a row another workspace still links to", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, { id: "pr-1", prNumber: 1, updatedAt: STALE });
		seedWorkspace(db, { id: "ws-other", pullRequestId: "pr-1" });

		expect(deletePullRequestIfOrphaned(db, "pr-1")).toBe(false);
		expect(
			db.select().from(pullRequests).where(eq(pullRequests.id, "pr-1")).get(),
		).toBeDefined();
	});
});
