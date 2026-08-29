import { Terminal } from "@xterm/headless";

/**
 * Turn a raw PTY byte stream into readable text.
 *
 * Stripping escape sequences recovers every character a program ever wrote,
 * which is why a handoff reads the stream rather than the live screen. But it
 * is only correct for programs that write in lines. A TUI positions with
 * `ESC[row;1H` and repaints, so stripping leaves its output with no line
 * breaks at all and each visible row repeated once per repaint: a 400-turn
 * viewport model came out as a single 444,912-character line.
 *
 * So replay the stream through an emulator and read rows instead, sampling
 * the viewport as the stream is fed and stitching the samples together on
 * their overlap. Sampling beats splitting on repaints because programs
 * disagree about what a repaint even looks like: `less` never erases the
 * screen at all, it just scrolls.
 */

const ESC = String.fromCharCode(27);
const ALT_SCREEN_ENTER = `${ESC}[?1049h`;

/**
 * Scrollback the replay emulator keeps. Sampling reads the viewport, so this
 * only has to absorb a burst between samples rather than hold the history.
 */
const SCROLLBACK_ROWS = 200;
/** Ceiling on stitched history, so a long-lived TUI cannot grow without end. */
const MAX_HISTORY_ROWS = 20_000;

export interface ReconstructedTranscript {
	text: string;
	/** `scrollback` for normal-screen programs, `viewport` for alt-screen TUIs. */
	/** Viewport samples stitched together on their overlap. */
	samples: number;
}

interface XtermInternals {
	_core?: { _writeBuffer?: { writeSync(data: string | Uint8Array): void } };
}

/**
 * `Terminal.write` is asynchronous, so reading a sample straight after writing
 * would race the parser. The same private `_writeBuffer.writeSync` the mode
 * tracker relies on parses inline; if the pinned version stops exposing it,
 * fail loudly rather than silently transcribing blank screens.
 */
function synchronousWriter(term: Terminal): (data: string) => void {
	const writeBuffer = (term as unknown as XtermInternals)._core?._writeBuffer;
	if (typeof writeBuffer?.writeSync !== "function") {
		throw new Error(
			"@xterm/headless internals not found (_writeBuffer.writeSync). " +
				"Likely a version-pinning regression — check the pinned version.",
		);
	}
	return (data: string) => writeBuffer.writeSync(data);
}

function trimTrailingBlanks(rows: string[]): string[] {
	const out = [...rows];
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out;
}

/** Just what is on screen now: all the alternate screen ever holds. */
function readViewport(term: Terminal): string[] {
	const buffer = term.buffer.active;
	const rows: string[] = [];
	for (let y = 0; y < term.rows; y++) {
		rows.push(
			buffer
				.getLine(buffer.baseY + y)
				?.translateToString(true)
				.trimEnd() ?? "",
		);
	}
	return trimTrailingBlanks(rows);
}

/**
 * Append `rows`, skipping the leading run the history already ends with. Two
 * consecutive samples of a scrolling viewport share everything but the newest
 * lines; without this every sample would be re-emitted almost whole. Only the
 * last `limit` rows can overlap, so the search stays bounded.
 */
function appendWithoutOverlap(
	history: string[],
	rows: string[],
	limit: number,
): void {
	const maxOverlap = Math.min(history.length, rows.length, limit);
	for (let size = maxOverlap; size > 0; size--) {
		let matches = true;
		for (let i = 0; i < size; i++) {
			if (history[history.length - size + i] !== rows[i]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			history.push(...rows.slice(size));
			return;
		}
	}
	history.push(...rows);
}

/** Sequences that begin a repaint, whatever the program's house style. */
const REPAINT_MARKERS = [
	`${ESC}[H`,
	`${ESC}[2J`,
	`${ESC}[3J`,
	`${ESC}[1;1H`,
	ALT_SCREEN_ENTER,
];
/** Backstop for a program that neither scrolls nor announces its repaints. */
const MAX_BYTES_PER_SAMPLE = 4096;

/**
 * Cut the stream so consecutive samples always overlap: at most half a screen
 * of lines may scroll past, and any repaint marker ends a chunk. Programs
 * disagree wildly here — `less` only scrolls and never erases, a ratatui TUI
 * only erases and never emits a newline — so all three rules are needed.
 */
function splitForSampling(stream: string, rows: number): string[] {
	const linesPerChunk = Math.max(1, Math.floor(rows / 2));
	const chunks: string[] = [];
	let start = 0;
	let newlines = 0;
	let i = 0;
	while (i < stream.length) {
		let cutAfter = -1;
		if (stream[i] === "\n") {
			newlines++;
			if (newlines >= linesPerChunk) cutAfter = i;
		} else if (stream[i] === ESC) {
			const marker = REPAINT_MARKERS.find((candidate) =>
				stream.startsWith(candidate, i),
			);
			if (marker) cutAfter = i + marker.length - 1;
		}
		if (cutAfter < 0 && i - start + 1 >= MAX_BYTES_PER_SAMPLE) cutAfter = i;
		if (cutAfter >= 0) {
			chunks.push(stream.slice(start, cutAfter + 1));
			start = cutAfter + 1;
			newlines = 0;
			i = cutAfter + 1;
			continue;
		}
		i++;
	}
	if (start < stream.length) chunks.push(stream.slice(start));
	return chunks;
}

export function reconstructTerminalTranscript(
	stream: string,
	options: { cols?: number; rows?: number } = {},
): ReconstructedTranscript {
	const cols = options.cols ?? 120;
	const rows = options.rows ?? 40;
	const term = new Terminal({
		cols,
		rows,
		scrollback: SCROLLBACK_ROWS,
		allowProposedApi: true,
	});
	try {
		const write = synchronousWriter(term);
		// Sampling unconditionally, not only for the alternate screen. The
		// retained ring is a tail, so the `?1049h` that entered the alt screen
		// has usually been evicted: a replay of the tail believes it is on the
		// normal screen, where a TUI's cursor-addressed repaints overwrite in
		// place and leave nothing behind. Sampling the viewport reconstructs
		// history in both modes, so the mode never has to be guessed.
		const history: string[] = [];
		let samples = 0;
		for (const chunk of splitForSampling(stream, rows)) {
			write(chunk);
			appendWithoutOverlap(history, readViewport(term), rows);
			samples++;
			if (history.length > MAX_HISTORY_ROWS) {
				history.splice(0, history.length - MAX_HISTORY_ROWS);
			}
		}
		return { text: history.join("\n"), samples };
	} finally {
		term.dispose();
	}
}
