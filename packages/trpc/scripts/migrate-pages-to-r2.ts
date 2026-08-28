/**
 * One-off: copies every page version from Vercel Blob into R2 under the key
 * the version row already holds, then writes each page's manifest. Safe to
 * rerun — versions already in R2 are skipped, manifests are rewritten.
 *
 *   bun --env-file=.env packages/trpc/scripts/migrate-pages-to-r2.ts
 */
import { db } from "@superset/db/client";
import { pageVersions } from "@superset/db/schema";
import { head } from "@vercel/blob";
import { getObject, putObject } from "../src/lib/r2";
import { writePageManifest } from "../src/router/page/storage";

const rows = await db
	.select({
		pageId: pageVersions.pageId,
		version: pageVersions.version,
		key: pageVersions.blobPathname,
		contentType: pageVersions.contentType,
	})
	.from(pageVersions);

let copied = 0;
let skipped = 0;
for (const row of rows) {
	const existing = await getObject(row.key);
	if (existing) {
		await existing.body?.cancel();
		skipped += 1;
		continue;
	}
	const { url } = await head(row.key);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Blob fetch failed (${response.status}) for ${row.key}`);
	}
	await putObject({
		key: row.key,
		body: new Uint8Array(await response.arrayBuffer()),
		contentType: row.contentType,
	});
	copied += 1;
	console.log(`copied ${row.key}`);
}

const pageIds = [...new Set(rows.map((row) => row.pageId))];
for (const pageId of pageIds) {
	await writePageManifest(pageId);
}

console.log(
	`done: ${copied} copied, ${skipped} already present, ${pageIds.length} manifests written`,
);
process.exit(0);
