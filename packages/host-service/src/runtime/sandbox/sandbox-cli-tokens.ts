import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getWorkspaceSandboxPaths } from "./paths.ts";

/**
 * Per-workspace tokens the bundled `superset` CLI uses from INSIDE a
 * sandbox container. The org PSK never enters the container; instead each
 * workspace gets a random token written to
 * `<sandbox-state>/host/token` (0600) and mounted read-only at
 * /opt/superset/host/token. PskHostAuthProvider accepts registered sandbox
 * tokens alongside the PSK; a token is revoked by destroying the sandbox.
 *
 * The registry is in-memory and repopulated on every container ensure, so
 * tokens survive host-service restarts as long as the workspace is used.
 */

const cliTokens = new Map<string, string>();

export interface CliTokenMount {
	/** Host directory to bind-mount read-only at /opt/superset/host. */
	hostDir: string;
}

export async function ensureCliTokenFile(
	workspaceId: string,
): Promise<CliTokenMount> {
	const hostDir = join(getWorkspaceSandboxPaths(workspaceId).stateDir, "host");
	await mkdir(hostDir, { recursive: true });
	const tokenPath = join(hostDir, "token");
	let token: string;
	if (existsSync(tokenPath)) {
		token = (await readFile(tokenPath, "utf-8")).trim();
	} else {
		token = randomBytes(32).toString("hex");
		await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
	}
	cliTokens.set(workspaceId, token);
	return { hostDir };
}

/** Timing-safe check against every registered sandbox CLI token. */
export function isValidSandboxCliToken(presented: string): boolean {
	const presentedBuffer = Buffer.from(presented);
	let valid = false;
	for (const token of cliTokens.values()) {
		const tokenBuffer = Buffer.from(token);
		if (
			presentedBuffer.length === tokenBuffer.length &&
			timingSafeEqual(presentedBuffer, tokenBuffer)
		) {
			// No early exit: keep comparison count independent of match position.
			valid = true;
		}
	}
	return valid;
}

export function dropCliToken(workspaceId: string): void {
	cliTokens.delete(workspaceId);
}

export function resetCliTokensForTests(): void {
	cliTokens.clear();
}
