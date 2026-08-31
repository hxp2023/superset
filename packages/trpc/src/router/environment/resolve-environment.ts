import { db } from "@superset/db/client";
import { environmentSecrets, environments } from "@superset/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./secrets/utils/crypto";
import { isReservedKey } from "./secrets/utils/secrets-validation";

export interface ResolvedEnvironment {
	id: string;
	provider: string;
	sourceKind: "image" | "fork";
	sourceRef: string;
	envs: Record<string, string>;
}

export async function resolveEnvironment(
	environmentId: string,
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
		.where(eq(environmentSecrets.environmentId, environmentId));

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
