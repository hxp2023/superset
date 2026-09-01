import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { env } from "renderer/env.renderer";
import { useKnownHosts } from "renderer/hooks/known-hosts/useKnownHosts";
import { useRelayUrl } from "renderer/hooks/useRelayUrl";
import { getHostEventBus } from "renderer/lib/host-event-bus";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { MOCK_ORG_ID } from "shared/constants";
import { deriveHostProjectsQueryTargets } from "../useHostProjects/useHostProjects.utils";

const TAG_FOLDERS_FALLBACK_REFETCH_INTERVAL_MS = 60_000;

/** One folder's host-side presentation, plus the scope it belongs to. */
export interface HostTagFolderSetting {
	scope: string;
	tag: string;
	displayName: string | null;
	color: string | null;
	tabOrder: number | null;
}

/**
 * The tag-folder read path: fan out `tagFolders.list` to every known host and
 * flatten. Folders travel on their own channel rather than riding project
 * snapshots, because the Sessions lane has no project to ride on.
 *
 * Deliberately lighter than `useHostProjects`: no IndexedDB snapshot. These
 * rows are presentation-only, so a folder that renders with its default name
 * and colour for one paint is a non-event — unlike a missing project, which
 * would empty the sidebar.
 */
export function useHostTagFolders(): HostTagFolderSetting[] {
	const queryClient = useQueryClient();
	const { activeHostUrl, machineId, activeOrganizationId } =
		useLocalHostService();
	const relayUrl = useRelayUrl();
	const fallbackOrganizationId = env.SKIP_ENV_VALIDATION
		? MOCK_ORG_ID
		: (activeOrganizationId ?? null);
	const { hosts } = useKnownHosts();

	const targets = useMemo(
		() =>
			deriveHostProjectsQueryTargets({
				activeHostUrl,
				hosts,
				machineId,
				relayUrl,
				fallbackOrganizationId,
			}),
		[activeHostUrl, hosts, machineId, relayUrl, fallbackOrganizationId],
	);

	const queryKeys = useMemo(
		() =>
			targets.map((target) => [
				"host-tag-folders",
				target.organizationId,
				target.machineId,
			]),
		[targets],
	);

	const queries = useQueries({
		queries: targets.map((target, index) => ({
			queryKey: queryKeys[index] as string[],
			enabled: target.hostUrl !== null,
			refetchInterval: TAG_FOLDERS_FALLBACK_REFETCH_INTERVAL_MS,
			// See useHostProjects: "online" networkMode would pause 127.0.0.1
			// queries when navigator.onLine is false, defeating offline-first.
			networkMode: "always" as const,
			refetchIntervalInBackground: true,
			retry: 1,
			queryFn: async (): Promise<HostTagFolderSetting[]> => {
				if (!target.hostUrl) return [];
				const client = getHostServiceClientByUrl(target.hostUrl);
				// Older hosts have no tagFolders router; they simply contribute
				// nothing rather than failing the whole fan-out.
				try {
					return (await client.tagFolders.list.query()) as HostTagFolderSetting[];
				} catch {
					return [];
				}
			},
		})),
	});

	// Live updates: refetch the owning host on its own tag-folders:changed.
	useEffect(() => {
		const cleanups: Array<() => void> = [];
		for (const [index, target] of targets.entries()) {
			if (!target.hostUrl) continue;
			const bus = getHostEventBus(target.hostUrl);
			const key = queryKeys[index];
			cleanups.push(
				bus.on("tag-folders:changed", "*", () => {
					void queryClient.invalidateQueries({ queryKey: key });
				}),
			);
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [targets, queryKeys, queryClient]);

	return useMemo(() => queries.flatMap((query) => query.data ?? []), [queries]);
}
