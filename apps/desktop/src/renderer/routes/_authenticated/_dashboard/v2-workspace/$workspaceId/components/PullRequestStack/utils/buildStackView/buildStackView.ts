import type {
	PullRequestStackData,
	PullRequestStackView,
	StackLayerView,
	StackLayerWorkspace,
} from "../../types";
import {
	getLayerBlocker,
	summarizeStackReadiness,
} from "../summarizeStackReadiness";

export interface StackSiblingWorkspace {
	id: string;
	name: string;
	branch: string;
	projectId: string | null;
	hostId: string;
	archivedAt?: number | null;
}

export interface StackCurrentWorkspace {
	id: string;
	name: string;
	projectId: string | null;
	hostId: string;
}

/**
 * Pairs every layer with the workspace already on its branch. Only live
 * workspaces of the same project on the same host count: an archived
 * tombstone or another host's clone would open a dead end. The current
 * layer always maps to the workspace being viewed, whatever its branch
 * field says mid-rename.
 */
export function findLayerWorkspace(
	layer: Pick<
		PullRequestStackData["layers"][number],
		"headRefName" | "isCurrent"
	>,
	current: StackCurrentWorkspace,
	siblings: StackSiblingWorkspace[],
): StackLayerWorkspace | null {
	if (layer.isCurrent) return { id: current.id, name: current.name };
	const match = siblings.find(
		(workspace) =>
			workspace.id !== current.id &&
			workspace.archivedAt == null &&
			workspace.hostId === current.hostId &&
			workspace.projectId === current.projectId &&
			workspace.branch === layer.headRefName,
	);
	return match ? { id: match.id, name: match.name } : null;
}

export function buildStackView(
	stack: PullRequestStackData,
	current: StackCurrentWorkspace,
	siblings: StackSiblingWorkspace[],
): PullRequestStackView {
	const layers: StackLayerView[] = stack.layers.map((layer) => ({
		...layer,
		blocker: getLayerBlocker(layer),
		workspace: findLayerWorkspace(layer, current, siblings),
	}));
	return {
		...stack,
		layers,
		readiness: summarizeStackReadiness(layers),
	};
}
