import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useMemo, useRef } from "react";
import {
	createPierreTreeStyle,
	PIERRE_TREE_UNSAFE_CSS,
} from "renderer/lib/pierreTree";
import type { ChangesetFile } from "../../../../../useChangeset";
import {
	buildDiffTreeData,
	type DiffTreeTarget,
} from "./utils/buildDiffTreeData";

const ITEM_HEIGHT = 24;
const TREE_STYLE = createPierreTreeStyle({
	rowHeight: ITEM_HEIGHT,
	levelIndent: 8,
});

interface DiffFileTreeProps {
	files: ChangesetFile[];
	/** One-time value baked into Pierre's store at creation — not reactive. */
	initialExpansion: "open" | "closed";
	onSelectFile: (target: DiffTreeTarget) => void;
}

/**
 * File tree beside the Changes pane's diff, mirroring the PR Code tab's:
 * Pierre builds the hierarchy from the flat path list and handles
 * virtualization + status tints + icons; we contribute `+N −M` row
 * decorations and click-to-navigate.
 */
export function DiffFileTree({
	files,
	initialExpansion,
	onSelectFile,
}: DiffFileTreeProps) {
	const { treePaths, gitStatus, decorationByTreePath, targetByTreePath } =
		useMemo(() => buildDiffTreeData(files), [files]);

	// Routed through a ref so Pierre's handler closures (resolved once at
	// useFileTree time) always see the latest data.
	const handlersRef = useRef({
		onSelect(_treePath: string) {},
		renderRowDecoration(_ctx: { item: { kind: string; path: string } }) {
			return null as { text: string } | null;
		},
	});
	handlersRef.current.onSelect = (treePath) => {
		const target = targetByTreePath.get(treePath);
		if (target) onSelectFile(target);
	};
	handlersRef.current.renderRowDecoration = (ctx) => {
		if (ctx.item.kind === "directory") return null;
		const text = decorationByTreePath.get(ctx.item.path);
		return text ? { text } : null;
	};

	const { model } = useFileTree({
		paths: treePaths,
		initialExpansion,
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

	// Keep Pierre's path set in sync as files churn (stage/unstage, new edits).
	useEffect(() => {
		model.resetPaths(treePaths);
	}, [model, treePaths]);

	useEffect(() => {
		model.setGitStatus(gitStatus);
	}, [model, gitStatus]);

	return (
		<PierreFileTree model={model} style={{ ...TREE_STYLE, height: "100%" }} />
	);
}
