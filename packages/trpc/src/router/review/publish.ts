import { renderReviewReportHtml } from "@superset/shared/review-report";
import { publishPage } from "../page/publish";
import type { PublishPageInput } from "../page/schema";
import { findLinkedPageId, linkReviewPage } from "./anchor";
import type { PublishReviewInput } from "./schema";

export async function publishReview({
	input,
	organizationId,
	userId,
}: {
	input: PublishReviewInput;
	organizationId: string;
	userId: string;
}) {
	// PR identity is the durable anchor: check it first so a review that also
	// carries a workspace/entryPath still versions the page the PR is already
	// linked to, rather than forking a second one.
	const existingPageId = input.githubPullRequestId
		? await findLinkedPageId(organizationId, input.githubPullRequestId)
		: null;

	const html = renderReviewReportHtml({
		title: input.title,
		repo: input.repo,
		prNumber: input.prNumber,
		prUrl: input.prUrl,
		branch: input.branch,
		commitSha: input.commitSha,
		effortLevel: input.effortLevel,
		generatedAt: new Date(),
		findings: input.findings,
		diff: input.diff,
	});

	const publishInput: PublishPageInput = {
		content: Buffer.from(html, "utf8").toString("base64"),
		contentType: "text/html",
		filename: "review.html",
		title: input.title,
		description: input.description,
		// Reviews default to org-wide: a review is meant to be seen by the team
		// as soon as it exists, unlike the narrowest-by-default rule generic
		// pages use.
		visibility: input.visibility ?? "org",
		...(existingPageId
			? { pageId: existingPageId }
			: {
					workspaceId: input.workspaceId,
					entryPath: input.entryPath,
				}),
	};

	const result = await publishPage({
		input: publishInput,
		organizationId,
		userId,
	});

	if (input.githubPullRequestId) {
		await linkReviewPage({
			organizationId,
			githubPullRequestId: input.githubPullRequestId,
			pageId: result.id,
		});
	}

	return result;
}
