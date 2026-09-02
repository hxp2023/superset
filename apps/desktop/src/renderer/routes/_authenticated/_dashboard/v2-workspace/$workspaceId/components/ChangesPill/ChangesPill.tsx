import { useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { GitCompareArrows } from "lucide-react";
import { memo, useMemo } from "react";
import { useWorkspaceGitStatus } from "../../providers/WorkspaceGitStatusProvider";
import { changesPillStats } from "./changesPillStats";

interface ChangesPillProps {
	onClick: () => void;
}

/**
 * Top-bar entry point into the Changes pane, and the at-a-glance signal that
 * the worktree is dirty (the role the sidebar Changes tab's badge used to
 * play). Hidden while status is unknown or the tree is clean, mirroring
 * BackgroundTerminalsButton's disappear-at-zero behavior.
 */
export const ChangesPill = memo(function ChangesPill({
	onClick,
}: ChangesPillProps) {
	const { t } = useLingui();
	const status = useWorkspaceGitStatus();
	const stats = useMemo(
		() => (status.data ? changesPillStats(status.data) : null),
		[status.data],
	);

	if (!stats || stats.fileCount === 0) return null;

	const label = t({
		id: "workspace.changesPill.openChanges",
		message: "Open changes",
	});

	return (
		<Button
			className="h-7 gap-1 rounded-md border border-border/60 bg-muted/30 px-2 text-xs text-muted-foreground shadow-none hover:bg-accent/60 hover:text-foreground"
			size="sm"
			type="button"
			variant="ghost"
			onClick={onClick}
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
	);
});
