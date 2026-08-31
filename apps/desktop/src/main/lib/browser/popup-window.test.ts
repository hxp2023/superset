import { describe, expect, test } from "bun:test";
import {
	isBrowserPanePopup,
	isPopupDisposition,
	markBrowserPanePopup,
} from "./popup-window";

describe("isPopupDisposition", () => {
	test("treats Chromium's popup disposition as a popup", () => {
		expect(isPopupDisposition("new-window")).toBe(true);
	});

	test("leaves link targets as tabs, so they still open as split panes", () => {
		expect(isPopupDisposition("foreground-tab")).toBe(false);
		expect(isPopupDisposition("background-tab")).toBe(false);
		expect(isPopupDisposition("default")).toBe(false);
		expect(isPopupDisposition("other")).toBe(false);
	});
});

describe("browser pane popup registry", () => {
	// The app-wide `web-contents-created` guard in electron-app/factories/app
	// sends http(s) `will-navigate` to the system browser. It consults this
	// registry so a pane's sign-in popup navigates in place instead of being
	// kicked out to Chrome, which would split the session across two browsers.
	const contents = () => ({}) as unknown as Electron.WebContents;

	test("an unmarked webContents is not a pane popup", () => {
		expect(isBrowserPanePopup(contents())).toBe(false);
	});

	test("a marked webContents is recognised", () => {
		const wc = contents();
		markBrowserPanePopup(wc);
		expect(isBrowserPanePopup(wc)).toBe(true);
	});

	test("marking one popup does not mark another", () => {
		const a = contents();
		const b = contents();
		markBrowserPanePopup(a);
		expect(isBrowserPanePopup(a)).toBe(true);
		expect(isBrowserPanePopup(b)).toBe(false);
	});
});
