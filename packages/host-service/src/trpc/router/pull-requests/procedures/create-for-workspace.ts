import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { workspaces } from "../../../../db/schema";
import { protectedProcedure } from "../../../index";
import { getDefaultBranchName } from "../../git/utils/git-helpers";
import { resolveWorktreePath } from "../../git/utils/resolve-worktree";
import { actionRejectionError } from "../../github/github";
import { resolveGithubRepo } from "../../workspace-creation/shared/project-helpers";

const createInputSchema = z.object({
	workspaceId: z.string(),
	title: z.string().trim().min(1),
	body: z.string().optional(),
	draft: z.boolean().default(false),
});

/**
 * Creates a GitHub PR from the workspace's current branch. The base is the
 * branch's configured `branch.<name>.base` (what the Changes panel's base
 * selector writes) falling back to the repo default branch. After creation
 * the workspace's PR link is refreshed immediately so the UI doesn't wait
 * out the next background sync tick.
 */
export const createForWorkspace = protectedProcedure
	.input(createInputSchema)
	.mutation(async ({ ctx, input }) => {
		const workspace = ctx.db.query.workspaces
			.findFirst({ where: eq(workspaces.id, input.workspaceId) })
			.sync();
		if (!workspace?.projectId) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"Workspace has no linked project, so there is no repository to open a pull request on",
			});
		}
		const worktreePath = resolveWorktreePath(ctx, input.workspaceId);
		const git = await ctx.git(worktreePath);

		const head = (
			await git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "")
		).trim();
		if (!head || head === "HEAD") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Cannot create a pull request from a detached HEAD",
			});
		}

		const configuredBase = (
			await git.raw(["config", `branch.${head}.base`]).catch(() => "")
		).trim();
		const base = (configuredBase || (await getDefaultBranchName(git)) || "")
			.replace(/^origin\//, "")
			.trim();
		if (!base) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Could not determine a base branch for the pull request",
			});
		}
		if (base === head) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Branch ${head} is the base branch — nothing to open a pull request from`,
			});
		}

		const repo = await resolveGithubRepo(ctx, workspace.projectId);
		const octokit = await ctx.github();
		try {
			const { data } = await octokit.pulls.create({
				owner: repo.owner,
				repo: repo.name,
				title: input.title,
				head,
				base,
				draft: input.draft,
				...(input.body ? { body: input.body } : {}),
			});
			await ctx.runtime.pullRequests.refreshPullRequestsByWorkspaces([
				input.workspaceId,
			]);
			return { number: data.number, url: data.html_url };
		} catch (error) {
			throw actionRejectionError(
				error,
				"GitHub refused to create the pull request.",
			);
		}
	});
