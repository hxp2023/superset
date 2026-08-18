import { db } from "@superset/db/client";
import { integrationConnections } from "@superset/db/schema";
import type { TRPCRouterRecord } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../../../trpc";
import { verifyOrgAdmin, verifyOrgMembership } from "../utils";
import { deleteTeamsSubscriptions } from "./subscriptions";

export const microsoftTeamsRouter = {
	getConnection: protectedProcedure
		.input(z.object({ organizationId: z.uuid() }))
		.query(async ({ ctx, input }) => {
			await verifyOrgMembership(ctx.session.user.id, input.organizationId);

			const connection = await db.query.integrationConnections.findFirst({
				where: and(
					eq(integrationConnections.organizationId, input.organizationId),
					eq(integrationConnections.provider, "microsoft_teams"),
				),
				columns: {
					id: true,
					externalOrgId: true,
					externalOrgName: true,
					config: true,
					createdAt: true,
					disconnectedAt: true,
					disconnectReason: true,
				},
			});
			if (!connection || connection.disconnectedAt) return null;

			const config =
				connection.config?.provider === "microsoft_teams"
					? connection.config
					: null;
			return {
				id: connection.id,
				tenantId: connection.externalOrgId,
				externalOrgName: connection.externalOrgName,
				connectedAt: connection.createdAt,
				// Whether Graph is actually delivering: a connection whose
				// subscriptions never got created is consented but deaf.
				subscriptions: {
					channelMessages: config?.subscriptions.channelMessages ?? null,
					channels: config?.subscriptions.channels ?? null,
				},
			};
		}),

	disconnect: protectedProcedure
		.input(z.object({ organizationId: z.uuid() }))
		.mutation(async ({ ctx, input }) => {
			await verifyOrgAdmin(ctx.session.user.id, input.organizationId);

			const connection = await db.query.integrationConnections.findFirst({
				where: and(
					eq(integrationConnections.organizationId, input.organizationId),
					eq(integrationConnections.provider, "microsoft_teams"),
				),
				columns: { id: true },
			});
			if (!connection) {
				return { success: false, error: "No connection found" };
			}

			// Before the row goes: the subscription ids live on it, and Graph
			// would otherwise keep posting to the notify route for two more days.
			await deleteTeamsSubscriptions(connection.id);
			await db
				.delete(integrationConnections)
				.where(eq(integrationConnections.id, connection.id));

			return { success: true };
		}),
} satisfies TRPCRouterRecord;
