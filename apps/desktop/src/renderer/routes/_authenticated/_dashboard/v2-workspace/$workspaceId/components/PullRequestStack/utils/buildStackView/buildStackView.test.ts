import { describe, expect, it } from "bun:test";
import type { PullRequestStackData } from "../../types";
import {
	buildStackView,
	findLayerWorkspace,
	type StackSiblingWorkspace,
} from "./buildStackView";

const current = {
	id: "ws-2",
	name: "relay delete",
	projectId: "p1",
	hostId: "h1",
};

function sibling(
	overrides: Partial<StackSiblingWorkspace> & { id: string },
): StackSiblingWorkspace {
	return {
		name: overrides.id,
		branch: "other",
		projectId: "p1",
		hostId: "h1",
		archivedAt: null,
		...overrides,
	};
}

function layer(
	overrides: Partial<PullRequestStackData["layers"][number]> & {
		number: number;
		position: number;
	},
): PullRequestStackData["layers"][number] {
	return {
		title: `PR ${overrides.number}`,
		url: `https://github.com/o/r/pull/${overrides.number}`,
		state: "open",
		headRefName: `branch-${overrides.number}`,
		baseRefName: "main",
		reviewDecision: "approved",
		checksStatus: "success",
		mergeability: "mergeable",
		additions: 0,
		deletions: 0,
		isCurrent: false,
		...overrides,
	};
}

describe("findLayerWorkspace", () => {
	it("maps the current layer to the workspace being viewed", () => {
		expect(
			findLayerWorkspace(
				{ headRefName: "anything", isCurrent: true },
				current,
				[],
			),
		).toEqual({ id: "ws-2", name: "relay delete" });
	});

	it("matches a live sibling on the same host and project by branch", () => {
		const siblings = [
			sibling({ id: "archived", branch: "branch-1", archivedAt: 1 }),
			sibling({ id: "other-host", branch: "branch-1", hostId: "h2" }),
			sibling({ id: "other-project", branch: "branch-1", projectId: "p2" }),
			sibling({ id: "ws-1", name: "relay cutover", branch: "branch-1" }),
		];
		expect(
			findLayerWorkspace(
				{ headRefName: "branch-1", isCurrent: false },
				current,
				siblings,
			),
		).toEqual({ id: "ws-1", name: "relay cutover" });
	});

	it("is null when no workspace is on that branch", () => {
		expect(
			findLayerWorkspace(
				{ headRefName: "branch-9", isCurrent: false },
				current,
				[sibling({ id: "ws-1", branch: "branch-1" })],
			),
		).toBeNull();
	});
});

describe("buildStackView", () => {
	it("annotates layers with blockers and workspaces and rolls up readiness", () => {
		const stack: PullRequestStackData = {
			source: "inferred",
			stackNumber: null,
			baseRefName: "main",
			currentPosition: 2,
			mergedBelow: null,
			layers: [
				layer({ number: 1, position: 1, state: "merged" }),
				layer({
					number: 2,
					position: 2,
					isCurrent: true,
					mergeability: "conflicting",
				}),
				layer({ number: 3, position: 3 }),
			],
		};
		const view = buildStackView(stack, current, [
			sibling({ id: "ws-3", name: "top", branch: "branch-3" }),
		]);
		expect(view.layers.map((item) => item.blocker)).toEqual([
			null,
			"conflicts",
			null,
		]);
		expect(view.layers.map((item) => item.workspace?.id ?? null)).toEqual([
			null,
			"ws-2",
			"ws-3",
		]);
		expect(view.readiness).toEqual({ kind: "blocked", number: 2 });
	});
});
