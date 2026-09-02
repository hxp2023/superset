import { describe, expect, it } from "bun:test";
import {
	createWorkspaceStore,
	type LayoutNode,
	type WorkspaceState,
} from "@superset/panes";
import type { DiffPaneData, PaneViewerData } from "../../types";
import { openChangesPaneInStore } from "./openChangesPaneInStore";

function paneLayout(paneId: string): LayoutNode {
	return { type: "pane", paneId };
}

function workspaceState(withDiffTab: boolean): WorkspaceState<PaneViewerData> {
	return {
		version: 1,
		activeTabId: "tab-1",
		tabs: [
			{
				id: "tab-1",
				createdAt: 1,
				activePaneId: "pane-1",
				layout: paneLayout("pane-1"),
				panes: {
					"pane-1": {
						id: "pane-1",
						kind: "terminal",
						data: { terminalId: "terminal-1" } as PaneViewerData,
					},
				},
			},
			...(withDiffTab
				? [
						{
							id: "diff-tab",
							createdAt: 2,
							activePaneId: "diff-pane",
							layout: paneLayout("diff-pane"),
							panes: {
								"diff-pane": {
									id: "diff-pane",
									kind: "diff",
									data: {
										path: "src/app.ts",
										collapsedFiles: [],
									} as PaneViewerData,
								},
							},
						},
					]
				: []),
		],
	};
}

function storeWith(withDiffTab: boolean) {
	return createWorkspaceStore<PaneViewerData>({
		initialState: workspaceState(withDiffTab),
	});
}

describe("openChangesPaneInStore", () => {
	it("adds a tab with an empty-target diff pane when none exists", () => {
		const store = storeWith(false);

		openChangesPaneInStore(store);

		const state = store.getState();
		expect(state.tabs).toHaveLength(2);
		const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
		const opened = Object.values(activeTab?.panes ?? {})[0];
		expect(opened?.kind).toBe("diff");
		expect(opened?.data as DiffPaneData).toEqual({
			path: "",
			collapsedFiles: [],
		});
	});

	it("focuses the first existing diff pane across tabs instead of adding one", () => {
		const store = storeWith(true);

		openChangesPaneInStore(store);

		const state = store.getState();
		expect(state.tabs).toHaveLength(2);
		expect(state.activeTabId).toBe("diff-tab");
		const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
		expect(activeTab?.activePaneId).toBe("diff-pane");
		// The existing pane's navigation target is untouched.
		const pane = activeTab?.panes["diff-pane"];
		expect((pane?.data as DiffPaneData).path).toBe("src/app.ts");
	});

	it("is idempotent once a diff pane exists", () => {
		const store = storeWith(false);

		openChangesPaneInStore(store);
		openChangesPaneInStore(store);

		expect(store.getState().tabs).toHaveLength(2);
	});
});
