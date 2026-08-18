import { dbWs } from "@superset/db/client";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
	type IngestOutcome,
	ingestAutomationEvent,
	type NormalizedDelivery,
} from "./ingestAutomationEvent";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export type DeliveryContext = {
	rawBody: string;
	headers: Headers;
	url: URL;
};

/**
 * What a provider has to say about its webhook, and nothing else. The runner
 * owns the mechanics every provider used to reimplement — body cap, verify
 * before parse, fan-out, record, dispatch, response codes, logging.
 *
 * `verify` looks at the raw request and either accepts it (returns nothing)
 * or answers it (a Response: 401 for a bad signature, 200 for a handshake).
 * `connections` names who receives the parsed payload — a Response here
 * answers the request instead (an ignored resource type, a side effect that
 * is the whole point of the delivery). `normalize` turns the payload into the
 * event for one connection, or null when it names nothing an automation can
 * see. `sideEffects` is for work that rides along with the delivery but is
 * not the automation event (mirroring a PR, syncing a task); it runs first
 * and its failure never costs the automation event.
 */
export type ProviderWebhookSpec<Payload, Connection> = {
	provider: string;
	maxBodyBytes?: number;
	database?: PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
	verify: (
		context: DeliveryContext,
	) => Promise<Response | undefined> | Response | undefined;
	parse?: (rawBody: string) => Payload;
	connections: (
		payload: Payload,
		context: DeliveryContext,
	) => Promise<Connection[] | Response> | Connection[] | Response;
	sideEffects?: (
		payload: Payload,
		connection: Connection,
		context: DeliveryContext,
	) => Promise<void> | void;
	normalize: (
		payload: Payload,
		connection: Connection,
		context: DeliveryContext,
	) => Promise<NormalizedDelivery | null> | NormalizedDelivery | null;
	connectionId?: (connection: Connection) => string;
};

export type ProviderWebhookResult = {
	connectionId: string | null;
	outcome: IngestOutcome | { status: "ignored" } | { status: "failed" };
};

export function providerWebhook<Payload = unknown, Connection = unknown>(
	spec: ProviderWebhookSpec<Payload, Connection>,
): (request: Request) => Promise<Response> {
	const maxBodyBytes = spec.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	const database = spec.database ?? dbWs;
	const tag = `[${spec.provider}/webhook]`;

	return async (request: Request) => {
		const contentLength = Number(request.headers.get("content-length"));
		if (contentLength > maxBodyBytes) {
			return Response.json({ error: "Body too large" }, { status: 413 });
		}
		const rawBody = await request.text();
		if (Buffer.byteLength(rawBody) > maxBodyBytes) {
			return Response.json({ error: "Body too large" }, { status: 413 });
		}
		const context: DeliveryContext = {
			rawBody,
			headers: request.headers,
			url: new URL(request.url),
		};

		const refused = await spec.verify(context);
		if (refused) return refused;

		let payload: Payload;
		try {
			payload = spec.parse
				? spec.parse(rawBody)
				: (JSON.parse(rawBody) as Payload);
		} catch {
			return Response.json({ error: "Invalid payload" }, { status: 400 });
		}

		const connections = await spec.connections(payload, context);
		if (connections instanceof Response) return connections;
		if (connections.length === 0) {
			return Response.json({ ok: true, status: "no_subscribers" });
		}

		const results: ProviderWebhookResult[] = await Promise.all(
			connections.map(async (connection) => {
				const connectionId = spec.connectionId?.(connection) ?? null;
				try {
					if (spec.sideEffects) {
						try {
							await spec.sideEffects(payload, connection, context);
						} catch (error) {
							console.error(`${tag} side effect failed:`, error);
						}
					}
					const delivery = await spec.normalize(payload, connection, context);
					if (!delivery)
						return { connectionId, outcome: { status: "ignored" } };
					const outcome = await ingestAutomationEvent(database, delivery);
					return { connectionId, outcome };
				} catch (error) {
					console.error(`${tag} failed for connection ${connectionId}:`, error);
					return { connectionId, outcome: { status: "failed" } };
				}
			}),
		);

		// A failure to normalize or record is worth a retry from the sender;
		// a failed QStash handoff is not, since the sweep owns that and a
		// redelivery would only dedupe.
		const allFailed = results.every((r) => r.outcome.status === "failed");
		return Response.json(
			{ ok: !allFailed, results },
			{ status: allFailed ? 500 : 200 },
		);
	};
}
