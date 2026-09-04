import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { cn } from "@superset/ui/utils";
import type { StackLayerView } from "../../../../types";

type StatusKey =
	| "merged"
	| "closed"
	| "queued"
	| "ready"
	| NonNullable<StackLayerView["blocker"]>;

const RED = "text-red-600 [.dark_&]:text-[#f87171]";
const AMBER = "text-amber-600 [.dark_&]:text-[#fbbf24]";
const RED_DOT = "bg-red-500 [.dark_&]:bg-[#f87171]";
const AMBER_DOT = "bg-amber-500 [.dark_&]:bg-[#fbbf24]";

const STATUS: Record<
	StatusKey,
	{ label: ReturnType<typeof msg>; text: string; dot: string }
> = {
	ready: {
		label: msg({ message: "Ready", context: "stack layer" }),
		text: "text-emerald-600 [.dark_&]:text-[#34d399]",
		dot: "bg-emerald-500 [.dark_&]:bg-[#34d399]",
	},
	merged: {
		label: msg({ message: "Merged" }),
		text: "text-violet-600 [.dark_&]:text-[#b0a6d9]",
		dot: "bg-violet-500 [.dark_&]:bg-[#b0a6d9]",
	},
	closed: { label: msg({ message: "Closed" }), text: RED, dot: RED_DOT },
	draft: {
		label: msg({ message: "Draft" }),
		text: "text-muted-foreground",
		dot: "bg-muted-foreground/50",
	},
	queued: { label: msg({ message: "Queued" }), text: AMBER, dot: AMBER_DOT },
	conflicts: { label: msg({ message: "Conflicts" }), text: RED, dot: RED_DOT },
	checks_failing: {
		label: msg({ message: "Checks failing" }),
		text: RED,
		dot: RED_DOT,
	},
	changes_requested: {
		label: msg({ message: "Changes requested" }),
		text: RED,
		dot: RED_DOT,
	},
	checks_pending: {
		label: msg({ message: "Checks running" }),
		text: AMBER,
		dot: AMBER_DOT,
	},
	review_required: {
		label: msg({ message: "Review required" }),
		text: AMBER,
		dot: AMBER_DOT,
	},
};

function resolveStatusKey(layer: StackLayerView): StatusKey {
	if (layer.state === "merged") return "merged";
	if (layer.state === "closed") return "closed";
	if (layer.blocker) return layer.blocker;
	if (layer.state === "queued") return "queued";
	return "ready";
}

interface StackLayerStatusProps {
	layer: StackLayerView;
	/** `dot` for tight rows; the label moves into the tooltip. */
	variant: "label" | "dot";
}

/** One word per layer: what it is, or the first thing keeping it from landing. */
export function StackLayerStatus({ layer, variant }: StackLayerStatusProps) {
	const status = STATUS[resolveStatusKey(layer)];
	const label = i18n._(status.label);
	if (variant === "dot") {
		return (
			<span
				className={cn("size-1.5 shrink-0 rounded-full", status.dot)}
				role="img"
				aria-label={label}
				title={label}
			/>
		);
	}
	return (
		<span
			className={cn(
				"shrink-0 text-[10px] font-medium whitespace-nowrap",
				status.text,
			)}
		>
			{label}
		</span>
	);
}
