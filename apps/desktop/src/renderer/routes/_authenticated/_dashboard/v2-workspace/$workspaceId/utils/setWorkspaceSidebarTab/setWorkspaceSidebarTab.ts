import type { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import type { WorkspaceSidebarTab } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";

type Collections = ReturnType<typeof useCollections>;

/**
 * Switch a workspace's right-sidebar tab. The sidebar reads its active tab
 * from per-workspace local state (not the global v2 preferences row), so
 * every flow that surfaces a tab's content — a file reveal, opening Changes —
 * writes here. A workspace without a local row yet is left alone rather than
 * synthesized: the row's identity fields come from workspace creation.
 */
export function setWorkspaceSidebarTab(
	collections: Collections,
	workspaceId: string,
	tab: WorkspaceSidebarTab,
): void {
	if (!collections.v2WorkspaceLocalState.get(workspaceId)) return;
	collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
		draft.sidebarState.activeTab = tab;
	});
}
