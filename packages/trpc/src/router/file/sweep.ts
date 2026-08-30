import { db } from "@superset/db/client";
import { files } from "@superset/db/schema";
import { fileOriginalKey } from "@superset/shared/usercontent";
import { and, eq, inArray, lt } from "drizzle-orm";
import { deleteObjects } from "../../lib/r2";

export const FILE_SWEEP_JOB_PATH = "/api/files/jobs/sweep";

const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 500;

/**
 * Drops `pending` rows older than a day, and their objects. Objects first —
 * a re-run repairs a half-finished sweep, whereas rows deleted before their
 * objects would strand bytes forever.
 */
export async function sweepPendingFiles(
	now = Date.now(),
): Promise<{ swept: number }> {
	const cutoff = new Date(now - PENDING_MAX_AGE_MS);
	const rows = await db
		.select({ id: files.id })
		.from(files)
		.where(and(eq(files.status, "pending"), lt(files.createdAt, cutoff)))
		.limit(SWEEP_BATCH);
	if (rows.length === 0) return { swept: 0 };

	await deleteObjects(rows.map((row) => fileOriginalKey(row.id)));
	await db.delete(files).where(
		inArray(
			files.id,
			rows.map((row) => row.id),
		),
	);
	return { swept: rows.length };
}
