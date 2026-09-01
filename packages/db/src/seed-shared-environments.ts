import { SHARED_ENVIRONMENT_ORGANIZATION_ID } from "@superset/shared/constants";
import { and, eq } from "drizzle-orm";
import { dbWs } from "./client";
import { environments, organizations } from "./schema";

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
 * Idempotent, and safe to run on every deploy: the image reference is the one
 * thing expected to change, so it is the one thing the upsert writes.
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
	imageRef = process.env.BLAXEL_SANDBOX_IMAGE,
): Promise<{ seeded: boolean; imageRef?: string }> {
	if (!imageRef) return { seeded: false };

	await dbWs
		.insert(organizations)
		.values(SHARED_ORGANIZATION)
		.onConflictDoNothing({ target: organizations.id });

	// The name is the conflict key, so renaming the shipped environment would
	// create a second row rather than rename the first. That is deliberate:
	// existing workspaces reference the old row by id and must keep resolving.
	await dbWs
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

	const [row] = await dbWs
		.select({ id: environments.id, sourceRef: environments.sourceRef })
		.from(environments)
		.where(
			and(
				eq(environments.organizationId, SHARED_ENVIRONMENT_ORGANIZATION_ID),
				eq(environments.name, SHARED_ENVIRONMENT_NAME),
			),
		);
	return { seeded: true, imageRef: row?.sourceRef };
}

if (import.meta.main) {
	const result = await seedSharedEnvironments();
	console.log(
		result.seeded
			? `seeded shared environment -> ${result.imageRef}`
			: "BLAXEL_SANDBOX_IMAGE unset; nothing seeded",
	);
	process.exit(0);
}
