import type { WorkspaceStore } from "@superset/panes";
import type { StoreApi } from "zustand/vanilla";
import type { DiffPaneData, PaneViewerData } from "../../types";

/**
 * Focus the workspace's Changes pane, creating one when none exists. The
 * first `diff` pane in tab order wins — the same pane every other diff
 * navigation targets (see openDiffPane), so repeated invocations converge on
 * one pane instead of accumulating tabs.
 */
export function openChangesPaneInStore(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
): void {
	const state = store.getState();

	for (const tab of state.tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (pane.kind !== "diff") continue;
			state.setActiveTab(tab.id);
			state.setActivePane({ tabId: tab.id, paneId: pane.id });
			return;
		}
	}

	state.addTab({
		panes: [
			{
				kind: "diff",
				data: { path: "", collapsedFiles: [] } as DiffPaneData,
			},
		],
	});
}
