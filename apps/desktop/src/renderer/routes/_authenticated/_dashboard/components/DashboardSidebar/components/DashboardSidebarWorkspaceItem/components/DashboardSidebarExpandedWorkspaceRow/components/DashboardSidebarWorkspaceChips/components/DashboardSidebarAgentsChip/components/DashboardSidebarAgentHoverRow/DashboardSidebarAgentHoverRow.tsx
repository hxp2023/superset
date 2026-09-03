import { useLingui } from "@lingui/react/macro";
import { formatCompactRelativeTime } from "@superset/i18n/format";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useNow } from "renderer/hooks/useNow";
import { navigateToV2Workspace } from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { getStatusTooltip } from "renderer/screens/main/components/StatusIndicator";
import type {
	DashboardSidebarRunningAgent,
	RunningAgentActivity,
	RunningAgentStatus,
} from "../../../../hooks/useDashboardSidebarWorkspaceRunningAgents";
import { DashboardSidebarAgentAvatar } from "../DashboardSidebarAgentAvatar";
import {
	type AgentActivityVerb,
	describeAgentActivity,
} from "./utils/describeAgentActivity";

const STATUS_TEXT_CLASS: Record<RunningAgentStatus, string> = {
	idle: "text-muted-foreground",
	working: "text-amber-500",
	permission: "text-yellow-500",
	failed: "text-red-500",
	review: "text-green-500",
};

interface DashboardSidebarAgentHoverRowProps {
	workspaceId: string;
	agent: DashboardSidebarRunningAgent;
}

export function DashboardSidebarAgentHoverRow({
	workspaceId,
	agent,
}: DashboardSidebarAgentHoverRowProps) {
	const { t } = useLingui();
	const navigate = useNavigate();

	const handleOpen = () => {
		void navigateToV2Workspace(workspaceId, navigate, {
			search: {
				terminalId: agent.terminalId,
				focusRequestId: crypto.randomUUID(),
			},
		});
	};

	const statusLabel =
		agent.status === "idle"
			? t({ id: "dashboard.sidebar.agentHoverRow.idle", message: "Idle" })
			: getStatusTooltip(agent.status);

	return (
		<div className="flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-muted">
			<button
				type="button"
				onClick={handleOpen}
				className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<DashboardSidebarAgentAvatar agent={agent} />
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="min-w-0 truncate text-xs">{agent.label}</span>
					{agent.activity ? (
						<DashboardSidebarAgentActivityLine activity={agent.activity} />
					) : null}
				</span>
			</button>
			<span
				className={cn("shrink-0 text-[10px]", STATUS_TEXT_CLASS[agent.status])}
			>
				{statusLabel}
			</span>
		</div>
	);
}

/**
 * One line for the agent's latest tool call: "Edit · src/a.ts · 3s ago".
 * The elapsed time ticks while the card is open so a stale line reads as
 * stale instead of live.
 */
function DashboardSidebarAgentActivityLine({
	activity,
}: {
	activity: RunningAgentActivity;
}) {
	const { t } = useLingui();
	const now = useNow();
	const { verb, tool, detail } = describeAgentActivity(activity);

	const verbLabels: Record<AgentActivityVerb, string> = {
		edit: t({
			id: "dashboard.sidebar.agentHoverRow.activity.edit",
			message: "Edit",
		}),
		read: t({
			id: "dashboard.sidebar.agentHoverRow.activity.read",
			message: "Read",
		}),
		run: t({
			id: "dashboard.sidebar.agentHoverRow.activity.run",
			message: "Run",
		}),
		search: t({
			id: "dashboard.sidebar.agentHoverRow.activity.search",
			message: "Search",
		}),
		fetch: t({
			id: "dashboard.sidebar.agentHoverRow.activity.fetch",
			message: "Fetch",
		}),
		delegate: t({
			id: "dashboard.sidebar.agentHoverRow.activity.delegate",
			message: "Subagent",
		}),
	};
	const label = verb ? verbLabels[verb] : tool;
	const text = detail ? `${label} · ${detail}` : label;

	return (
		<span
			className="flex min-w-0 items-baseline text-[10px] text-muted-foreground"
			title={text}
		>
			<span className="min-w-0 truncate">{text}</span>
			<span className="ml-1 shrink-0 text-muted-foreground/70">
				· {formatCompactRelativeTime(activity.at, now)}
			</span>
		</span>
	);
}
