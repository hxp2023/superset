import type {
	PullRequestStackLayerData,
	StackLayerBlocker,
	StackReadiness,
} from "../../types";

type LayerSignals = Pick<
	PullRequestStackLayerData,
	"state" | "mergeability" | "reviewDecision" | "checksStatus"
>;

/**
 * The one thing standing between a layer and the merge button. A layer can
 * have several problems at once; the first in fix-order is the one worth a
 * label, since the author has to clear it before the others matter.
 */
export function getLayerBlocker(layer: LayerSignals): StackLayerBlocker | null {
	if (layer.state === "merged") return null;
	if (layer.state === "closed") return "closed";
	if (layer.state === "draft") return "draft";
	if (layer.mergeability === "conflicting") return "conflicts";
	if (layer.checksStatus === "failure") return "checks_failing";
	if (layer.reviewDecision === "changes_requested") return "changes_requested";
	if (layer.checksStatus === "pending") return "checks_pending";
	if (layer.reviewDecision === "review_required") return "review_required";
	return null;
}

/**
 * Stacks land bottom-up, so readiness is a prefix: the layers that can
 * merge are the unmerged ones from the trunk up to the first blocked layer.
 * `layers` must be ordered by position, trunk-most first.
 */
export function summarizeStackReadiness(
	layers: Array<LayerSignals & { number: number }>,
): StackReadiness {
	const unmerged = layers.filter((layer) => layer.state !== "merged");
	if (unmerged.length === 0) return { kind: "landed" };

	let readyThrough: number | null = null;
	for (const layer of unmerged) {
		if (getLayerBlocker(layer)) {
			return readyThrough == null
				? { kind: "blocked", number: layer.number }
				: { kind: "ready-through", number: readyThrough };
		}
		readyThrough = layer.number;
	}
	return { kind: "all-ready" };
}
