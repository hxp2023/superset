/**
 * Coalesces PTY output chunks into one xterm.write() per animation frame.
 *
 * Agent CLIs (Claude Code especially) emit full-screen repaints as many small
 * PTY chunks. Writing each chunk individually triggers an xterm parse/render
 * cycle per chunk, which overwhelms the renderer during streaming output.
 * Batching to the display refresh rate makes the cost per frame constant
 * regardless of chunk count. See issues #2241 / #2244.
 *
 * Frame batching alone still lets a sustained burst outrun the emulator: it
 * keeps its own queue of unparsed data and throws the batch away once that
 * queue passes its ceiling. So a batch is only handed over while the emulator
 * reports itself drained — its write-completion callback is the signal.
 */

/**
 * Pending-byte ceiling. requestAnimationFrame stalls while the window is
 * hidden (Electron throttles backgrounded renderers), so without a cap the
 * buffer could grow unboundedly during a background firehose. Exceeding the
 * cap writes early instead of waiting for a frame that may be far off. It
 * doubles as the "we are behind" mark: past it, a drained emulator is handed
 * the next batch straight away rather than idling until the next frame.
 */
export const MAX_PENDING_BYTES = 1024 * 1024;

export interface WriteCoalescer {
	/** Queue PTY bytes for the next frame's write. */
	push(chunk: Uint8Array): void;
	/**
	 * Write everything pending right now. Call before writing anything else
	 * to the terminal (exit notices, error lines) so output stays ordered.
	 */
	flushSync(): void;
	/** Flush remaining bytes and stop accepting new ones. */
	dispose(): void;
}

export function createWriteCoalescer(
	/** `done` is the emulator's write-completion callback: it has parsed the batch. */
	write: (data: Uint8Array, done: () => void) => void,
): WriteCoalescer {
	let pending: Uint8Array[] = [];
	let pendingBytes = 0;
	let frameId: number | null = null;
	let inFlight = 0;
	let disposed = false;

	function scheduleFrame() {
		if (frameId !== null) return;
		frameId = requestAnimationFrame(() => {
			frameId = null;
			// Emulator still parsing: onDrained schedules the next batch.
			if (inFlight > 0) return;
			flushSync();
		});
	}

	function onDrained() {
		inFlight--;
		if (disposed || inFlight > 0 || pendingBytes === 0) return;
		// Same rule push uses: a full cap's worth banked means we are behind,
		// so hand the next batch over now rather than idle until the frame.
		if (pendingBytes > MAX_PENDING_BYTES) flushSync();
		else scheduleFrame();
	}

	function flushSync() {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
		if (pendingBytes === 0) return;
		let batch: Uint8Array;
		if (pending.length === 1) {
			batch = pending[0] as Uint8Array;
		} else {
			batch = new Uint8Array(pendingBytes);
			let offset = 0;
			for (const chunk of pending) {
				batch.set(chunk, offset);
				offset += chunk.length;
			}
		}
		pending = [];
		pendingBytes = 0;
		inFlight++;
		let drained = false;
		try {
			write(batch, () => {
				if (drained) return;
				drained = true;
				// Deferred, not immediate: the emulator invokes this from inside
				// its parse loop and before it drops the batch from its own
				// pending count, so writing here would both re-enter that loop
				// and be measured against a count that still includes this batch.
				queueMicrotask(onDrained);
			});
		} catch (error) {
			// The emulator throws instead of buffering once its own ceiling is
			// passed, and then never calls back. Release here or nothing is ever
			// written to this terminal again.
			if (!drained) {
				drained = true;
				inFlight--;
			}
			throw error;
		}
	}

	function push(chunk: Uint8Array) {
		if (disposed) return;
		pending.push(chunk);
		pendingBytes += chunk.length;
		// Back-pressure. While the emulator is still parsing the last batch,
		// hold everything: another write only grows the queue it discards when
		// it overflows. onDrained picks these bytes up the moment it catches up.
		if (inFlight > 0) return;
		if (pendingBytes > MAX_PENDING_BYTES) {
			flushSync();
			return;
		}
		scheduleFrame();
	}

	return {
		push,
		flushSync,
		dispose() {
			if (disposed) return;
			flushSync();
			disposed = true;
		},
	};
}
