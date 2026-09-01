import type { HostProjectsQueryTarget } from "../useHostProjects/useHostProjects.utils";

/** One folder's host-side presentation, plus the scope it belongs to. */
export interface HostTagFolderSetting {
	scope: string;
	tag: string;
	displayName: string | null;
	color: string | null;
	tabOrder: number | null;
}

export type HostTagFoldersStatus = "pending" | "ready" | "error" | "offline";

/** Per-host state is retained so callers never mistake a failed read for empty. */
export interface HostTagFoldersResult {
	target: HostProjectsQueryTarget;
	status: HostTagFoldersStatus;
	settings: HostTagFolderSetting[];
}

/**
 * Collapse duplicate `(scope, tag)` rows when the same project is served by
 * multiple hosts. Local wins at row granularity; otherwise host identity
 * makes the result independent of query completion order. Do not merge
 * nullable fields: null is an explicit reset, not evidence that another
 * host's value should be resurrected. Sessions normally contribute one host.
 */
export function mergeHostTagFolders(
	hostResults: HostTagFoldersResult[],
): HostTagFolderSetting[] {
	const ordered = [...hostResults].sort((left, right) => {
		if (left.target.isLocal !== right.target.isLocal) {
			return left.target.isLocal ? -1 : 1;
		}
		return left.target.machineId.localeCompare(right.target.machineId);
	});
	const byFolder = new Map<string, HostTagFolderSetting>();
	for (const result of ordered) {
		for (const setting of result.settings) {
			const key = `${setting.scope}\u0000${setting.tag}`;
			if (!byFolder.has(key)) byFolder.set(key, setting);
		}
	}
	return [...byFolder.values()].sort(
		(left, right) =>
			left.scope.localeCompare(right.scope) ||
			left.tag.localeCompare(right.tag),
	);
}
