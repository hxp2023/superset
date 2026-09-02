import { V2WorkspaceOpenInButton } from "renderer/routes/_authenticated/_dashboard/components/TopBar/components/V2WorkspaceOpenInButton";

interface PRActionHeaderProps {
	workspaceId: string;
}

/**
 * Sidebar top strip: window-drag region plus the open-in-editor button. The
 * PR badge and its state machine moved to the top bar's ChangesControl, so
 * the bar itself stays quiet.
 */
export function PRActionHeader({ workspaceId }: PRActionHeaderProps) {
	return (
		<div className="flex h-10 shrink-0 items-center gap-2 bg-muted/45 px-2 dark:bg-muted/35">
			<div className="drag h-full min-w-0 flex-1" />
			<div className="flex items-center gap-2">
				<V2WorkspaceOpenInButton workspaceId={workspaceId} />
			</div>
		</div>
	);
}
