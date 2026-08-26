import { db } from "@superset/db/client";
import {
	githubPullRequests,
	pages,
	pageVersions,
	reviewPages,
} from "@superset/db/schema";
import { TRPCError } from "@trpc/server";
import { del } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

/**
 * The `github_pull_requests` FK only requires the row to exist, not that it
 * belongs to the caller's org — without this check, an org could link a
 * review page to a PR row that actually belongs to a different org.
 */
export async function assertPullRequestInOrg(
	organizationId: string,
	githubPullRequestId: string,
): Promise<void> {
	const [row] = await db
		.select({ id: githubPullRequests.id })
		.from(githubPullRequests)
		.where(
			and(
				eq(githubPullRequests.id, githubPullRequestId),
				eq(githubPullRequests.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Pull request not found",
		});
	}
}

export async function findLinkedPageId(
	organizationId: string,
	githubPullRequestId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ pageId: reviewPages.pageId })
		.from(reviewPages)
		.where(
			and(
				eq(reviewPages.organizationId, organizationId),
				eq(reviewPages.githubPullRequestId, githubPullRequestId),
			),
		)
		.limit(1);
	return row?.pageId ?? null;
}

// Cleans up a page this call just created but lost the race to link — the
// alternative is a permanent orphaned, org-visible page with a wasted blob
// upload sitting around forever. Doesn't prevent the race itself (that would
// need a lock spanning publishPage's own transaction), just bounds the harm.
async function deleteOrphanedPage(pageId: string): Promise<void> {
	const rows = await db
		.select({ blobPathname: pageVersions.blobPathname })
		.from(pageVersions)
		.where(eq(pageVersions.pageId, pageId));

	await db.delete(pages).where(eq(pages.id, pageId));

	const pathnames = rows.map((row) => row.blobPathname);
	if (pathnames.length > 0) {
		try {
			await del(pathnames);
		} catch (error) {
			console.error("[reviews] blob cleanup failed after orphan delete", {
				pageId,
				pathnames,
				error,
			});
		}
	}
}

// A no-op if this PR is already linked to `pageId` (the common re-review
// case); a genuine conflict only if it is linked to some other page — which
// `findLinkedPageId` should have caught before `publishPage` ran, so this is
// just the race between that read and this write.
export async function linkReviewPage({
	organizationId,
	githubPullRequestId,
	pageId,
}: {
	organizationId: string;
	githubPullRequestId: string;
	pageId: string;
}): Promise<void> {
	const [inserted] = await db
		.insert(reviewPages)
		.values({ organizationId, githubPullRequestId, pageId })
		.onConflictDoNothing({
			target: [reviewPages.organizationId, reviewPages.githubPullRequestId],
		})
		.returning();
	if (inserted) return;

	const existing = await findLinkedPageId(organizationId, githubPullRequestId);
	if (existing !== pageId) {
		await deleteOrphanedPage(pageId);
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Someone else has already published a review for this PR — retry to add a version to theirs.",
		});
	}
}
