import { describe, expect, test } from "bun:test";
import type { ChecksTally } from "../../../../utils/pullRequest/checks";
import { actionLabelFor, headlineFor } from "./copy";

function tally(overrides: Partial<ChecksTally> = {}): ChecksTally {
	return {
		passed: 0,
		failed: 0,
		running: 0,
		needsAction: 0,
		ignored: 0,
		total: 0,
		failing: [],
		...overrides,
	};
}

const open = { isDraft: false, tally: tally() };

describe("headlineFor", () => {
	test("each state names what the pull request is waiting on", () => {
		expect(headlineFor("merged", open)).toBe("PR Merged and Closed");
		expect(headlineFor("closed", open)).toBe("PR Closed");
		expect(headlineFor("conflicts", open)).toBe("Resolve Conflicts to Merge");
		expect(headlineFor("waiting-for-checks", open)).toBe("Waiting for Checks");
		expect(headlineFor("waiting-for-review", open)).toBe("Waiting for Review");
		expect(headlineFor("changes-requested", open)).toBe("Changes Requested");
		expect(headlineFor("ready", open)).toBe("Ready to Merge");
		expect(headlineFor("ready", { isDraft: true, tally: tally() })).toBe(
			"Ready for Review",
		);
	});

	test("failed-check headline counts exactly", () => {
		expect(
			headlineFor("checks-failed", {
				isDraft: false,
				tally: tally({ failed: 1 }),
			}),
		).toBe("1 Check Failed");
		expect(
			headlineFor("checks-failed", {
				isDraft: false,
				tally: tally({ failed: 2 }),
			}),
		).toBe("2 Checks Failed");
	});
});

describe("actionLabelFor", () => {
	const squash = { mergeMethod: "squash" as const };

	test("every action label is exact", () => {
		expect(actionLabelFor("merge", squash)).toBe("Squash & Merge");
		expect(actionLabelFor("mark-ready", squash)).toBe("Mark Ready");
		expect(actionLabelFor("update-branch", squash)).toBe("Update Branch");
		expect(actionLabelFor("reopen", squash)).toBe("Reopen PR");
		expect(actionLabelFor("ask-fix-checks", squash)).toBe(
			"Fix Checks with Agent",
		);
	});

	test("conflicts reuse the checks agent label, even with no checks", () => {
		expect(actionLabelFor("ask-resolve-conflicts", squash)).toBe(
			"Fix Checks with Agent",
		);
	});

	test("requested changes get their own agent label", () => {
		expect(actionLabelFor("ask-address-comments", squash)).toBe(
			"Address Comments with Agent",
		);
	});
});
