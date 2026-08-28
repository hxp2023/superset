import { describe, expect, test } from "bun:test";
import type { ChangesetFile } from "../../../../../useChangeset";
import {
	isDiffContentTooLarge,
	isGeneratedDiffFile,
	LARGE_DIFF_CHANGED_LINES,
	shouldAutoLoadDiff,
} from "./diffLoadingGuards";

function createFile(
	path: string,
	overrides: Partial<ChangesetFile> = {},
): ChangesetFile {
	return {
		path,
		status: "modified",
		additions: 1,
		deletions: 1,
		isBinary: false,
		source: { kind: "unstaged" },
		...overrides,
	};
}

describe("diff loading guards", () => {
	test("auto-loads an ordinary small source file", () => {
		expect(shouldAutoLoadDiff(createFile("src/app.ts"))).toBe(true);
	});

	test("keeps large diffs opt-in", () => {
		expect(
			shouldAutoLoadDiff(
				createFile("src/generated.ts", {
					additions: LARGE_DIFF_CHANGED_LINES + 1,
					deletions: 0,
				}),
			),
		).toBe(false);
	});

	test("keeps generated artifacts opt-in even when their numstat is tiny", () => {
		for (const path of [
			"bun.lock",
			"package-lock.json",
			"dist/app.js",
			"src/vendor/client.ts",
			"assets/app.min.css",
			"packages/i18n/locales/ja/messages.ts",
		]) {
			expect(isGeneratedDiffFile(path)).toBe(true);
			expect(shouldAutoLoadDiff(createFile(path))).toBe(false);
		}
	});

	test("rejects oversized contents before synchronous diff parsing", () => {
		expect(
			isDiffContentTooLarge("a".repeat(250_000), "b".repeat(250_001)),
		).toBe(true);
		expect(
			isDiffContentTooLarge("a".repeat(250_000), "b".repeat(250_000)),
		).toBe(false);
	});
});
