/**
 * One origin per page: `<slug>.<usercontent host>`. The slug is already a
 * valid DNS label (lowercase alphanumerics and hyphens, at most 57 chars), so
 * it is used verbatim.
 */
export function usercontentOrigin(baseUrl: string, slug: string): string {
	const base = new URL(baseUrl);
	return `${base.protocol}//${slug}.${base.host}`;
}

export const THUMBNAIL_FILENAME = "thumbnail.jpg";

function withToken(url: URL, token: string | undefined): string {
	if (token) url.searchParams.set("t", token);
	return url.toString();
}

/** `/` serves the shared version (or latest); `/v/<n>/` pins one. */
export function pageViewUrl({
	baseUrl,
	slug,
	version = null,
	token,
}: {
	baseUrl: string;
	slug: string;
	version?: number | null;
	token?: string;
}): string {
	const path = version === null ? "/" : `/v/${version}/`;
	return withToken(new URL(path, usercontentOrigin(baseUrl, slug)), token);
}

export function pageThumbnailUrl({
	baseUrl,
	slug,
	version,
	token,
}: {
	baseUrl: string;
	slug: string;
	version: number;
	token?: string;
}): string {
	return withToken(
		new URL(
			`/v/${version}/${THUMBNAIL_FILENAME}`,
			usercontentOrigin(baseUrl, slug),
		),
		token,
	);
}

const SLUG_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The page slug a request host names, or null for the apex or a bad label. */
export function slugFromHost(host: string, baseHost: string): string | null {
	const suffix = `.${baseHost}`;
	if (!host.endsWith(suffix)) return null;
	const slug = host.slice(0, -suffix.length);
	return SLUG_LABEL.test(slug) ? slug : null;
}
