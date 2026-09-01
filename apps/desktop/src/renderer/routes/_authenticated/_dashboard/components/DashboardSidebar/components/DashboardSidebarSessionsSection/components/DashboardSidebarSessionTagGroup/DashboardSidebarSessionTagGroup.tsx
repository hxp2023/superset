import {
	normalizeWorkspaceTag,
	SESSIONS_TAG_SCOPE,
} from "@superset/shared/workspace-tags";
import { type ReactNode, useEffect, useState } from "react";
import { useDashboardSidebarState } from "renderer/routes/_authenticated/hooks/useDashboardSidebarState";
import { useOptimisticActions } from "renderer/routes/_authenticated/hooks/useOptimisticActions";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import {
	applyFolderTagChange,
	buildSidebarFolderKey,
	useTagFolderContext,
} from "renderer/routes/_authenticated/utils/workspaceTagFolders";
import { RenameInput } from "renderer/screens/main/components/WorkspaceSidebar/RenameInput";
import { DashboardSidebarGroupHeader } from "../../../DashboardSidebarGroupHeader";
import { DashboardSidebarSectionContextMenu } from "../../../DashboardSidebarSection/components/DashboardSidebarSectionContextMenu";
import { DashboardSidebarSectionActionsDropdown } from "../../../DashboardSidebarSection/components/DashboardSidebarSectionContextMenu/components/DashboardSidebarSectionActionsDropdown";
import { useDashboardSidebarSectionRename } from "../../../DashboardSidebarSectionRenameContext";

interface DashboardSidebarSessionTagGroupProps {
	tag: string;
	isCollapsed: boolean;
	onToggleCollapse: () => void;
	children: ReactNode;
}

/** A derived tag lane inside Sessions, styled like project tag folders. */
export function DashboardSidebarSessionTagGroup({
	tag,
	isCollapsed,
	onToggleCollapse,
	children,
}: DashboardSidebarSessionTagGroupProps) {
	const [isRenaming, setIsRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(tag);
	const { workspaces } = useHostWorkspaces();
	const { v2Workspaces } = useOptimisticActions();
	const { pendingRenameSectionId, clearPendingSectionRename } =
		useDashboardSidebarSectionRename();
	const { renameSection, setSectionColor } = useDashboardSidebarState();
	const { tagSettings } = useTagFolderContext();
	const renameKey = buildSidebarFolderKey(SESSIONS_TAG_SCOPE, tag);
	const setting = tagSettings.find(
		(item) => item.projectId === SESSIONS_TAG_SCOPE && item.tag === tag,
	);
	const displayName = setting?.displayName ?? tag;
	useEffect(() => {
		if (pendingRenameSectionId !== renameKey) return;
		setRenameValue(displayName);
		setIsRenaming(true);
		clearPendingSectionRename(renameKey);
	}, [
		pendingRenameSectionId,
		renameKey,
		displayName,
		clearPendingSectionRename,
	]);
	const members = workspaces.filter(
		(workspace) =>
			workspace.projectId === null &&
			workspace.tags?.some(
				(workspaceTag) => normalizeWorkspaceTag(workspaceTag) === tag,
			),
	);
	const retagMembers = (nextTag: string | null) => {
		for (const workspace of members) {
			void v2Workspaces.updateWorkspace(workspace.id, {
				tags: applyFolderTagChange(workspace.tags, [tag], nextTag),
			});
		}
	};
	const startRename = () => {
		setRenameValue(displayName);
		setIsRenaming(true);
	};
	const submitRename = () => {
		const nextName = renameValue.trim();
		setIsRenaming(false);
		if (!nextName || nextName === displayName) return;
		renameSection(renameKey, nextName);
	};
	const cancelRename = () => {
		setRenameValue(displayName);
		setIsRenaming(false);
	};
	// Presentation for this lane lives under the Sessions scope, keyed by tag
	// exactly like a project folder is keyed under its project id.
	const color = setting?.color ?? null;
	const setColor = (next: string | null) => setSectionColor(renameKey, next);
	const actions = (
		<DashboardSidebarSectionActionsDropdown
			color={color}
			onRename={startRename}
			onSetColor={setColor}
			onDelete={() => retagMembers(null)}
		/>
	);

	return (
		<div>
			<div
				className="border-l-2"
				style={{ borderColor: color ?? "var(--color-border)" }}
			>
				<DashboardSidebarSectionContextMenu
					color={color}
					onRename={startRename}
					onSetColor={setColor}
					onDelete={() => retagMembers(null)}
				>
					<DashboardSidebarGroupHeader
						label={
							isRenaming ? (
								<RenameInput
									value={renameValue}
									onChange={setRenameValue}
									onSubmit={submitRename}
									onCancel={cancelRename}
									className="-ml-1 h-5 w-full min-w-0 border-none bg-transparent px-1 py-0 text-[13px] font-medium text-muted-foreground outline-none"
								/>
							) : (
								<span className="truncate">{displayName}</span>
							)
						}
						isCollapsed={isCollapsed}
						isEditing={isRenaming}
						onToggleCollapse={onToggleCollapse}
						actions={actions}
					/>
				</DashboardSidebarSectionContextMenu>
			</div>
			{!isCollapsed && children}
		</div>
	);
}
