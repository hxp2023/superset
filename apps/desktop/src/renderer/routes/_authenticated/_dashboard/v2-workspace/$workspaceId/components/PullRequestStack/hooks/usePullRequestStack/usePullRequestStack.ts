import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import type { PullRequestStackView } from "../../types";
import { buildStackView } from "../../utils/buildStackView";

interface UsePullRequestStackOptions {
	workspaceId: string;
	/** Off while there is no PR to have a stack — saves the GraphQL call. */
	enabled?: boolean;
}

/**
 * The stack behind this workspace's PR, with each layer paired to the sibling
 * workspace on its branch. Stacks change on the order of minutes (a merge, a
 * retarget, a new layer), so this polls far slower than the PR badge; the
 * badge's merge actions invalidate it explicitly.
 */
export function usePullRequestStack({
	workspaceId,
	enabled = true,
}: UsePullRequestStackOptions): {
	stack: PullRequestStackView | null;
	isLoading: boolean;
} {
	const query = workspaceTrpc.git.getPullRequestStack.useQuery(
		{ workspaceId },
		{
			enabled: enabled && !!workspaceId,
			refetchInterval: 60_000,
			refetchOnWindowFocus: true,
			staleTime: 30_000,
		},
	);
	const { workspace } = useWorkspace();
	const { workspaces } = useHostWorkspaces();

	const stack = useMemo(() => {
		if (!query.data) return null;
		return buildStackView(
			query.data,
			{
				id: workspace.id,
				name: workspace.name,
				projectId: workspace.projectId,
				hostId: workspace.hostId,
			},
			workspaces,
		);
	}, [
		query.data,
		workspace.id,
		workspace.name,
		workspace.projectId,
		workspace.hostId,
		workspaces,
	]);

	return { stack, isLoading: query.isLoading };
}
