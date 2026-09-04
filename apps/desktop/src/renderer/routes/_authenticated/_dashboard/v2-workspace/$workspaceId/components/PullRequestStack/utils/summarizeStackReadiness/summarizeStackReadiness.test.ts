import { describe, expect, it } from "bun:test";
import type { PullRequestStackLayerData } from "../../types";
import {
	getLayerBlocker,
	summarizeStackReadiness,
} from "./summarizeStackReadiness";

type Signals = Pick<
	PullRequestStackLayerData,
	"state" | "mergeability" | "reviewDecision" | "checksStatus"
> & { number: number };

function layer(number: number, overrides: Partial<Signals> = {}): Signals {
	return {
		number,
		state: "open",
		mergeability: "mergeable",
		reviewDecision: "approved",
		checksStatus: "success",
		...overrides,
	};
}

describe("getLayerBlocker", () => {
	it("is null for a merged layer whatever else it reports", () => {
		expect(
			getLayerBlocker(
				layer(1, { state: "merged", mergeability: "conflicting" }),
			),
		).toBeNull();
	});

	it("is null for a clean, approved, green layer", () => {
		expect(getLayerBlocker(layer(1))).toBeNull();
		expect(getLayerBlocker(layer(1, { reviewDecision: null }))).toBeNull();
	});

	it("ranks problems in fix order", () => {
		expect(
			getLayerBlocker(
				layer(1, { state: "draft", mergeability: "conflicting" }),
			),
		).toBe("draft");
		expect(
			getLayerBlocker(
				layer(1, { mergeability: "conflicting", checksStatus: "failure" }),
			),
		).toBe("conflicts");
		expect(
			getLayerBlocker(
				layer(1, {
					checksStatus: "failure",
					reviewDecision: "changes_requested",
				}),
			),
		).toBe("checks_failing");
		expect(
			getLayerBlocker(
				layer(1, {
					reviewDecision: "changes_requested",
					checksStatus: "pending",
				}),
			),
		).toBe("changes_requested");
		expect(
			getLayerBlocker(
				layer(1, {
					checksStatus: "pending",
					reviewDecision: "review_required",
				}),
			),
		).toBe("checks_pending");
		expect(
			getLayerBlocker(layer(1, { reviewDecision: "review_required" })),
		).toBe("review_required");
		expect(getLayerBlocker(layer(1, { state: "closed" }))).toBe("closed");
	});
});

describe("summarizeStackReadiness", () => {
	it("reports landed once every layer merged", () => {
		expect(
			summarizeStackReadiness([
				layer(1, { state: "merged" }),
				layer(2, { state: "merged" }),
			]),
		).toEqual({ kind: "landed" });
	});

	it("reports all-ready when nothing above the merged prefix is blocked", () => {
		expect(
			summarizeStackReadiness([
				layer(1, { state: "merged" }),
				layer(2),
				layer(3),
			]),
		).toEqual({ kind: "all-ready" });
	});

	it("names the highest layer that can land when a higher one is blocked", () => {
		expect(
			summarizeStackReadiness([
				layer(1),
				layer(2),
				layer(3, { checksStatus: "pending" }),
				layer(4),
			]),
		).toEqual({ kind: "ready-through", number: 2 });
	});

	it("is blocked at the lowest unmerged layer when that one cannot land", () => {
		expect(
			summarizeStackReadiness([
				layer(1, { state: "merged" }),
				layer(2, { mergeability: "conflicting" }),
				layer(3),
			]),
		).toEqual({ kind: "blocked", number: 2 });
	});
});
