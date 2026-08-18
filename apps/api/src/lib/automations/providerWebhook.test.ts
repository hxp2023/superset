import { describe, expect, it } from "bun:test";
import { providerWebhook } from "./providerWebhook";

const post = (
	handler: (request: Request) => Promise<Response>,
	body: string,
	headers: Record<string, string> = {},
) =>
	handler(
		new Request("https://api.test/webhook", {
			method: "POST",
			body,
			headers,
		}),
	);

describe("providerWebhook", () => {
	it("refuses before parsing when verify answers", async () => {
		let parsed = false;
		const handler = providerWebhook({
			provider: "test",
			verify: ({ headers }) =>
				headers.get("x-sig") === "ok"
					? undefined
					: Response.json({ error: "Invalid signature" }, { status: 401 }),
			connections: () => {
				parsed = true;
				return [];
			},
			normalize: () => null,
		});
		const refused = await post(handler, "not even json");
		expect(refused.status).toBe(401);
		expect(parsed).toBe(false);
	});

	it("rejects an unparseable body only after verification", async () => {
		const handler = providerWebhook({
			provider: "test",
			verify: () => undefined,
			connections: () => [],
			normalize: () => null,
		});
		const response = await post(handler, "{nope");
		expect(response.status).toBe(400);
	});

	it("caps the body before reading it", async () => {
		const handler = providerWebhook({
			provider: "test",
			maxBodyBytes: 10,
			verify: () => undefined,
			connections: () => [],
			normalize: () => null,
		});
		const response = await post(handler, "x".repeat(11));
		expect(response.status).toBe(413);
	});

	it("lets connections answer the request outright", async () => {
		const handler = providerWebhook({
			provider: "test",
			verify: () => undefined,
			connections: () => Response.json({ handshake: true }),
			normalize: () => null,
		});
		const response = await post(handler, "{}");
		expect(await response.json()).toEqual({ handshake: true });
	});

	it("acknowledges a delivery nobody subscribes to", async () => {
		const handler = providerWebhook({
			provider: "test",
			verify: () => undefined,
			connections: () => [],
			normalize: () => null,
		});
		const response = await post(handler, "{}");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			status: "no_subscribers",
		});
	});

	it("reports ignored deliveries per connection without recording", async () => {
		const handler = providerWebhook<unknown, { id: string }>({
			provider: "test",
			verify: () => undefined,
			connections: () => [{ id: "a" }, { id: "b" }],
			normalize: () => null,
			connectionId: (c) => c.id,
		});
		const response = await post(handler, "{}");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			results: [
				{ connectionId: "a", outcome: { status: "ignored" } },
				{ connectionId: "b", outcome: { status: "ignored" } },
			],
		});
	});

	it("keeps the automation event when a side effect throws", async () => {
		let normalized = false;
		const handler = providerWebhook<unknown, { id: string }>({
			provider: "test",
			verify: () => undefined,
			connections: () => [{ id: "a" }],
			sideEffects: () => {
				throw new Error("mirror failed");
			},
			normalize: () => {
				normalized = true;
				return null;
			},
		});
		const response = await post(handler, "{}");
		expect(response.status).toBe(200);
		expect(normalized).toBe(true);
	});

	it("returns 500 only when every connection failed", async () => {
		const handler = providerWebhook<unknown, { id: string }>({
			provider: "test",
			verify: () => undefined,
			connections: () => [{ id: "a" }, { id: "b" }],
			normalize: (_payload, connection) => {
				if (connection.id === "a") throw new Error("boom");
				return null;
			},
			connectionId: (c) => c.id,
		});
		const partial = await post(handler, "{}");
		expect(partial.status).toBe(200);

		const allBad = providerWebhook<unknown, { id: string }>({
			provider: "test",
			verify: () => undefined,
			connections: () => [{ id: "a" }],
			normalize: () => {
				throw new Error("boom");
			},
		});
		const failed = await post(allBad, "{}");
		expect(failed.status).toBe(500);
	});
});
