import { connect, type Socket } from "node:net";
import type { NodeWebSocket } from "@hono/node-ws";
import type { Hono } from "hono";

/**
 * The VNC server's port. Fixed rather than taken from the request: a
 * caller-supplied port would turn an authenticated socket into a way to reach
 * any port on the loopback interface, which is a capability this route has no
 * reason to hand out.
 */
const VNC_PORT = 5900;

/**
 * Loopback on purpose, and it must stay that way. x11vnc is started with
 * `-localhost`, so the display is reachable only from inside the sandbox — this
 * proxy, sitting behind the same auth as `/terminal/*`, is the sole way in. A
 * VNC session is full control of the machine; binding the server to 0.0.0.0
 * would expose it to anything that can route to the sandbox.
 */
const VNC_HOST = "127.0.0.1";

/** Frames buffered while the TCP socket is still connecting. */
const MAX_PENDING_FRAMES = 64;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;

export interface RegisterDesktopRouteOptions {
	app: Hono;
	upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
}

function toBytes(data: unknown): Uint8Array | null {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	// RFB is a binary protocol; a text frame means the client is misconfigured
	// rather than that we should guess an encoding for it.
	return null;
}

/**
 * Bridges a client WebSocket to the sandbox's VNC server so the desktop can
 * render the machine's screen in a pane.
 *
 * RFB is a raw TCP protocol and browsers cannot open TCP sockets, so the bytes
 * have to arrive over a WebSocket — which is exactly what noVNC expects on the
 * other end. Frames pass through untouched in both directions; this understands
 * nothing about RFB and deliberately stays that way, so protocol versions and
 * encodings are negotiated between the client and x11vnc without this being in
 * the middle of it.
 *
 * Modelled on the browser CDP route, which does the same job for a WebSocket
 * upstream instead of a TCP one.
 */
export function registerDesktopRoute({
	app,
	upgradeWebSocket,
}: RegisterDesktopRouteOptions) {
	app.get(
		"/desktop/vnc",
		upgradeWebSocket(() => {
			let upstream: Socket | null = null;
			let open = false;
			const pending: Uint8Array[] = [];
			let pendingBytes = 0;

			return {
				onOpen: (_event, ws) => {
					const socket = connect(VNC_PORT, VNC_HOST);
					upstream = socket;
					socket.on("connect", () => {
						open = true;
						for (const frame of pending) socket.write(frame);
						pending.length = 0;
						pendingBytes = 0;
					});
					// Copied rather than viewed: a Buffer's backing store is typed
					// ArrayBufferLike, which may be a SharedArrayBuffer, and the
					// socket only accepts a plain ArrayBuffer-backed view. The copy
					// also detaches the frame from Node's pooled buffer, which is
					// reused as soon as this handler returns.
					socket.on("data", (chunk: Buffer) => {
						ws.send(new Uint8Array(chunk));
					});
					// A refused connection is the ordinary case, not an error: it
					// means no VNC server is running in this sandbox. Say so, rather
					// than leaving the client to guess from a dropped socket.
					socket.on("error", () => {
						ws.close(1011, "No desktop session on this host");
					});
					socket.on("close", () => {
						open = false;
						ws.close(1000, "Desktop session ended");
					});
				},
				onMessage: (event, ws) => {
					const bytes = toBytes(event.data);
					if (!bytes) {
						ws.close(1003, "Desktop expects binary frames");
						return;
					}
					if (upstream && open) {
						upstream.write(bytes);
						return;
					}
					pendingBytes += bytes.byteLength;
					if (
						pending.length >= MAX_PENDING_FRAMES ||
						pendingBytes > MAX_PENDING_BYTES
					) {
						ws.close(1009, "Desktop frame backlog exceeded");
						upstream?.destroy();
						upstream = null;
						pending.length = 0;
						pendingBytes = 0;
						return;
					}
					pending.push(bytes);
				},
				onClose: () => {
					upstream?.destroy();
					upstream = null;
				},
				onError: () => {
					upstream?.destroy();
					upstream = null;
				},
			};
		}),
	);
}
