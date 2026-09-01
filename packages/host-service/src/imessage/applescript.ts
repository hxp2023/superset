import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OUTBOUND_MARKER, truncateOutbound } from "./messages";

const execFileAsync = promisify(execFile);

const SEND_TIMEOUT_MS = 15_000;

/**
 * The text and target ride in as argv — never spliced into the script — so a
 * reply body can't inject AppleScript.
 */
const SEND_SCRIPT = [
	"on run argv",
	"  set theText to item 1 of argv",
	"  set theTarget to item 2 of argv",
	'  tell application "Messages"',
	"    set theService to 1st account whose service type = iMessage",
	"    send theText to participant theTarget of theService",
	"  end tell",
	"end run",
].join("\n");

export function buildSendArgs(to: string, text: string): string[] {
	return [
		"-e",
		SEND_SCRIPT,
		"--",
		`${OUTBOUND_MARKER}${truncateOutbound(text)}`,
		to,
	];
}

export type ExecFileFn = (
	file: string,
	args: string[],
	options: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export async function sendImessage(
	to: string,
	text: string,
	execFileFn: ExecFileFn = execFileAsync,
): Promise<void> {
	await execFileFn("osascript", buildSendArgs(to, text), {
		timeout: SEND_TIMEOUT_MS,
	});
}
