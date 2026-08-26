import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pageFields } from "@superset/trpc/page-schema";
import {
	hasReviewAnchor,
	REVIEW_ANCHOR_MESSAGE,
} from "@superset/trpc/review-schema";
import { z } from "zod";
import { createMcpCaller } from "../../caller";
import { defineTool } from "../../define-tool";
import { optionalish } from "../../optionalish";

// Field names are camelCase to match every other tool in this file (pageFields
// etc.) — the `--share` integration on the `/code-review` side is expected to
// map from ReportFindings' snake_case shape (file, failure_scenario,
// short_summary, verdict) onto this one.
const reviewFindingInputSchema = z.object({
	file: z
		.string()
		.min(1)
		.describe("Repo-relative path of the file the finding is in."),
	line: optionalish(z.number().int().positive()).describe(
		"1-indexed line the finding anchors to.",
	),
	category: optionalish(z.string().max(60)).describe(
		'Short kebab-case slug of the finding type, e.g. "correctness".',
	),
	summary: z.string().min(1).describe("One-sentence statement of the defect."),
	shortSummary: optionalish(z.string().max(200)).describe(
		"Compressed label for compact UI (≤60 chars).",
	),
	failureScenario: z
		.string()
		.min(1)
		.describe("Concrete inputs/state → wrong output/crash."),
	verdict: optionalish(z.enum(["CONFIRMED", "PLAUSIBLE"])).describe(
		"Set when a verify pass ran.",
	),
});

export function register(server: McpServer): void {
	defineTool(server, {
		name: "reviews_publish",
		annotations: { destructiveHint: false },
		description:
			"Publish a code review's findings as a shareable page and return its public URL. Builds on the same Pages infrastructure as `pages_publish` — read that tool's description for the underlying constraints (self-contained HTML rendering, no external requests). Unlike a generic page, a review defaults to `org` visibility, not `just_me`: a review is meant to be seen by the team as soon as it exists. Anchor the review so a later re-review of the same PR adds a version instead of minting a duplicate page: pass `githubPullRequestId` whenever the review is of a real GitHub PR — this is the anchor that lets a standalone re-review find the same page even with no workspace — or `workspaceId` + `entryPath` when there is no PR row to anchor to. Passing both is fine and recommended when available.",
		inputSchema: z
			.object({
				githubPullRequestId: optionalish(z.string().uuid()).describe(
					"The PR this review is for. Preferred anchor — lets re-reviewing the same PR from anywhere add a version to the same page.",
				),
				workspaceId: optionalish(pageFields.workspaceId).describe(
					"The workspace this review ran in, if any. Get it from the SUPERSET_WORKSPACE_ID environment variable, or `superset workspaces list`.",
				),
				entryPath: optionalish(pageFields.entryPath).describe(
					"Where this review lives in the workspace, e.g. `.superset/review.html`. Required alongside workspaceId when githubPullRequestId is not given.",
				),
				title: pageFields.title.describe("Review title, e.g. the PR title."),
				description: optionalish(pageFields.description),
				repo: optionalish(z.string().max(200)).describe(
					"`owner/repo`, used to link each finding's file:line to its GitHub blob.",
				),
				prNumber: optionalish(z.number().int().positive()),
				prUrl: optionalish(z.string().url()),
				branch: optionalish(z.string().max(200)),
				commitSha: optionalish(z.string().max(64)).describe(
					"Commit the review ran against. Required alongside `repo` to link findings to GitHub.",
				),
				effortLevel: optionalish(z.string().max(40)).describe(
					"e.g. `low`, `high`, `ultra`.",
				),
				visibility: optionalish(pageFields.visibility).describe(
					"`org` (default) lets anyone in the organization open it; `just_me` keeps it private to the publisher.",
				),
				findings: z.array(reviewFindingInputSchema),
				diff: optionalish(z.string().max(2_000_000)).describe(
					"Raw unified diff text, e.g. the output of `gh pr diff <n>`. When given, the published page gets a Code tab alongside Summary, matching the app's own PR view.",
				),
			})
			.refine(hasReviewAnchor, REVIEW_ANCHOR_MESSAGE),
		handler: async (input, ctx) => {
			const caller = createMcpCaller(ctx);
			return caller.review.publish(input);
		},
	});
}
