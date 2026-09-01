import { db, dbWs } from "@superset/db/client";
import { cloudWorkspaces, environments } from "@superset/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../env";
import { promoteSandboxToEnvironment } from "../../lib/blaxel";
import { assertInternal, assertMember } from "../../lib/cloud-guards";
import { jwtProcedure, userError } from "../../trpc";
import { secretsRouter } from "./secrets";

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

	/**
	 * Only a name. The base a sandbox boots from is infrastructure we maintain,
	 * not something anyone can usefully type — an image tag like
	 * `superset-hostsvc:hoockx6bbvtx` is meaningless to whoever is filling in
	 * the form. Forking sets these itself once an environment has a sandbox
	 * worth copying.
	 */
	create: jwtProcedure
		.input(
			z.object({
				organizationId: z.string().uuid(),
				name: z.string().min(1).max(100),
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
					provider: "blaxel",
					sourceKind: "image",
					sourceRef: env.BLAXEL_SANDBOX_IMAGE,
				})
				.returning();
			return row;
		}),

	/**
	 * Turns a workspace someone configured into a reusable starting point.
	 *
	 * Forks the workspace's sandbox into one the environment owns rather than
	 * pointing at the workspace itself: the workspace keeps running and can be
	 * deleted later, and the copy stays frozen because nothing runs in it. A
	 * live source would instead be re-copied, mid-work, on every provision.
	 */
	promote: jwtProcedure
		.input(
			z.object({
				cloudWorkspaceId: z.string().uuid(),
				name: z.string().min(1).max(100),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			assertInternal(ctx.email);
			const workspace = await db.query.cloudWorkspaces.findFirst({
				where: eq(cloudWorkspaces.id, input.cloudWorkspaceId),
			});
			if (!workspace) {
				throw userError({
					code: "NOT_FOUND",
					message: "Cloud workspace not found",
					i18nKey: "serverError.environment.cloudWorkspaceNotFound",
				});
			}
			assertMember(ctx.organizationIds, workspace.organizationId);
			if (workspace.status !== "ready") {
				throw userError({
					code: "PRECONDITION_FAILED",
					message: "Only a ready workspace can become an environment",
					i18nKey: "serverError.environment.workspaceNotReady",
				});
			}

			const environmentId = crypto.randomUUID();
			const goldenName = `env-${environmentId.replaceAll("-", "").slice(0, 24)}`;
			await promoteSandboxToEnvironment({
				sourceSandbox: workspace.providerSandboxId,
				goldenName,
			});

			const [row] = await dbWs
				.insert(environments)
				.values({
					id: environmentId,
					organizationId: workspace.organizationId,
					name: input.name,
					provider: workspace.provider,
					sourceKind: "fork",
					sourceRef: goldenName,
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
