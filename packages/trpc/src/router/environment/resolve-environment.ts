import { db } from "@superset/db/client";
import { environmentSecrets, environments } from "@superset/db/schema";
import { isReservedKey } from "@superset/shared/environment-secrets";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "./secrets/utils/crypto";

export interface ResolvedEnvironment {
	id: string;
	provider: string;
	sourceKind: "image" | "fork";
	sourceRef: string;
	envs: Record<string, string>;
}

/**
 * @param organizationId the workspace's organization. Required, and not derived
 * from the environment: a shared environment is owned by no customer and holds
 * a separate set of values per organization, so resolving without it would feed
 * whichever organization wrote first into every other organization's sandbox.
 */
export async function resolveEnvironment(
	environmentId: string,
	organizationId: string,
): Promise<ResolvedEnvironment | null> {
	const row = await db.query.environments.findFirst({
		where: eq(environments.id, environmentId),
	});
	if (!row) return null;

	const rows = await db
		.select({
			key: environmentSecrets.key,
			encryptedValue: environmentSecrets.encryptedValue,
		})
		.from(environmentSecrets)
		.where(
			and(
				eq(environmentSecrets.environmentId, environmentId),
				eq(environmentSecrets.organizationId, organizationId),
			),
		);

	const envs: Record<string, string> = {};
	for (const secret of rows) {
		// Validation rejects reserved keys on write; re-checked here so a row
		// written before a name became reserved can never shadow identity.
		if (isReservedKey(secret.key)) continue;
		envs[secret.key] = decryptSecret(secret.encryptedValue);
	}

	return {
		id: row.id,
		provider: row.provider,
		sourceKind: row.sourceKind,
		sourceRef: row.sourceRef,
		envs,
	};
}
