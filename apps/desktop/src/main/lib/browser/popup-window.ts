/**
 * Classification for a guest pane's `window.open`.
 *
 * Chromium decides the disposition itself: a scripted `window.open(url, name,
 * "width=…,height=…")` is a popup (`new-window`), while a `target="_blank"`
 * link is a tab (`foreground-tab`/`background-tab`). We keep tabs as split
 * panes and let popups stay real popups — see `resolveWindowOpen` in
 * browser-manager.
 */
export function isPopupDisposition(
	disposition: Electron.HandlerDetails["disposition"],
): boolean {
	return disposition === "new-window";
}

/**
 * An OAuth 2.0 / OpenID Connect authorization request (RFC 6749 section 4.1.1).
 *
 * Needed because Chromium cannot tell us the thing we actually want to know.
 * Measured in Electron 41: a scripted `window.open(url)` with no name and no
 * features, and a plain `<a target="_blank">` click, arrive *identically* —
 * disposition `foreground-tab`, empty `frameName`, empty `features`. Sites that
 * open sign-in that way (Deel does) would otherwise land in a split pane, lose
 * `window.opener`, and never complete the handshake.
 *
 * Keyed on the parameters every authorization endpoint carries rather than a
 * list of provider hostnames, so it covers any identity provider without a
 * vendor allowlist to maintain. A `target="_blank"` link to an ordinary page
 * has none of these, so the split-pane path keeps that traffic.
 */
export function isOAuthAuthorizationUrl(url: string): boolean {
	let params: URLSearchParams;
	try {
		params = new URL(url).searchParams;
	} catch {
		return false;
	}
	return (
		params.has("client_id") &&
		params.has("redirect_uri") &&
		params.has("response_type")
	);
}

/**
 * Whether a guest's `window.open` should become a real popup window rather than
 * a split pane: either Chromium already called it a popup, or it is a sign-in
 * handshake that cannot survive losing its opener.
 */
export function shouldOpenAsPopup(
	details: Pick<Electron.HandlerDetails, "disposition" | "url">,
): boolean {
	return (
		isPopupDisposition(details.disposition) ||
		isOAuthAuthorizationUrl(details.url)
	);
}

/**
 * Popups opened from a browser pane.
 *
 * The app-wide `web-contents-created` guard sends any http(s) `will-navigate`
 * in a non-webview `webContents` to the system browser. A pane's popup is a
 * `BrowserWindow`, so it matches that rule — which would kick a "Sign in with
 * Google" window out to Chrome, stranding the session in a different browser's
 * cookie jar from the pane that started it (SUPER-1272). These popups must
 * navigate in place instead; that is the entire point of allowing them.
 *
 * A `WeakSet` so an entry dies with its `webContents`. Registration happens on
 * `did-create-window`, which Electron fires before the popup's first
 * `will-navigate`, so the guard always sees the mark in time.
 */
const panePopupContents = new WeakSet<Electron.WebContents>();

export function markBrowserPanePopup(contents: Electron.WebContents): void {
	panePopupContents.add(contents);
}

export function isBrowserPanePopup(contents: Electron.WebContents): boolean {
	return panePopupContents.has(contents);
}
