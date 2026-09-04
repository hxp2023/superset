import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { useMemo } from "react";
import { useOpenStackLayer } from "../../hooks/useOpenStackLayer";
import type { PullRequestStackView } from "../../types";
import { StackLayerRow } from "./components/StackLayerRow";
import { StackRailTrunkNode } from "./components/StackRailNode";

interface PullRequestStackRailProps {
	stack: PullRequestStackView;
	/** `compact` drops the branch line and hover actions for a popover. */
	variant: "compact" | "full";
	className?: string;
}

/**
 * The stack as a rail: the trunk at the bottom, each layer stacked on the
 * one beneath it, the way commits pile up — the same orientation as
 * `gh stack view` and GitHub's own stack map, so nobody has to relearn which
 * way is up.
 */
export function PullRequestStackRail({
	stack,
	variant,
	className,
}: PullRequestStackRailProps) {
	const { t } = useLingui();
	const { openWorkspace, openInNewWorkspace, canOpenInNewWorkspace } =
		useOpenStackLayer();
	const topFirst = useMemo(
		() => [...stack.layers].sort((a, b) => b.position - a.position),
		[stack.layers],
	);

	return (
		<ol
			className={cn("flex min-w-0 flex-col", className)}
			aria-label={t({
				message: "Stack",
				context: "pull request stack",
			})}
		>
			{topFirst.map((layer, index) => (
				<StackLayerRow
					key={layer.number}
					layer={layer}
					variant={variant}
					hasAbove={index > 0}
					hasBelow
					onOpenWorkspace={openWorkspace}
					onOpenInNewWorkspace={openInNewWorkspace}
					canOpenInNewWorkspace={canOpenInNewWorkspace}
				/>
			))}
			<li className="relative flex min-w-0 gap-1.5">
				<StackRailTrunkNode />
				<div
					className="min-w-0 flex-1 truncate px-1.5 py-1 font-mono text-[10px] text-muted-foreground"
					title={stack.baseRefName}
				>
					{stack.baseRefName}
				</div>
			</li>
		</ol>
	);
}
