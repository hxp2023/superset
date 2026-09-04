import { Trans } from "@lingui/react/macro";
import { LuTerminal, LuTriangleAlert } from "react-icons/lu";
import type { PullRequestStackView } from "../../types";

interface RestackCalloutProps {
	mergedBelow: NonNullable<PullRequestStackView["mergedBelow"]>;
	trunk: string;
	/** The exact command the button runs, shown so nothing happens unseen. */
	command: string;
	/** Absent when no terminal can be opened from here; the command still shows. */
	onRun?: () => void;
}

/**
 * The one situation a stack needs a hand with: the layer beneath this one
 * landed, GitHub retargeted this PR to the trunk, and the branch still
 * carries the merged commits — which the trunk now holds as a squash, so
 * GitHub reports conflicts until the branch is replayed on top.
 */
export function RestackCallout({
	mergedBelow,
	trunk,
	command,
	onRun,
}: RestackCalloutProps) {
	const number = mergedBelow.number;
	return (
		<div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2">
			<div className="flex items-start gap-2">
				<LuTriangleAlert
					aria-hidden="true"
					className="mt-0.5 size-3.5 shrink-0 text-amber-600 [.dark_&]:text-[#fbbf24]"
				/>
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium text-foreground">
						<Trans>#{number} merged below this branch</Trans>
					</p>
					<p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
						<Trans>
							Restack to replay this branch's commits on top of {trunk} and
							clear the conflicts.
						</Trans>
					</p>
					<code
						className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/80"
						title={command}
					>
						{command}
					</code>
					{onRun && (
						<button
							type="button"
							onClick={onRun}
							className="mt-2 inline-flex h-6 items-center gap-1 rounded-md border border-amber-500/30 bg-background/60 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<LuTerminal className="size-3" aria-hidden="true" />
							<Trans>Restack onto {trunk}</Trans>
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
