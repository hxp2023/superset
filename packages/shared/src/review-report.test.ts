import { describe, expect, it } from "bun:test";
import { renderReviewReportHtml } from "./review-report";

describe("renderReviewReportHtml", () => {
	it("renders an empty state when there are no findings", () => {
		const html = renderReviewReportHtml({
			title: "Fix login bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
		});
		expect(html).toContain("No findings");
		expect(html).toContain("Fix login bug");
	});

	it("groups findings by verdict and orders confirmed before plausible before unverified", () => {
		const html = renderReviewReportHtml({
			title: "Add caching layer",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [
				{
					file: "a.ts",
					summary: "unverified issue",
					failureScenario: "n/a",
				},
				{
					file: "b.ts",
					summary: "plausible issue",
					failureScenario: "n/a",
					verdict: "PLAUSIBLE",
				},
				{
					file: "c.ts",
					summary: "confirmed issue",
					failureScenario: "n/a",
					verdict: "CONFIRMED",
				},
			],
		});

		const confirmedIndex = html.indexOf("Confirmed");
		const plausibleIndex = html.indexOf("Plausible");
		const unverifiedIndex = html.indexOf("Unverified");
		expect(confirmedIndex).toBeGreaterThan(-1);
		expect(confirmedIndex).toBeLessThan(plausibleIndex);
		expect(plausibleIndex).toBeLessThan(unverifiedIndex);
		expect(html).toContain('<span class="section-summary">1 finding</span>');
	});

	it("links file:line to the GitHub blob when repo and commitSha are given", () => {
		const html = renderReviewReportHtml({
			title: "Fix bug",
			repo: "superset-sh/superset",
			commitSha: "abc1234def",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [
				{
					file: "packages/db/src/schema/schema.ts",
					line: 42,
					summary: "issue",
					failureScenario: "n/a",
				},
			],
		});
		expect(html).toContain(
			'href="https://github.com/superset-sh/superset/blob/abc1234def/packages/db/src/schema/schema.ts#L42"',
		);
		expect(html).toContain("packages/db/src/schema/schema.ts:42");
	});

	it("omits the GitHub link when repo or commitSha is missing", () => {
		const html = renderReviewReportHtml({
			title: "Fix bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [
				{ file: "a.ts", line: 1, summary: "issue", failureScenario: "n/a" },
			],
		});
		expect(html).not.toContain("<a href=");
		expect(html).toContain("a.ts:1");
	});

	it("escapes HTML in user-controlled content", () => {
		const html = renderReviewReportHtml({
			title: "<script>alert(1)</script>",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [
				{
					file: "a.ts",
					summary: "<img src=x onerror=alert(1)>",
					failureScenario: "<b>bold</b>",
					category: 'correctness"><script>',
				},
			],
		});
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).not.toContain("<img src=x onerror=alert(1)>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	it("includes PR metadata and a link to the PR when provided", () => {
		const html = renderReviewReportHtml({
			title: "Fix bug",
			repo: "superset-sh/superset",
			prNumber: 42,
			prUrl: "https://github.com/superset-sh/superset/pull/42",
			branch: "fix-bug",
			effortLevel: "high",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
		});
		expect(html).toContain("#42");
		expect(html).toContain("superset-sh/superset");
		expect(html).toContain("fix-bug");
		expect(html).toContain("high review");
		expect(html).toContain(
			'href="https://github.com/superset-sh/superset/pull/42"',
		);
	});

	it("omits the tab bar and Code panel when no diff is given", () => {
		const html = renderReviewReportHtml({
			title: "Fix bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
		});
		expect(html).not.toContain('id="tab-summary"');
		expect(html).not.toContain('id="panel-code"');
		expect(html).toContain('<main class="content">');
		expect(html).toContain(
			'<span class="tab-label tab-label-active">Summary</span>',
		);
	});

	it("renders the PR header anatomy: GitHub icon button, mono PR number, branch with icon, generated date", () => {
		const html = renderReviewReportHtml({
			title: "Fix bug",
			repo: "superset-sh/superset",
			prNumber: 42,
			prUrl: "https://github.com/superset-sh/superset/pull/42",
			branch: "fix-bug",
			commitSha: "abc1234def",
			generatedAt: "2026-08-25T21:05:00.000Z",
			findings: [],
		});
		expect(html).toContain('aria-label="Open pull request in GitHub"');
		expect(html).toContain('<span class="meta-num mono">#42</span>');
		expect(html).toContain('<span class="branch-label">fix-bug</span>');
		expect(html).toContain('<span class="meta-mono mono">abc1234</span>');
		expect(html).toContain("generated Aug 25, 2026");
		expect(html).toContain("<span aria-hidden>·</span>");
	});

	it("renders a Code tab with added/removed/context lines and per-file stats", () => {
		const diff = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"index abc1234..def5678 100644",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -1,3 +1,3 @@",
			" context line",
			"-removed line",
			"+added line",
			" trailing context",
		].join("\n");

		const html = renderReviewReportHtml({
			title: "Fix bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
			diff,
		});

		expect(html).toContain('id="tab-summary"');
		expect(html).toContain('id="panel-code"');
		expect(html).toContain("src/foo.ts");
		expect(html).toContain('<span class="diff-stat-add">+1</span>');
		expect(html).toContain('<span class="diff-stat-del">-1</span>');
		expect(html).toContain('class="diff-line diff-add"');
		expect(html).toContain('class="diff-line diff-remove"');
		expect(html).toContain('class="diff-line diff-context"');
		expect(html).toContain("@@ -1,3 +1,3 @@");
	});

	it("resolves a deleted file's path from the --- line when +++ is /dev/null", () => {
		const diff = [
			"diff --git a/src/gone.ts b/src/gone.ts",
			"deleted file mode 100644",
			"index abc1234..0000000 000000",
			"--- a/src/gone.ts",
			"+++ /dev/null",
			"@@ -1,2 +0,0 @@",
			"-line one",
			"-line two",
		].join("\n");

		const html = renderReviewReportHtml({
			title: "Fix bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
			diff,
		});
		expect(html).toContain("src/gone.ts");
		expect(html).toContain('<span class="diff-stat-del">-2</span>');
	});

	it("shows a placeholder for a binary file instead of its content", () => {
		const diff = [
			"diff --git a/image.png b/image.png",
			"index abc1234..def5678 100644",
			"Binary files a/image.png and b/image.png differ",
		].join("\n");

		const html = renderReviewReportHtml({
			title: "Fix bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
			diff,
		});
		expect(html).toContain("Binary file not shown");
	});

	it("escapes HTML inside diff content", () => {
		const diff = [
			"diff --git a/src/foo.ts b/src/foo.ts",
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -1 +1 @@",
			"+<script>alert(1)</script>",
		].join("\n");

		const html = renderReviewReportHtml({
			title: "Fix bug",
			generatedAt: "2026-01-01T00:00:00.000Z",
			findings: [],
			diff,
		});
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});
});
