import type { WorkspaceSidebarTab } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { create } from "zustand";

interface RowlessSidebarTabStore {
	/** Active sidebar tab by workspace id, for workspaces without a local row. */
	tabs: Record<string, WorkspaceSidebarTab>;
	setTab: (workspaceId: string, tab: WorkspaceSidebarTab) => void;
}

/**
 * Session-only sidebar tab for workspaces with no v2WorkspaceLocalState row —
 * auto-included local `main` checkouts. Those rows are only created by an
 * explicit sidebar placement (pin, move), and a tab switch must not fake
 * one, so the choice lives here and is forgotten on restart, like the pane
 * layout those workspaces don't persist either.
 */
export const useRowlessSidebarTabStore = create<RowlessSidebarTabStore>()(
	(set) => ({
		tabs: {},
		setTab: (workspaceId, tab) =>
			set((state) => ({ tabs: { ...state.tabs, [workspaceId]: tab } })),
	}),
);
