import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Linking, View } from "react-native";
import { WebView } from "react-native-webview";
import { withUniwind } from "uniwind";
import { Text } from "@/components/ui/text";
import { apiClient } from "@/lib/trpc/client";

const StyledWebView = withUniwind(WebView);

// A ticket is stable within its window (an hour for the served alias), so
// reopening the page inside it reuses the URL — and WebKit's cache — instead
// of minting a fresh one.
const VIEW_URL_STALE_MS = 55 * 60 * 1000;

/**
 * A published page, loaded top-level from its own origin: its storage, CSP
 * and video playback work exactly as on the web, cached by WebKit. The
 * ticket rides the URL's path, so the WebView needs no headers and no
 * cookies. Navigation stays on the page's origin; anything else opens in
 * the browser.
 */
export function PageViewerScreen() {
	const { t } = useLingui();
	const { id } = useLocalSearchParams<{ id: string }>();

	const page = useQuery({
		queryKey: ["cloud", "page", "get", id],
		enabled: !!id,
		staleTime: VIEW_URL_STALE_MS,
		networkMode: "always",
		queryFn: () => apiClient.page.get.query({ id: id as string }),
	});

	const viewUrl = page.data?.viewUrl;
	const pageOrigin = viewUrl ? new URL(viewUrl).origin : null;

	return (
		<View className="flex-1 bg-background">
			<Stack.Screen options={{ title: page.data?.title ?? "" }} />
			{page.isError ? (
				<View className="flex-1 items-center justify-center gap-2 px-8">
					<Text className="text-center font-medium">
						{t({
							id: "dashboard.pageViewer.pageOpenFailedTitle",
							message: "This page could not be opened",
						})}
					</Text>
					<Text className="text-center text-muted-foreground text-sm">
						{t({
							id: "dashboard.pageViewer.pageMissingDescription",
							message:
								"It may have been deleted, or it belongs to another organization.",
						})}
					</Text>
				</View>
			) : viewUrl ? (
				<StyledWebView
					ph-no-capture
					className="flex-1 bg-background"
					source={{ uri: viewUrl }}
					allowsInlineMediaPlayback
					mediaPlaybackRequiresUserAction={false}
					setSupportMultipleWindows={false}
					onShouldStartLoadWithRequest={(request) => {
						if (pageOrigin && request.url.startsWith(pageOrigin)) return true;
						if (request.url.startsWith("about:")) return true;
						void Linking.openURL(request.url).catch(() => {});
						return false;
					}}
					webviewDebuggingEnabled={__DEV__}
				/>
			) : (
				<View className="flex-1 items-center justify-center">
					<ActivityIndicator />
				</View>
			)}
		</View>
	);
}
