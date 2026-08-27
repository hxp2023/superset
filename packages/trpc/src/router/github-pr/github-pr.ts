/**
 * Fetches a pull request's own description and diff straight from GitHub, for
 * viewing a PR that never went through an AI review — no Superset DB row for
 * the PR is required, only that it parses as a github.com PR link.
 */
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { db } from "@superset/db/client";
import { githubInstallations } from "@superset/db/schema";
import { parseGithubPullRequestUrl } from "@superset/shared/github-pr-url";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { env } from "../../env";
import { protectedProcedure } from "../../trpc";
import { requireActiveOrgMembership } from "../utils/active-org";
import { fetchGithubPrSchema } from "./schema";

export interface GithubPrComment {
	id: number;
	authorLogin: string;
	authorAvatarUrl: string | null;
	body: string;
	createdAt: string;
	htmlUrl: string;
}

export interface GithubPrContent {
	owner: string;
	repo: string;
	number: number;
	title: string;
	description: string | null;
	authorLogin: string;
	authorAvatarUrl: string | null;
	state: "open" | "closed";
	merged: boolean;
	isDraft: boolean;
	headBranch: string;
	baseBranch: string;
	htmlUrl: string;
	createdAt: string;
	updatedAt: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	/** Raw unified diff text. */
	diff: string;
	/** Top-level conversation comments, oldest first. Capped at 100. */
	comments: GithubPrComment[];
}

/** The subset of GitHub's PR API response this router actually reads. */
interface GithubApiPullRequest {
	title: string;
	body: string | null;
	user: { login: string; avatar_url: string | null } | null;
	state: string;
	merged?: boolean;
	merged_at?: string | null;
	draft?: boolean;
	head: { ref: string };
	base: { ref: string };
	html_url: string;
	created_at: string;
	updated_at: string;
	additions?: number;
	deletions?: number;
	changed_files?: number;
}

/** The subset of GitHub's issue-comment API response this router actually reads. */
interface GithubApiComment {
	id: number;
	body: string | null;
	user: { login: string; avatar_url: string | null } | null;
	created_at: string;
	html_url: string;
}

function toComment(comment: GithubApiComment): GithubPrComment {
	return {
		id: comment.id,
		authorLogin: comment.user?.login ?? "unknown",
		authorAvatarUrl: comment.user?.avatar_url ?? null,
		body: comment.body ?? "",
		createdAt: comment.created_at,
		htmlUrl: comment.html_url,
	};
}

function toContent(
	owner: string,
	repo: string,
	number: number,
	pr: GithubApiPullRequest,
	diff: string,
	comments: GithubApiComment[],
): GithubPrContent {
	return {
		owner,
		repo,
		number,
		title: pr.title,
		description: pr.body ?? null,
		authorLogin: pr.user?.login ?? "unknown",
		authorAvatarUrl: pr.user?.avatar_url ?? null,
		state: pr.state === "closed" ? "closed" : "open",
		merged: Boolean(pr.merged ?? pr.merged_at),
		isDraft: Boolean(pr.draft),
		headBranch: pr.head.ref,
		baseBranch: pr.base.ref,
		htmlUrl: pr.html_url,
		createdAt: pr.created_at,
		updatedAt: pr.updated_at,
		additions: pr.additions ?? 0,
		deletions: pr.deletions ?? 0,
		changedFiles: pr.changed_files ?? 0,
		diff,
		comments: comments.map(toComment),
	};
}

/**
 * Tries the calling org's own GitHub App installation. Installation tokens
 * only grant access to repos that installation actually covers — trying it
 * against an arbitrary owner/repo cannot leak another org's access, GitHub
 * just answers as if the repo doesn't exist. Any failure (no installation
 * row, repo not covered, installation suspended) falls through to the public
 * path rather than being surfaced directly, since "not accessible privately"
 * and "doesn't exist" look the same to this caller either way.
 */
async function fetchViaInstallation(
	organizationId: string,
	owner: string,
	repo: string,
	number: number,
): Promise<GithubPrContent | null> {
	if (!env.GH_APP_ID || !env.GH_APP_PRIVATE_KEY) return null;

	const installation = await db.query.githubInstallations.findFirst({
		where: eq(githubInstallations.organizationId, organizationId),
	});
	if (!installation) return null;

	try {
		const app = new App({
			appId: env.GH_APP_ID,
			privateKey: env.GH_APP_PRIVATE_KEY,
			Octokit,
		});
		const octokit = await app.getInstallationOctokit(
			Number(installation.installationId),
		);
		const [{ data: pr }, diffResponse, { data: comments }] = await Promise.all([
			octokit.rest.pulls.get({ owner, repo, pull_number: number }),
			octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
				owner,
				repo,
				pull_number: number,
				mediaType: { format: "diff" },
			}),
			// A PR *is* an issue in GitHub's API — comments live under /issues.
			octokit.rest.issues.listComments({
				owner,
				repo,
				issue_number: number,
				per_page: 100,
			}),
		]);
		return toContent(
			owner,
			repo,
			number,
			pr as unknown as GithubApiPullRequest,
			diffResponse.data as unknown as string,
			comments as unknown as GithubApiComment[],
		);
	} catch {
		return null;
	}
}

/** Unauthenticated GitHub REST — works only for public repos, 60 req/hr per IP. */
async function fetchPublic(
	owner: string,
	repo: string,
	number: number,
): Promise<GithubPrContent | null> {
	const base = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
	// A PR *is* an issue in GitHub's API — comments live under /issues, not /pulls.
	const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`;
	const [metaResponse, diffResponse, commentsResponse] = await Promise.all([
		fetch(base, { headers: { Accept: "application/vnd.github+json" } }),
		fetch(base, { headers: { Accept: "application/vnd.github.v3.diff" } }),
		fetch(commentsUrl, { headers: { Accept: "application/vnd.github+json" } }),
	]);
	if (metaResponse.status === 404) return null;
	if (!metaResponse.ok) {
		throw new TRPCError({
			code: "BAD_GATEWAY",
			message: `GitHub returned ${metaResponse.status} for this pull request`,
		});
	}
	const pr = (await metaResponse.json()) as GithubApiPullRequest;
	const diff = diffResponse.ok ? await diffResponse.text() : "";
	const comments = commentsResponse.ok
		? ((await commentsResponse.json()) as GithubApiComment[])
		: [];
	return toContent(owner, repo, number, pr, diff, comments);
}

export const githubPrRouter = {
	fetchByUrl: protectedProcedure
		.input(fetchGithubPrSchema)
		.query(async ({ ctx, input }): Promise<GithubPrContent> => {
			const organizationId = await requireActiveOrgMembership(ctx);

			// The schema's refine guarantees this parses.
			const pr = parseGithubPullRequestUrl(input.prUrl);
			if (!pr) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Not a valid GitHub pull request URL",
				});
			}

			const content =
				(await fetchViaInstallation(
					organizationId,
					pr.owner,
					pr.repo,
					pr.number,
				)) ?? (await fetchPublic(pr.owner, pr.repo, pr.number));

			if (!content) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"Pull request not found, or this organization doesn't have access to it",
				});
			}
			return content;
		}),
} satisfies TRPCRouterRecord;
