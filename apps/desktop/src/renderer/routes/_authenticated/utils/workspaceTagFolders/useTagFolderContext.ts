import { useMemo } from "react";
import { useHostTagFolders } from "renderer/hooks/host-projects/useHostTagFolders";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import type { TagFolderContext } from "./workspaceTagFolders";

/**
 * The one presentation context every membership pass shares: host-side tag
 * settings (from the tag-folder fan-out) and the local hidden-folder list.
 * Build it here, not per consumer — two passes with different contexts is
 * the same bug class as two membership derivations.
 */
export function useTagFolderContext(): TagFolderContext {
	const tagFolders = useHostTagFolders();
	const { preferences } = useV2UserPreferences();
	const hiddenTagFolders = preferences.hiddenTagFolders;
	return useMemo(
		() => ({
			// `projectId` here is the folder's scope: a project key, or the
			// Sessions lane sentinel for project-less session folders.
			tagSettings: tagFolders.map(({ scope, ...setting }) => ({
				projectId: scope,
				...setting,
			})),
			hiddenTagsByProject: new Map(
				Object.entries(hiddenTagFolders).map(([projectId, tags]) => [
					projectId,
					new Set(tags),
				]),
			),
		}),
		[tagFolders, hiddenTagFolders],
	);
}
