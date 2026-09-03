// Extra unsafeCSS appended to (not replacing) useDiffCodeViewTheme's own —
// shared by every card-styled diff surface (the PR Code tab and the
// v2-workspace DiffPane) via useDiffCardCodeViewTheme.
//
// [data-diff]'s --diffs-light-bg/--diffs-dark-bg override: the shared hook
// sources its background from the *terminal* theme
// (terminalTheme?.background ?? var(--background)), but the terminal theme's
// default background doesn't match the app's own var(--background), and the
// card look draws its borders/gaps against the app background — re-overridden
// here (both are !important, so this wins by appearing later in the
// concatenated string) back to the token card surfaces actually use. The
// CodeView root's own `style.backgroundColor` gets the equivalent fix
// directly as a prop (see useDiffCardCodeViewTheme's style) since that one
// isn't reachable through unsafeCSS.
//
// Card-per-file look: Pierre has no single wrapping element around one
// file's header+content (confirmed live: [data-diffs-header]'s
// parentElement is the shadow root itself), so the "card" is an illusion
// built from two adjacent elements — the header gets rounded top corners,
// the diff body gets rounded bottom corners, matching borders on both meet
// with no gap between them, and layout.gap (set in useDiffCardCodeViewTheme)
// puts real space before the *next* file's header. Mirrors packages/ui's
// shared Card component's own recipe (rounded-xl border shadow-sm) rather
// than inventing a new one.
//
// A function (not a static string) because the additions/deletions colors
// are theme-branched in JS — mirroring useDiffCodeViewTheme's own
// additionColor/deletionColor — rather than relying on a `.dark` selector,
// which can't reach in from outside the shadow root the way a CSS custom
// property can.
export function diffCardUnsafeCss(
	additionsColor: string,
	deletionsColor: string,
): string {
	return `
	[data-diffs-header='default'] {
		border: 1px solid var(--border);
		border-bottom: none;
		border-top-left-radius: 0.75rem;
		border-top-right-radius: 0.75rem;
		/* Two shadows: the card's drop shadow, then — listed last, so it
		 * paints beneath — a hard copy of the header's shape shifted up by
		 * the corner radius in the pane background. Every header carries
		 * data-sticky from first render (confirmed live) and pins while the
		 * code column scrolls behind it; the rounded top corners cut a notch
		 * out of its own background, and whatever's scrolled behind shows
		 * through that notch as a stray border/text sliver. The shifted copy
		 * covers exactly the notches — its straight edges run under the whole
		 * box from the top edge down — without reaching below the header,
		 * so the corners can stay rounded like the card's bottom ones. */
		box-shadow:
			0 1px 2px 0 rgb(0 0 0 / 0.05),
			0 -0.75rem 0 0 var(--background);
		/* Pushes [data-metadata] (the +/- count) to the card's right edge
		 * instead of leaving it flush against the filename — matches the
		 * PR list row's own diff-stat placement. Overrides the shared
		 * hook's flex-start (same selector, appended later so it wins). */
		justify-content: space-between;
		/* Pierre's own padding (0 16px) sits the collapse chevron well right
		 * of the Files pill above it (px-2 on the toolbar row, 8px) — cut to
		 * match so the two rows read as left-aligned. */
		padding-left: 8px;
	}
	/* Pierre renders the full relative path as one plain-text node here;
	 * replaced by our own filename/directory split rendered through
	 * renderHeaderFilenameSuffix, which sits right after this in the DOM so
	 * hiding it (rather than removing/reordering) keeps the same slot order. */
	[data-diffs-header='default'] [data-title] {
		display: none;
	}
	/* Pierre slots the renderHeaderFilenameSuffix output through an unstyled
	 * light-DOM wrapper div; as a flex item it defaults to min-width:auto and
	 * refuses to shrink below the full path's intrinsic width, painting the
	 * directory under the +/− counts in narrow panes. Let it shrink so the
	 * suffix's own min-w-0/truncate chain can ellipsize the directory
	 * (confirmed live: the wrapper measured 893px inside a 513px
	 * [data-header-content]). */
	[data-diffs-header='default'] slot[name='header-filename-suffix']::slotted(*) {
		min-width: 0;
		overflow: hidden;
	}
	/* Match PullRequestRow's diff-stat colors (the PR list view) instead of
	 * the shared hook's own green/red, which use a different palette. */
	[data-diffs-header='default'] [data-additions-count] {
		color: ${additionsColor};
	}
	[data-diffs-header='default'] [data-deletions-count] {
		color: ${deletionsColor};
	}
	[data-diff] {
		--diffs-light-bg: var(--background) !important;
		--diffs-dark-bg: var(--background) !important;
		border: 1px solid var(--border);
		border-top: none;
		border-bottom-left-radius: 0.75rem;
		border-bottom-right-radius: 0.75rem;
		box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
	}
	/* The shared hook zeroes this strip's own inline padding to sit flush
	 * with an edge-to-edge pane — but that leaves "N unmodified lines" text
	 * touching this card's left border with no breathing room. Restored
	 * (higher specificity: same selector, later in the concatenated string,
	 * so this !important wins over that one). */
	[data-separator^='line-info'] [data-separator-content] {
		padding-inline: 8px !important;
	}
`;
}
