import type { CodeViewItem, CodeViewOptions } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	LuColumns2,
	LuPanelLeft,
	LuPanelLeftClose,
	LuPanelLeftOpen,
	LuRows2,
} from "react-icons/lu";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import {
	createPierreTreeStyle,
	PIERRE_TREE_UNSAFE_CSS,
	type PierreGitStatus,
} from "renderer/lib/pierreTree";
import { WorkItemDetailState } from "renderer/routes/_authenticated/_dashboard/components/WorkItemDetailState";
import { useDiffCodeViewTheme } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/DiffPane/hooks/useDiffCodeViewTheme";

interface PullRequestCodeTabProps {
	projectId: string;
	prNumber: number;
	hostUrl: string;
}

type DiffStyle = "split" | "unified";

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
	item: CodeViewItem;
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
	hostUrl,
}: PullRequestCodeTabProps) {
	const { options, style } = useDiffCodeViewTheme();
	const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
	const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
	const codeViewOptions = useMemo(
		() => ({ ...options, diffStyle }) as CodeViewOptions<undefined>,
		[options, diffStyle],
	);
	const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["pull-request-diff", projectId, hostUrl, prNumber],
		queryFn: async () => {
			const client = getHostServiceClientByUrl(hostUrl);
			return client.pullRequests.getDiff.query({ projectId, prNumber });
		},
		staleTime: 30_000,
		gcTime: 10 * 60_000,
	});

	const files = useMemo(() => parseFileDiffs(data?.patch ?? ""), [data?.patch]);
	const items = useMemo<CodeViewItem[]>(
		() => files.map((f) => f.item),
		[files],
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
					<div className="flex h-full w-56 shrink-0 flex-col border-r border-border/50">
						<PierreFileTree
							model={model}
							style={{ ...TREE_STYLE, height: "100%" }}
						/>
					</div>
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
					/>
				</div>
			</div>
		</div>
	);
}
