import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { actionRejectionError } from "../../github/github";
import { resolveGithubRepo } from "../../workspace-creation/shared/project-helpers";

const createReviewCommentInputSchema = z.object({
	projectId: z.string(),
	prNumber: z.number().int().positive(),
	path: z.string(),
	line: z.number().int().positive(),
	side: z.enum(["LEFT", "RIGHT"]),
	body: z.string().trim().min(1),
});

export const createReviewComment = protectedProcedure
	.input(createReviewCommentInputSchema)
	.mutation(async ({ ctx, input }) => {
		const repo = await resolveGithubRepo(ctx, input.projectId);
		const octokit = await ctx.github();
		try {
			// createReviewComment requires the PR's current head sha, which none
			// of this tab's other procedures (getDiff/getThreads) fetch — pull it
			// fresh rather than trust a value the caller might have cached from
			// an earlier, now-stale head.
			const pr = await octokit.pulls.get({
				owner: repo.owner,
				repo: repo.name,
				pull_number: input.prNumber,
			});
			const { data } = await octokit.pulls.createReviewComment({
				owner: repo.owner,
				repo: repo.name,
				pull_number: input.prNumber,
				commit_id: pr.data.head.sha,
				path: input.path,
				line: input.line,
				side: input.side,
				body: input.body,
			});
			return { id: data.id };
		} catch (error) {
			throw actionRejectionError(error, "GitHub refused the comment.");
		}
	});
