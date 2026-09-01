import { db, dbWs } from "@superset/db/client";
import { environmentSecrets } from "@superset/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertInternal } from "../../../lib/cloud-guards";
import { jwtProcedure, userError } from "../../../trpc";
import { loadEnvironment } from "../environment";
import { encryptSecret } from "./utils/crypto";
import {
	MAX_SECRETS_PER_ENVIRONMENT,
	validateSecretKey,
	validateSecretValue,
} from "./utils/secrets-validation";

export const secretsRouter = {
	list: jwtProcedure
		.input(z.object({ environmentId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			await loadEnvironment(input.environmentId, ctx.organizationIds);
			const rows = await db
				.select({
					id: environmentSecrets.id,
					key: environmentSecrets.key,
					sensitive: environmentSecrets.sensitive,
					updatedAt: environmentSecrets.updatedAt,
				})
				.from(environmentSecrets)
				.where(eq(environmentSecrets.environmentId, input.environmentId))
				.orderBy(asc(environmentSecrets.key));
			return rows;
		}),

	set: jwtProcedure
		.input(
			z.object({
				environmentId: z.string().uuid(),
				key: z.string().min(1),
				value: z.string(),
				sensitive: z.boolean().default(true),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			const environment = await loadEnvironment(
				input.environmentId,
				ctx.organizationIds,
			);

			const keyCheck = validateSecretKey(input.key);
			if (!keyCheck.valid) {
				throw userError({
					code: "BAD_REQUEST",
					message: keyCheck.error,
					i18nKey: "serverError.environment.invalidSecretKey",
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

			const existing = await db
				.select({ key: environmentSecrets.key })
				.from(environmentSecrets)
				.where(eq(environmentSecrets.environmentId, input.environmentId));
			const isNew = !existing.some((row) => row.key === input.key);
			if (isNew && existing.length >= MAX_SECRETS_PER_ENVIRONMENT) {
				throw userError({
					code: "BAD_REQUEST",
					message: `An environment holds at most ${MAX_SECRETS_PER_ENVIRONMENT} variables`,
					i18nKey: "serverError.environment.tooManySecrets",
				});
			}

			await dbWs
				.insert(environmentSecrets)
				.values({
					organizationId: environment.organizationId,
					environmentId: input.environmentId,
					key: input.key,
					encryptedValue: encryptSecret(input.value),
					sensitive: input.sensitive,
					createdByUserId: ctx.userId,
				})
				.onConflictDoUpdate({
					target: [environmentSecrets.environmentId, environmentSecrets.key],
					set: {
						encryptedValue: encryptSecret(input.value),
						sensitive: input.sensitive,
					},
				});
			return { key: input.key };
		}),

	remove: jwtProcedure
		.input(
			z.object({ environmentId: z.string().uuid(), key: z.string().min(1) }),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			await loadEnvironment(input.environmentId, ctx.organizationIds);
			await dbWs
				.delete(environmentSecrets)
				.where(
					and(
						eq(environmentSecrets.environmentId, input.environmentId),
						eq(environmentSecrets.key, input.key),
					),
				);
			return { removed: true };
		}),
} satisfies TRPCRouterRecord;
