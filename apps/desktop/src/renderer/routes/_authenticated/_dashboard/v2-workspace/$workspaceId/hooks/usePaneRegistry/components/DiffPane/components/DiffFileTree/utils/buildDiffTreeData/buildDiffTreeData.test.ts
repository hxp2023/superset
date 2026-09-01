import { describe, expect, it } from "bun:test";
import type { ChangesetFile } from "../../../../../../../useChangeset";
import { buildDiffTreeData } from "./buildDiffTreeData";

const ZWSP = "​";

function file(overrides: Partial<ChangesetFile> = {}): ChangesetFile {
	return {
		path: "src/index.ts",
		status: "modified",
		additions: 1,
		deletions: 0,
		source: { kind: "unstaged" },
		...overrides,
	};
}

describe("buildDiffTreeData", () => {
	it("keeps diff order and maps statuses through FILE_STATUS_TO_PIERRE", () => {
		const result = buildDiffTreeData([
			file({ path: "b/two.ts", status: "changed" }),
			file({ path: "a/one.ts", status: "untracked" }),
		]);
		expect(result.treePaths).toEqual(["b/two.ts", "a/one.ts"]);
		expect(result.gitStatus).toEqual([
			{ path: "b/two.ts", status: "modified" },
			{ path: "a/one.ts", status: "untracked" },
		]);
	});

	it("collapses a duplicate path (staged + unstaged) into one row", () => {
		const result = buildDiffTreeData([
			file({
				path: "src/app.ts",
				additions: 2,
				deletions: 1,
				source: { kind: "unstaged" },
			}),
			file({
				path: "src/app.ts",
				additions: 3,
				deletions: 4,
				status: "renamed",
				source: { kind: "staged" },
			}),
		]);
		expect(result.treePaths).toEqual(["src/app.ts"]);
		// +/− sum across occurrences…
		expect(result.decorationByTreePath.get("src/app.ts")).toBe("+5 −5");
		// …while status and click target come from the first occurrence in
		// diff order (where a click scrolls to).
		expect(result.gitStatus).toEqual([
			{ path: "src/app.ts", status: "modified" },
		]);
		expect(result.targetByTreePath.get("src/app.ts")).toEqual({
			path: "src/app.ts",
			changeKey: "unstaged:src/app.ts",
		});
	});

	it("omits the decoration when a file has no counted changes", () => {
		const result = buildDiffTreeData([
			file({ path: "assets/logo.png", additions: 0, deletions: 0 }),
		]);
		expect(result.decorationByTreePath.has("assets/logo.png")).toBe(false);
	});

	it("disambiguates a file that collides with a directory and keeps the real path in the target", () => {
		const result = buildDiffTreeData([
			file({ path: "skills", status: "deleted", deletions: 3, additions: 0 }),
			file({ path: "skills/pdf/SKILL.md", status: "added" }),
		]);
		expect(result.treePaths).toEqual([`skills${ZWSP}`, "skills/pdf/SKILL.md"]);
		expect(result.targetByTreePath.get(`skills${ZWSP}`)).toEqual({
			path: "skills",
			changeKey: "unstaged:skills",
		});
		expect(result.decorationByTreePath.get(`skills${ZWSP}`)).toBe("−3");
	});
});
