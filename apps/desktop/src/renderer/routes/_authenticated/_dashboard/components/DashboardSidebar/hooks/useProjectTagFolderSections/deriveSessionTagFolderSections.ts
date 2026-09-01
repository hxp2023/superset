import {
	normalizeWorkspaceTag,
	normalizeWorkspaceTags,
	SESSIONS_TAG_SCOPE,
} from "@superset/shared/workspace-tags";
import type {
	TagFolderContext,
	TagFolderWorkspaceInput,
} from "renderer/routes/_authenticated/utils/workspaceTagFolders";
import type { ProjectTagFolderSection } from "./useProjectTagFolderSections";

/**
 * Build the Sessions move-menu rows from the same host presentation settings
 * as the rendered group headers. The normalized tag remains the stable id;
 * display name and colour are presentation only.
 */
export function deriveSessionTagFolderSections(
	workspaces: readonly TagFolderWorkspaceInput[],
	context: TagFolderContext,
): ProjectTagFolderSection[] {
	const settingsByTag = new Map(
		context.tagSettings.flatMap((setting) => {
			if (setting.projectId !== SESSIONS_TAG_SCOPE) return [];
			const tag = normalizeWorkspaceTag(setting.tag);
			return tag == null ? [] : [[tag, setting] as const];
		}),
	);
	const tags = new Set<string>();
	for (const workspace of workspaces) {
		if (workspace.projectId !== null) continue;
		for (const tag of normalizeWorkspaceTags(workspace.tags)) tags.add(tag);
	}
	return [...tags].sort().map((tag) => {
		const setting = settingsByTag.get(tag);
		return {
			id: tag,
			name: setting?.displayName ?? tag,
			color: setting?.color ?? null,
		};
	});
}
