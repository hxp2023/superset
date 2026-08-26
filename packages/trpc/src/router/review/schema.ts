import { z } from "zod";
import { pageFields } from "../page/schema";

export const reviewFindingSchema = z.object({
	file: z.string().min(1),
	line: z.number().int().positive().optional(),
	category: z.string().max(60).optional(),
	summary: z.string().min(1),
	shortSummary: z.string().max(200).optional(),
	failureScenario: z.string().min(1),
	verdict: z.enum(["CONFIRMED", "PLAUSIBLE"]).optional(),
});

const publishReviewFieldsSchema = z.object({
	githubPullRequestId: z.string().uuid().optional(),
	workspaceId: pageFields.workspaceId.optional(),
	entryPath: pageFields.entryPath.optional(),
	title: pageFields.title,
	description: pageFields.description.optional(),
	repo: z.string().max(200).optional(),
	prNumber: z.number().int().positive().optional(),
	prUrl: z.string().url().optional(),
	branch: z.string().max(200).optional(),
	commitSha: z.string().max(64).optional(),
	effortLevel: z.string().max(40).optional(),
	visibility: pageFields.visibility.optional(),
	findings: z.array(reviewFindingSchema),
	diff: z.string().max(2_000_000).optional(),
});

/**
 * A review publish must name either the PR it belongs to or the workspace/path
 * it was published from — without one of those, nothing can find this review
 * again to add a version rather than mint a duplicate page.
 */
export const hasReviewAnchor = (value: {
	githubPullRequestId?: string | undefined;
	workspaceId?: string | undefined;
	entryPath?: string | undefined;
}) =>
	Boolean(value.githubPullRequestId) ||
	Boolean(value.workspaceId && value.entryPath);

export const REVIEW_ANCHOR_MESSAGE = {
	message:
		"A review publish must name where it belongs: pass githubPullRequestId, or workspaceId and entryPath",
	path: ["githubPullRequestId"],
};

export const publishReviewSchema = publishReviewFieldsSchema.refine(
	hasReviewAnchor,
	REVIEW_ANCHOR_MESSAGE,
);

export type PublishReviewInput = z.infer<typeof publishReviewSchema>;

export const getReviewForPullRequestSchema = z.object({
	githubPullRequestId: z.string().uuid(),
});
