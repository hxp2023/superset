/**
 * Object keys in the storage bucket the usercontent origin reads from. The
 * manifest is keyed by slug because the serving host names the page by slug;
 * everything else hangs off the page id so a rename never moves bytes.
 */
export function pageManifestKey(slug: string): string {
	return `slugs/${slug}.json`;
}

export function pageThumbnailKey(pageId: string, version: number): string {
	return `pages/${pageId}/thumbnails/${version}.jpg`;
}
