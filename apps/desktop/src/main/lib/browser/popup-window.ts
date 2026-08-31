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
