import type {
	CodeViewItem,
	CodeViewOptions,
	DiffLineAnnotation,
	SelectedLineRange,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { sanitizePromptForPty } from "@superset/shared/agent-prompt-launch";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	LuChevronDown,
	LuChevronUp,
	LuColumns2,
	LuPanelLeft,
	LuPanelLeftClose,
	LuPanelLeftOpen,
	LuRows2,
} from "react-icons/lu";
import {
	type AgentPromptFileSide,
	formatAgentPromptWithFileContext,
} from "renderer/hooks/host-service/useSendToTerminalAgent";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import {
	createPierreTreeStyle,
	PIERRE_TREE_UNSAFE_CSS,
	type PierreGitStatus,
} from "renderer/lib/pierreTree";
import { normalizeTerminalCommand } from "renderer/lib/terminal/launch-command";
import { WorkItemDetailState } from "renderer/routes/_authenticated/_dashboard/components/WorkItemDetailState";
import type { AgentTarget } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AgentCommentComposer/hooks/useDiffCommentTarget";
import { useDiffCodeViewTheme } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/DiffPane/hooks/useDiffCodeViewTheme";
import { ResizablePanel } from "renderer/screens/main/components/ResizablePanel";
import { useWorkspaceCreates } from "renderer/stores/workspace-creates/useWorkspaceCreates";
import { PullRequestCommentComposer } from "../PullRequestCommentComposer";
import { PullRequestCommentThread } from "../PullRequestCommentThread";

interface PullRequestCodeTabProps {
	projectId: string;
	prNumber: number;
	prUrl: string;
	hostUrl: string;
	hostId: string | null;
}

interface PrCommentThreadComment {
	id: string;
	authorLogin: string;
	avatarUrl?: string;
	body: string;
	createdAt?: number;
}

interface PrCommentThreadMetadata {
	kind: "thread";
	threadId: string;
	/** REST databaseId of a comment already in the thread — replies thread
	 *  onto it regardless of which comment they target. Undefined only if
	 *  GitHub ever returns a thread with zero comments (shouldn't happen). */
	replyToCommentId?: number;
	comments: PrCommentThreadComment[];
	isResolved: boolean;
	isOutdated: boolean;
	url?: string;
}

interface PrDraftCommentMetadata {
	kind: "composer";
	path: string;
	line: number;
	side: "additions" | "deletions";
}

type PrAnnotationMetadata = PrCommentThreadMetadata | PrDraftCommentMetadata;

interface OrderedThread {
	threadId: string;
	itemId: string;
	lineNumber: number;
	side: "additions" | "deletions";
}

interface ComposerState {
	itemId: string;
	path: string;
	range: SelectedLineRange;
}

type DiffStyle = "split" | "unified";

// Wider than the tree's other call sites: PR diffs commonly nest several
// levels deeper than a plain file explorer (app/components/FooSection/...),
// and Pierre's row-level overflow detection truncates names hardest at
// depth, where indentation leaves the least room for the name itself.
const DEFAULT_TREE_WIDTH = 288;
const MIN_TREE_WIDTH = 200;
const MAX_TREE_WIDTH = 560;

const ITEM_HEIGHT = 24;
const TREE_STYLE = createPierreTreeStyle({
	rowHeight: ITEM_HEIGHT,
	levelIndent: 8,
});

// GitHub's diff-file-type vocabulary (from parsePatchFiles) mapped onto
// Pierre's tree git-status vocabulary — a distinct mapping from
// FILE_STATUS_TO_PIERRE, which targets local-filesystem status instead.
const CHANGE_TYPE_TO_PIERRE_STATUS: Record<string, PierreGitStatus> = {
	change: "modified",
	"rename-pure": "renamed",
	"rename-changed": "renamed",
	new: "added",
	deleted: "deleted",
};

interface ParsedFileDiff {
	item: CodeViewItem<PrAnnotationMetadata>;
	path: string;
	status: PierreGitStatus;
	additions: number;
	deletions: number;
}

function parseFileDiffs(patch: string): ParsedFileDiff[] {
	if (!patch.trim()) return [];
	try {
		return parsePatchFiles(patch, undefined, false).flatMap((parsedPatch) =>
			parsedPatch.files.map((fileDiff, index) => {
				let additions = 0;
				let deletions = 0;
				for (const hunk of fileDiff.hunks) {
					additions += hunk.additionLines;
					deletions += hunk.deletionLines;
				}
				return {
					item: { id: `${fileDiff.name}-${index}`, type: "diff", fileDiff },
					path: fileDiff.name,
					status: CHANGE_TYPE_TO_PIERRE_STATUS[fileDiff.type] ?? "modified",
					additions,
					deletions,
				};
			}),
		);
	} catch {
		return [];
	}
}

function formatDiffStats(additions: number, deletions: number): string {
	if (additions === 0 && deletions === 0) return "";
	if (additions === 0) return `−${deletions}`;
	if (deletions === 0) return `+${additions}`;
	return `+${additions} −${deletions}`;
}

export function PullRequestCodeTab({
	projectId,
	prNumber,
	prUrl,
	hostUrl,
	hostId,
}: PullRequestCodeTabProps) {
	const { options, style } = useDiffCodeViewTheme();
	const codeViewRef = useRef<CodeViewHandle<PrAnnotationMetadata>>(null);
	const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
	const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);
	const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH);
	const [isResizingTree, setIsResizingTree] = useState(false);
	const [composer, setComposer] = useState<ComposerState | null>(null);
	// Pierre's controlled `items` prop skips reprocessing an item whose
	// `version` is unchanged from what it last saw (see the version comment
	// on `items` below) — composer open/close/move doesn't touch
	// threadsUpdatedAt, so without this the annotation update goes stale:
	// the composer can silently fail to open, or fail to disappear on
	// cancel/Escape, whenever a thread hasn't also refetched in between.
	// Scoped to just the file(s) losing or gaining the composer annotation
	// (not every file in the diff) so a transition doesn't force Pierre to
	// reprocess the whole PR. Both refs are written synchronously inside
	// the event handler, before setComposer, so `items` sees the update on
	// the very next render — no lag.
	const composerVersionRef = useRef(0);
	const composerAffectedPathsRef = useRef<ReadonlySet<string>>(new Set());
	const updateComposer = useCallback((next: ComposerState | null) => {
		composerVersionRef.current += 1;
		setComposer((prev) => {
			const affected = new Set<string>();
			if (prev) affected.add(prev.path);
			if (next) affected.add(next.path);
			composerAffectedPathsRef.current = affected;
			return next;
		});
	}, []);
	const queryClient = useQueryClient();

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["pull-request-diff", projectId, hostUrl, prNumber],
		queryFn: async () => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.pullRequests.getDiff.query({ projectId, prNumber });
		},
		staleTime: 30_000,
		gcTime: 10 * 60_000,
	});

	const threadsQueryKey = [
		"pull-request-threads",
		projectId,
		hostUrl,
		prNumber,
	];
	const { data: threadsData, dataUpdatedAt: threadsUpdatedAt } = useQuery({
		queryKey: threadsQueryKey,
		queryFn: async () => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.pullRequests.getThreads.query({ projectId, prNumber });
		},
		staleTime: 30_000,
		gcTime: 10 * 60_000,
	});
	const setThreadResolution = useMutation({
		mutationFn: async (input: { threadId: string; resolved: boolean }) => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.pullRequests.setThreadResolution.mutate(input);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: threadsQueryKey });
		},
		onError: (mutationError) => {
			toast.error("Couldn't update thread", {
				description: mutationError.message,
			});
		},
	});
	const replyToThread = useMutation({
		mutationFn: async (input: { commentId: number; body: string }) => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.pullRequests.replyToThread.mutate({
				projectId,
				prNumber,
				...input,
			});
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: threadsQueryKey });
		},
		onError: (mutationError) => {
			toast.error("Couldn't post reply", {
				description: mutationError.message,
			});
		},
	});
	const linkedWorkspaceQueryKey = [
		"pull-request-linked-workspace",
		projectId,
		hostUrl,
		prNumber,
	];
	const { data: linkedWorkspaceData } = useQuery({
		queryKey: linkedWorkspaceQueryKey,
		queryFn: async () => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.pullRequests.getLinkedWorkspace.query({
				projectId,
				prNumber,
			});
		},
		staleTime: 30_000,
		gcTime: 10 * 60_000,
	});
	const linkedWorkspaceId = linkedWorkspaceData?.workspaceId ?? null;
	const { submit: submitWorkspaceCreate } = useWorkspaceCreates();

	// Mirrors DiffPane's split between "send to an existing terminal" and
	// "create a new agent session", but the PR tab has no fixed workspace to
	// launch a new session *in* — when no workspace is linked to this PR yet,
	// "new" means spinning up a whole PR-checkout workspace (via the same
	// useWorkspaceCreates path "Start Workspace" uses) with the prompt baked
	// into its first agent launch, not just a fresh terminal in one that
	// already exists.
	const sendCommentToAgent = useMutation({
		mutationFn: async (input: {
			comment: string;
			target: AgentTarget;
			path: string;
			line: number;
			side: AgentPromptFileSide;
		}) => {
			const text = formatAgentPromptWithFileContext({
				comment: input.comment,
				file: {
					path: input.path,
					startLine: input.line,
					endLine: input.line,
					side: input.side,
				},
			});

			if (input.target.kind === "existing") {
				if (!linkedWorkspaceId) {
					throw new Error("No workspace open for this session");
				}
				const client = getHostServiceClientByUrl(hostUrl);
				await client.terminal.writeInput.mutate({
					workspaceId: linkedWorkspaceId,
					terminalId: input.target.terminalId,
					data: normalizeTerminalCommand(sanitizePromptForPty(text)),
				});
				return;
			}

			if (linkedWorkspaceId) {
				const client = getHostServiceClientByUrl(hostUrl);
				await client.agents.run.mutate({
					workspaceId: linkedWorkspaceId,
					agent: input.target.configId,
					prompt: text,
				});
				return;
			}

			if (!hostId) {
				throw new Error("No host available to create a workspace");
			}
			const { completed } = submitWorkspaceCreate({
				hostId,
				snapshot: {
					id: crypto.randomUUID(),
					projectId,
					pr: prNumber,
					agents: [{ agent: input.target.configId, prompt: text }],
				},
			});
			const outcome = await completed;
			if (!outcome.ok) throw new Error(outcome.error);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: linkedWorkspaceQueryKey });
			toast.success("Sent to agent");
			updateComposer(null);
		},
		onError: (mutationError) => {
			toast.error("Couldn't send comment", {
				description: mutationError.message,
			});
		},
	});

	const annotationsByPath = useMemo(() => {
		const map = new Map<
			string,
			DiffLineAnnotation<PrCommentThreadMetadata>[]
		>();
		for (const thread of threadsData?.reviewThreads ?? []) {
			if (thread.line == null || !thread.path) continue;
			const firstCommentDbId = thread.comments[0]?.databaseId;
			const list = map.get(thread.path) ?? [];
			list.push({
				side: thread.diffSide === "LEFT" ? "deletions" : "additions",
				lineNumber: thread.line,
				metadata: {
					kind: "thread",
					threadId: thread.id,
					replyToCommentId: firstCommentDbId,
					isResolved: thread.isResolved,
					isOutdated: thread.isOutdated,
					url: firstCommentDbId
						? `${prUrl}#discussion_r${firstCommentDbId}`
						: undefined,
					comments: thread.comments.map((comment) => ({
						id: comment.id,
						authorLogin: comment.author.login,
						avatarUrl: comment.author.avatarUrl,
						body: comment.body,
						createdAt: comment.createdAt
							? new Date(comment.createdAt).getTime()
							: undefined,
					})),
				},
			});
			map.set(thread.path, list);
		}
		return map;
	}, [threadsData, prUrl]);

	const files = useMemo(() => parseFileDiffs(data?.patch ?? ""), [data?.patch]);
	const pathByItemId = useMemo(
		() => new Map(files.map((f) => [f.item.id, f.path])),
		[files],
	);
	const composerAnnotation =
		useMemo<DiffLineAnnotation<PrDraftCommentMetadata> | null>(() => {
			if (!composer) return null;
			const side = composer.range.endSide ?? composer.range.side ?? "additions";
			return {
				side,
				lineNumber: composer.range.end,
				metadata: {
					kind: "composer",
					path: composer.path,
					line: composer.range.end,
					side,
				},
			};
		}, [composer]);
	const items = useMemo<CodeViewItem<PrAnnotationMetadata>[]>(
		() =>
			files.map((f) => {
				const threadAnnotations = annotationsByPath.get(f.path) ?? [];
				const annotations =
					composerAnnotation && composer?.path === f.path
						? [...threadAnnotations, composerAnnotation]
						: threadAnnotations;
				return {
					...f.item,
					annotations: annotations.length > 0 ? annotations : undefined,
					// Pierre's controlled `items` prop diffs items by id and, per
					// its own docs ("bump the version when also changing the
					// value"), needs an explicit version bump to know an
					// already-rendered item's content changed — otherwise a
					// same-id item with new annotations (a reply landing, a
					// resolve toggling, a composer opening/closing) can go stale
					// in the live view even though the query cache/state is
					// correct. Only the file(s) actually losing or gaining the
					// composer annotation get the extra bump, so a composer
					// transition elsewhere doesn't force Pierre to reprocess
					// every file in the diff.
					version: composerAffectedPathsRef.current.has(f.path)
						? threadsUpdatedAt + composerVersionRef.current
						: threadsUpdatedAt,
				};
			}),
		// composerVersionRef.current and composerAffectedPathsRef.current
		// are read directly, not listed as dependencies — both are written
		// synchronously in updateComposer before setComposer, so they're
		// already current by the time this recomputes off the `composer`
		// change below.
		[files, annotationsByPath, composer, composerAnnotation, threadsUpdatedAt],
	);
	// Flattened in diff order (file order, then line number within a file)
	// so next/prev walks the pane top-to-bottom instead of thread-creation
	// order.
	const orderedThreads = useMemo<OrderedThread[]>(() => {
		const list: OrderedThread[] = [];
		for (const f of files) {
			const annotations = annotationsByPath.get(f.path);
			if (!annotations) continue;
			const sorted = [...annotations].sort(
				(a, b) => a.lineNumber - b.lineNumber,
			);
			for (const annotation of sorted) {
				if (!annotation.metadata) continue;
				list.push({
					threadId: annotation.metadata.threadId,
					itemId: f.item.id,
					lineNumber: annotation.lineNumber,
					side: annotation.side,
				});
			}
		}
		return list;
	}, [files, annotationsByPath]);
	const [focusedThreadIndex, setFocusedThreadIndex] = useState<number | null>(
		null,
	);
	const [focusTick, setFocusTick] = useState(0);

	const jumpToThread = (index: number) => {
		const target = orderedThreads[index];
		if (!target) return;
		setFocusedThreadIndex(index);
		setFocusTick(Date.now());
		codeViewRef.current?.scrollTo({
			type: "line",
			id: target.itemId,
			lineNumber: target.lineNumber,
			side: target.side,
			align: "center",
			behavior: "smooth-auto",
		});
	};
	const goToNextComment = () => {
		if (orderedThreads.length === 0) return;
		jumpToThread(
			focusedThreadIndex == null
				? 0
				: (focusedThreadIndex + 1) % orderedThreads.length,
		);
	};
	const goToPrevComment = () => {
		if (orderedThreads.length === 0) return;
		jumpToThread(
			focusedThreadIndex == null
				? orderedThreads.length - 1
				: (focusedThreadIndex - 1 + orderedThreads.length) %
						orderedThreads.length,
		);
	};

	const codeViewOptions = useMemo(
		() =>
			({
				...options,
				diffStyle,
				enableLineSelection: true,
				enableGutterUtility: true,
				// Pierre gates the gutter "+" button's pointer flow behind a
				// non-null onGutterUtilityClick (InteractionManager's
				// startGutterSelectionFromPointerDown early-returns otherwise)
				// — the real open logic lives in onLineSelectionEnd, which also
				// fires on gutter clicks. Mirrors the v2-workspace DiffPane's
				// identical stub for the same reason.
				onGutterUtilityClick: () => {},
				onLineSelectionEnd: (
					range: SelectedLineRange | null,
					context: { type: "diff" | "file"; item: { id: string } },
				) => {
					if (context.type !== "diff" || !range) {
						updateComposer(null);
						return;
					}
					const path = pathByItemId.get(context.item.id);
					if (!path) return;
					updateComposer({ itemId: context.item.id, path, range });
				},
			}) as CodeViewOptions<PrAnnotationMetadata>,
		[options, diffStyle, pathByItemId, updateComposer],
	);

	const treePaths = useMemo(() => files.map((f) => f.path), [files]);
	const fileByPath = useMemo(
		() => new Map(files.map((f) => [f.path, f])),
		[files],
	);
	const gitStatus = useMemo(
		() => files.map((f) => ({ path: f.path, status: f.status })),
		[files],
	);
	const itemIdByPath = useMemo(
		() => new Map(files.map((f) => [f.path, f.item.id])),
		[files],
	);

	// Routed through a ref so Pierre's handler closures (resolved once at
	// useFileTree time) always see the latest data.
	const handlersRef = useRef({
		onSelect(_path: string) {},
		renderRowDecoration(_ctx: { item: { kind: string; path: string } }) {
			return null as { text: string } | null;
		},
	});
	handlersRef.current.onSelect = (path) => {
		const itemId = itemIdByPath.get(path);
		if (!itemId) return;
		codeViewRef.current?.scrollTo({
			type: "item",
			id: itemId,
			align: "start",
			behavior: "smooth-auto",
		});
	};
	handlersRef.current.renderRowDecoration = (ctx) => {
		if (ctx.item.kind === "directory") return null;
		const file = fileByPath.get(ctx.item.path);
		if (!file) return null;
		const text = formatDiffStats(file.additions, file.deletions);
		return text ? { text } : null;
	};

	const { model } = useFileTree({
		paths: treePaths,
		initialExpansion: "open",
		search: false,
		unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
		gitStatus,
		icons: { set: "complete", colored: true },
		itemHeight: ITEM_HEIGHT,
		overscan: 20,
		stickyFolders: true,
		flattenEmptyDirectories: true,
		onSelectionChange: (selected) => {
			const last = selected[selected.length - 1];
			if (!last || last.endsWith("/")) return;
			handlersRef.current.onSelect(last);
		},
		renderRowDecoration: (ctx) => handlersRef.current.renderRowDecoration(ctx),
	});

	useEffect(() => {
		model.resetPaths(treePaths);
	}, [model, treePaths]);

	useEffect(() => {
		model.setGitStatus(gitStatus);
	}, [model, gitStatus]);

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<WorkItemDetailState message="Loading diff…" isLoading />
			</div>
		);
	}

	if (error instanceof Error) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<WorkItemDetailState
					message={error.message}
					isError
					onRetry={() => void refetch()}
				/>
			</div>
		);
	}

	if (items.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
				No changes to display.
			</div>
		);
	}

	const toggleClass = (active: boolean) =>
		cn(
			"flex size-5 items-center justify-center rounded transition-colors",
			active
				? "bg-secondary text-foreground"
				: "text-muted-foreground hover:text-foreground",
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 @md:px-6">
			<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
				{!isTreeCollapsed && (
					<ResizablePanel
						width={treeWidth}
						onWidthChange={setTreeWidth}
						isResizing={isResizingTree}
						onResizingChange={setIsResizingTree}
						minWidth={MIN_TREE_WIDTH}
						maxWidth={MAX_TREE_WIDTH}
						handleSide="right"
						onDoubleClickHandle={() => setTreeWidth(DEFAULT_TREE_WIDTH)}
						className="flex flex-col"
					>
						<PierreFileTree
							model={model}
							style={{ ...TREE_STYLE, height: "100%" }}
						/>
					</ResizablePanel>
				)}
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="flex shrink-0 items-center justify-between gap-1 border-b border-border/50 px-2 py-1.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => setIsTreeCollapsed((prev) => !prev)}
									aria-label={
										isTreeCollapsed ? "Show file tree" : "Hide file tree"
									}
									className="group flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
								>
									<span className="group-hover:hidden">
										<LuPanelLeft className="size-3.5" strokeWidth={1.5} />
									</span>
									<span className="hidden group-hover:block">
										{isTreeCollapsed ? (
											<LuPanelLeftOpen className="size-3.5" strokeWidth={1.5} />
										) : (
											<LuPanelLeftClose
												className="size-3.5"
												strokeWidth={1.5}
											/>
										)}
									</span>
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{isTreeCollapsed ? "Show file tree" : "Hide file tree"}
							</TooltipContent>
						</Tooltip>
						<div className="flex items-center gap-1">
							{orderedThreads.length > 0 && (
								<>
									<div className="flex items-center gap-0.5 rounded-md border border-border/60 px-1 py-0.5">
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={goToPrevComment}
													aria-label="Previous comment"
													className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
												>
													<LuChevronUp className="size-3.5" strokeWidth={1.5} />
												</button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												Previous comment
											</TooltipContent>
										</Tooltip>
										<span className="min-w-[3ch] text-center text-[11px] tabular-nums text-muted-foreground">
											{focusedThreadIndex != null
												? focusedThreadIndex + 1
												: "–"}
											/{orderedThreads.length}
										</span>
										<Tooltip>
											<TooltipTrigger asChild>
												<button
													type="button"
													onClick={goToNextComment}
													aria-label="Next comment"
													className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
												>
													<LuChevronDown
														className="size-3.5"
														strokeWidth={1.5}
													/>
												</button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												Next comment
											</TooltipContent>
										</Tooltip>
									</div>
									<div className="mx-0.5 h-4 w-px bg-border" />
								</>
							)}
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => setDiffStyle("unified")}
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
										onClick={() => setDiffStyle("split")}
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
					<CodeView
						ref={codeViewRef}
						className="min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain [overflow-anchor:none]"
						style={style}
						items={items}
						options={codeViewOptions}
						renderAnnotation={(annotation) => {
							const metadata = annotation.metadata;
							if (!metadata) return null;
							if (metadata.kind === "composer") {
								return (
									<PullRequestCommentComposer
										contextLabel={`Line ${metadata.line}`}
										hostUrl={hostUrl}
										linkedWorkspaceId={linkedWorkspaceId}
										onCancel={() => updateComposer(null)}
										onSubmit={async ({ comment, target }) => {
											await sendCommentToAgent.mutateAsync({
												comment,
												target,
												path: metadata.path,
												line: metadata.line,
												side: metadata.side,
											});
										}}
									/>
								);
							}
							const isFocused =
								focusedThreadIndex != null &&
								orderedThreads[focusedThreadIndex]?.threadId ===
									metadata.threadId;
							return (
								<PullRequestCommentThread
									isResolved={metadata.isResolved}
									isOutdated={metadata.isOutdated}
									url={metadata.url}
									comments={metadata.comments}
									onResolveChange={(resolved) =>
										setThreadResolution.mutate({
											threadId: metadata.threadId,
											resolved,
										})
									}
									isResolvePending={
										setThreadResolution.isPending &&
										setThreadResolution.variables?.threadId ===
											metadata.threadId
									}
									onReply={(body) => {
										const commentId = metadata.replyToCommentId;
										if (!commentId) return;
										replyToThread.mutate({ commentId, body });
									}}
									isReplyPending={
										replyToThread.isPending &&
										replyToThread.variables?.commentId ===
											metadata.replyToCommentId
									}
									focusTick={isFocused ? focusTick : undefined}
								/>
							);
						}}
					/>
				</div>
			</div>
		</div>
	);
}
