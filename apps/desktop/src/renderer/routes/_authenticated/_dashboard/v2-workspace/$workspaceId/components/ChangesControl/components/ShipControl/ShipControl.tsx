import { Trans, useLingui } from "@lingui/react/macro";
import { Checkbox } from "@superset/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { workspaceTrpc } from "@superset/workspace-client";
import { useState } from "react";
import {
	VscChevronDown,
	VscGitCommit,
	VscGitPullRequestCreate,
	VscLoading,
	VscRepoPush,
} from "react-icons/vsc";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import type { BranchSyncStatus } from "../../utils/getPRFlowState";

interface ShipControlProps {
	workspaceId: string;
	sync: BranchSyncStatus;
	onRefresh: () => void;
}

/**
 * The no-PR half of the top-bar Changes cluster: one progressive action that
 * walks the branch to a pull request. Uncommitted changes → "Commit" (message
 * popover); committed → "Create PR" (title/description popover; pushes first
 * when the branch is unpublished or ahead). A chevron menu offers "Push" on
 * its own whenever there is something to push.
 *
 * Session workspaces (null projectId) can't create PRs — the PR route and
 * repo resolution are project-scoped — so they only ever see Commit/Push.
 */
export function ShipControl({
	workspaceId,
	sync,
	onRefresh,
}: ShipControlProps) {
	const { t } = useLingui();
	const { workspace } = useWorkspace();
	const canCreatePr = workspace.projectId != null;

	const needsCommit = sync.hasUncommitted;
	const needsPush = !sync.hasUpstream || sync.pushCount > 0;

	const [commitOpen, setCommitOpen] = useState(false);
	const [commitMessage, setCommitMessage] = useState("");
	const [prOpen, setPrOpen] = useState(false);
	const [prTitle, setPrTitle] = useState("");
	const [prBody, setPrBody] = useState("");
	const [prDraft, setPrDraft] = useState(false);

	const commitMutation = workspaceTrpc.git.commit.useMutation({
		onSuccess: () => {
			toast.success(
				t({ id: "workspace.shipControl.committed", message: "Committed" }),
			);
			setCommitOpen(false);
			setCommitMessage("");
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

	const createPrMutation =
		workspaceTrpc.pullRequests.createForWorkspace.useMutation();

	// Prefill the PR title from the branch's latest commit subject once the
	// popover opens; tanstack-query dedupes this with the Changes panel's own
	// commit list when one is mounted.
	const commitsQuery = workspaceTrpc.git.listCommits.useQuery(
		{ workspaceId },
		{ enabled: prOpen && canCreatePr },
	);
	const latestSubject = commitsQuery.data?.commits[0]?.message ?? "";
	const effectiveTitle = prTitle || latestSubject;

	const isShipping = pushMutation.isPending || createPrMutation.isPending;

	const handleCommit = () => {
		const message = commitMessage.trim();
		if (!message) return;
		commitMutation.mutate({ workspaceId, message });
	};

	const handleCreatePr = async () => {
		const title = effectiveTitle.trim();
		if (!title) return;
		const toastId = toast.loading(
			needsPush
				? t({ id: "workspace.shipControl.pushing", message: "Pushing..." })
				: t({
						id: "workspace.shipControl.creatingPr",
						message: "Creating PR...",
					}),
		);
		try {
			if (needsPush) {
				await pushMutation.mutateAsync({ workspaceId });
				toast.loading(
					t({
						id: "workspace.shipControl.creatingPr",
						message: "Creating PR...",
					}),
					{ id: toastId },
				);
			}
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
				{ id: toastId },
			);
			setPrOpen(false);
			setPrTitle("");
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

	const showCreatePr = !needsCommit && canCreatePr;
	if (!needsCommit && !showCreatePr && !needsPush) return null;

	const mainButtonClass =
		"flex h-full items-center gap-1.5 px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent/60";

	return (
		<div className="flex h-7 items-center overflow-hidden rounded-md border border-border/60 bg-muted/30">
			{needsCommit ? (
				<Popover open={commitOpen} onOpenChange={setCommitOpen}>
					<PopoverTrigger asChild>
						<button type="button" className={mainButtonClass}>
							{commitMutation.isPending ? (
								<VscLoading className="size-3.5 animate-spin" />
							) : (
								<VscGitCommit className="size-3.5" />
							)}
							<Trans id="workspace.shipControl.commit">Commit</Trans>
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" sideOffset={8} className="w-80 p-3">
						<div className="flex flex-col gap-2">
							<Textarea
								autoFocus
								value={commitMessage}
								onChange={(e) => setCommitMessage(e.target.value)}
								placeholder={t({
									id: "workspace.shipControl.commitMessagePlaceholder",
									message: "Commit message",
								})}
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
								disabled={!commitMessage.trim() || commitMutation.isPending}
								className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{commitMutation.isPending && (
									<VscLoading className="size-3.5 animate-spin" />
								)}
								<Trans id="workspace.shipControl.commit">Commit</Trans>
							</button>
						</div>
					</PopoverContent>
				</Popover>
			) : showCreatePr ? (
				<Popover open={prOpen} onOpenChange={setPrOpen}>
					<PopoverTrigger asChild>
						<button type="button" className={mainButtonClass}>
							{isShipping ? (
								<VscLoading className="size-3.5 animate-spin" />
							) : (
								<VscGitPullRequestCreate className="size-3.5" />
							)}
							<Trans id="workspace.shipControl.createPr">Create PR</Trans>
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" sideOffset={8} className="w-96 p-3">
						<div className="flex flex-col gap-2">
							<Input
								autoFocus
								value={effectiveTitle}
								onChange={(e) => setPrTitle(e.target.value)}
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
									disabled={!effectiveTitle.trim() || isShipping}
									className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
								>
									{isShipping && (
										<VscLoading className="size-3.5 animate-spin" />
									)}
									<Trans id="workspace.shipControl.createPrAction">
										Create pull request
									</Trans>
								</button>
							</div>
						</div>
					</PopoverContent>
				</Popover>
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

			{needsPush && (needsCommit || showCreatePr) && (
				<>
					<div className="h-full w-px bg-border/60" />
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="flex h-full items-center px-1 outline-none transition-colors hover:bg-accent/60"
								aria-label={t({
									id: "workspace.shipControl.openShipOptionsAria",
									message: "Open ship options",
								})}
							>
								<VscChevronDown className="size-3 text-muted-foreground" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-40">
							<DropdownMenuItem
								className="text-xs"
								disabled={pushMutation.isPending}
								onClick={() => pushMutation.mutate({ workspaceId })}
							>
								<VscRepoPush className="size-3.5" />
								<Trans id="workspace.shipControl.push">Push</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</>
			)}
		</div>
	);
}
