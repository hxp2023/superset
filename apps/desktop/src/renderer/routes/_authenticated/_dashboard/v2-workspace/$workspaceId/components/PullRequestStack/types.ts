import type { AppRouter } from "@superset/host-service";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type PullRequestStackData = NonNullable<
	RouterOutputs["git"]["getPullRequestStack"]
>;
export type PullRequestStackLayerData = PullRequestStackData["layers"][number];

/**
 * What stops a layer from landing, ordered by what the author fixes first:
 * a closed or draft PR is not a candidate at all, conflicts and red checks
 * are the author's to fix, requested changes need new work, and the last two
 * only need waiting.
 */
export type StackLayerBlocker =
	| "closed"
	| "draft"
	| "conflicts"
	| "checks_failing"
	| "changes_requested"
	| "checks_pending"
	| "review_required";

export interface StackLayerWorkspace {
	id: string;
	name: string;
}

export interface StackLayerView extends PullRequestStackLayerData {
	/** Null when the layer is ready to land, or already merged. */
	blocker: StackLayerBlocker | null;
	/** The workspace on this layer's branch, when one exists on this host. */
	workspace: StackLayerWorkspace | null;
}

export type StackReadiness =
	/** Every layer has merged. */
	| { kind: "landed" }
	/** Every unmerged layer can land, bottom to top. */
	| { kind: "all-ready" }
	/** Layers up to this PR can land; the one above it cannot. */
	| { kind: "ready-through"; number: number }
	/** The lowest unmerged layer cannot land, so nothing can. */
	| { kind: "blocked"; number: number };

export interface PullRequestStackView
	extends Omit<PullRequestStackData, "layers"> {
	layers: StackLayerView[];
	readiness: StackReadiness;
}
