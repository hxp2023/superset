import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Per-workspace agent-hook tokens for sandboxed workspaces.
 *
 * The notifications.hook endpoint is deliberately unauthenticated (see the
 * router), but sandboxed PTYs get a random per-workspace token injected as
 * SUPERSET_AGENT_HOOK_TOKEN and echoed back as a request header, scoping
 * spoofed lifecycle events without putting the host PSK in agent shells.
 * In-memory only — regenerated per host-service lifetime; verification is
 * tolerant of token-less requests so pre-update notify scripts keep working.
 */

const hookTokens = new Map<string, string>();

export function getOrCreateHookToken(workspaceId: string): string {
	const existing = hookTokens.get(workspaceId);
	if (existing) return existing;
	const token = randomBytes(24).toString("hex");
	hookTokens.set(workspaceId, token);
	return token;
}

export function dropHookToken(workspaceId: string): void {
	hookTokens.delete(workspaceId);
}

/**
 * Tolerant verification: only a PRESENT-but-mismatched token is rejected.
 * No registered token (host workspaces) and token-less requests (pre-update
 * notify scripts) both pass.
 */
export function verifyHookToken(
	workspaceId: string,
	presented: string | undefined,
): boolean {
	const registered = hookTokens.get(workspaceId);
	if (!registered || presented === undefined) return true;
	const a = Buffer.from(presented);
	const b = Buffer.from(registered);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function resetHookTokensForTests(): void {
	hookTokens.clear();
}
