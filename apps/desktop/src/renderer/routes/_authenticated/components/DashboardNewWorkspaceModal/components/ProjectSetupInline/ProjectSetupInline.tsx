import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { CloneAccessStatus } from "renderer/routes/_authenticated/components/CloneAccessStatus";
import type { useCloneAccessPlan } from "renderer/routes/_authenticated/hooks/useCloneAccessPlan";

interface ProjectSetupInlineProps {
	projectName: string;
	hostName: string;
	isRemoteTarget: boolean;
	plan: ReturnType<typeof useCloneAccessPlan>;
	/** Manual fallback: the settings setup modal (import, relocation). */
	onOpenSettings: () => void;
}

/**
 * Composer-inline plan for a project that isn't set up on the chosen host:
 * creation subsumes setup, so instead of routing the user to settings this
 * states what will happen ("cloned to … first"), lets them edit the target
 * directory, and runs the access preflight in place. Submitting the
 * workspace performs the clone as its first step.
 */
export function ProjectSetupInline({
	projectName,
	hostName,
	isRemoteTarget,
	plan,
	onOpenSettings,
}: ProjectSetupInlineProps) {
	const [editingPath, setEditingPath] = useState(false);

	return (
		<div className="space-y-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2">
			<p className="text-xs text-muted-foreground">
				<span className="font-medium text-foreground">{projectName}</span> isn't
				on {hostName} yet. It'll be cloned to{" "}
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
						className="mx-1 inline-block h-5 w-64 px-1.5 font-mono text-[11px]"
					/>
				) : (
					<button
						type="button"
						className="rounded bg-muted/60 px-1 font-mono text-[11px] text-foreground hover:bg-muted"
						title="Change the clone location"
						onClick={() => setEditingPath(true)}
					>
						{plan.parentDir || "~/.superset/projects"}
					</button>
				)}{" "}
				first.{" "}
				<Button
					type="button"
					variant="link"
					size="sm"
					className="h-auto p-0 align-baseline text-xs"
					onClick={onOpenSettings}
				>
					Set up manually…
				</Button>
			</p>
			<CloneAccessStatus
				result={plan.access}
				isChecking={plan.isCheckingAccess}
				hostName={hostName}
				isRemoteTarget={isRemoteTarget}
				onRecheck={plan.recheckAccess}
			/>
		</div>
	);
}
