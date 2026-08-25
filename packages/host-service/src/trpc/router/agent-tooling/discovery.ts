import os from "node:os";
import type { SlashCommand } from "@superset/shared/slash-commands";
import {
	getSlashCommandDiscovery,
	SLASH_COMMAND_DISCOVERY,
	type SlashCommandDiscoveryEntry,
} from "./registry";

/**
 * 30s TTL: absorbs the refetch burst while a composer menu is open, yet a
 * newly saved command file appears on the next open without restarting
 * anything. The PROMISE is cached (not the value) so concurrent opens
 * coalesce onto one scan; a rejected promise is evicted immediately so one
 * flaky read doesn't pin an error for 30s. Insertion-order LRU bounded the
 * way workspace-fs's search index is (delete + re-set on hit, evict oldest
 * at capacity). Known staleness: an account switch that changes the config
 * dir can serve results for the old account for up to the TTL — the key
 * deliberately omits env to keep coalescing simple.
 */
const DISCOVERY_CACHE_TTL_MS = 30_000;
const DISCOVERY_CACHE_MAX_ENTRIES = 64;

const discoveryCache = new Map<
	string,
	{ promise: Promise<SlashCommand[]>; fetchedAt: number }
>();

export interface ListAgentSlashCommandsOptions {
	worktreePath: string;
	/** Raw client-supplied agent id (presetId or config UUID) — cache-key part. */
	agentId: string;
	/** Resolved presetId (config.presetId, or agentId when no config row exists). */
	presetId: string;
	/** Effective launch env overlay: account default + config env. */
	env: Record<string, string>;
	/** Test injection points. */
	homeDir?: string;
	registry?: readonly SlashCommandDiscoveryEntry[];
	now?: () => number;
}

export async function listAgentSlashCommands(
	options: ListAgentSlashCommandsOptions,
): Promise<SlashCommand[]> {
	const registry = options.registry ?? SLASH_COMMAND_DISCOVERY;
	const entry = options.registry
		? registry.find((candidate) => candidate.presetId === options.presetId)
		: getSlashCommandDiscovery(options.presetId);
	if (!entry) return [];

	const now = options.now ?? Date.now;
	const key = `${options.worktreePath}::${options.agentId}`;
	const cached = discoveryCache.get(key);
	if (cached && now() - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
		discoveryCache.delete(key);
		discoveryCache.set(key, cached);
		return cached.promise;
	}

	const configDir = entry.resolveConfigDir(
		options.env,
		options.homeDir ?? os.homedir(),
	);
	const promise = entry.scan({
		worktreePath: options.worktreePath,
		configDir,
	});
	discoveryCache.delete(key);
	while (discoveryCache.size >= DISCOVERY_CACHE_MAX_ENTRIES) {
		const oldestKey = discoveryCache.keys().next().value;
		if (!oldestKey) break;
		discoveryCache.delete(oldestKey);
	}
	discoveryCache.set(key, { promise, fetchedAt: now() });
	promise.catch(() => {
		if (discoveryCache.get(key)?.promise === promise) {
			discoveryCache.delete(key);
		}
	});
	return promise;
}

export function clearSlashCommandDiscoveryCache(): void {
	discoveryCache.clear();
}
