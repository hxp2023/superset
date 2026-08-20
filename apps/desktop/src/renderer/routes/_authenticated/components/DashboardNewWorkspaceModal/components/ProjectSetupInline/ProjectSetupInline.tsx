import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { CloneAccessStatus } from "renderer/routes/_authenticated/components/CloneAccessStatus";
import type { useCloneAccessPlan } from "renderer/routes/_authenticated/hooks/useCloneAccessPlan";

interface ProjectSetupInlineProps {
	hostName: string;
	isRemoteTarget: boolean;
	plan: ReturnType<typeof useCloneAccessPlan>;
	/** Manual fallback: the settings setup modal (import, relocation). */
	onOpenSettings: () => void;
}

const DEFAULT_PARENT_DIR = "~/.superset/projects";

/**
 * Composer-inline plan for a project that isn't set up on the chosen host:
 * creation subsumes setup, so instead of routing the user to settings this
 * is one quiet status line under the prompt ("clones to … first", editable
 * target, access check running in place). Submitting the workspace performs
 * the clone as its first step. Only an access failure adds a second row.
 */
export function ProjectSetupInline({
	hostName,
	isRemoteTarget,
	plan,
	onOpenSettings,
}: ProjectSetupInlineProps) {
	const [editingPath, setEditingPath] = useState(false);
	const failed =
		plan.access !== null && !plan.access.ok && !plan.isCheckingAccess;

	return (
		<div className="space-y-1 px-1 text-xs text-muted-foreground">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className="min-w-0">
					Clones to{" "}
					{editingPath ? (
						<Input
							autoFocus
							value={plan.parentDir}
							onChange={(e) => plan.setParentDir(e.target.value)}
							onBlur={() => setEditingPath(false)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === "Escape") {
									e.preventDefault();
									setEditingPath(false);
								}
							}}
							className="mx-0.5 inline-block h-5 w-56 px-1 font-mono text-[11px]"
						/>
					) : (
						<button
							type="button"
							className="inline-block max-w-[280px] truncate rounded-sm align-bottom font-mono text-[11px] text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground"
							title={`${plan.parentDir || DEFAULT_PARENT_DIR} (click to change)`}
							onClick={() => setEditingPath(true)}
						>
							{plan.parentDir || DEFAULT_PARENT_DIR}
						</button>
					)}{" "}
					on {hostName} first.
				</span>
				{!failed && (
					<CloneAccessStatus
						variant="inline"
						result={plan.access}
						isChecking={plan.isCheckingAccess}
						hostName={hostName}
						isRemoteTarget={isRemoteTarget}
						onRecheck={plan.recheckAccess}
					/>
				)}
				<Button
					type="button"
					variant="link"
					size="sm"
					className="ml-auto h-auto p-0 text-xs text-muted-foreground/80"
					onClick={onOpenSettings}
				>
					Set up manually
				</Button>
			</div>
			{failed && (
				<CloneAccessStatus
					variant="inline"
					result={plan.access}
					isChecking={plan.isCheckingAccess}
					hostName={hostName}
					isRemoteTarget={isRemoteTarget}
					onRecheck={plan.recheckAccess}
				/>
			)}
		</div>
	);
}
