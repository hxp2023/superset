import {
	buildCollisionSafeTreePaths,
	FILE_STATUS_TO_PIERRE,
	formatDiffStats,
	type PierreGitStatusEntry,
} from "renderer/lib/pierreTree";
import {
	type ChangesetFile,
	getChangesetFileKey,
} from "../../../../../../../useChangeset";

export interface DiffTreeTarget {
	/** Workspace-relative changeset path (the real path, not the tree path). */
	path: string;
	changeKey: string;
}

export interface DiffTreeData {
	/** Unique, collision-safe tree paths in diff order. */
	treePaths: string[];
	gitStatus: PierreGitStatusEntry[];
	/** `+N −M` row decoration text, keyed by tree path. */
	decorationByTreePath: Map<string, string>;
	/** Tree path → navigation target for a row click. */
	targetByTreePath: Map<string, DiffTreeTarget>;
}

/**
 * Tree inputs for the Changes pane's file tree. Unlike a PR diff, a changeset
 * can list the same path in more than one section (e.g. staged + unstaged,
 * each its own CodeView item) while the tree shows each file once: the first
 * occurrence in diff order wins the status and the click target (matching
 * where a click scrolls to), and `+/−` counts sum across occurrences. The
 * uniqued paths then go through the same file-vs-directory collision
 * disambiguation the sidebar tree uses.
 */
export function buildDiffTreeData(files: ChangesetFile[]): DiffTreeData {
	const uniquePaths: string[] = [];
	const firstByPath = new Map<string, ChangesetFile>();
	const additionsByPath = new Map<string, number>();
	const deletionsByPath = new Map<string, number>();
	for (const file of files) {
		if (!firstByPath.has(file.path)) {
			firstByPath.set(file.path, file);
			uniquePaths.push(file.path);
		}
		additionsByPath.set(
			file.path,
			(additionsByPath.get(file.path) ?? 0) + file.additions,
		);
		deletionsByPath.set(
			file.path,
			(deletionsByPath.get(file.path) ?? 0) + file.deletions,
		);
	}

	const { treePaths, toTreePath } = buildCollisionSafeTreePaths(uniquePaths);

	const gitStatus: PierreGitStatusEntry[] = [];
	const decorationByTreePath = new Map<string, string>();
	const targetByTreePath = new Map<string, DiffTreeTarget>();
	for (const path of uniquePaths) {
		const file = firstByPath.get(path);
		if (!file) continue;
		const treePath = toTreePath.get(path) ?? path;
		gitStatus.push({
			path: treePath,
			status: FILE_STATUS_TO_PIERRE[file.status],
		});
		const text = formatDiffStats(
			additionsByPath.get(path) ?? 0,
			deletionsByPath.get(path) ?? 0,
		);
		if (text) decorationByTreePath.set(treePath, text);
		targetByTreePath.set(treePath, {
			path,
			changeKey: getChangesetFileKey(file),
		});
	}

	return { treePaths, gitStatus, decorationByTreePath, targetByTreePath };
}
