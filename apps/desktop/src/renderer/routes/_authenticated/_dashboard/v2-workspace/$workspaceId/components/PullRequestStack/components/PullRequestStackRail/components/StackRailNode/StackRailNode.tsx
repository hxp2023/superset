import { cn } from "@superset/ui/utils";
import type { PullRequestStackLayerData } from "../../../../types";

// `dark:` isn't used here — this app's globals.css never defines
// `@custom-variant dark`, so it would track the OS setting instead of the
// theme switcher. The hex values match PRIcon so a node and the badge icon
// beside it read as the same state.
const NODE_FILL: Record<PullRequestStackLayerData["state"], string> = {
	open: "bg-emerald-500 [.dark_&]:bg-[#34d399]",
	merged: "bg-violet-500 [.dark_&]:bg-[#b0a6d9]",
	closed: "bg-red-500 [.dark_&]:bg-[#e0918a]",
	draft: "bg-muted-foreground/50",
	queued: "bg-amber-500 [.dark_&]:bg-[#fbbf24]",
};

const NODE_RING: Record<PullRequestStackLayerData["state"], string> = {
	open: "ring-emerald-500/25",
	merged: "ring-violet-500/25",
	closed: "ring-red-500/25",
	draft: "ring-muted-foreground/20",
	queued: "ring-amber-500/25",
};

interface StackRailNodeProps {
	state: PullRequestStackLayerData["state"];
	/** The layer this workspace is on: a larger node with a halo. */
	isCurrent?: boolean;
	/** Whether the rail continues above (a higher layer) or below. */
	hasAbove: boolean;
	hasBelow: boolean;
}

/**
 * One dot on the rail. The line segments meet at the dot's centre, 12px
 * below the row's top edge — the text baseline of a `text-xs` first line
 * with `py-1` — so the rail reads as one continuous stroke.
 */
export function StackRailNode({
	state,
	isCurrent = false,
	hasAbove,
	hasBelow,
}: StackRailNodeProps) {
	return (
		<div
			className="relative flex w-4 shrink-0 justify-center"
			aria-hidden="true"
		>
			{hasAbove && <span className="absolute top-0 h-3 w-px bg-border" />}
			{hasBelow && <span className="absolute top-3 bottom-0 w-px bg-border" />}
			<span
				className={cn(
					"relative rounded-full",
					NODE_FILL[state],
					isCurrent
						? cn("mt-[7px] size-2.5 ring-2", NODE_RING[state])
						: "mt-2 size-2",
				)}
			/>
		</div>
	);
}

/** The trunk's anchor: a short bar where the rail ends. */
export function StackRailTrunkNode() {
	return (
		<div
			className="relative flex w-4 shrink-0 justify-center"
			aria-hidden="true"
		>
			<span className="absolute top-0 h-3 w-px bg-border" />
			<span className="relative mt-[11px] h-0.5 w-2.5 rounded-full bg-muted-foreground/50" />
		</div>
	);
}
