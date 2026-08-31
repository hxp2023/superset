"use client";

import { Trans } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { WaitlistForm } from "@/app/[lang]/components/WaitlistForm";
import { Platform, usePlatform } from "@/app/[lang]/hooks/useOS";
import { track } from "@/lib/analytics";
import { desktopUrlFor, hasDesktopBuild } from "../../utils/desktopUrlFor";
import { DesktopDownloadButton } from "../DesktopDownloadButton";
import { DownloadLinkForm } from "../DownloadLinkForm";

const AUTO_DOWNLOAD_DELAY_MS = 600;

// Platform identifiers, not prose — they read the same in every locale
const PLATFORM_LABELS: Record<Platform, string> = {
	[Platform.MacAppleSilicon]: "macOS · Apple Silicon",
	[Platform.MacIntel]: "macOS · Intel",
	[Platform.Windows]: "Windows",
	[Platform.Linux]: "Linux · x64",
	[Platform.Mobile]: "Mobile browser",
	[Platform.Unknown]: "macOS",
};

const HEADING_CLASS =
	"text-3xl font-medium tracking-tight text-foreground sm:text-4xl";

export function DownloadInterstitial() {
	const { platform } = usePlatform();
	const firedRef = useRef(false);

	// A phone can't run the app, so mobile visitors get a link to open on their
	// desktop. Windows has no published build and falls through to the waitlist.
	const showEmailLink = platform === Platform.Mobile;
	const canAutoDownload = !showEmailLink && hasDesktopBuild(platform);
	const showWaitlist = platform === Platform.Windows;

	useEffect(() => {
		if (firedRef.current) return;
		if (!canAutoDownload) return;

		firedRef.current = true;
		const url = desktopUrlFor(platform);
		track("download_started", { platform });

		window.setTimeout(() => {
			window.location.href = url;
		}, AUTO_DOWNLOAD_DELAY_MS);
	}, [canAutoDownload, platform]);

	return (
		<section className="pb-12 sm:pb-16">
			<div className="mb-6 inline-flex w-max items-center gap-2 whitespace-nowrap rounded-[2px] border border-border bg-background/80 px-3 py-1.5 font-mono text-muted-foreground text-xs">
				<span className="shrink-0 text-brand">●</span>
				<span>{PLATFORM_LABELS[platform]}</span>
			</div>

			{showEmailLink ? (
				<div className="max-w-2xl">
					<h1 className={HEADING_CLASS}>
						<Trans id="marketing.download.mobileTitle">
							Get Superset on your Mac
						</Trans>
					</h1>
					<p className="mt-3 text-muted-foreground sm:text-lg">
						<Trans id="marketing.download.mobileBody">
							Superset is a desktop app. Enter your email and we&apos;ll send
							you a download link to open on your Mac.
						</Trans>
					</p>
					<div className="mt-6">
						<DownloadLinkForm />
					</div>
				</div>
			) : showWaitlist ? (
				<div className="max-w-2xl">
					<h1 className={HEADING_CLASS}>
						<Trans id="marketing.download.waitlistTitle">
							Superset isn't on Windows yet
						</Trans>
					</h1>
					<p className="mt-3 text-muted-foreground sm:text-lg">
						<Trans id="marketing.download.waitlistBody">
							The desktop app runs on macOS and Linux today. Drop your email and
							we'll let you know the moment the Windows build ships.
						</Trans>
					</p>
					<div className="mt-6 max-w-sm">
						<WaitlistForm />
					</div>
				</div>
			) : (
				<div className="max-w-2xl">
					<h1 className={HEADING_CLASS}>
						<Trans id="marketing.download.autoTitle">
							You're about to get Superset
						</Trans>
					</h1>
					<p className="mt-3 text-muted-foreground sm:text-lg">
						<Trans id="marketing.download.autoBodyShort">
							Your download starts automatically. If it didn't, grab it here.
						</Trans>
					</p>
					<div className="mt-6">
						<DesktopDownloadButton />
					</div>
				</div>
			)}
		</section>
	);
}
