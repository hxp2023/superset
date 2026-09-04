import type { ComponentType, ReactNode } from "react";

export interface SidebarTabDefinition {
	id: string;
	label: string;
	icon?: ComponentType<{ className?: string }>;
	badge?: number;
	actions?: ReactNode;
	content: ReactNode;
}

/** Opens a new terminal tab in this workspace that starts by running `command`. */
export type RunTerminalCommand = (args: {
	command: string;
	title?: string;
}) => void | Promise<void>;
