import { randomUUID } from "node:crypto";
import { db, dbWs } from "@superset/db/client";
import { environmentProxyCredentials, users } from "@superset/db/schema";
import {
	PROXY_CREDENTIAL_PROVIDERS,
	validateProxyCredential,
} from "@superset/shared/environment-proxy-credentials";
import { validateSecretValue } from "@superset/shared/environment-secrets";
import type { TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertInternal } from "../../../lib/cloud-guards";
import { jwtProcedure, userError } from "../../../trpc";
import { loadEnvironment, secretOwnerOrganizationId } from "../environment";
import { encryptSecret } from "../secrets/utils/crypto";
import { proxyCredentialSecretKey } from "./secret-key";

export const proxyCredentialsRouter = {
	list: jwtProcedure
		.input(z.object({ environmentId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			const environment = await loadEnvironment(
				input.environmentId,
				ctx.organizationIds,
			);
			const organizationId = secretOwnerOrganizationId(
				environment,
				ctx.activeOrganizationId,
			);
			const rows = await db
				.select({
					id: environmentProxyCredentials.id,
					provider: environmentProxyCredentials.provider,
					name: environmentProxyCredentials.name,
					placeholderEnv: environmentProxyCredentials.placeholderEnv,
					destinations: environmentProxyCredentials.destinations,
					header: environmentProxyCredentials.header,
					valueTemplate: environmentProxyCredentials.valueTemplate,
					createdAt: environmentProxyCredentials.createdAt,
					updatedAt: environmentProxyCredentials.updatedAt,
					createdBy: {
						id: users.id,
						name: users.name,
						image: users.image,
					},
				})
				.from(environmentProxyCredentials)
				.leftJoin(
					users,
					eq(environmentProxyCredentials.createdByUserId, users.id),
				)
				.where(
					and(
						eq(environmentProxyCredentials.environmentId, input.environmentId),
						eq(environmentProxyCredentials.organizationId, organizationId),
					),
				)
				.orderBy(asc(environmentProxyCredentials.name));
			return rows.map((row) => ({
				...row,
				createdBy: row.createdBy?.id ? row.createdBy : null,
			}));
		}),

	create: jwtProcedure
		.input(
			z.object({
				environmentId: z.string().uuid(),
				provider: z.enum(PROXY_CREDENTIAL_PROVIDERS as [string, ...string[]]),
				name: z.string().min(1),
				value: z.string().min(1),
				placeholderEnv: z.string().min(1),
				destinations: z.array(z.string().min(1)).min(1),
				header: z.string().min(1),
				valueTemplate: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			const environment = await loadEnvironment(
				input.environmentId,
				ctx.organizationIds,
			);
			const organizationId = secretOwnerOrganizationId(
				environment,
				ctx.activeOrganizationId,
			);

			const rule = {
				name: input.name.trim(),
				placeholderEnv: input.placeholderEnv.trim(),
				destinations: input.destinations.map((entry) =>
					entry.trim().toLowerCase(),
				),
				header: input.header.trim(),
				valueTemplate: input.valueTemplate.trim(),
			};
			const check = validateProxyCredential(rule);
			if (!check.valid) {
				throw userError({
					code: "BAD_REQUEST",
					message: check.error,
					i18nKey: "serverError.environment.invalidProxyCredential",
				});
			}
			const valueCheck = validateSecretValue(input.value);
			if (!valueCheck.valid) {
				throw userError({
					code: "BAD_REQUEST",
					message: valueCheck.error,
					i18nKey: "serverError.environment.invalidSecretValue",
				});
			}

			// Same name replaces the row in place, so a rotated key keeps its id
			// and the ciphertext stays bound to that id.
			const existing = await db.query.environmentProxyCredentials.findFirst({
				where: and(
					eq(environmentProxyCredentials.environmentId, input.environmentId),
					eq(environmentProxyCredentials.organizationId, organizationId),
					eq(environmentProxyCredentials.name, rule.name),
				),
			});
			const id = existing?.id ?? randomUUID();
			const encryptedValue = encryptSecret(input.value, {
				environmentId: input.environmentId,
				organizationId,
				key: proxyCredentialSecretKey(id),
			});
			const provider = input.provider as "anthropic" | "openai" | "custom";
			if (existing) {
				await dbWs
					.update(environmentProxyCredentials)
					.set({ ...rule, provider, encryptedValue })
					.where(eq(environmentProxyCredentials.id, id));
			} else {
				await dbWs.insert(environmentProxyCredentials).values({
					id,
					environmentId: input.environmentId,
					organizationId,
					provider,
					...rule,
					encryptedValue,
					createdByUserId: ctx.userId,
				});
			}
			return { id };
		}),

	remove: jwtProcedure
		.input(
			z.object({ environmentId: z.string().uuid(), id: z.string().uuid() }),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			const environment = await loadEnvironment(
				input.environmentId,
				ctx.organizationIds,
			);
			const organizationId = secretOwnerOrganizationId(
				environment,
				ctx.activeOrganizationId,
			);
			await dbWs
				.delete(environmentProxyCredentials)
				.where(
					and(
						eq(environmentProxyCredentials.id, input.id),
						eq(environmentProxyCredentials.environmentId, input.environmentId),
						eq(environmentProxyCredentials.organizationId, organizationId),
					),
				);
			return { success: true };
		}),
} satisfies TRPCRouterRecord;
