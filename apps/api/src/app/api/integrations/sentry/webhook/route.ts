import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@superset/db/client";
import { integrationConnections } from "@superset/db/schema";
import { disconnectSentry } from "@superset/trpc/integrations/sentry";
import { and, eq, sql } from "drizzle-orm";

import { env } from "@/env";
import { providerWebhook } from "@/lib/automations/providerWebhook";
import {
	matchableFrom,
	normalizeSentryDelivery,
	type SentryIssuePayload,
} from "./normalizeSentryDelivery";

/**
 * Webhooks from the public Sentry integration.
 *
 * Every delivery is signed with the app's one client secret, an env var, so the
 * signature is verified before anything is looked up. The payload names no
 * Superset org, only the installation's uuid — and that uuid is what the
 * install callback stored on the connection, so it is the only way a delivery
 * finds the org it belongs to.
 */

/** How far a delivery's `sentry-hook-timestamp` may sit from our clock. */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** Sentry sends unix seconds; a stale or future timestamp is a replay. */
function timestampFresh(header: string | null): boolean {
	if (!header) return false;
	const seconds = Number(header);
	if (!Number.isFinite(seconds)) return false;
	return Math.abs(Date.now() - seconds * 1000) <= TIMESTAMP_TOLERANCE_MS;
}

/** Constant-time compare of Sentry's hex HMAC-SHA256 against ours. */
function signatureMatches(
	body: string,
	signature: string,
	secret: string,
): boolean {
	const expected = createHmac("sha256", secret).update(body, "utf8").digest();
	const received = Buffer.from(signature, "hex");
	return (
		received.length === expected.length && timingSafeEqual(received, expected)
	);
}

/** The connection an installation uuid belongs to, active or not. */
async function connectionByInstallation(installationUuid: string) {
	return db.query.integrationConnections.findFirst({
		where: and(
			eq(integrationConnections.provider, "sentry"),
			sql`${integrationConnections.config}->>'installationUuid' = ${installationUuid}`,
		),
		columns: { id: true, organizationId: true, disconnectedAt: true },
	});
}

type SentryConnection = NonNullable<
	Awaited<ReturnType<typeof connectionByInstallation>>
>;

function installationUuidOf(payload: SentryIssuePayload): string | null {
	return payload.installation?.uuid ?? payload.data?.installation?.uuid ?? null;
}

export const POST = providerWebhook<SentryIssuePayload, SentryConnection>({
	provider: "sentry",
	database: db,

	verify: ({ rawBody, headers }) => {
		const secret = env.SENTRY_CLIENT_SECRET;
		const signature = headers.get("sentry-hook-signature");
		if (
			!secret ||
			!signature ||
			!signatureMatches(rawBody, signature, secret)
		) {
			return Response.json({ error: "Invalid signature" }, { status: 401 });
		}
		if (!timestampFresh(headers.get("sentry-hook-timestamp"))) {
			return Response.json({ error: "Stale timestamp" }, { status: 401 });
		}
	},

	connections: async (payload, { headers }) => {
		const resource = headers.get("sentry-hook-resource");
		const installationUuid = installationUuidOf(payload);

		// installation.deleted / .created only touch connection state; a
		// deletion drops the token so a later issue delivery for the same
		// install is refused.
		if (resource === "installation") {
			if (installationUuid && payload.action === "deleted") {
				const connection = await connectionByInstallation(installationUuid);
				if (connection) {
					await disconnectSentry(
						connection.id,
						"Integration removed in Sentry",
					);
				}
			}
			// installation.created is a no-op: the callback, which alone knows
			// the Superset org, is what writes the connection.
			return Response.json({ success: true });
		}
		if (resource !== "issue" || !payload.action) {
			return Response.json({ success: true, message: "Ignored" });
		}

		const connection = installationUuid
			? await connectionByInstallation(installationUuid)
			: null;
		// No active connection for this install: nothing to attribute the
		// event to, and nothing a retry could resolve.
		if (!connection || connection.disconnectedAt) return [];
		return [connection];
	},

	normalize: (payload, connection, { headers }) => {
		const event = matchableFrom(payload, `issue.${payload.action}`);
		const deliveryId =
			headers.get("request-id") ?? `sentry-${crypto.randomUUID()}`;
		if (event.names.length === 0) {
			console.log(
				`[sentry/webhook] Unhandled action issue.${payload.action}, recorded only:`,
				deliveryId,
			);
		}
		return normalizeSentryDelivery({
			organizationId: connection.organizationId,
			connectionId: connection.id,
			event,
			deliveryId,
			payload,
		});
	},

	connectionId: (connection) => connection.id,
});
