import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useEffect } from "react";
import { LuFileCode, LuLoader } from "react-icons/lu";
import type { ChangesetFile } from "../../../../../useChangeset";
import type { DeferredDiffReason } from "../../hooks/useDiffAnnotations";
import { isGeneratedDiffFile } from "../../utils/diffLoadingGuards";

interface DeferredDiffPlaceholderProps {
	file: ChangesetFile;
	reason: DeferredDiffReason;
	autoLoad: boolean;
	onRequest: () => void;
	onOpenFile: (path: string, openInNewTab?: boolean) => void;
}

export function DeferredDiffPlaceholder({
	file,
	reason,
	autoLoad,
	onRequest,
	onOpenFile,
}: DeferredDiffPlaceholderProps) {
	useEffect(() => {
		if (reason !== "deferred" || !autoLoad) return;
		const frame = requestAnimationFrame(onRequest);
		return () => cancelAnimationFrame(frame);
	}, [autoLoad, onRequest, reason]);

	const canOpen = file.status !== "deleted";
	const isLoading = reason === "loading" || (reason === "deferred" && autoLoad);

	return (
		<div className="flex flex-col items-center justify-center gap-3 bg-muted/30 py-8 text-muted-foreground">
			{isLoading ? (
				<LuLoader className="size-6 animate-spin" />
			) : (
				<LuFileCode className="size-8" />
			)}
			<p className="cursor-text select-text text-sm">
				{isLoading ? (
					<Trans id="workspace.diffPane.fileLoading">Loading diff…</Trans>
				) : reason === "error" ? (
					<Trans id="workspace.diffPane.diffLoadFailed">
						Unable to load diff
					</Trans>
				) : reason === "too-large" ? (
					<Trans id="workspace.diffPane.diffTooLarge">
						Diff is too large to render
					</Trans>
				) : isGeneratedDiffFile(file.path) ? (
					<Trans id="workspace.diffPane.generatedFileHidden">
						Generated file hidden
					</Trans>
				) : (
					<Trans id="workspace.diffPane.largeDiffHidden">
						Large diff hidden
					</Trans>
				)}
			</p>
			{reason === "deferred" && !autoLoad ? (
				<Button variant="outline" size="sm" onClick={onRequest}>
					<Trans id="workspace.diffPane.loadDiff">Load diff</Trans>
				</Button>
			) : reason === "error" ? (
				<Button variant="outline" size="sm" onClick={onRequest}>
					<Trans id="workspace.diffPane.retryDiff">Retry</Trans>
				</Button>
			) : reason === "too-large" && canOpen ? (
				<Button
					variant="outline"
					size="sm"
					onClick={() => onOpenFile(file.path)}
				>
					<Trans id="workspace.diffPane.openFile">Open file</Trans>
				</Button>
			) : null}
		</div>
	);
}
