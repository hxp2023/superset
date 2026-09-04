import { useCallback } from "react";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { useCreateAndOpenWorkspace } from "renderer/hooks/useCreateAndOpenWorkspace";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";
import { useV2WorkspaceCreateDefaultsStore } from "renderer/stores/v2-workspace-create-defaults";

/**
 * Creates a v2 workspace immediately, skipping the new-workspace modal.
 * `projectIdHint` is the caller's best guess at "current project" (e.g. the
 * open v2 workspace route); when absent it falls back to the last-used
 * project, then the first known project. With no project to infer at all,
 * falls back to opening the modal so the user can add or pick one.
 */
export function useQuickCreateWorkspace() {
	const { machineId } = useLocalHostService();
	const { projects: hostProjects } = useHostProjects();
	const createAndOpen = useCreateAndOpenWorkspace();
	const openNewWorkspaceModal = useOpenNewWorkspaceModal();

	return useCallback(
		(projectIdHint?: string | null) => {
			const projectId =
				projectIdHint ??
				useV2WorkspaceCreateDefaultsStore.getState().lastProjectId ??
				hostProjects[0]?.id ??
				null;

			if (!projectId || !machineId) {
				openNewWorkspaceModal();
				return;
			}

			createAndOpen({
				hostId: machineId,
				snapshot: { id: crypto.randomUUID(), projectId },
			});
		},
		[createAndOpen, hostProjects, machineId, openNewWorkspaceModal],
	);
}
