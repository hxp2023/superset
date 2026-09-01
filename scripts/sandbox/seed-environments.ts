import { db } from "../../packages/db/src/client.ts";
import {
	environments,
	organizations,
} from "../../packages/db/src/schema/index.ts";
import {
	SANDBOX_IMAGE_NAME,
	SHARED_ENVIRONMENT_ORGANIZATION_ID,
} from "../../packages/shared/src/constants.ts";

/**
 * The environments the platform ships, owned by a sentinel organization nobody
 * is a member of.
 *
 * One row per shipped image rather than a copy per customer: rebuilding an
 * image re-points a single row and every organization has it immediately, where
 * per-organization copies would need a backfill across every organization that
 * existed when the image changed — the same drift this whole area exists to
 * avoid.
 *
 * Idempotent, and run on every deploy after migrations: the image reference is
 * the one thing expected to change, so it is the one thing the upsert writes.
 */
const SHARED_ORGANIZATION = {
	id: SHARED_ENVIRONMENT_ORGANIZATION_ID,
	name: "Superset",
	// Slug is unique across real organizations, so it has to be one nobody
	// would pick. Reserved rather than merely unlikely.
	slug: "superset-shared-environments",
} as const;

/** Named for what a customer sees, not for how it is built. */
export const SHARED_ENVIRONMENT_NAME = "Default";

export async function seedSharedEnvironments(
	imageRef = process.env.BLAXEL_SANDBOX_IMAGE ?? SANDBOX_IMAGE_NAME,
): Promise<{ imageRef: string }> {
	await db
		.insert(organizations)
		.values(SHARED_ORGANIZATION)
		.onConflictDoNothing({ target: organizations.id });

	// The name is the conflict key, so renaming the shipped environment would
	// create a second row rather than rename the first. That is deliberate:
	// existing workspaces reference the old row by id and must keep resolving.
	await db
		.insert(environments)
		.values({
			organizationId: SHARED_ENVIRONMENT_ORGANIZATION_ID,
			name: SHARED_ENVIRONMENT_NAME,
			provider: "blaxel",
			sourceKind: "image",
			sourceRef: imageRef,
		})
		.onConflictDoUpdate({
			target: [environments.organizationId, environments.name],
			set: { sourceRef: imageRef, archivedAt: null },
		});

	return { imageRef };
}

if (import.meta.main) {
	const { imageRef } = await seedSharedEnvironments();
	console.log(`seeded shared environment -> ${imageRef}`);
	process.exit(0);
}
