import { randomUUID } from "node:crypto";
import { db } from "@superset/db/client";
import { pages, pageVersions, type SelectPage } from "@superset/db/schema";
import {
	type PageManifest,
	pageManifestKey,
	pageThumbnailKey,
	signPageViewToken,
} from "@superset/shared/usercontent";
import { asc, eq } from "drizzle-orm";
import { env } from "../../env";
import { deleteObjects, putObject } from "../../lib/r2";

const VIEW_TOKEN_TTL_SECONDS = 60 * 60;

export function usercontentBaseUrl(): string {
	if (!env.USERCONTENT_URL) {
		throw new Error("Usercontent origin is not configured");
	}
	return env.USERCONTENT_URL;
}

function tokenSecret(): string {
	if (!env.USERCONTENT_TOKEN_SECRET) {
		throw new Error("Usercontent origin is not configured");
	}
	return env.USERCONTENT_TOKEN_SECRET;
}

export function pageContentKey({
	organizationId,
	sha256,
	filename,
}: {
	organizationId: string;
	sha256: string;
	filename: string;
}): string {
	const safe =
		filename.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "page";
	return `pages/${organizationId}/${sha256}/${randomUUID()}/${safe}`;
}

/**
 * Rewrites the manifest the usercontent origin serves from. Called after any
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
		key: pageManifestKey(page.slug),
		body: JSON.stringify(manifest),
		contentType: "application/json",
	});
}

export async function deletePageObjects({
	pageId,
	slug,
	versions,
}: {
	pageId: string;
	slug: string;
	versions: readonly { version: number; key: string }[];
}): Promise<void> {
	await deleteObjects([
		pageManifestKey(slug),
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
export async function mintPageViewToken(
	page: Pick<SelectPage, "id" | "visibility">,
	{
		version,
		ttlSeconds = VIEW_TOKEN_TTL_SECONDS,
	}: { version?: number; ttlSeconds?: number } = {},
): Promise<string | undefined> {
	if (page.visibility === "everyone") return undefined;
	return signPageViewToken(tokenSecret(), {
		pageId: page.id,
		...(version !== undefined ? { version } : {}),
		exp: Math.floor(Date.now() / 1000) + ttlSeconds,
	});
}
