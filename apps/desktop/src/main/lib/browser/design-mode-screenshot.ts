import {
	DESIGN_MODE_BUDGET,
	type DesignModeRect,
	type DesignModeScreenshot,
} from "shared/browser-design-mode";

const HIDE_OVERLAY_SCRIPT = `(function(){
  var d = window.__supersetDesignMode;
  if (d && d.host) d.host.style.display = 'none';
})()`;

const RESTORE_OVERLAY_SCRIPT = `(function(){
  var d = window.__supersetDesignMode;
  if (d && d.host) d.host.style.display = '';
})()`;

/**
 * Capture a screenshot of the guest page cropped to the given CSS-pixel rect.
 * Returns null on any failure — a missing screenshot is non-fatal for the
 * design-mode flow.
 */
export async function captureDesignModeScreenshot(
	rect: DesignModeRect,
	guest: Electron.WebContents,
): Promise<DesignModeScreenshot | null> {
	try {
		// The rect crosses IPC from the renderer; keep NaN out of image.crop().
		const safeN = (n: unknown): number =>
			typeof n === "number" && Number.isFinite(n) ? n : 0;
		const safeRect = {
			x: safeN(rect.x),
			y: safeN(rect.y),
			width: safeN(rect.width),
			height: safeN(rect.height),
		};

		// Hide the selection overlay so the highlight box and label don't appear
		// in the capture; always restore it, even when capturePage throws.
		await guest.executeJavaScript(HIDE_OVERLAY_SCRIPT).catch(() => {});
		let image: Electron.NativeImage;
		try {
			image = await guest.capturePage();
		} finally {
			await guest.executeJavaScript(RESTORE_OVERLAY_SCRIPT).catch(() => {});
		}
		if (image.isEmpty()) return null;

		// capturePage returns physical pixels while the rect is CSS pixels. The
		// combined scale factor (zoom × device scale) is derived empirically from
		// the guest's CSS viewport width, which stays correct on multi-monitor
		// setups with mixed DPI where the primary display's factor would be wrong.
		const bitmapSize = image.getSize();
		const viewportCssWidth: number =
			await guest.executeJavaScript("window.innerWidth");
		if (!viewportCssWidth || viewportCssWidth <= 0) return null;
		const scaleFactor = bitmapSize.width / viewportCssWidth;

		const cropX = Math.max(0, Math.round(safeRect.x * scaleFactor));
		const cropY = Math.max(0, Math.round(safeRect.y * scaleFactor));
		const cropW = Math.min(
			bitmapSize.width - cropX,
			Math.round(safeRect.width * scaleFactor),
		);
		const cropH = Math.min(
			bitmapSize.height - cropY,
			Math.round(safeRect.height * scaleFactor),
		);
		if (cropW <= 0 || cropH <= 0) return null;

		const pngBuffer = image
			.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
			.toPNG();
		// Fail closed to "no screenshot" rather than send an oversized payload.
		if (pngBuffer.byteLength > DESIGN_MODE_BUDGET.screenshotMaxBytes) {
			return null;
		}

		return {
			mimeType: "image/png",
			dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
			// Report CSS pixels so the dimensions match rectViewport/rectPage.
			width: Math.round(cropW / scaleFactor),
			height: Math.round(cropH / scaleFactor),
		};
	} catch {
		// Capture can fail while the guest is being torn down. Fail closed.
		return null;
	}
}
