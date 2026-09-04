import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { LuArrowUpRight, LuPlus } from "react-icons/lu";
import type { StackLayerView } from "../../../../types";
import { StackLayerStatus } from "../StackLayerStatus";
import { StackRailNode } from "../StackRailNode";

interface StackLayerRowProps {
	layer: StackLayerView;
	variant: "compact" | "full";
	hasAbove: boolean;
	hasBelow: boolean;
	onOpenWorkspace: (workspaceId: string) => void;
	onOpenInNewWorkspace: (layer: StackLayerView) => void;
	canOpenInNewWorkspace: boolean;
}

const hoverReveal =
	"shrink-0 rounded-sm p-0.5 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100";

/**
 * One layer of the stack. The row's main click goes where the branch lives:
 * its workspace when this host has one, otherwise the PR on GitHub. Hover
 * reveals the other way in — GitHub for a layer with a workspace, a fresh
 * workspace for a layer without. The current layer is the reference point
 * and does not navigate anywhere.
 */
export function StackLayerRow({
	layer,
	variant,
	hasAbove,
	hasBelow,
	onOpenWorkspace,
	onOpenInNewWorkspace,
	canOpenInNewWorkspace,
}: StackLayerRowProps) {
	const { t } = useLingui();
	const interactive = !layer.isCurrent;
	const workspaceId = layer.workspace?.id ?? null;

	const body = (
		<div
			className={cn(
				"min-w-0 flex-1 rounded-md px-1.5 py-1 text-left transition-colors",
				interactive && "hover:bg-accent/50",
				layer.isCurrent && "bg-accent/40",
			)}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
					#{layer.number}
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-xs",
						layer.isCurrent
							? "font-medium text-foreground"
							: "text-foreground/80 group-hover:text-foreground",
					)}
					title={layer.title}
				>
					{layer.title}
				</span>
				<StackLayerStatus
					layer={layer}
					variant={variant === "compact" ? "dot" : "label"}
				/>
			</div>
			{variant === "full" && (
				<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
					<span
						className="min-w-0 truncate font-mono"
						title={layer.headRefName}
					>
						{layer.headRefName}
					</span>
					{layer.isCurrent ? (
						<span className="shrink-0 rounded-sm bg-muted px-1 py-px">
							<Trans>This workspace</Trans>
						</span>
					) : layer.workspace ? (
						<span
							className="min-w-0 shrink truncate rounded-sm bg-muted px-1 py-px"
							title={layer.workspace.name}
						>
							{layer.workspace.name}
						</span>
					) : null}
				</div>
			)}
		</div>
	);

	let primary: ReactNode;
	if (!interactive) {
		primary = body;
	} else if (workspaceId) {
		primary = (
			<button
				type="button"
				className="flex min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
				aria-label={t({
					message: "Open workspace",
				})}
				onClick={() => onOpenWorkspace(workspaceId)}
			>
				{body}
			</button>
		);
	} else {
		primary = (
			<a
				href={layer.url}
				target="_blank"
				rel="noopener noreferrer"
				className="flex min-w-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md"
				aria-label={t({
					message: "View on GitHub",
				})}
			>
				{body}
			</a>
		);
	}

	return (
		<li className="group relative flex min-w-0 items-stretch gap-1.5">
			<StackRailNode
				state={layer.state}
				isCurrent={layer.isCurrent}
				hasAbove={hasAbove}
				hasBelow={hasBelow}
			/>
			{/* Secondary actions stay siblings of the primary control: an
			    interactive element inside a button or link is invalid HTML and
			    breaks assistive-tech focus. */}
			<div className="flex min-w-0 flex-1 items-start gap-0.5">
				{primary}
				{interactive && variant === "full" && (
					<div className="flex shrink-0 items-center gap-0.5 pt-1">
						{workspaceId && (
							<a
								href={layer.url}
								target="_blank"
								rel="noopener noreferrer"
								className={hoverReveal}
								aria-label={t({
									message: "View on GitHub",
								})}
								title={t({
									message: "View on GitHub",
								})}
							>
								<LuArrowUpRight className="size-3" aria-hidden="true" />
							</a>
						)}
						{!workspaceId && canOpenInNewWorkspace && (
							<button
								type="button"
								className={hoverReveal}
								aria-label={t({
									message: "Open in a new workspace",
								})}
								title={t({
									message: "Open in a new workspace",
								})}
								onClick={() => onOpenInNewWorkspace(layer)}
							>
								<LuPlus className="size-3" aria-hidden="true" />
							</button>
						)}
					</div>
				)}
			</div>
		</li>
	);
}
