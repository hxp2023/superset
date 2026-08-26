import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const blobStore = new Map<string, Buffer>();
let putCalls = 0;
mock.module("@vercel/blob", () => ({
	put: async (pathname: string, body: Buffer, _opts: unknown) => {
		putCalls += 1;
		const stored = `${pathname}-${putCalls}`;
		blobStore.set(stored, body);
		return { pathname: stored, url: `https://blob.test/${stored}` };
	},
	head: async (pathname: string) => {
		if (!blobStore.has(pathname)) throw new Error("blob not found");
		return { url: `https://blob.test/${pathname}`, pathname };
	},
	del: async () => {},
}));

const { db, dbWs } = await import("@superset/db/client");
const {
	githubInstallations,
	githubPullRequests,
	githubRepositories,
	members,
	organizations,
	pageVersions,
	reviewPages,
	users,
	workspacePages,
} = await import("@superset/db/schema");
const { eq } = await import("drizzle-orm");
const { publishReview } = await import("./publish");

const ORG = crypto.randomUUID();
const USER = crypto.randomUUID();
const OTHER_USER = crypto.randomUUID();
const WORKSPACE = crypto.randomUUID();
const suffix = Date.now();

const findings = [
	{
		file: "a.ts",
		line: 1,
		summary: "issue",
		failureScenario: "n/a",
		verdict: "CONFIRMED" as const,
	},
];

const publish = (input: Record<string, unknown>) =>
	publishReview({
		input: {
			title: "Test Review",
			findings,
			...input,
		} as never,
		organizationId: ORG,
		userId: USER,
	});

let repositoryId: string;

async function makePullRequest(prNumber: number) {
	const [pr] = await db
		.insert(githubPullRequests)
		.values({
			repositoryId,
			organizationId: ORG,
			prNumber,
			nodeId: `node-${suffix}-${prNumber}`,
			headBranch: "feature",
			headSha: "abc1234",
			baseBranch: "main",
			title: "Add feature",
			url: `https://github.com/superset-sh/superset/pull/${prNumber}`,
			authorLogin: "octocat",
			state: "open",
		})
		.returning();
	if (!pr) throw new Error("failed to insert pull request");
	return pr;
}

beforeAll(async () => {
	await db.insert(organizations).values({
		id: ORG,
		name: "Test Org",
		slug: `test-org-review-${suffix}`,
	});
	await db.insert(users).values([
		{
			id: USER,
			name: "Test User",
			email: `test-review-${suffix}@example.com`,
			organizationIds: [ORG],
		},
		{
			id: OTHER_USER,
			name: "Other Member",
			email: `other-review-${suffix}@example.com`,
			organizationIds: [ORG],
		},
	]);
	await db.insert(members).values([
		{
			id: crypto.randomUUID(),
			organizationId: ORG,
			userId: USER,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: crypto.randomUUID(),
			organizationId: ORG,
			userId: OTHER_USER,
			role: "member",
			createdAt: new Date(),
		},
	]);

	const [installation] = await db
		.insert(githubInstallations)
		.values({
			organizationId: ORG,
			connectedByUserId: USER,
			installationId: `install-${suffix}`,
			accountLogin: "superset-sh",
			accountType: "Organization",
		})
		.returning();
	if (!installation) throw new Error("failed to insert installation");

	const [repository] = await db
		.insert(githubRepositories)
		.values({
			installationId: installation.id,
			organizationId: ORG,
			repoId: `repo-${suffix}`,
			owner: "superset-sh",
			name: "superset",
			fullName: "superset-sh/superset",
		})
		.returning();
	if (!repository) throw new Error("failed to insert repository");
	repositoryId = repository.id;
});

afterAll(async () => {
	await db.delete(organizations).where(eq(organizations.id, ORG));
	await db.delete(users).where(eq(users.id, USER));
	await db.delete(users).where(eq(users.id, OTHER_USER));
	await dbWs.$client.end?.();
});

describe("publishReview", () => {
	test("first publish for a PR creates a page at v1 and links it", async () => {
		const pr = await makePullRequest(1);
		const result = await publish({ githubPullRequestId: pr.id });

		expect(result.version).toBe(1);
		expect(result.visibility).toBe("org");

		const [link] = await db
			.select()
			.from(reviewPages)
			.where(eq(reviewPages.githubPullRequestId, pr.id));
		expect(link?.pageId).toBe(result.id);
	});

	test("re-reviewing the same PR adds a version to the same page", async () => {
		const pr = await makePullRequest(2);
		const first = await publish({ githubPullRequestId: pr.id });
		const second = await publish({ githubPullRequestId: pr.id });

		expect(second.id).toBe(first.id);
		expect(second.version).toBe(2);

		const links = await db
			.select()
			.from(reviewPages)
			.where(eq(reviewPages.githubPullRequestId, pr.id));
		expect(links).toHaveLength(1);
	});

	test("a standalone review (PR id only) and a later workspace-anchored review of the same PR share one page", async () => {
		const pr = await makePullRequest(3);
		const standalone = await publish({ githubPullRequestId: pr.id });
		const workspaceRun = await publish({
			githubPullRequestId: pr.id,
			workspaceId: WORKSPACE,
			entryPath: ".superset/review.html",
		});

		expect(workspaceRun.id).toBe(standalone.id);
		expect(workspaceRun.version).toBe(2);
	});

	test("different PRs get different pages", async () => {
		const prA = await makePullRequest(4);
		const prB = await makePullRequest(5);
		const a = await publish({ githubPullRequestId: prA.id });
		const b = await publish({ githubPullRequestId: prB.id });
		expect(a.id).not.toBe(b.id);
	});

	test("workspace-anchored review with no PR id behaves like a plain page: same entryPath versions, no reviewPages row", async () => {
		const first = await publish({
			workspaceId: WORKSPACE,
			entryPath: "no-pr/review.html",
		});
		const second = await publish({
			workspaceId: WORKSPACE,
			entryPath: "no-pr/review.html",
		});

		expect(second.id).toBe(first.id);
		expect(second.version).toBe(2);

		const links = await db
			.select()
			.from(workspacePages)
			.where(eq(workspacePages.entryPath, "no-pr/review.html"));
		expect(links).toHaveLength(1);
	});

	test("the rendered HTML embeds the findings", async () => {
		const pr = await makePullRequest(6);
		const result = await publish({
			githubPullRequestId: pr.id,
			title: "Renders findings",
		});
		const [row] = await db
			.select()
			.from(pageVersions)
			.where(eq(pageVersions.pageId, result.id));
		const stored = blobStore.get(row?.blobPathname ?? "");
		expect(stored?.toString()).toContain("a.ts:1");
	});
});
