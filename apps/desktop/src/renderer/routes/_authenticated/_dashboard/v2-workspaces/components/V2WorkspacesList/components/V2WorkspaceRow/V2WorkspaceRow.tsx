import { Button } from "@superset/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { CgLaptop } from "react-icons/cg";
import { LuGitBranch, LuSquareTerminal, LuTrash2 } from "react-icons/lu";
import { RiPushpinFill, RiPushpinLine } from "react-icons/ri";
import { V2WorkspaceContextMenu } from "renderer/routes/_authenticated/_dashboard/v2-workspaces/components/V2WorkspaceContextMenu";
import { V2WorkspaceProjectIcon } from "renderer/routes/_authenticated/_dashboard/v2-workspaces/components/V2WorkspaceProjectIcon";
import type { AccessibleV2Workspace } from "renderer/routes/_authenticated/_dashboard/v2-workspaces/hooks/useAccessibleV2Workspaces";
import { workspaceActivityAt } from "renderer/routes/_authenticated/_dashboard/v2-workspaces/utils/sortWorkspaces";
import { getRelativeTime } from "renderer/screens/main/components/WorkspacesListView/utils";
import { WorkspaceAgentIcon } from "./components/WorkspaceAgentIcon";
import { WorkspaceNameMarquee } from "./components/WorkspaceNameMarquee";
import { WorkspacePrPill } from "./components/WorkspacePrPill";
import { WorkspaceStateGlyph } from "./components/WorkspaceStateGlyph";

interface V2WorkspaceRowProps {
	workspace: AccessibleV2Workspace;
	isCurrentRoute: boolean;
}

/** 181909 → "181.9k" — keeps outlier churn from blowing out the stats slot. */
function formatCount(count: number): string {
	if (count < 10_000) return String(count);
	return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

export function V2WorkspaceRow({
	workspace,
	isCurrentRoute,
}: V2WorkspaceRowProps) {
	const isMainWorkspace = workspace.type === "main";

	const creatorLabel = workspace.isCreatedByCurrentUser
		? "you"
		: workspace.createdByName;

	// The visible age tracks activity (matches the default sort); creation
	// and last-agent-event details live in the tooltip.
	const timeLabel = getRelativeTime(workspaceActivityAt(workspace), {
		format: "compact",
	});
	const timeTitle = [
		`Created ${workspace.createdAt.toLocaleString()}${creatorLabel ? ` by ${creatorLabel}` : ""}`,
		workspace.lastAgentEventAt
			? `Last agent activity ${new Date(workspace.lastAgentEventAt).toLocaleString()}`
			: null,
	]
		.filter(Boolean)
		.join("\n");

	return (
		<V2WorkspaceContextMenu
			workspace={workspace}
			isCurrentRoute={isCurrentRoute}
		>
			{(actions) => (
				// biome-ignore lint/a11y/useSemanticElements: The row contains nested action buttons, so it cannot be a native button.
				<div
					role="button"
					aria-current={isCurrentRoute ? "page" : undefined}
					tabIndex={0}
					onClick={actions.open}
					onKeyDown={(event) => {
						if (event.target !== event.currentTarget) return;
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							actions.open();
						}
					}}
					className={cn(
						"group/row flex cursor-pointer items-center gap-3 border-b border-border/40 px-6 py-2 text-sm outline-none transition-colors",
						"focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
						isCurrentRoute
							? "bg-muted hover:bg-muted focus-visible:bg-muted"
							: "hover:bg-accent/50 focus-visible:bg-accent/50",
					)}
				>
					<WorkspaceStateGlyph workspace={workspace} />

					{isMainWorkspace ? (
						<Tooltip delayDuration={300}>
							<TooltipTrigger asChild>
								<CgLaptop
									className="size-3.5 shrink-0 text-muted-foreground"
									aria-label="Main workspace"
								/>
							</TooltipTrigger>
							<TooltipContent side="top">Main workspace</TooltipContent>
						</Tooltip>
					) : null}

					{/* Two lines instead of a column-per-field row: the name
					    gets its own line to breathe, and everything else
					    flows together below it at its natural width — no
					    slot is reserved for a field that has nothing to
					    show, and there's no longer a rigid column set that
					    breakpoints have to hide pieces of to protect the
					    name's space. */}
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex items-center gap-2">
							<WorkspaceNameMarquee
								name={workspace.name}
								className={cn(
									"min-w-0 flex-1 font-medium",
									// Done states recede so live work owns the contrast.
									workspace.archivedAt != null ||
										workspace.pr?.state === "merged"
										? "text-muted-foreground"
										: "text-foreground",
								)}
							/>

							{/* Automation runs share a name; the run stamp is the
							    "AS-11" that tells ten identical rows apart
							    (Linear's muted ID). */}
							{workspace.type === "session" ? (
								<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
									{workspace.createdAt.toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
									})}
									{" · "}
									{workspace.createdAt.toLocaleTimeString(undefined, {
										hour: "2-digit",
										minute: "2-digit",
									})}
								</span>
							) : null}

							<span
								className="ml-auto shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
								title={timeTitle}
							>
								{timeLabel}
							</span>
						</div>

						<div className="flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
							{workspace.pr ? (
								<WorkspacePrPill pr={workspace.pr} branch={workspace.branch} />
							) : null}

							{workspace.agentIds.length > 0 ? (
								<span className="flex shrink-0 items-center gap-1">
									{workspace.agentIds.slice(0, 3).map((agentId) => (
										<WorkspaceAgentIcon key={agentId} agentId={agentId} />
									))}
								</span>
							) : null}

							{workspace.diffStats &&
							(workspace.diffStats.additions > 0 ||
								workspace.diffStats.deletions > 0) ? (
								<span
									className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums leading-none"
									title={`${workspace.diffStats.fileCount} changed ${workspace.diffStats.fileCount === 1 ? "file" : "files"}`}
								>
									<span className="text-emerald-600/80 dark:text-emerald-400/70">
										+{formatCount(workspace.diffStats.additions)}
									</span>
									<span className="text-red-600/80 dark:text-red-400/70">
										−{formatCount(workspace.diffStats.deletions)}
									</span>
								</span>
							) : null}

							{/* Branch equal to the display name (main workspaces) or a
							    session's default checkout says nothing useful. */}
							{workspace.type !== "session" &&
							workspace.branch.toLowerCase() !==
								workspace.name.toLowerCase() ? (
								<span
									className="flex min-w-0 shrink items-center gap-1"
									title={workspace.branch}
								>
									<LuGitBranch className="size-3 shrink-0" />
									<span className="min-w-0 truncate font-mono text-[11px]">
										{workspace.branch}
									</span>
								</span>
							) : null}

							<span
								className="flex shrink-0 items-center gap-1.5"
								title={workspace.projectName ?? "Session (no project)"}
							>
								{workspace.projectName ? (
									<V2WorkspaceProjectIcon
										projectName={workspace.projectName}
										iconUrl={workspace.projectIconUrl}
										size="sm"
										className="size-3.5 text-[8px]"
									/>
								) : (
									<LuSquareTerminal className="size-3.5 shrink-0 text-muted-foreground/70" />
								)}
								<span className="truncate">
									{workspace.projectName ?? "Session"}
								</span>
							</span>
						</div>
					</div>

					{/* Space is always reserved so the row doesn't shift when
					    these fade in on hover. */}
					<span className="flex w-14 shrink-0 items-center justify-end gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
						{workspace.isInSidebar ? (
							<Button
								size="icon"
								variant="ghost"
								onClick={(event) => {
									event.stopPropagation();
									actions.removeFromSidebar();
								}}
								disabled={isCurrentRoute}
								aria-label="Unpin from sidebar"
								title={
									isCurrentRoute
										? "Can't unpin the current workspace"
										: "Unpin from sidebar"
								}
								className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
							>
								<RiPushpinFill className="size-3.5" />
							</Button>
						) : (
							<Button
								size="icon"
								variant="ghost"
								onClick={(event) => {
									event.stopPropagation();
									actions.addToSidebar();
								}}
								aria-label="Pin to sidebar"
								title="Pin to sidebar"
								className="size-6 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
							>
								<RiPushpinLine className="size-3.5" />
							</Button>
						)}
						{!isMainWorkspace ? (
							<Button
								size="icon"
								variant="ghost"
								onClick={(event) => {
									event.stopPropagation();
									actions.openDeleteDialog();
								}}
								aria-label="Delete workspace"
								title="Delete workspace"
								className="size-6 text-muted-foreground hover:bg-transparent hover:text-destructive dark:hover:bg-transparent"
							>
								<LuTrash2 className="size-3.5" />
							</Button>
						) : null}
					</span>
				</div>
			)}
		</V2WorkspaceContextMenu>
	);
}
