import {
	DOWNLOAD_URL_LINUX_X64,
	DOWNLOAD_URL_MAC_ARM64,
	DOWNLOAD_URL_MAC_X64,
} from "@superset/shared/constants";
import { Platform } from "@/app/[lang]/hooks/useOS";

// Which platforms we actually publish a desktop binary for. Windows is
// configured in electron-builder but no installer has shipped yet, so it is
// deliberately absent — the page must not offer a download that does not exist.
export function hasDesktopBuild(platform: Platform): boolean {
	return (
		platform === Platform.MacAppleSilicon ||
		platform === Platform.MacIntel ||
		platform === Platform.Linux ||
		// Arch detection can fail on a Mac; Unknown falls back to the Apple
		// Silicon build, which is what the overwhelming majority of visitors need.
		platform === Platform.Unknown
	);
}

// Points at the `releases/latest` aliases rather than a pinned version, so the
// link keeps working across releases without a redeploy.
export function desktopUrlFor(platform: Platform): string {
	if (platform === Platform.MacIntel) return DOWNLOAD_URL_MAC_X64;
	if (platform === Platform.Linux) return DOWNLOAD_URL_LINUX_X64;
	return DOWNLOAD_URL_MAC_ARM64;
}
