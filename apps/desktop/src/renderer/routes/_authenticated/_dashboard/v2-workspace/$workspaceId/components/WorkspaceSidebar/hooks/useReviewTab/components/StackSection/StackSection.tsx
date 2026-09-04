import { Trans, useLingui } from "@lingui/react/macro";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { cn } from "@superset/ui/utils";
import { useState } from "react";
import { VscChevronRight } from "react-icons/vsc";
import {
	buildRestackCommand,
	PullRequestStackRail,
	RestackCallout,
	StackReadinessLine,
	usePullRequestStack,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/PullRequestStack";
import type { RunTerminalCommand } from "../../../../types";

interface StackSectionProps {
	workspaceId: string;
	onRunCommand?: RunTerminalCommand;
}

/**
 * Where this PR sits in its stack and whether the stack can land. Renders
 * nothing for a PR that stands alone, so the tab reads exactly as before
 * for the common case.
 */
export function StackSection({ workspaceId, onRunCommand }: StackSectionProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(true);
	const { stack } = usePullRequestStack({ workspaceId });
	if (!stack) return null;

	const position = stack.currentPosition;
	const size = stack.layers.length;
	const mergedBelow = stack.mergedBelow;
	const restackCommand = mergedBelow
		? buildRestackCommand({
				source: stack.source,
				trunk: stack.baseRefName,
				mergedHeadOid: mergedBelow.headRefOid,
			})
		: null;

	return (
		<>
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger
					className={cn(
						"flex w-full min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-left",
						"cursor-pointer transition-colors hover:bg-accent/30",
					)}
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<VscChevronRight
							className={cn(
								"size-3 shrink-0 text-muted-foreground transition-transform duration-150",
								open && "rotate-90",
							)}
						/>
						<span className="truncate text-xs font-medium">
							<Trans context="pull request stack">Stack</Trans>
						</span>
						<span className="shrink-0 text-[10px] text-muted-foreground">
							{t({
								message: `Layer ${position} of ${size}`,
							})}
						</span>
					</div>
					<StackReadinessLine
						readiness={stack.readiness}
						className="max-w-[180px] shrink"
					/>
				</CollapsibleTrigger>
				<CollapsibleContent className="min-w-0 overflow-hidden px-2 pb-1.5">
					{mergedBelow && restackCommand && (
						<RestackCallout
							mergedBelow={mergedBelow}
							trunk={stack.baseRefName}
							command={restackCommand}
							onRun={
								onRunCommand
									? () =>
											void onRunCommand({
												command: restackCommand,
												title: t({
													message: "Restack",
												}),
											})
									: undefined
							}
						/>
					)}
					<PullRequestStackRail stack={stack} variant="full" />
				</CollapsibleContent>
			</Collapsible>
			<div className="my-1 border-b border-border/70" />
		</>
	);
}
