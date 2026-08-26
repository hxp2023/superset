import { db } from "@superset/db/client";
import { reviewPages } from "@superset/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

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
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Someone else has already published a review for this PR — retry to add a version to theirs.",
		});
	}
}
