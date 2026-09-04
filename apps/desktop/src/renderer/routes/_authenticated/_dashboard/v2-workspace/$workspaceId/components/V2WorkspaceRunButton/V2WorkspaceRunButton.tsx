import { Trans, useLingui } from "@lingui/react/macro";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Loader2, Play, Settings, Square, X } from "lucide-react";
import { useCallback } from "react";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { useSetSettingsSearchQuery } from "renderer/stores/settings-state";
import type { WorkspaceRunDefinition } from "shared/workspace-run-definition";

interface V2WorkspaceRunButtonProps {
	/** Null for project-less "session" workspaces (no project scripts page). */
	projectId: string | null;
	definition: WorkspaceRunDefinition | null;
	isRunning: boolean;
	isPending: boolean;
	canForceStop: boolean;
	onToggle: () => void | Promise<void>;
	onForceStop: () => void | Promise<void>;
}

/**
 * Top-bar Run control: one split pill like its neighbours (the Changes
 * control, Background terminals) — a bordered `bg-muted/30` shell with a
 * hairline divider between the action face and the chevron, `text-xs`
 * faces, `hover:bg-accent/60`. The face is Run / Stop / Set Run, tinted
 * emerald while the command runs the way an open PR badge is; the chevron
 * holds Force Stop and Configure.
 */
export function V2WorkspaceRunButton({
	projectId,
	definition,
	isRunning,
	isPending,
	canForceStop,
	onToggle,
	onForceStop,
}: V2WorkspaceRunButtonProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const setSettingsSearchQuery = useSetSettingsSearchQuery();
	const hotkeyText = useHotkeyDisplay("RUN_WORKSPACE_COMMAND").text;
	const hasRunCommand = (definition?.commands ?? []).length > 0;

	const handleConfigureClick = useCallback(() => {
		if (definition?.source === "terminal-preset") {
			void navigate({
				to: "/settings/terminal",
				search: { editPresetId: definition.presetId },
			});
			return;
		}

		// Sessions have no project settings page; global presets are the only
		// configurable run source, handled by the terminal-preset branch above.
		if (projectId === null) {
			void navigate({ to: "/settings/terminal" });
			return;
		}
		setSettingsSearchQuery("scripts");
		void navigate({
			to: "/settings/projects/$projectId",
			params: { projectId },
		});
	}, [definition, navigate, projectId, setSettingsSearchQuery]);

	const label = isRunning
		? t({ id: "workspace.runButton.stop", message: "Stop" })
		: hasRunCommand
			? t({ id: "workspace.runButton.run", message: "Run" })
			: t({ id: "workspace.runButton.setRun", message: "Set Run" });
	const Icon = isPending
		? Loader2
		: isRunning
			? Square
			: hasRunCommand
				? Play
				: Settings;

	// Same tint recipe as the PR badge's "open" state: fill on the shell,
	// stronger fill on hover, the divider in the same hue.
	const tint = isRunning
		? {
				container: "border-emerald-500/30 bg-emerald-500/10",
				face: "text-emerald-600 [.dark_&]:text-[#34d399]",
				hover: "hover:bg-emerald-500/15",
				divider: "bg-emerald-500/30",
			}
		: {
				container: "border-border/60 bg-muted/30",
				face: hasRunCommand
					? "text-foreground"
					: "text-muted-foreground hover:text-foreground",
				hover: "hover:bg-accent/60",
				divider: "bg-border/60",
			};

	return (
		<div
			className={cn(
				"flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border no-drag",
				tint.container,
			)}
			aria-busy={isPending}
		>
			<button
				type="button"
				onClick={() => {
					if (!hasRunCommand && !isRunning) {
						handleConfigureClick();
						return;
					}
					void onToggle();
				}}
				disabled={isPending}
				className={cn(
					"flex h-full items-center gap-1.5 px-2 text-xs font-medium outline-none transition-colors disabled:opacity-50",
					tint.face,
					tint.hover,
				)}
				aria-label={
					isRunning
						? t({
								id: "workspace.runButton.stopAria",
								message: "Stop workspace run command",
							})
						: hasRunCommand
							? t({
									id: "workspace.runButton.runAria",
									message: "Run workspace command",
								})
							: t({
									id: "workspace.runButton.configureAria",
									message: "Configure workspace run command",
								})
				}
			>
				<Icon
					className={cn("size-3.5 shrink-0", isPending && "animate-spin")}
				/>
				<span>{label}</span>
				{hotkeyText && hotkeyText !== "Unassigned" && (
					<span className="hidden text-[10px] tracking-wide text-muted-foreground/60 sm:inline">
						{hotkeyText}
					</span>
				)}
			</button>

			<div className={cn("h-full w-px", tint.divider)} />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						disabled={isPending}
						className={cn(
							"flex h-full items-center px-1 outline-none transition-colors disabled:opacity-50",
							tint.hover,
						)}
						aria-label={t({
							id: "workspace.runButton.optionsAria",
							message: "Workspace run options",
						})}
					>
						<ChevronDown className="size-3 text-muted-foreground" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					{canForceStop && (
						<>
							<DropdownMenuItem
								onClick={() => void onForceStop()}
								className="text-xs text-destructive focus:text-destructive"
							>
								<X className="size-3.5 text-destructive" />
								<Trans id="workspace.runButton.forceStop">Force Stop</Trans>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem onClick={handleConfigureClick} className="text-xs">
						<Settings className="size-3.5" />
						{definition?.source === "terminal-preset"
							? t({
									id: "workspace.runButton.editRunScript",
									message: "Edit Run Script",
								})
							: t({
									id: "workspace.runButton.configure",
									message: "Configure",
								})}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
