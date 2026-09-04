import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useCreateAndOpenWorkspace } from "renderer/hooks/useCreateAndOpenWorkspace";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import type { StackLayerView } from "../../types";

/**
 * Moves between layers the way Superset moves between branches: by
 * workspace. A layer with one is a navigation; a layer without one checks
 * the PR out into a fresh workspace on the same host and project as the one
 * being viewed. Session workspaces have no project to create under, so the
 * second path is withheld there.
 */
export function useOpenStackLayer(): {
	openWorkspace: (workspaceId: string) => void;
	openInNewWorkspace: (layer: StackLayerView) => void;
	canOpenInNewWorkspace: boolean;
} {
	const navigate = useNavigate();
	const { workspace } = useWorkspace();
	const createAndOpen = useCreateAndOpenWorkspace();
	const projectId = workspace.projectId;
	const hostId = workspace.hostId;

	const openWorkspace = useCallback(
		(workspaceId: string) => {
			void navigate({
				to: "/v2-workspace/$workspaceId",
				params: { workspaceId },
			});
		},
		[navigate],
	);

	const openInNewWorkspace = useCallback(
		(layer: StackLayerView) => {
			if (projectId == null) return;
			createAndOpen({
				hostId,
				snapshot: { id: crypto.randomUUID(), projectId, pr: layer.number },
			});
		},
		[createAndOpen, hostId, projectId],
	);

	return {
		openWorkspace,
		openInNewWorkspace,
		canOpenInNewWorkspace: projectId != null,
	};
}
