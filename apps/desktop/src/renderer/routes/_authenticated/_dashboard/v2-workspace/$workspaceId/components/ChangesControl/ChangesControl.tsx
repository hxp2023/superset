import { useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { GitCompareArrows } from "lucide-react";
import { memo, useMemo } from "react";
import { useWorkspaceGitStatus } from "../../providers/WorkspaceGitStatusProvider";
import { changesPillStats } from "./changesPillStats";
import { PRStatusGroup } from "./components/PRStatusGroup";
import { ShipControl } from "./components/ShipControl";
import { usePRFlowState } from "./hooks/usePRFlowState";

interface ChangesControlProps {
	workspaceId: string;
	onOpenChanges: () => void;
}

/**
 * Top-bar Changes cluster: the diff-stat pill that opens the Changes pane
 * (the at-a-glance dirty signal the sidebar Changes tab's badge used to be),
 * next to the workspace's PR badge — status icon, number, check indicators,
 * merge menu — when a PR exists.
 *
 * Each half hides on its own: the pill while status is unknown or the tree is
 * clean (mirroring BackgroundTerminalsButton's disappear-at-zero behavior);
 * the right half is the PR badge once a PR exists, the ShipControl
 * (commit → push → create PR) before one does, and nothing while the flow
 * state is loading or unavailable — no dead placeholder affordances.
 */
export const ChangesControl = memo(function ChangesControl({
	workspaceId,
	onOpenChanges,
}: ChangesControlProps) {
	const { t } = useLingui();
	const status = useWorkspaceGitStatus();
	const { flowState, onRetry } = usePRFlowState(workspaceId);
	const stats = useMemo(
		() => (status.data ? changesPillStats(status.data) : null),
		[status.data],
	);

	const label = t({
		id: "workspace.changesPill.openChanges",
		message: "Open changes",
	});

	return (
		<>
			{stats != null && stats.fileCount > 0 && (
				<Button
					className="h-7 gap-1 rounded-md border border-border/60 bg-muted/30 px-2 text-xs text-muted-foreground shadow-none hover:bg-accent/60 hover:text-foreground"
					size="sm"
					type="button"
					variant="ghost"
					onClick={onOpenChanges}
					aria-label={label}
					title={label}
				>
					<GitCompareArrows className="size-3.5" />
					<span className="tabular-nums text-emerald-600 [.dark_&]:text-[#34d399]">
						+{stats.additions}
					</span>
					<span className="tabular-nums text-red-600 [.dark_&]:text-[#f87171]">
						−{stats.deletions}
					</span>
				</Button>
			)}
			{flowState.kind === "no-pr" ? (
				<ShipControl
					workspaceId={workspaceId}
					sync={flowState.sync}
					onRefresh={onRetry}
				/>
			) : (
				<PRStatusGroup
					state={flowState}
					workspaceId={workspaceId}
					onRefresh={onRetry}
				/>
			)}
		</>
	);
});
