import {
	type CodeViewItem,
	type DiffLineAnnotation,
	type FileDiffMetadata,
	type LineAnnotation,
	parseDiffFromFile,
} from "@pierre/diffs";
import type { AppRouter } from "@superset/host-service";
import { useWorkspaceClient, workspaceTrpc } from "@superset/workspace-client";
import { useQueries } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ChangesetFile,
	getChangesetFileKey,
} from "../../../../../useChangeset";
import {
	isDiffContentTooLarge,
	shouldAutoLoadDiff,
} from "../../utils/diffLoadingGuards";
import type {
	DeferredDiffReason,
	DiffAnnotationMetadata,
} from "../useDiffAnnotations";

type GetDiffInput = inferRouterInputs<AppRouter>["git"]["getDiff"];
type GetDiffOutput = inferRouterOutputs<AppRouter>["git"]["getDiff"];

interface UseDiffCodeViewItemsOptions {
	workspaceId: string;
	files: ChangesetFile[];
	collapsedSet: ReadonlySet<string>;
	editingSet: ReadonlySet<string>;
	editorRevisionByItemId: ReadonlyMap<string, number>;
	annotationsByPath: ReadonlyMap<
		string,
		DiffLineAnnotation<DiffAnnotationMetadata>[]
	>;
	/** Extra in-memory annotations keyed by CodeView item id (e.g. the live
	 *  agent-comment composer). Merged on top of `annotationsByPath`. */
	extraAnnotationsByItemId?: ReadonlyMap<
		string,
		DiffLineAnnotation<DiffAnnotationMetadata>[]
	> | null;
}

interface UseDiffCodeViewItemsResult {
	items: CodeViewItem<DiffAnnotationMetadata>[];
	fileByItemId: Map<string, ChangesetFile>;
	requestDiff: (itemId: string) => void;
}

export function useDiffCodeViewItems({
	workspaceId,
	files,
	collapsedSet,
	editingSet,
	editorRevisionByItemId,
	annotationsByPath,
	extraAnnotationsByItemId,
}: UseDiffCodeViewItemsOptions): UseDiffCodeViewItemsResult {
	const { trpcClient } = useWorkspaceClient();
	const [requestedItemIds, setRequestedItemIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const requestedItemIdsRef = useRef(requestedItemIds);
	requestedItemIdsRef.current = requestedItemIds;
	const retryByItemIdRef = useRef(new Map<string, () => void>());

	const fileByItemId = useMemo(() => {
		const map = new Map<string, ChangesetFile>();
		for (const file of files) {
			map.set(getDiffItemId(file), file);
		}
		return map;
	}, [files]);

	useEffect(() => {
		setRequestedItemIds((current) => {
			let changed = false;
			const next = new Set<string>();
			for (const itemId of current) {
				if (fileByItemId.has(itemId)) next.add(itemId);
				else changed = true;
			}
			return changed ? next : current;
		});
	}, [fileByItemId]);

	const requestDiff = useCallback((itemId: string) => {
		if (requestedItemIdsRef.current.has(itemId)) {
			retryByItemIdRef.current.get(itemId)?.();
			return;
		}
		setRequestedItemIds((current) => {
			if (current.has(itemId)) return current;
			const next = new Set(current);
			next.add(itemId);
			return next;
		});
	}, []);

	const diffRequests = useMemo(
		() =>
			files
				.filter(
					(file) => !file.isBinary && requestedItemIds.has(getDiffItemId(file)),
				)
				.map((file) => ({
					file,
					itemId: getDiffItemId(file),
					input: createGetDiffInput(workspaceId, file),
				})),
		[files, requestedItemIds, workspaceId],
	);

	const diffQueries = useQueries({
		queries: diffRequests.map(({ input }) => ({
			queryKey: getQueryKey(workspaceTrpc.git.getDiff, input, "query"),
			queryFn: () => trpcClient.git.getDiff.query(input),
			staleTime: Number.POSITIVE_INFINITY,
		})),
	});

	const contentCacheRef = useRef(
		new Map<
			string,
			{
				source: GetDiffOutput;
				content: GetDiffOutput & { revision: number };
			}
		>(),
	);
	retryByItemIdRef.current = new Map(
		diffRequests.map((request, index) => [
			request.itemId,
			() => void diffQueries[index]?.refetch(),
		]),
	);

	const diffContentByItemId = useMemo(() => {
		const map = new Map<string, GetDiffOutput & { revision: number }>();
		const cache = contentCacheRef.current;
		const liveItemIds = new Set(fileByItemId.keys());
		diffRequests.forEach((request, index) => {
			const data = diffQueries[index]?.data;
			if (!data) return;
			if (isDiffContentTooLarge(data.oldFile.contents, data.newFile.contents)) {
				return;
			}
			const cached = cache.get(request.itemId);
			if (cached?.source === data) {
				map.set(request.itemId, cached.content);
				return;
			}
			// react-query stamps this when *this file's* query resolves, and
			// every file has its own query, so it moves exactly when the
			// file's contents do. Hashing both file bodies for the same
			// answer walked every character of the changeset on the main
			// thread — 228ms of a profiled 24-file changeset.
			const content = {
				...data,
				revision: diffQueries[index]?.dataUpdatedAt ?? 0,
			};
			cache.set(request.itemId, { source: data, content });
			map.set(request.itemId, content);
		});
		for (const itemId of cache.keys()) {
			if (!liveItemIds.has(itemId)) cache.delete(itemId);
		}
		return map;
	}, [diffRequests, diffQueries, fileByItemId]);

	const diffReasonByItemId = useMemo(() => {
		const map = new Map<string, DeferredDiffReason>();
		diffRequests.forEach((request, index) => {
			const query = diffQueries[index];
			const data = query?.data;
			const reason: DeferredDiffReason = query?.isError
				? "error"
				: !data
					? "loading"
					: isDiffContentTooLarge(data.oldFile.contents, data.newFile.contents)
						? "too-large"
						: "deferred";
			map.set(request.itemId, reason);
		});
		return map;
	}, [diffRequests, diffQueries]);

	// Parsing a file's diff (parseDiffFromFile) is the expensive part of
	// building an item — cache it per item id, keyed by the file's content
	// revision, so a render triggered by something unrelated (collapsed
	// state, an annotation on a different file, another file in the same
	// group refetching) doesn't re-parse every file.
	const fileDiffCacheRef = useRef(
		new Map<string, { revision: number; fileDiff: FileDiffMetadata }>(),
	);

	const items = useMemo<CodeViewItem<DiffAnnotationMetadata>[]>(() => {
		const nextItems: CodeViewItem<DiffAnnotationMetadata>[] = [];
		const cache = fileDiffCacheRef.current;
		const liveItemIds = new Set<string>();

		for (const file of files) {
			const itemId = getDiffItemId(file);
			liveItemIds.add(itemId);
			const collapsed = collapsedSet.has(getChangesetFileKey(file));
			const editing = editingSet.has(getChangesetFileKey(file));

			if (file.isBinary) {
				const annotations = getPlaceholderAnnotations(annotationsByPath, file, {
					kind: "binary-placeholder",
				});
				nextItems.push({
					id: itemId,
					type: "file",
					file: {
						name: file.path,
						contents: " ",
					},
					annotations,
					collapsed,
					version: hashString(
						[
							file.path,
							file.oldPath ?? "",
							file.status,
							file.additions,
							file.deletions,
							"binary",
							collapsed ? "1" : "0",
							getAnnotationsVersion(annotations),
						].join("\0"),
					),
				});
				continue;
			}

			const content = diffContentByItemId.get(itemId);
			if (!content) {
				const reason = diffReasonByItemId.get(itemId) ?? "deferred";
				const annotations = getPlaceholderAnnotations(annotationsByPath, file, {
					kind: "deferred-placeholder",
					reason,
					autoLoad: reason === "deferred" && shouldAutoLoadDiff(file),
				});
				nextItems.push({
					id: itemId,
					type: "file",
					file: { name: file.path, contents: " " },
					annotations,
					collapsed,
					version: hashString(
						[
							file.path,
							file.oldPath ?? "",
							file.status,
							file.additions,
							file.deletions,
							reason,
							collapsed ? "1" : "0",
							getAnnotationsVersion(annotations),
						].join("\0"),
					),
				});
				continue;
			}

			const cached = cache.get(itemId);
			const fileDiff =
				cached && cached.revision === content.revision
					? cached.fileDiff
					: parseDiffFromFile(
							{
								...content.oldFile,
								name: file.oldPath ?? file.path,
								// Lets @pierre/diffs' WorkerPoolManager reuse an
								// already-highlighted AST across remounts (e.g.
								// navigating away from a workspace and back), which
								// this hook's own fileDiffCacheRef can't cover since
								// it's wiped on unmount. revision changes only when
								// this file's own contents change, not when a
								// sibling in the same bulk group refetches.
								cacheKey: `${itemId}:${content.revision}:old`,
							},
							{
								...content.newFile,
								name: file.path,
								cacheKey: `${itemId}:${content.revision}:new`,
							},
						);
			if (!cached || cached.revision !== content.revision) {
				cache.set(itemId, { revision: content.revision, fileDiff });
			}

			const baseAnnotations = getAnnotationsForFile(annotationsByPath, file);
			const extra = extraAnnotationsByItemId?.get(itemId);
			const annotations =
				baseAnnotations && extra
					? [...baseAnnotations, ...extra]
					: (extra ?? baseAnnotations);
			const version = hashString(
				[
					content.revision,
					file.path,
					file.oldPath ?? "",
					file.status,
					file.additions,
					file.deletions,
					collapsed ? "1" : "0",
					editing ? "editing" : "readonly",
					editorRevisionByItemId.get(itemId) ?? 0,
					getAnnotationsVersion(annotations),
				].join("\0"),
			);

			nextItems.push({
				id: itemId,
				type: "diff",
				fileDiff,
				annotations,
				collapsed,
				edit: editing,
				version,
			});
		}

		// Drop cache entries for files no longer in the changeset so the map
		// doesn't grow unbounded as the user navigates between diffs.
		for (const key of cache.keys()) {
			if (!liveItemIds.has(key)) cache.delete(key);
		}

		return nextItems;
	}, [
		files,
		diffContentByItemId,
		diffReasonByItemId,
		annotationsByPath,
		collapsedSet,
		editingSet,
		editorRevisionByItemId,
		extraAnnotationsByItemId,
	]);

	return {
		items,
		fileByItemId,
		requestDiff,
	};
}

function createGetDiffInput(
	workspaceId: string,
	file: ChangesetFile,
): GetDiffInput {
	const { source } = file;
	if (source.kind === "against-base") {
		return {
			workspaceId,
			path: file.path,
			category: "against-base",
			baseBranch: source.baseBranch ?? undefined,
		};
	}
	if (source.kind === "commit") {
		return {
			workspaceId,
			path: file.path,
			category: "commit",
			commitHash: source.commitHash,
			fromHash: source.fromHash,
		};
	}
	return {
		workspaceId,
		path: file.path,
		category: source.kind,
	};
}

function getDiffItemId(file: ChangesetFile): string {
	return `diff:${getChangesetFileKey(file)}`;
}

function getAnnotationsForFile(
	annotationsByPath: ReadonlyMap<
		string,
		DiffLineAnnotation<DiffAnnotationMetadata>[]
	>,
	file: ChangesetFile,
): DiffLineAnnotation<DiffAnnotationMetadata>[] | undefined {
	const current = annotationsByPath.get(file.path);
	const previous =
		file.oldPath && file.oldPath !== file.path
			? annotationsByPath.get(file.oldPath)
			: undefined;
	if (current && previous) return [...previous, ...current];
	return current ?? previous;
}

/** `LineAnnotation<M>` distributes over `M`, so an annotation whose metadata is
 * still the whole union isn't assignable to it. Everything here lands on line 1
 * regardless of which member it holds, so the pairing can't go wrong — keep the
 * assertion in one place rather than at every construction site. */
function toLineOneAnnotation(
	metadata: DiffAnnotationMetadata,
): LineAnnotation<DiffAnnotationMetadata> {
	return { lineNumber: 1, metadata } as LineAnnotation<DiffAnnotationMetadata>;
}

/** Annotations for a file rendered as a single-line placeholder (binary, or a
 * diff we haven't loaded). Existing review threads are re-anchored onto line 1
 * — otherwise they'd point at diff lines that don't exist here and silently
 * disappear — keeping their original line in `sourceLine`. */
function getPlaceholderAnnotations(
	annotationsByPath: ReadonlyMap<
		string,
		DiffLineAnnotation<DiffAnnotationMetadata>[]
	>,
	file: ChangesetFile,
	placeholder: DiffAnnotationMetadata,
): LineAnnotation<DiffAnnotationMetadata>[] {
	const threadAnnotations = (
		getAnnotationsForFile(annotationsByPath, file) ?? []
	).map((annotation) =>
		toLineOneAnnotation(
			annotation.metadata.kind === "thread"
				? { ...annotation.metadata, sourceLine: annotation.lineNumber }
				: annotation.metadata,
		),
	);
	return [toLineOneAnnotation(placeholder), ...threadAnnotations];
}

function getAnnotationsVersion(
	annotations:
		| (
				| DiffLineAnnotation<DiffAnnotationMetadata>
				| LineAnnotation<DiffAnnotationMetadata>
		  )[]
		| undefined,
): string {
	if (!annotations?.length) return "";
	return annotations
		.map((annotation) => {
			const m = annotation.metadata;
			const side = "side" in annotation ? annotation.side : "file";
			if (m.kind === "composer") {
				return [
					"c",
					side,
					annotation.lineNumber,
					m.startLine,
					m.endLine,
					m.startSide,
					m.endSide,
				].join(",");
			}
			if (m.kind !== "thread") return "local";
			return [
				"t",
				side,
				annotation.lineNumber,
				m.threadId,
				m.isResolved ? "1" : "0",
				m.isOutdated ? "1" : "0",
				m.comments.length,
			].join(",");
		})
		.join("|");
}

function hashString(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
