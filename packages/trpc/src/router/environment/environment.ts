import { db, dbWs } from "@superset/db/client";
import { environmentSecrets, environments } from "@superset/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { assertInternal, assertMember } from "../../lib/cloud-guards";
import { jwtProcedure, userError } from "../../trpc";
import { encryptSecret } from "./secrets/utils/crypto";
import {
	MAX_SECRETS_PER_ENVIRONMENT,
	validateSecretKey,
	validateSecretValue,
} from "./secrets/utils/secrets-validation";

const sourceKind = z.enum(["image", "fork"]);

async function loadEnvironment(id: string, organizationIds: string[]) {
	const row = await db.query.environments.findFirst({
		where: eq(environments.id, id),
	});
	if (!row) {
		throw userError({
			code: "NOT_FOUND",
			message: "Environment not found",
			i18nKey: "serverError.environment.environmentNotFound",
		});
	}
	assertMember(organizationIds, row.organizationId);
	return row;
}

export const environmentRouter = {
	list: jwtProcedure
		.input(z.object({ organizationId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			assertMember(ctx.organizationIds, input.organizationId);
			return db
				.select()
				.from(environments)
				.where(
					and(
						eq(environments.organizationId, input.organizationId),
						isNull(environments.archivedAt),
					),
				)
				.orderBy(asc(environments.name));
		}),

	get: jwtProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			return loadEnvironment(input.id, ctx.organizationIds);
		}),

	create: jwtProcedure
		.input(
			z.object({
				organizationId: z.string().uuid(),
				name: z.string().min(1).max(100),
				sourceKind,
				sourceRef: z.string().min(1),
				provider: z.string().min(1).default("blaxel"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			assertMember(ctx.organizationIds, input.organizationId);
			const [row] = await dbWs
				.insert(environments)
				.values({
					organizationId: input.organizationId,
					name: input.name,
					provider: input.provider,
					sourceKind: input.sourceKind,
					sourceRef: input.sourceRef,
				})
				.returning();
			return row;
		}),

	update: jwtProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1).max(100).optional(),
				sourceRef: z.string().min(1).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			await loadEnvironment(input.id, ctx.organizationIds);
			const [row] = await dbWs
				.update(environments)
				.set({
					...(input.name ? { name: input.name } : {}),
					...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
				})
				.where(eq(environments.id, input.id))
				.returning();
			return row;
		}),

	archive: jwtProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			await loadEnvironment(input.id, ctx.organizationIds);
			await dbWs
				.update(environments)
				.set({ archivedAt: new Date() })
				.where(eq(environments.id, input.id));
			return { archived: true };
		}),

	listSecrets: jwtProcedure
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

	setSecret: jwtProcedure
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

	removeSecret: jwtProcedure
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
