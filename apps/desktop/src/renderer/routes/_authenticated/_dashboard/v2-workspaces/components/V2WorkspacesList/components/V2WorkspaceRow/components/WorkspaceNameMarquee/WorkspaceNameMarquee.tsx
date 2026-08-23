import { cn } from "@superset/ui/utils";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const PIXELS_PER_SECOND = 45;
const MIN_SCROLL_DURATION_S = 0.5;
const MAX_SCROLL_DURATION_S = 6;
const SCROLL_START_DELAY_S = 0.35;
const RESET_DURATION_S = 0.2;

interface WorkspaceNameMarqueeProps {
	name: string;
	className?: string;
}

/**
 * Truncated with an ellipsis at rest, same as `truncate`. On hover, scrolls
 * the text left just far enough to reveal the cut-off tail at a constant,
 * readable pace, then snaps back to the start when the pointer leaves — so a
 * name that's been squeezed by a narrow row can still be read without a
 * tooltip popup.
 */
export function WorkspaceNameMarquee({
	name,
	className,
}: WorkspaceNameMarqueeProps) {
	const containerRef = useRef<HTMLSpanElement>(null);
	const textRef = useRef<HTMLSpanElement>(null);
	const [overflow, setOverflow] = useState(0);
	const [hovered, setHovered] = useState(false);

	const measureOverflow = useCallback(() => {
		const container = containerRef.current;
		const text = textRef.current;
		if (!container || !text) return;
		setOverflow(Math.max(0, text.scrollWidth - container.clientWidth));
	}, []);

	// Scoped to `name` (not every render) so this doesn't re-arm the hover
	// transition every time this row re-renders — this list re-renders often
	// (live status, ticking relative timestamps). A row resized while it
	// wasn't hovered is instead caught by the mouseEnter re-measure below.
	useLayoutEffect(() => {
		if (name) measureOverflow();
	}, [name, measureOverflow]);

	const canScroll = overflow > 0;
	const scrollDurationS = Math.min(
		MAX_SCROLL_DURATION_S,
		Math.max(MIN_SCROLL_DURATION_S, overflow / PIXELS_PER_SECOND),
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: decorative hover reveal, not a control — the full name is already in the DOM for assistive tech regardless of the CSS transform.
		<span
			ref={containerRef}
			className={cn(
				"block overflow-hidden whitespace-nowrap",
				!(hovered && canScroll) && "text-ellipsis",
				className,
			)}
			onMouseEnter={() => {
				// Re-measure on entry in case the row was resized since the
				// name last rendered (e.g. this row wasn't visible then).
				measureOverflow();
				setHovered(true);
			}}
			onMouseLeave={() => setHovered(false)}
		>
			<span
				ref={textRef}
				className="inline-block whitespace-nowrap"
				style={{
					transform:
						hovered && canScroll ? `translateX(-${overflow}px)` : undefined,
					transition: canScroll
						? hovered
							? `transform ${scrollDurationS}s linear ${SCROLL_START_DELAY_S}s`
							: `transform ${RESET_DURATION_S}s ease`
						: undefined,
				}}
			>
				{name}
			</span>
		</span>
	);
}
