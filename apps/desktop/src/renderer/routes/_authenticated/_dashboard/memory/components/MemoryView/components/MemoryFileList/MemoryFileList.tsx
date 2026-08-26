import type { AgentMemoryFileEntry } from "@superset/host-service/agent-memory";
import { cn } from "@superset/ui/utils";
import { Fragment } from "react";
import { targetKey } from "../../utils/targetKey";

interface MemoryFileListProps {
	entries: AgentMemoryFileEntry[];
	selectedKey: string | null;
	onSelect: (entry: AgentMemoryFileEntry) => void;
}

/** Group identity: one section per scope (global / project main / workspace). */
export function entryGroupKey(entry: AgentMemoryFileEntry): string {
	return `${entry.projectId ?? "none"}:${entry.workspaceId ?? "main"}`;
}

export function entryGroupLabel(entry: AgentMemoryFileEntry): string {
	if (entry.workspaceName !== null) {
		return entry.projectName !== null
			? `${entry.projectName} · ${entry.workspaceName}`
			: entry.workspaceName;
	}
	return entry.projectName ?? "Global";
}

function formatSize(sizeBytes: number | null): string {
	if (sizeBytes === null) return "";
	if (sizeBytes < 1024) return `${sizeBytes} B`;
	return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

/**
 * Second column of the Memory tab: one agent's files — global first, then per
 * project the main checkout's files followed by its worktrees' (divergent
 * instruction files + auto-memory notes), then session workspaces. Entries
 * arrive pre-grouped and pre-sorted from agentMemory.listFiles.
 */
export function MemoryFileList({
	entries,
	selectedKey,
	onSelect,
}: MemoryFileListProps) {
	return (
		<div className="flex w-72 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-3">
			{entries.map((entry, index) => {
				const key = targetKey(entry.target);
				const groupKey = entryGroupKey(entry);
				const isActive = key === selectedKey;
				const startsGroup =
					index === 0 || entryGroupKey(entries[index - 1]) !== groupKey;
				const groupCount = startsGroup
					? entries.filter((e) => entryGroupKey(e) === groupKey).length
					: 0;
				return (
					<Fragment key={key}>
						{startsGroup && (
							<div
								className={cn(
									"flex items-baseline gap-1.5 px-2 pb-0.5 pt-2",
									index === 0 && "pt-0",
								)}
							>
								<span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									{entryGroupLabel(entry)}
								</span>
								{(entry.projectId !== null || entry.workspaceId !== null) &&
									groupCount > 1 && (
										<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
											{groupCount}
										</span>
									)}
							</div>
						)}
						<button
							type="button"
							onClick={() => onSelect(entry)}
							aria-current={isActive ? "true" : undefined}
							className={cn(
								"flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
								isActive ? "bg-fill-selected" : "hover:bg-fill-hover",
							)}
						>
							<span className="min-w-0 flex-1 truncate text-[12.5px]">
								{entry.fileName}
							</span>
							<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
								{entry.exists ? formatSize(entry.sizeBytes) : "new"}
							</span>
						</button>
					</Fragment>
				);
			})}
		</div>
	);
}
