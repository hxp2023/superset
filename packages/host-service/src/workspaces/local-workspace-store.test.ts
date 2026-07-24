import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { pullRequests, workspaces } from "../db/schema";
import type { EventBus } from "../events";
import {
	deleteLocalWorkspace,
	type WorkspaceStoreContext,
} from "./local-workspace-store";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");
const PROJECT_ID = "project-1";

function createRealDb(): HostDb {
	const sqlite = new Database(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON;");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db as unknown as HostDb;
}

function makeCtx(db: HostDb): WorkspaceStoreContext {
	return {
		db,
		eventBus: { broadcastWorkspaceChanged: () => {} } as unknown as EventBus,
	};
}

function seedProject(db: HostDb) {
	db.insert(schema.projects)
		.values({ id: PROJECT_ID, repoPath: "/repo", createdAt: Date.now() })
		.run();
}

function seedPullRequest(db: HostDb, id: string, prNumber: number) {
	db.insert(schema.pullRequests)
		.values({
			id,
			projectId: PROJECT_ID,
			repoProvider: "github",
			repoOwner: "owner",
			repoName: "repo",
			prNumber,
			url: `https://github.com/owner/repo/pull/${prNumber}`,
			title: `PR ${prNumber}`,
			state: "open",
			headBranch: `branch-${prNumber}`,
			headSha: "a".repeat(40),
			createdAt: Date.now(),
			updatedAt: Date.now(),
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
			createdAt: Date.now(),
			pullRequestId: w.pullRequestId ?? null,
		})
		.run();
}

function getPr(db: HostDb, id: string) {
	return db.select().from(pullRequests).where(eq(pullRequests.id, id)).get();
}

describe("deleteLocalWorkspace pull-request cleanup", () => {
	test("deletes the linked PR row along with its last workspace", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, "pr-1", 1);
		seedWorkspace(db, { id: "ws", pullRequestId: "pr-1" });

		deleteLocalWorkspace(makeCtx(db), "ws");

		expect(
			db.select().from(workspaces).where(eq(workspaces.id, "ws")).get(),
		).toBeUndefined();
		expect(getPr(db, "pr-1")).toBeUndefined();
	});

	test("keeps the PR row while another workspace still links to it", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, "pr-1", 1);
		seedWorkspace(db, { id: "ws-a", pullRequestId: "pr-1" });
		seedWorkspace(db, { id: "ws-b", pullRequestId: "pr-1" });

		deleteLocalWorkspace(makeCtx(db), "ws-a");

		expect(getPr(db, "pr-1")).toBeDefined();

		deleteLocalWorkspace(makeCtx(db), "ws-b");

		expect(getPr(db, "pr-1")).toBeUndefined();
	});

	test("is a no-op for workspaces without a PR link", () => {
		const db = createRealDb();
		seedProject(db);
		seedPullRequest(db, "pr-unrelated", 1);
		seedWorkspace(db, { id: "ws" });

		deleteLocalWorkspace(makeCtx(db), "ws");

		expect(getPr(db, "pr-unrelated")).toBeDefined();
	});
});
