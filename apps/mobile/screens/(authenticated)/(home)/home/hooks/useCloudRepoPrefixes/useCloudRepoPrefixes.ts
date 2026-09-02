import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/client";
import { apiClient } from "@/lib/trpc/client";

/**
 * The repo URL prefix every cloud workspace's pull requests live under. One
 * repository serves all of them, so this is a single value rather than a map.
 */
export function useCloudRepoPrefix(): string | null {
	const { data: session } = useSession();
	const organizationId = session?.session?.activeOrganizationId ?? null;

	const { data } = useQuery({
		queryKey: ["cloud", "cloudWorkspace", "repo", organizationId],
		enabled: organizationId !== null,
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: () =>
			apiClient.cloudWorkspace.repo.query({
				organizationId: organizationId as string,
			}),
	});
	if (!data) return null;
	return `https://github.com/${data.owner}/${data.name}/`.toLowerCase();
}
