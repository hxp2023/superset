import { db } from "@superset/db/client";
import {
	environmentProxyCredentials,
	environmentSecrets,
	environments,
} from "@superset/db/schema";
import type { ProxyCredentialRule } from "@superset/shared/environment-proxy-credentials";
import { isReservedKey } from "@superset/shared/environment-secrets";
import { and, eq } from "drizzle-orm";
import { proxyCredentialSecretKey } from "./proxy-credentials/secret-key";
import { decryptSecret } from "./secrets/utils/crypto";

export interface ResolvedEnvironment {
	id: string;
	provider: string;
	sourceKind: "image" | "fork";
	sourceRef: string;
	envs: Record<string, string>;
	/** Injected at the edge; the sandbox only holds each rule's placeholder. */
	proxyCredentials: ResolvedProxyCredential[];
}

export interface ResolvedProxyCredential extends ProxyCredentialRule {
	value: string;
}

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
		if (isReservedKey(secret.key)) continue;
		envs[secret.key] = decryptSecret(secret.encryptedValue, {
			environmentId,
			organizationId,
			key: secret.key,
		});
	}

	const credentialRows = await db
		.select({
			name: environmentProxyCredentials.name,
			placeholderEnv: environmentProxyCredentials.placeholderEnv,
			destinations: environmentProxyCredentials.destinations,
			header: environmentProxyCredentials.header,
			valueTemplate: environmentProxyCredentials.valueTemplate,
			encryptedValue: environmentProxyCredentials.encryptedValue,
		})
		.from(environmentProxyCredentials)
		.where(
			and(
				eq(environmentProxyCredentials.environmentId, environmentId),
				eq(environmentProxyCredentials.organizationId, organizationId),
			),
		);
	const proxyCredentials = credentialRows.map((credential) => ({
		placeholderEnv: credential.placeholderEnv,
		destinations: credential.destinations,
		header: credential.header,
		valueTemplate: credential.valueTemplate,
		value: decryptSecret(credential.encryptedValue, {
			environmentId,
			organizationId,
			key: proxyCredentialSecretKey(credential.name),
		}),
	}));

	return {
		id: row.id,
		provider: row.provider,
		sourceKind: row.sourceKind,
		sourceRef: row.sourceRef,
		envs,
		proxyCredentials,
	};
}
