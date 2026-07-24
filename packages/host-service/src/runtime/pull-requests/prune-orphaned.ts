import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { HostDb } from "../../db";
import { pullRequests, workspaces } from "../../db/schema";

/**
 * `pull_requests` rows are only reachable through `workspaces.pullRequestId`
 * links — once nothing references a row it can never surface again, but until
 * these helpers existed nothing deleted it either, so every PR ever opened
 * from a local workspace accumulated in host.db forever.
 */

// Refresh upserts a PR row before link assignment, and the two can sit on
// opposite sides of an await boundary — a sweep firing in that gap would see
// the fresh row as unreferenced. Every upsert bumps `updatedAt`, so skipping
// recently-touched rows closes the race.
export const ORPHANED_PULL_REQUEST_GRACE_MS = 60_000;

/**
 * Delete every pull-request row no workspace references anymore, except rows
 * touched within the grace window. Returns the number of rows deleted.
 */
export function pruneOrphanedPullRequests(
	db: HostDb,
	now = Date.now(),
): number {
	const orphaned = db
		.select({ id: pullRequests.id })
		.from(pullRequests)
		.leftJoin(workspaces, eq(workspaces.pullRequestId, pullRequests.id))
		.where(
			and(
				isNull(workspaces.id),
				lt(pullRequests.updatedAt, now - ORPHANED_PULL_REQUEST_GRACE_MS),
			),
		)
		.all();
	if (orphaned.length === 0) return 0;

	db.delete(pullRequests)
		.where(
			inArray(
				pullRequests.id,
				orphaned.map((row) => row.id),
			),
		)
		.run();
	return orphaned.length;
}

/**
 * Targeted variant for workspace deletion: drop one PR row immediately —
 * no grace window, the caller just severed the only suspect link — unless
 * another workspace still references it (same branch checked out twice).
 * Returns whether the row was deleted.
 */
export function deletePullRequestIfOrphaned(
	db: HostDb,
	pullRequestId: string,
): boolean {
	const stillLinked = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(eq(workspaces.pullRequestId, pullRequestId))
		.get();
	if (stillLinked) return false;

	db.delete(pullRequests).where(eq(pullRequests.id, pullRequestId)).run();
	return true;
}
