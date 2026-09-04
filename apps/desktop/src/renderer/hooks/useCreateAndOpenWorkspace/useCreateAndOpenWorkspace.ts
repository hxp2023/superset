import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
	type UseWorkspaceCreatesApi,
	useWorkspaceCreates,
} from "renderer/stores/workspace-creates";

type SubmitArgs = Parameters<UseWorkspaceCreatesApi["submit"]>[0];

/**
 * Submits a workspace create and lands the user in it straight away — the
 * route renders its pending state while the host does the git work — with
 * one toast tracking the outcome. Every "make a workspace and go there"
 * path shares this so the navigation and toast copy stay identical.
 */
export function useCreateAndOpenWorkspace(): (args: SubmitArgs) => string {
	const { t } = useLingui();
	const navigate = useNavigate();
	const { submit } = useWorkspaceCreates();

	return useCallback(
		(args: SubmitArgs) => {
			const { workspaceId, completed } = submit(args);
			void navigate({
				to: "/v2-workspace/$workspaceId",
				params: { workspaceId },
			}).catch((error) => {
				console.error(
					"[CreateAndOpenWorkspace] failed to open workspace",
					error,
				);
			});
			toast.promise(
				completed.then((outcome) => {
					if (!outcome.ok) throw new Error(outcome.error);
				}),
				{
					loading: t({
						message: "Creating workspace...",
					}),
					success: t({
						message: "Workspace created",
					}),
					error: (error) =>
						error instanceof Error
							? error.message
							: t({
									message: "Failed to create workspace",
								}),
				},
			);
			return workspaceId;
		},
		[navigate, submit, t],
	);
}
