import { db, dbWs } from "@superset/db/client";
import { environments } from "@superset/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { assertInternal, assertMember } from "../../lib/cloud-guards";
import { jwtProcedure, userError } from "../../trpc";
import { secretsRouter } from "./secrets";

const sourceKind = z.enum(["image", "fork"]);

export async function loadEnvironment(id: string, organizationIds: string[]) {
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
	secrets: secretsRouter,

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
} satisfies TRPCRouterRecord;
