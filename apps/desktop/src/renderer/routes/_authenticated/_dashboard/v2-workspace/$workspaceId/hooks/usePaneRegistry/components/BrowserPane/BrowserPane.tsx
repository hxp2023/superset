import type { RendererContext, Tab } from "@superset/panes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useParams } from "@tanstack/react-router";
import { GlobeIcon, SquareDashedMousePointer, XIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { TbDeviceDesktop } from "react-icons/tb";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { BrowserPaneData, PaneViewerData } from "../../../../types";

import { browserRuntimeRegistry } from "./browserRuntimeRegistry";
import { BrowserErrorOverlay } from "./components/BrowserErrorOverlay";
import { BrowserOverflowMenu } from "./components/BrowserOverflowMenu";
import { BrowserTabFavicon } from "./components/BrowserTabFavicon";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { DesignModePopover } from "./components/DesignModePopover";
import { designModeStore, useDesignModeState } from "./designModeStore";
import { usePersistentWebview } from "./hooks/usePersistentWebview";

function getSingleBrowserPane(
	tab: Tab<PaneViewerData>,
): { id: string; data: BrowserPaneData } | null {
	const paneIds = Object.keys(tab.panes);
	if (paneIds.length !== 1) return null;
	const pane = tab.panes[paneIds[0]];
	if (pane.kind !== "browser") return null;
	return { id: pane.id, data: pane.data as BrowserPaneData };
}

export function renderBrowserTabIcon(tab: Tab<PaneViewerData>) {
	const browser = getSingleBrowserPane(tab);
	if (!browser) return null;
	const faviconUrl = browser.data.faviconUrl ?? null;
	// Keyed by page + favicon URL so a failed favicon retries on navigation
	// even when the favicon URL itself is unchanged.
	return (
		<BrowserTabFavicon
			key={`${browser.data.url}|${faviconUrl ?? "none"}`}
			src={faviconUrl}
		/>
	);
}

interface CreateNewAgentSessionInput {
	configId: string;
	placement: "split-pane" | "new-tab";
	prompt: string;
}

interface BrowserPaneProps {
	ctx: RendererContext<PaneViewerData>;
	onCreateNewAgentSession?: (
		input: CreateNewAgentSessionInput,
	) => Promise<{ terminalId: string } | null>;
	/** Bring the pane hosting this agent terminal to the front. */
	onFocusAgentTerminal?: (terminalId: string) => void;
}

function useBrowserState(paneId: string) {
	return useSyncExternalStore(
		useCallback(
			(cb) => browserRuntimeRegistry.onStateChange(paneId, cb),
			[paneId],
		),
		useCallback(() => browserRuntimeRegistry.getState(paneId), [paneId]),
	);
}

export function BrowserPane({
	ctx,
	onCreateNewAgentSession,
	onFocusAgentTerminal,
}: BrowserPaneProps) {
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);
	const { placeholderRef, reload } = usePersistentWebview({ paneId, ctx });
	const { workspaceId } = useParams({ strict: false });
	const designMode = useDesignModeState(paneId);

	// A pane switch or unmount must not leave a stale picker overlay armed in
	// the guest, nor an await resolving into a pane that no longer shows it.
	useEffect(() => {
		return () => {
			if (designModeStore.getState(paneId).phase !== "idle") {
				designModeStore.exit(paneId);
			}
		};
	}, [paneId]);

	// Esc while the host (not the guest) owns focus: with a captured element it
	// discards the capture and goes back to picking; while picking it exits.
	// The injected overlay handles Esc itself when the guest has focus, and the
	// composer's own Esc handler covers its textarea.
	useEffect(() => {
		if (designMode.phase === "idle") return;
		const phase = designMode.phase;
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.key !== "Escape") return;
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable ||
					target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA")
			) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (phase === "confirming") {
				designModeStore.rearm(paneId);
			} else {
				designModeStore.exit(paneId);
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [designMode.phase, paneId]);

	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";

	// Anchor the composer under the clicked element: the capture's viewport
	// rect is in guest CSS pixels, which map 1:1 onto the placeholder's box
	// (the webview mirrors the placeholder rect, and the pane root is the
	// offset parent of both the placeholder and the popover). Computed in a
	// layout effect (refs are unset during the first render of a remount) and
	// re-clamped when the pane resizes so the card stays inside it.
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({
		top: 12,
		left: 12,
	});
	const confirmingRect =
		designMode.phase === "confirming"
			? designMode.payload?.target.rectViewport
			: undefined;
	useLayoutEffect(() => {
		if (!confirmingRect) return;
		const root = rootRef.current;
		if (!root) return;
		const compute = () => {
			const placeholder = placeholderRef.current;
			if (!placeholder) return;
			const width = Math.min(420, root.clientWidth - 16);
			const estimatedHeight = 170;
			const left = Math.min(
				Math.max(placeholder.offsetLeft + confirmingRect.x, 8),
				Math.max(8, root.clientWidth - width - 8),
			);
			const below =
				placeholder.offsetTop + confirmingRect.y + confirmingRect.height + 4;
			const top =
				below + estimatedHeight > root.clientHeight
					? Math.max(
							8,
							placeholder.offsetTop + confirmingRect.y - estimatedHeight - 4,
						)
					: below;
			setPopoverStyle({ top, left, width });
		};
		compute();
		const observer = new ResizeObserver(compute);
		observer.observe(root);
		return () => observer.disconnect();
	}, [confirmingRect, placeholderRef]);

	return (
		// min-w-0: without it the banner row's intrinsic width becomes the pane
		// root's flex min-content, overflowing the pane slot — and the webview
		// follows the placeholder rect, painting over the neighbor pane.
		<div ref={rootRef} className="relative flex h-full min-w-0 flex-1 flex-col">
			{designMode.phase !== "idle" && (
				// relative z-20: must stay clickable above the confirming-phase
				// click-catcher (z-10) so the exit button keeps working.
				<div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-border/60 bg-[#0d99ff]/10 px-3 py-1.5 text-xs text-foreground/90">
					<SquareDashedMousePointer className="size-3.5 shrink-0 text-[#0d99ff]" />
					<span className="min-w-0 flex-1 truncate">
						{designMode.phase === "selecting"
							? "Design mode — click any element in the page to send it to an agent."
							: "Element captured — describe the change, or press esc to pick again."}
					</span>
					{designMode.phase === "selecting" && (
						<span className="shrink-0 text-muted-foreground/70">
							esc to exit
						</span>
					)}
					<button
						type="button"
						onClick={() => designModeStore.exit(paneId)}
						aria-label="Exit design mode"
						className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
					>
						<XIcon className="size-3.5" />
					</button>
				</div>
			)}
			<div ref={placeholderRef} className="w-full min-h-0 flex-1" />
			{designMode.phase === "confirming" &&
				designMode.payload &&
				workspaceId && (
					<>
						{/* Click-catcher: the guest overlay froze pointer events on
						    selection, so without this a stray page click would
						    navigate out from under the open composer. */}
						<button
							type="button"
							aria-label="Discard captured element"
							onClick={() => designModeStore.rearm(paneId)}
							className="absolute inset-0 z-10 cursor-default"
						/>
						<DesignModePopover
							workspaceId={workspaceId}
							paneId={paneId}
							payload={designMode.payload}
							style={popoverStyle}
							onDismiss={() => designModeStore.rearm(paneId)}
							onSent={() => designModeStore.exit(paneId)}
							onCreateNewAgentSession={onCreateNewAgentSession}
							onFocusAgentTerminal={onFocusAgentTerminal}
						/>
					</>
				)}
			{state.error && !state.isLoading && (
				<BrowserErrorOverlay error={state.error} onRetry={reload} />
			)}
			{isBlankPage && !state.isLoading && !state.error && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background pointer-events-none">
					<GlobeIcon className="size-10 text-muted-foreground/30" />
					<div className="text-center">
						<p className="text-sm font-medium text-muted-foreground/50">
							Browser
						</p>
						<p className="mt-1 text-xs text-muted-foreground/30">
							Enter a URL above, or instruct an agent to navigate
							<br />
							and use the browser
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

interface BrowserPaneToolbarProps {
	ctx: RendererContext<PaneViewerData>;
}

export function BrowserPaneToolbar({ ctx }: BrowserPaneToolbarProps) {
	const paneId = ctx.pane.id;
	const state = useBrowserState(paneId);
	const designMode = useDesignModeState(paneId);

	const handleToggleDesignMode = useCallback(() => {
		designModeStore.toggle(paneId);
	}, [paneId]);

	const handleOpenDevTools = useCallback(() => {
		electronTrpcClient.browser.openDevTools.mutate({ paneId }).catch(() => {});
	}, [paneId]);

	const handleGoBack = useCallback(() => {
		browserRuntimeRegistry.goBack(paneId);
	}, [paneId]);

	const handleGoForward = useCallback(() => {
		browserRuntimeRegistry.goForward(paneId);
	}, [paneId]);

	const handleReload = useCallback(() => {
		browserRuntimeRegistry.reload(paneId);
	}, [paneId]);

	const handleNavigate = useCallback(
		(url: string) => {
			browserRuntimeRegistry.navigate(paneId, url);
		},
		[paneId],
	);

	const isBlankPage = !state.currentUrl || state.currentUrl === "about:blank";
	const PaneHeaderActions = ctx.components.PaneHeaderActions;

	return (
		<div className="flex h-full w-full min-w-0 items-center justify-between">
			<BrowserToolbar
				currentUrl={state.currentUrl}
				faviconUrl={state.faviconUrl}
				isLoading={state.isLoading}
				canGoBack={state.canGoBack}
				canGoForward={state.canGoForward}
				onGoBack={handleGoBack}
				onGoForward={handleGoForward}
				onReload={handleReload}
				onNavigate={handleNavigate}
			/>
			<div className="flex shrink-0 items-center gap-0.5 pr-1.5">
				<Tooltip disableHoverableContent>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleToggleDesignMode}
							disabled={isBlankPage}
							aria-pressed={designMode.phase !== "idle"}
							className={cn(
								"flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none transition-colors disabled:opacity-40",
								// Armed color matches the in-page picker outline
								// (design-mode-script.ts), not the theme primary.
								designMode.phase !== "idle"
									? "bg-[#0d99ff] text-white hover:bg-[#0d99ff]/90"
									: "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
							)}
						>
							<SquareDashedMousePointer className="size-3" />
							Design
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{designMode.phase !== "idle"
							? "Exit design mode (esc)"
							: "Design mode — click any element in the page to send it to an agent"}
					</TooltipContent>
				</Tooltip>
				<Tooltip disableHoverableContent>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={handleOpenDevTools}
							className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
						>
							<TbDeviceDesktop className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom">Open DevTools</TooltipContent>
				</Tooltip>
				<BrowserOverflowMenu
					paneId={paneId}
					currentUrl={state.currentUrl}
					hasPage={!isBlankPage}
				/>
				<PaneHeaderActions />
			</div>
		</div>
	);
}
