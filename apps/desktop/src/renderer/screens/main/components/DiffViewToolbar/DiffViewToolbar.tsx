import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import {
	LuChevronDown,
	LuChevronUp,
	LuColumns2,
	LuFiles,
	LuFoldVertical,
	LuRows2,
	LuUnfoldVertical,
} from "react-icons/lu";
import { useSettings } from "renderer/stores/settings";

export interface DiffViewToolbarCommentNav {
	/** Index into the ordered thread list, or null before any navigation. */
	focusedIndex: number | null;
	total: number;
	onPrev: () => void;
	onNext: () => void;
}

interface DiffViewToolbarProps {
	fileCount: number;
	isTreeCollapsed: boolean;
	onToggleTree: () => void;
	areAllFilesCollapsed: boolean;
	onToggleCollapseAll: () => void;
	/** Prev/next review-comment cluster; hidden when null or total is 0. */
	commentNav?: DiffViewToolbarCommentNav | null;
}

/**
 * Toolbar row above a card-styled diff (the PR Code tab and the v2-workspace
 * DiffPane): file-tree toggle + collapse/expand-all on the left, comment
 * navigation + unified/split on the right. The unified/split toggles
 * read/write the persisted app setting directly — the same one every diff
 * surface renders from — so a toggle made here carries across surfaces
 * instead of silently overriding the user's saved preference with a local
 * default.
 */
export function DiffViewToolbar({
	fileCount,
	isTreeCollapsed,
	onToggleTree,
	areAllFilesCollapsed,
	onToggleCollapseAll,
	commentNav,
}: DiffViewToolbarProps) {
	const diffStyle = useSettings((s) => s.diffStyle);
	const updateSetting = useSettings((s) => s.update);

	const toggleClass = (active: boolean) =>
		cn(
			"flex size-5 items-center justify-center rounded transition-colors",
			active
				? "bg-secondary text-foreground"
				: "text-muted-foreground hover:text-foreground",
		);

	return (
		<div className="flex shrink-0 items-center justify-between gap-1 border-b border-border/20 px-2 py-1.5">
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={onToggleTree}
					aria-label={isTreeCollapsed ? "Show file tree" : "Hide file tree"}
					className="flex items-center gap-1.5 rounded-md bg-fill-hover px-1.5 py-1 text-muted-foreground transition-colors hover:bg-fill-selected hover:text-foreground"
				>
					<LuFiles className="size-3.5 shrink-0" strokeWidth={1.5} />
					<span className="text-[11px] font-medium">Files</span>
					<span className="text-[11px] tabular-nums text-muted-foreground/70">
						{fileCount}
					</span>
				</button>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={onToggleCollapseAll}
							aria-label={
								areAllFilesCollapsed ? "Expand all files" : "Collapse all files"
							}
							className="flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
						>
							{areAllFilesCollapsed ? (
								<LuUnfoldVertical className="size-3.5" strokeWidth={1.5} />
							) : (
								<LuFoldVertical className="size-3.5" strokeWidth={1.5} />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{areAllFilesCollapsed ? "Expand all files" : "Collapse all files"}
					</TooltipContent>
				</Tooltip>
			</div>
			<div className="flex items-center gap-1">
				{commentNav != null && commentNav.total > 0 && (
					<>
						<div className="flex items-center gap-0.5 rounded-md bg-muted/50 px-1 py-0.5">
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={commentNav.onPrev}
										aria-label="Previous comment"
										className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
									>
										<LuChevronUp className="size-3.5" strokeWidth={1.5} />
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">Previous comment</TooltipContent>
							</Tooltip>
							<span className="min-w-[3ch] text-center text-[11px] tabular-nums text-muted-foreground">
								{commentNav.focusedIndex != null
									? commentNav.focusedIndex + 1
									: "–"}
								/{commentNav.total}
							</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={commentNav.onNext}
										aria-label="Next comment"
										className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
									>
										<LuChevronDown className="size-3.5" strokeWidth={1.5} />
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">Next comment</TooltipContent>
							</Tooltip>
						</div>
						<div className="mx-0.5 h-4 w-px bg-border" />
					</>
				)}
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => updateSetting("diffStyle", "unified")}
							aria-label="Unified view"
							aria-pressed={diffStyle === "unified"}
							className={toggleClass(diffStyle === "unified")}
						>
							<LuRows2 className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">Unified view</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => updateSetting("diffStyle", "split")}
							aria-label="Split view"
							aria-pressed={diffStyle === "split"}
							className={toggleClass(diffStyle === "split")}
						>
							<LuColumns2 className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">Split view</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
