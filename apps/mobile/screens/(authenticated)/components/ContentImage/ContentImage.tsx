import { Image as ExpoImage, type ImageProps } from "expo-image";
import { withUniwind } from "uniwind";

const StyledImage = withUniwind(ExpoImage);

interface ContentImageProps extends Omit<ImageProps, "source"> {
	url: string | null | undefined;
	/**
	 * The server's storage key for the bytes, when it names one
	 * (`Superset-Storage-Key`, `storageKey` in API responses). It becomes the
	 * disk-cache key, so a rotated ticket in the URL is never a fresh
	 * download.
	 */
	storageKey?: string | null;
	className?: string;
}

/** Every remote image the app renders goes through here, cached by identity, not URL. */
export function ContentImage({
	url,
	storageKey,
	className,
	...props
}: ContentImageProps) {
	if (!url) return null;
	return (
		<StyledImage
			className={className}
			source={{ uri: url, ...(storageKey ? { cacheKey: storageKey } : {}) }}
			cachePolicy="disk"
			{...props}
		/>
	);
}
