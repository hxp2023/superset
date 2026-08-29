/**
 * One origin per page: `<pageId>.<pages host>`. A page id is a UUID, which
 * is already a valid DNS label (lowercase hex and hyphens, 36 characters).
 */
export function pageOrigin(baseUrl: string, pageId: string): string {
	const base = new URL(baseUrl);
	return `${base.protocol}//${pageId}.${base.host}`;
}

export const THUMBNAIL_FILENAME = "thumbnail.jpg";
export const TICKET_QUERY_PARAM = "ticket";

function withTicket(url: URL, ticket: string | undefined): string {
	if (ticket) url.searchParams.set(TICKET_QUERY_PARAM, ticket);
	return url.toString();
}

/** `/` serves the shared version (or latest); `/versions/<n>/` pins one. */
export function pageViewUrl({
	baseUrl,
	pageId,
	version = null,
	ticket,
}: {
	baseUrl: string;
	pageId: string;
	version?: number | null;
	ticket?: string;
}): string {
	const path = version === null ? "/" : `/versions/${version}/`;
	return withTicket(new URL(path, pageOrigin(baseUrl, pageId)), ticket);
}

export function pageThumbnailUrl({
	baseUrl,
	pageId,
	version,
	ticket,
}: {
	baseUrl: string;
	pageId: string;
	version: number;
	ticket?: string;
}): string {
	return withTicket(
		new URL(
			`/versions/${version}/${THUMBNAIL_FILENAME}`,
			pageOrigin(baseUrl, pageId),
		),
		ticket,
	);
}

const PAGE_ID_LABEL =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The page id a request host names, or null for the apex or a bad label. */
export function pageIdFromHost(host: string, baseHost: string): string | null {
	const suffix = `.${baseHost}`;
	if (!host.endsWith(suffix)) return null;
	const label = host.slice(0, -suffix.length);
	return PAGE_ID_LABEL.test(label) ? label : null;
}
