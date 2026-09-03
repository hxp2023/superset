import os from "node:os";
import type { AgentIdentity } from "@superset/shared/agent-identity";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { terminalSessions, workspaces } from "../../../db/schema";
import { mapEventType } from "../../../events";
import type { HostServiceContext } from "../../../types";
import { publicProcedure, router } from "../../index";

// Hook scripts emit "" for unset env vars; we coerce to undefined so the
// AgentIdentity broadcast carries only meaningful fields.
const agentIdentityInput = z
	.object({
		agentId: z.string().optional(),
		sessionId: z.string().optional(),
		definitionId: z.string().optional(),
	})
	.optional();

// The hook script caps `detail` before sending; the caps here are the
// display budget, applied after paths are shortened.
const ACTIVITY_TOOL_MAX_LENGTH = 40;
const ACTIVITY_DETAIL_MAX_LENGTH = 160;

const activityInput = z
	.object({
		tool: z.string().optional(),
		detail: z.string().optional(),
	})
	.optional();

const hookInput = z.object({
	terminalId: z.string().optional(),
	eventType: z.string().optional(),
	agent: agentIdentityInput,
	activity: activityInput,
});

function trimOrUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeAgentIdentity(
	agent: z.infer<typeof agentIdentityInput>,
): AgentIdentity | undefined {
	const agentId = trimOrUndefined(agent?.agentId);
	if (!agentId) return undefined;
	const sessionId = trimOrUndefined(agent?.sessionId);
	const definitionId = trimOrUndefined(agent?.definitionId);
	return {
		agentId: agentId as AgentIdentity["agentId"],
		...(sessionId ? { sessionId } : {}),
		...(definitionId
			? { definitionId: definitionId as AgentIdentity["definitionId"] }
			: {}),
	};
}

/**
 * Shorten paths so the sidebar line reads "src/a.ts", not the worktree's
 * absolute path: strip the workspace root first, then the home directory.
 * Applies to commands too, which routinely embed absolute paths.
 */
export function normalizeAgentActivity(
	activity: z.infer<typeof activityInput>,
	options: { worktreePath?: string; homeDir?: string },
): { tool: string; detail?: string } | undefined {
	const tool = trimOrUndefined(activity?.tool)?.slice(
		0,
		ACTIVITY_TOOL_MAX_LENGTH,
	);
	if (!tool) return undefined;

	let detail = trimOrUndefined(activity?.detail);
	if (detail) {
		const worktreePath = options.worktreePath?.replace(/\/+$/, "");
		if (worktreePath) {
			detail = detail.replaceAll(`${worktreePath}/`, "");
		}
		const homeDir = options.homeDir?.replace(/\/+$/, "");
		if (homeDir) {
			detail = detail.replaceAll(`${homeDir}/`, "~/");
		}
		detail = detail.slice(0, ACTIVITY_DETAIL_MAX_LENGTH);
	}
	return { tool, ...(detail ? { detail } : {}) };
}

// Tasks already nudged to "started" this process. `Start` fires on every
// agent turn and tool use, so gate the cloud call to once per task per
// process — `task.start` is idempotent and forward-only server-side, so a
// duplicate after a restart is harmless.
const startedTaskIds = new Set<string>();

function markLinkedTaskStarted(
	ctx: HostServiceContext,
	taskId: string | null | undefined,
): void {
	if (!taskId || startedTaskIds.has(taskId)) return;
	startedTaskIds.add(taskId);
	void ctx.api.task.start.mutate({ id: taskId }).catch((err) => {
		// Let a later Start event retry — calls are event-driven (one per
		// agent turn/tool use at most), so a cloud outage can't tight-loop.
		startedTaskIds.delete(taskId);
		console.warn(
			`[notifications.hook] failed to mark task ${taskId} as started:`,
			err,
		);
	});
}

export const notificationsRouter = router({
	/**
	 * Agent lifecycle hook. The shell hook POSTs here; we normalize, resolve
	 * the terminal's workspace, and fan out over the WS event bus.
	 *
	 * Intentionally unauthenticated: a caller can only trigger a chime, a
	 * sidebar indicator, and the idempotent forward-only "linked task →
	 * In Progress" nudge for a real workspace. Reusing the host-service PSK
	 * would leak it into every agent shell's env for zero practical gain.
	 */
	hook: publicProcedure.input(hookInput).mutation(async ({ ctx, input }) => {
		const eventType = mapEventType(input.eventType);
		if (!eventType) {
			return { success: true, ignored: true as const };
		}

		if (!input.terminalId) {
			return { success: true, ignored: true as const };
		}

		const terminalSession = ctx.db.query.terminalSessions
			.findFirst({
				where: eq(terminalSessions.id, input.terminalId),
				columns: { originWorkspaceId: true },
			})
			.sync();
		if (!terminalSession?.originWorkspaceId) {
			return { success: true, ignored: true as const };
		}

		const workspace = ctx.db.query.workspaces
			.findFirst({
				where: eq(workspaces.id, terminalSession.originWorkspaceId),
				columns: { taskId: true, worktreePath: true },
			})
			.sync();

		const agent = normalizeAgentIdentity(input.agent);
		const activity = normalizeAgentActivity(input.activity, {
			worktreePath: workspace?.worktreePath,
			homeDir: os.homedir(),
		});
		const occurredAt = Date.now();

		ctx.eventBus.broadcastAgentLifecycle({
			workspaceId: terminalSession.originWorkspaceId,
			eventType,
			terminalId: input.terminalId,
			...(agent ? { agent } : {}),
			occurredAt,
		});

		ctx.terminalAgentStore.recordEvent({
			terminalId: input.terminalId,
			workspaceId: terminalSession.originWorkspaceId,
			eventType,
			...(agent?.agentId ? { agentId: agent.agentId } : {}),
			...(agent?.sessionId ? { agentSessionId: agent.sessionId } : {}),
			...(agent?.definitionId ? { definitionId: agent.definitionId } : {}),
			...(activity ? { activity } : {}),
			occurredAt,
		});

		// An agent began working in this workspace — nudge the linked task
		// to In Progress.
		if (eventType === "Start") {
			markLinkedTaskStarted(ctx, workspace?.taskId);
		}

		return { success: true, ignored: false as const };
	}),
});
