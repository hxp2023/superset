import { Trans, useLingui } from "@lingui/react/macro";
import { AGENT_IDENTITY_LABELS } from "@superset/shared/agent-catalog";
import { Checkbox } from "@superset/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { workspaceTrpc } from "@superset/workspace-client";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	VscChevronDown,
	VscDebugStop,
	VscEdit,
	VscGitCommit,
	VscGitPullRequestCreate,
	VscLoading,
	VscRepoPush,
	VscSend,
	VscTerminal,
} from "react-icons/vsc";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import { useTerminalAgentBindings } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { usePullRequestsSplitViewStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsSplitViewStore";
import {
	type AgentSessionPlacement,
	EXISTING_PREFIX,
	NEW_PREFIX,
	useDiffCommentTarget,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AgentCommentComposer";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useWorkspaceGitStatus } from "../../../../providers/WorkspaceGitStatusProvider";
import type { BranchSyncStatus } from "../../utils/getPRFlowState";
import { useCreatePrWithAgent } from "./hooks/useCreatePrWithAgent";

interface ShipControlProps {
	workspaceId: string;
	sync: BranchSyncStatus;
	onRefresh: () => void;
	/**
	 * True when the diff-stat face is showing next to this segment: the ship
	 * actions collapse into the chevron menu so the control keeps one face.
	 */
	compact?: boolean;
	/** Brings a terminal pane into view: opens a freshly launched agent's
	 * pane on dispatch (at `placement`), and backs "Show agent terminal"
	 * while it works. */
	onOpenTerminal?: (
		terminalId: string,
		placement?: AgentSessionPlacement,
	) => void;
}

/**
 * The no-PR half of the top-bar Changes control: walks the branch to a pull
 * request. Full mode shows one face; compact mode (diff stats own the face)
 * folds the same actions into the chevron menu.
 *
 * Create PR hands the branch to an agent (`useCreatePrWithAgent`) and is the
 * face whenever the project can open PRs — the agent commits a dirty tree
 * first, so Commit and Push become chevron entries. The target is the diff
 * composer's model, picked and remembered by `useDiffCommentTarget` and
 * shown in the chevron's "Send to" submenu: a live agent terminal in the
 * workspace, or a new agent terminal launched with the prompt. The face
 * shows "Creating PR…" until the PR is confirmed (the control then flips to
 * its PR badge), the agent finishes without one, or the wait times out.
 * "Create PR manually…" keeps today's title/description popover (which
 * pushes first when the branch is unpublished or ahead) as the by-hand path.
 *
 * Session workspaces (null projectId) can't create PRs — the PR route and
 * repo resolution are project-scoped — so they only ever see Commit/Push.
 */
export function ShipControl({
	workspaceId,
	sync,
	onRefresh,
	compact = false,
	onOpenTerminal,
}: ShipControlProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const { workspace } = useWorkspace();
	const status = useWorkspaceGitStatus();
	const projectId = workspace.projectId;
	const canCreatePr = projectId != null;

	const needsCommit = sync.hasUncommitted;
	const needsPush = !sync.hasUpstream || sync.pushCount > 0;

	// Which popover form is open; both anchor to the whole segment so the
	// compact menu items and the full-mode faces share one Popover.
	const [view, setView] = useState<"commit" | "pr" | null>(null);
	// A compact menu item can't open the popover directly: the menu content
	// stays mounted (and keeps reclaiming focus) through its exit animation,
	// so a popover opened on click loses its autofocused field a few
	// milliseconds later and dismisses itself as focus-outside. Items only
	// record the intent; the menu's onCloseAutoFocus — which fires once its
	// focus scope is genuinely torn down — opens the popover and suppresses
	// the focus-return to the chevron (equally focus-outside).
	const pendingViewRef = useRef<"commit" | "pr" | null>(null);
	const [commitMessage, setCommitMessage] = useState("");
	const [prTitle, setPrTitle] = useState("");
	const [prBody, setPrBody] = useState("");
	const [prDraft, setPrDraft] = useState(false);

	// The branch's commits ahead of its base: prefills the PR title from the
	// latest subject, and gates Create PR — GitHub rejects a PR with no
	// commits between base and head, so the action disables instead of
	// surfacing that as a failure toast. Counted against the configured
	// branch.<name>.base (the base createForWorkspace actually opens
	// against) — measuring against the repo default gets stacked branches
	// exactly backwards. Same 10s cadence as the PR/sync queries so
	// committing (here or in a terminal) enables it promptly; both queries
	// dedupe with ChangesPanel's identical ones.
	const baseBranchQuery = workspaceTrpc.git.getBaseBranch.useQuery(
		{ workspaceId },
		{ enabled: canCreatePr, staleTime: Number.POSITIVE_INFINITY },
	);
	const commitsQuery = workspaceTrpc.git.listCommits.useQuery(
		{
			workspaceId,
			baseBranch: baseBranchQuery.data?.baseBranch ?? undefined,
		},
		{
			enabled: canCreatePr && baseBranchQuery.isSuccess,
			refetchInterval: 10_000,
			refetchOnWindowFocus: true,
			staleTime: 10_000,
		},
	);
	// Optimistic while loading so the action doesn't flash disabled.
	const hasCommitsAhead =
		commitsQuery.data == null || commitsQuery.data.commits.length > 0;
	const latestSubject = commitsQuery.data?.commits[0]?.message ?? "";

	const commitMutation = workspaceTrpc.git.commit.useMutation({
		onSuccess: () => {
			toast.success(
				t({ id: "workspace.shipControl.committed", message: "Committed" }),
			);
			setView(null);
			setCommitMessage("");
			// The 10s poll is too slow here: the face flips to Create PR
			// immediately and must not sit disabled on pre-commit data.
			void commitsQuery.refetch();
			onRefresh();
		},
		onError: (error) => {
			toast.error(
				t({
					id: "workspace.shipControl.commitFailed",
					message: `Commit failed: ${error.message}`,
				}),
			);
		},
	});

	const pushMutation = workspaceTrpc.git.push.useMutation({
		onSuccess: () => {
			toast.success(
				t({ id: "workspace.shipControl.pushed", message: "Pushed" }),
			);
			onRefresh();
		},
		onError: (error) => {
			toast.error(
				t({
					id: "workspace.shipControl.pushFailed",
					message: `Push failed: ${error.message}`,
				}),
			);
		},
	});

	// A second push mutation with no global toasts: the create-PR flow runs
	// its own labeled toast sequence, and reusing `pushMutation` there popped
	// a stray "Pushed" toast mid-flow (and a duplicate, mislabeled error).
	// It still refreshes on success so a push that lands right before a
	// failed PR create is reflected without waiting out the 10s poll.
	const flowPushMutation = workspaceTrpc.git.push.useMutation({
		onSuccess: () => onRefresh(),
	});
	const createPrMutation =
		workspaceTrpc.pullRequests.createForWorkspace.useMutation();

	// Seed the title from the latest commit subject when the PR form opens. A
	// render-time `prTitle || latestSubject` fallback looked the same but
	// made the field uneditable: clearing it snapped the prefill straight
	// back. The effect covers the form opening before listCommits resolves —
	// it seeds late when the subject arrives, but never over the user's own
	// typing (or deliberate clearing).
	const prTitleTouchedRef = useRef(false);
	const openPrView = () => {
		setPrTitle((prev) => prev || latestSubject);
		setView("pr");
	};
	useEffect(() => {
		if (
			view === "pr" &&
			!prTitleTouchedRef.current &&
			prTitle === "" &&
			latestSubject
		) {
			setPrTitle(latestSubject);
		}
	}, [view, prTitle, latestSubject]);

	const isShipping =
		pushMutation.isPending ||
		flowPushMutation.isPending ||
		createPrMutation.isPending;

	const noCommitsTooltip = t({
		id: "workspace.shipControl.noCommitsTooltip",
		message: "No commits to open a pull request from",
	});
	const noAgentTooltip = t({
		id: "workspace.shipControl.noAgentTooltip",
		message: "No agent to send this to — add one in Settings → Agents",
	});

	// The agent target — same picker state as the diff comment composer, so
	// the remembered session/config and placement are shared.
	const bindings = useTerminalAgentBindings(workspaceId, {
		enabled: canCreatePr,
	});
	const sessions = useMemo(
		() => [...bindings.values()].sort((a, b) => b.lastEventAt - a.lastEventAt),
		[bindings],
	);
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const { data: configs = [] } = useV2AgentConfigs(
		canCreatePr ? hostUrl : null,
	);
	const agentTarget = useDiffCommentTarget({ sessions, configs });
	const targetLabel = useMemo(() => {
		const resolved = agentTarget.resolved;
		if (!resolved) return null;
		if (resolved.kind === "existing") {
			const session = sessions.find(
				(s) => s.terminalId === resolved.terminalId,
			);
			return session ? sessionLabel(session.agentId, session.terminalId) : null;
		}
		const config = configs.find((c) => c.id === resolved.configId);
		return config
			? t({
					id: "workspace.shipControl.newSessionTargetLabel",
					message: `a new ${config.label} session`,
				})
			: null;
	}, [agentTarget.resolved, configs, sessions, t]);

	const agentPr = useCreatePrWithAgent({
		workspaceId,
		projectId,
		target: agentTarget.resolved,
		placement: agentTarget.placement,
		onPrCreated: onRefresh,
		onOpenTerminal,
	});
	const agentBusy = agentPr.status !== null || agentPr.isDispatching;
	// A dirty tree is enough for the agent (it commits first); the manual
	// popover still needs commits, since GitHub rejects an empty PR.
	const hasSomethingToShip = hasCommitsAhead || needsCommit;
	const canDispatch = hasSomethingToShip && agentTarget.resolved !== null;
	// Plain identifiers so Lingui names the placeholders for translators.
	const workingLabel = agentPr.status?.agentLabel;
	const handleCreatePrWithAgent = () => {
		if (!hasSomethingToShip) {
			toast.info(noCommitsTooltip);
			return;
		}
		if (!agentTarget.resolved) {
			toast.info(noAgentTooltip);
			return;
		}
		void agentPr.dispatch();
	};

	const changedPaths = useMemo(() => {
		const data = status.data;
		if (!data) return [];
		return [...new Set([...data.staged, ...data.unstaged].map((f) => f.path))];
	}, [status.data]);
	// Fallback when the message box is left empty. Deliberately not
	// translated: commit messages live in git history, not the UI.
	const defaultCommitMessage =
		changedPaths.length === 1
			? `Update ${changedPaths[0]?.split("/").pop()}`
			: changedPaths.length > 1
				? `Update ${changedPaths.length} files`
				: "Update";

	const handleCommit = () => {
		const message = commitMessage.trim() || defaultCommitMessage;
		commitMutation.mutate({ workspaceId, message });
	};

	const handleCreatePr = async () => {
		const title = prTitle.trim();
		if (!title || !hasCommitsAhead) return;
		const toastId = toast.loading(
			t({ id: "workspace.shipControl.pushing", message: "Pushing..." }),
		);
		// Always push first rather than trusting `needsPush`: the sync
		// snapshot can be up to 10s stale right after a commit, and skipping
		// the push then would open the PR at the old remote tip. Pushing an
		// already-synced branch is a cheap no-op.
		try {
			await flowPushMutation.mutateAsync({ workspaceId });
		} catch (error) {
			toast.error(
				t({
					id: "workspace.shipControl.pushFailed",
					message: `Push failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
				{ id: toastId },
			);
			return;
		}
		toast.loading(
			t({
				id: "workspace.shipControl.creatingPr",
				message: "Creating PR...",
			}),
			{ id: toastId },
		);
		try {
			const created = await createPrMutation.mutateAsync({
				workspaceId,
				title,
				body: prBody.trim() || undefined,
				draft: prDraft,
			});
			toast.success(
				t({
					id: "workspace.shipControl.prCreated",
					message: `PR #${created.number} created`,
				}),
				{
					id: toastId,
					description: (
						<a
							href={created.url}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2 transition-colors hover:text-foreground"
						>
							{t({
								id: "workspace.shipControl.prUrlLink",
								message: "PR URL",
							})}
						</a>
					),
					action: {
						label: t({
							id: "workspace.shipControl.openPrToastAction",
							message: "Open",
						}),
						onClick: () => {
							if (projectId == null) return;
							// Same pair the PR badge's own click performs.
							usePullRequestsSplitViewStore.getState().expandDetail();
							void navigate({
								to: "/pull-requests/$prNumber",
								params: { prNumber: String(created.number) },
								search: { project: projectId },
							});
						},
					},
				},
			);
			setView(null);
			setPrTitle("");
			prTitleTouchedRef.current = false;
			setPrBody("");
			setPrDraft(false);
			onRefresh();
		} catch (error) {
			toast.error(
				t({
					id: "workspace.shipControl.createPrFailed",
					message: `Create PR failed: ${error instanceof Error ? error.message : String(error)}`,
				}),
				{ id: toastId },
			);
		}
	};

	// Create PR is the face whenever the project can open PRs — the agent
	// commits a dirty tree itself, so Commit moves into the chevron.
	const showCreatePr = canCreatePr;
	if (!needsCommit && !showCreatePr && !needsPush) return null;

	// enabled: on the hover so a disabled button stays hoverable (pointer
	// events are kept alive for the native title tooltip) without lighting up.
	const mainButtonClass =
		"flex h-full items-center gap-1.5 px-2 text-xs font-medium text-foreground outline-none transition-colors enabled:hover:bg-accent/60 disabled:opacity-50";
	const chevronButton = (
		<button
			type="button"
			className="flex h-full items-center px-1 outline-none transition-colors hover:bg-accent/60"
			aria-label={t({
				id: "workspace.shipControl.openShipOptionsAria",
				message: "Open ship options",
			})}
		>
			{isShipping || commitMutation.isPending || agentBusy ? (
				<VscLoading className="size-3 animate-spin text-muted-foreground" />
			) : (
				<VscChevronDown className="size-3 text-muted-foreground" />
			)}
		</button>
	);

	// Menu entries while an agent has the PR: bring its terminal into view
	// (terminal mode) or drop the wait. Shared by both modes' chevrons.
	const agentTerminalId = agentPr.status?.terminalId ?? null;
	const agentWaitItems = agentPr.status ? (
		<>
			{agentTerminalId && onOpenTerminal && (
				<DropdownMenuItem
					className="text-xs"
					onClick={() => onOpenTerminal(agentTerminalId)}
				>
					<VscTerminal className="size-3.5" />
					<Trans id="workspace.shipControl.showAgentTerminal">
						Show agent terminal
					</Trans>
				</DropdownMenuItem>
			)}
			<DropdownMenuItem className="text-xs" onClick={agentPr.stopWaiting}>
				<VscDebugStop className="size-3.5" />
				<Trans id="workspace.shipControl.stopWaiting">Stop waiting</Trans>
			</DropdownMenuItem>
		</>
	) : null;
	// Where the prompt goes — the diff composer's picker as a submenu, so the
	// choice (and that a new session would be started) is visible before
	// clicking, and switchable.
	const targetSubmenu = (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger className="text-xs">
				<VscSend className="mr-2 size-3.5" />
				<span className="truncate">
					{targetLabel
						? t({
								id: "workspace.shipControl.sendToTarget",
								message: `Send to ${targetLabel}`,
							})
						: t({ id: "workspace.shipControl.sendTo", message: "Send to…" })}
				</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="w-56">
				<DropdownMenuRadioGroup
					value={agentTarget.value ?? undefined}
					onValueChange={agentTarget.onValueChange}
				>
					{sessions.length > 0 && (
						<DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
							<Trans id="workspace.agentCommentComposer.activeSessions">
								Active sessions
							</Trans>
						</DropdownMenuLabel>
					)}
					{sessions.map((session) => (
						<DropdownMenuRadioItem
							key={session.terminalId}
							value={`${EXISTING_PREFIX}${session.terminalId}`}
							className="text-xs"
						>
							<TargetOption
								presetId={session.agentId}
								label={sessionLabel(session.agentId, session.terminalId)}
							/>
						</DropdownMenuRadioItem>
					))}
					{sessions.length > 0 && configs.length > 0 && (
						<DropdownMenuSeparator />
					)}
					{configs.length > 0 && (
						<DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
							<Trans id="workspace.agentCommentComposer.startNewSession">
								Start new session
							</Trans>
						</DropdownMenuLabel>
					)}
					{configs.map((config) => (
						<DropdownMenuRadioItem
							key={config.id}
							value={`${NEW_PREFIX}${config.id}`}
							className="text-xs"
						>
							<TargetOption presetId={config.presetId} label={config.label} />
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
	// The manual steps, one level down now that the agent commits and pushes
	// by default.
	const commitItem = (
		<DropdownMenuItem
			className="text-xs"
			disabled={commitMutation.isPending}
			onClick={() => {
				pendingViewRef.current = "commit";
			}}
		>
			<VscGitCommit className="size-3.5" />
			<Trans id="workspace.shipControl.commit">Commit</Trans>
		</DropdownMenuItem>
	);
	const pushItem = (
		<DropdownMenuItem
			className="text-xs"
			disabled={pushMutation.isPending}
			onClick={() => pushMutation.mutate({ workspaceId })}
		>
			<VscRepoPush className="size-3.5" />
			<Trans id="workspace.shipControl.push">Push</Trans>
		</DropdownMenuItem>
	);
	// The by-hand path: today's title/description popover, kept one menu
	// level down so the default click stays the agent dispatch.
	const manualCreatePrItem = (
		<DropdownMenuItem
			className={
				hasCommitsAhead
					? "text-xs"
					: "text-xs text-muted-foreground focus:text-muted-foreground"
			}
			disabled={isShipping}
			onClick={() => {
				if (!hasCommitsAhead) {
					toast.info(noCommitsTooltip);
					return;
				}
				pendingViewRef.current = "pr";
			}}
		>
			<VscEdit className="size-3.5" />
			<Trans id="workspace.shipControl.createPrManually">
				Create PR manually…
			</Trans>
		</DropdownMenuItem>
	);

	return (
		<Popover
			open={view !== null}
			onOpenChange={(open) => {
				if (!open) setView(null);
			}}
		>
			<PopoverAnchor asChild>
				{/* A segment of ChangesControl's split button — the parent owns
				    the border, rounding, and fill. */}
				<div className="flex items-center">
					{compact ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>{chevronButton}</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="w-52"
								onCloseAutoFocus={(event) => {
									const pending = pendingViewRef.current;
									if (pending) {
										pendingViewRef.current = null;
										event.preventDefault();
										if (pending === "pr") openPrView();
										else setView(pending);
									}
								}}
							>
								{needsCommit && commitItem}
								{needsPush && pushItem}
								{canCreatePr && (needsCommit || needsPush) && (
									<DropdownMenuSeparator />
								)}
								{canCreatePr && agentBusy ? (
									<>
										<DropdownMenuItem className="text-xs" disabled>
											<VscLoading className="size-3.5 animate-spin" />
											<Trans id="workspace.shipControl.agentCreatingPrFace">
												Creating PR…
											</Trans>
										</DropdownMenuItem>
										{agentWaitItems}
									</>
								) : canCreatePr ? (
									<>
										{/* Not `disabled` when there is nothing to ship: a disabled
										    menu item is pointer-events-none, so its title tooltip can
										    never show — instead the greyed item stays clickable and
										    explains itself with a toast. */}
										<DropdownMenuItem
											className={
												canDispatch
													? "text-xs"
													: "text-xs text-muted-foreground focus:text-muted-foreground"
											}
											disabled={isShipping}
											onClick={handleCreatePrWithAgent}
										>
											<VscGitPullRequestCreate className="size-3.5" />
											<Trans id="workspace.shipControl.createPr">
												Create PR
											</Trans>
										</DropdownMenuItem>
										{targetSubmenu}
										{manualCreatePrItem}
									</>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
					) : (
						<>
							{needsCommit && !showCreatePr ? (
								<button
									type="button"
									className={mainButtonClass}
									onClick={() => setView("commit")}
								>
									{commitMutation.isPending ? (
										<VscLoading className="size-3.5 animate-spin" />
									) : (
										<VscGitCommit className="size-3.5" />
									)}
									<Trans id="workspace.shipControl.commit">Commit</Trans>
								</button>
							) : showCreatePr ? (
								<button
									type="button"
									className={mainButtonClass}
									disabled={!canDispatch || agentBusy}
									title={
										workingLabel
											? t({
													id: "workspace.shipControl.creatingPrWithAgentTitle",
													message: `${workingLabel} is creating the pull request`,
												})
											: !hasSomethingToShip
												? noCommitsTooltip
												: !targetLabel
													? noAgentTooltip
													: needsCommit
														? t({
																id: "workspace.shipControl.createPrWithAgentDirtyTitle",
																message: `Have ${targetLabel} commit the changes, then name, describe, and open the pull request`,
															})
														: t({
																id: "workspace.shipControl.createPrWithAgentTitle",
																message: `Have ${targetLabel} name, describe, and open the pull request`,
															})
									}
									onClick={handleCreatePrWithAgent}
								>
									{isShipping || agentBusy ? (
										<VscLoading className="size-3.5 animate-spin" />
									) : (
										<VscGitPullRequestCreate className="size-3.5" />
									)}
									{agentBusy ? (
										<Trans id="workspace.shipControl.agentCreatingPrFace">
											Creating PR…
										</Trans>
									) : (
										<Trans id="workspace.shipControl.createPr">Create PR</Trans>
									)}
								</button>
							) : (
								<button
									type="button"
									className={mainButtonClass}
									disabled={pushMutation.isPending}
									onClick={() => pushMutation.mutate({ workspaceId })}
								>
									{pushMutation.isPending ? (
										<VscLoading className="size-3.5 animate-spin" />
									) : (
										<VscRepoPush className="size-3.5" />
									)}
									<Trans id="workspace.shipControl.push">Push</Trans>
								</button>
							)}
							{((needsPush && needsCommit) || showCreatePr) && (
								<>
									<div className="h-full w-px bg-border/60" />
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											{chevronButton}
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="end"
											className="w-52"
											onCloseAutoFocus={(event) => {
												const pending = pendingViewRef.current;
												if (pending) {
													pendingViewRef.current = null;
													event.preventDefault();
													if (pending === "pr") openPrView();
													else setView(pending);
												}
											}}
										>
											{showCreatePr && needsCommit && commitItem}
											{needsPush && pushItem}
											{showCreatePr && (needsCommit || needsPush) && (
												<DropdownMenuSeparator />
											)}
											{showCreatePr &&
												(agentBusy ? (
													agentWaitItems
												) : (
													<>
														{targetSubmenu}
														{manualCreatePrItem}
													</>
												))}
										</DropdownMenuContent>
									</DropdownMenu>
								</>
							)}
						</>
					)}
				</div>
			</PopoverAnchor>
			<PopoverContent
				align="end"
				sideOffset={8}
				className={view === "pr" ? "w-96 p-3" : "w-80 p-3"}
			>
				{view === "commit" ? (
					<div className="flex flex-col gap-2">
						<Textarea
							autoFocus
							value={commitMessage}
							onChange={(e) => setCommitMessage(e.target.value)}
							placeholder={defaultCommitMessage}
							className="min-h-20 text-xs"
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									handleCommit();
								}
							}}
						/>
						<button
							type="button"
							onClick={handleCommit}
							disabled={commitMutation.isPending}
							className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
						>
							{commitMutation.isPending && (
								<VscLoading className="size-3.5 animate-spin" />
							)}
							<Trans id="workspace.shipControl.commit">Commit</Trans>
						</button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<Input
							autoFocus
							value={prTitle}
							onChange={(e) => {
								prTitleTouchedRef.current = true;
								setPrTitle(e.target.value);
							}}
							placeholder={t({
								id: "workspace.shipControl.prTitlePlaceholder",
								message: "Pull request title",
							})}
							className="h-8 text-xs"
						/>
						<Textarea
							value={prBody}
							onChange={(e) => setPrBody(e.target.value)}
							placeholder={t({
								id: "workspace.shipControl.prBodyPlaceholder",
								message: "Description (optional)",
							})}
							className="min-h-20 text-xs"
						/>
						<div className="flex items-center justify-between">
							<Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Checkbox
									checked={prDraft}
									onCheckedChange={(v) => setPrDraft(v === true)}
								/>
								<Trans id="workspace.shipControl.draft">Draft</Trans>
							</Label>
							<button
								type="button"
								onClick={() => void handleCreatePr()}
								disabled={!prTitle.trim() || !hasCommitsAhead || isShipping}
								className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{isShipping && <VscLoading className="size-3.5 animate-spin" />}
								<Trans id="workspace.shipControl.createPrAction">
									Create pull request
								</Trans>
							</button>
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function sessionLabel(agentId: string, terminalId: string): string {
	const label =
		(AGENT_IDENTITY_LABELS as Record<string, string | undefined>)[agentId] ??
		agentId;
	return `${label} · ${terminalId.slice(0, 6)}`;
}

function TargetOption({
	presetId,
	label,
}: {
	presetId: string;
	label: string;
}) {
	const iconSrc = usePresetIcon(presetId);
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5">
			{iconSrc ? (
				<img
					src={iconSrc}
					alt=""
					className="size-3 shrink-0"
					draggable={false}
				/>
			) : null}
			<span className="truncate">{label}</span>
		</span>
	);
}
