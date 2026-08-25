import { afterEach, describe, expect, it } from "bun:test";
import { getEventBus } from "./eventBus";

// Real WS server standing in for a host-service event bus. Records upgrades
// and client commands; `push` broadcasts a server event to connected clients.
function makeHostServer() {
	const upgrades: string[] = [];
	const commands: Array<Record<string, unknown>> = [];
	const clients = new Set<Bun.ServerWebSocket<unknown>>();
	const server = Bun.serve({
		port: 0,
		fetch(req, srv) {
			upgrades.push(new URL(req.url).pathname);
			if (srv.upgrade(req)) return;
			return new Response("no", { status: 400 });
		},
		websocket: {
			open(ws) {
				clients.add(ws);
			},
			close(ws) {
				clients.delete(ws);
			},
			message(_ws, data) {
				commands.push(JSON.parse(String(data)));
			},
		},
	});
	return {
		server,
		upgrades,
		commands,
		hostUrl: `http://localhost:${server.port}`,
		push(payload: object) {
			for (const ws of clients) ws.send(JSON.stringify(payload));
		},
		dropClients() {
			for (const ws of clients) ws.close();
		},
		clientCount: () => clients.size,
	};
}

function waitFor(cond: () => boolean, timeoutMs = 4_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const t = setInterval(() => {
			if (cond()) {
				clearInterval(t);
				resolve();
			} else if (Date.now() - start > timeoutMs) {
				clearInterval(t);
				reject(new Error("waitFor timeout"));
			}
		}, 20);
	});
}

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanups.splice(0)) fn();
});

describe("eventBus", () => {
	it("routes events to listeners by type and workspaceId (exact and wildcard)", async () => {
		const host = makeHostServer();
		const bus = getEventBus(host.hostUrl, () => "tok");
		const exact: string[] = [];
		const wildcard: string[] = [];
		const other: string[] = [];
		cleanups.push(bus.on("git:changed", "ws-1", (id) => exact.push(id)));
		cleanups.push(bus.on("git:changed", "*", (id) => wildcard.push(id)));
		cleanups.push(bus.on("git:changed", "ws-2", (id) => other.push(id)));
		cleanups.push(() => host.server.stop(true));

		await waitFor(() => host.clientCount() === 1);
		host.push({ type: "git:changed", workspaceId: "ws-1", paths: ["a.ts"] });
		await waitFor(() => exact.length === 1 && wildcard.length === 1);
		expect(other.length).toBe(0);
	});

	it("shares one connection per hostUrl across handles", async () => {
		const host = makeHostServer();
		const busA = getEventBus(host.hostUrl, () => "tok");
		const busB = getEventBus(host.hostUrl, () => "tok");
		cleanups.push(busA.on("git:changed", "*", () => {}));
		cleanups.push(busB.on("port:changed", "*", () => {}));
		cleanups.push(() => host.server.stop(true));

		await waitFor(() => host.clientCount() === 1);
		// Give a second dial a chance to appear if sharing were broken.
		await Bun.sleep(150);
		expect(host.upgrades.length).toBe(1);
	});

	it("refcounts fs:watch and only unwatches at zero", async () => {
		const host = makeHostServer();
		const bus = getEventBus(host.hostUrl, () => "tok");
		cleanups.push(bus.on("fs:events", "*", () => {}));
		cleanups.push(() => host.server.stop(true));
		await waitFor(() => host.clientCount() === 1);

		bus.watchFs("ws-1");
		bus.watchFs("ws-1"); // second watcher: no duplicate command
		await waitFor(() => host.commands.length >= 1);
		await Bun.sleep(100);
		expect(host.commands).toEqual([{ type: "fs:watch", workspaceId: "ws-1" }]);

		bus.unwatchFs("ws-1"); // still one watcher left: no unwatch yet
		await Bun.sleep(100);
		expect(host.commands.length).toBe(1);

		bus.unwatchFs("ws-1");
		await waitFor(() => host.commands.length === 2);
		expect(host.commands[1]).toEqual({
			type: "fs:unwatch",
			workspaceId: "ws-1",
		});
	});

	it("re-sends active fs:watch commands after a reconnect", async () => {
		const host = makeHostServer();
		const bus = getEventBus(host.hostUrl, () => "tok");
		cleanups.push(bus.on("fs:events", "*", () => {}));
		cleanups.push(() => host.server.stop(true));
		await waitFor(() => host.clientCount() === 1);

		bus.watchFs("ws-1");
		await waitFor(() => host.commands.length === 1);

		host.dropClients();
		// The wrapper reconnects (1s base delay) and the open handler replays
		// every active watch from state.
		await waitFor(() => host.commands.length === 2, 8_000);
		expect(host.commands[1]).toEqual({ type: "fs:watch", workspaceId: "ws-1" });
	});

	it("closes the connection when the last listener unsubscribes", async () => {
		const host = makeHostServer();
		const bus = getEventBus(host.hostUrl, () => "tok");
		const off = bus.on("git:changed", "*", () => {});
		cleanups.push(() => host.server.stop(true));
		await waitFor(() => host.clientCount() === 1);

		off();
		await waitFor(() => host.clientCount() === 0);
		// And no zombie reconnect afterwards.
		await Bun.sleep(1_500);
		expect(host.clientCount()).toBe(0);
	});

	it("releasing interest via a fresh handle, after the connection's last listener already closed it, does not strand a new connection", async () => {
		const host = makeHostServer();
		const bus = getEventBus(host.hostUrl, () => "tok");
		const off = bus.on("git:changed", "*", () => {});
		bus.watchGit("ws-1");
		cleanups.push(() => host.server.stop(true));
		await waitFor(() => host.clientCount() === 1);
		expect(host.upgrades.length).toBe(1);

		// Simulates a sibling effect's cleanup running first and releasing
		// this connection's only listener/retainer — a real, order-dependent
		// scenario in a multi-effect component (see DashboardSidebar-
		// WorkspaceStatusProvider's final-unmount and mid-session-removal
		// cleanup ordering).
		off();
		await waitFor(() => host.clientCount() === 0);

		// A *fresh* getEventBus() call, exactly matching the real call site
		// (getHostEventBus(hostUrl).unwatchGit(...) — never the same cached
		// handle). getEventBus() unconditionally (re)creates a ConnectionState
		// if none exists; before this fix, nothing ever closed the socket it
		// opens back down (unwatchGit/unwatchFs never called
		// maybeCleanupConnection), so it would dial in and reconnect forever
		// (a second real upgrade hits the server, `host.upgrades.length`
		// reaches 2, and `clientCount()` gets stuck at 1).
		getEventBus(host.hostUrl, () => "tok").unwatchGit("ws-1");

		// With the fix, maybeCleanupConnection closes the fresh connection
		// synchronously — fast enough that it never even dials out. No
		// second upgrade ever reaches the server, and no client lingers.
		await Bun.sleep(1_500);
		expect(host.upgrades.length).toBe(1);
		expect(host.clientCount()).toBe(0);
	});
});
