import { db } from "@superset/db/client";
import { pages, pageVersions, type SelectPage } from "@superset/db/schema";
import {
	type PageManifest,
	pageManifestKey,
	pageThumbnailKey,
	signPageTicket,
} from "@superset/shared/usercontent";
import { asc, eq } from "drizzle-orm";
import { env } from "../../env";
import { deleteObjects, putObject } from "../../lib/r2";

const PAGE_TICKET_TTL_SECONDS = 60 * 60;

export function usercontentBaseUrl(): string {
	if (!env.USERCONTENT_URL) {
		throw new Error("Usercontent origin is not configured");
	}
	return env.USERCONTENT_URL;
}

function ticketSecret(): string {
	if (!env.USERCONTENT_TOKEN_SECRET) {
		throw new Error("Usercontent origin is not configured");
	}
	return env.USERCONTENT_TOKEN_SECRET;
}

/**
 * Rewrites the manifest the content Worker serves from. Called after any
 * change to what a page serves or who may see it; idempotent, so a failed
 * write is repaired by the next caller.
 */
export async function writePageManifest(pageId: string): Promise<void> {
	const [page] = await db
		.select()
		.from(pages)
		.where(eq(pages.id, pageId))
		.limit(1);
	if (!page) return;

	const rows = await db
		.select({
			version: pageVersions.version,
			key: pageVersions.blobPathname,
			contentType: pageVersions.contentType,
		})
		.from(pageVersions)
		.where(eq(pageVersions.pageId, pageId))
		.orderBy(asc(pageVersions.version));

	const manifest: PageManifest = {
		v: 1,
		pageId,
		slug: page.slug,
		visibility: page.visibility,
		sharedVersion: page.sharedVersion,
		latestVersion: rows.at(-1)?.version ?? null,
		versions: Object.fromEntries(
			rows.map((row) => [
				String(row.version),
				{ key: row.key, contentType: row.contentType },
			]),
		),
	};

	await putObject({
		key: pageManifestKey(pageId),
		body: JSON.stringify(manifest),
		contentType: "application/json",
	});
}

export async function deletePageObjects({
	pageId,
	versions,
}: {
	pageId: string;
	versions: readonly { version: number; key: string }[];
}): Promise<void> {
	await deleteObjects([
		pageManifestKey(pageId),
		...versions.flatMap((row) => [
			row.key,
			pageThumbnailKey(pageId, row.version),
		]),
	]);
}

/**
 * A public page needs no ticket; anything narrower gets one bound to the
 * page and, when given, to a single version.
 */
export async function mintPageTicket(
	page: Pick<SelectPage, "id" | "visibility">,
	{
		version,
		ttlSeconds = PAGE_TICKET_TTL_SECONDS,
	}: { version?: number; ttlSeconds?: number } = {},
): Promise<string | undefined> {
	if (page.visibility === "everyone") return undefined;
	return signPageTicket(ticketSecret(), {
		pageId: page.id,
		...(version !== undefined ? { version } : {}),
		exp: Math.floor(Date.now() / 1000) + ttlSeconds,
	});
}
