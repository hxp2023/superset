import { describe, expect, test } from "bun:test";
import { findReportedPrNumber } from "./useCreatePrWithAgent";

describe("findReportedPrNumber", () => {
	test("takes the last PR URL on the screen and ignores other GitHub links", () => {
		const screen = [
			"Pushed. Creating the PR…",
			"https://github.com/superset-sh/superset/pull/7148",
			"Fixes https://github.com/superset-sh/superset/issues/12",
			"Published `feature-x` and opened the PR.",
			"https://github.com/superset-sh/superset/pull/7149",
			"❯ ",
		].join("\n");
		expect(findReportedPrNumber(screen)).toBe(7149);
	});

	test("null when nothing PR-shaped is on screen", () => {
		expect(findReportedPrNumber("Working…\n❯ ")).toBeNull();
	});
});
