import { sanitizePromptForPty } from "@superset/shared/agent-prompt-launch";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { HostDb } from "../../../../db";
import { hostAgentConfigs, workspaces } from "../../../../db/schema";
import { createGitEnvResolver } from "../../../../runtime/git";
import type { TerminalSessionError } from "../../../../terminal/terminal";
import { writeFramedInputToSession } from "../../../../terminal/terminal";
import type { TerminalAgentStore } from "../../../../terminal-agents";
import type { HostServiceContext } from "../../../../types";
import { getHostWorkerPool } from "../../../../workers/host-worker-pool";
import {
	type GitPrContextResult,
	gitPrContextTask,
} from "../../../../workers/tasks/git";
import { protectedProcedure } from "../../../index";
import { type AgentRunResult, runAgentInWorkspace } from "../../agents/agents";
import { resolveWorktreePath } from "../../git/utils/resolve-worktree";
import { toTerminalSessionError } from "../../terminal/errors";
import { buildCreatePrPrompt } from "../utils/create-pr-prompt";
import {
	type CreatePrSkillSource,
	resolveCreatePrSkill,
} from "../utils/create-pr-skill";
import { hasSomethingToShip } from "../utils/pr-context";

const createWithAgentInput = z.object({
	workspaceId: z.string(),
	/** A live agent terminal to send the prompt to. Omitted → a new agent
	 * terminal is launched in the workspace with the prompt baked in. */
	terminalId: z.string().optional(),
	/** Host agent config (or preset) id for the new session; defaults to the
	 * first configured agent. Ignored when `terminalId` is set. */
	agent: z.string().min(1).optional(),
	draft: z.boolean().default(false),
});

export type CreateWithAgentInput = z.infer<typeof createWithAgentInput>;

export type CreateWithAgentResult =
	| {
			mode: "terminal";
			terminalId: string;
			agentId: string;
			skillSource: CreatePrSkillSource;
	  }
	| {
			mode: "new-session";
			terminalId: string;
			agentLabel: string;
			skillSource: CreatePrSkillSource;
	  };

export interface CreateWithAgentDeps {
	db: HostDb;
	terminalAgentStore: Pick<TerminalAgentStore, "listByWorkspace">;
	readPrContext: (worktreePath: string) => Promise<GitPrContextResult>;
	resolveSkill: typeof resolveCreatePrSkill;
	sendToTerminal: (args: {
		workspaceId: string;
		terminalId: string;
		text: string;
	}) => Promise<{ success: true } | TerminalSessionError>;
	/** Launches a fresh agent terminal with the prompt as its first turn —
	 * the same path the diff composer's "new session" target takes. */
	runAgent: (args: {
		workspaceId: string;
		agent: string;
		prompt: string;
	}) => Promise<AgentRunResult>;
}

function contextFailure(reason: "detached-head" | "no-base" | "on-base") {
	switch (reason) {
		case "detached-head":
			return "Cannot create a pull request from a detached HEAD";
		case "no-base":
			return "Could not determine a base branch for the pull request";
		case "on-base":
			return "This branch is the base branch — nothing to open a pull request from";
	}
}

/**
 * Dispatches PR creation to an agent: gathers the branch context off-loop,
 * resolves the (overridable) `create-pr` skill, and either pastes the prompt
 * into a live agent terminal or launches a new agent terminal in the
 * workspace with the prompt as its opening turn. The PR itself surfaces
 * through the usual link sync once the agent has run `gh pr create`; the
 * renderer also reads the agent's screen for the URL it reports.
 */
export async function createPullRequestWithAgent(
	deps: CreateWithAgentDeps,
	input: CreateWithAgentInput & { worktreePath: string },
): Promise<CreateWithAgentResult> {
	const workspace = deps.db.query.workspaces
		.findFirst({ where: eq(workspaces.id, input.workspaceId) })
		.sync();
	if (!workspace?.projectId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Workspace has no linked project, so there is no repository to open a pull request on",
		});
	}

	// A stale terminal target must surface as NOT_FOUND even when the branch
	// has nothing to ship yet, so the renderer drops the dead binding either
	// way — hence checked before the (slower) context and skill reads.
	const binding = input.terminalId
		? deps.terminalAgentStore
				.listByWorkspace(input.workspaceId)
				.find((candidate) => candidate.terminalId === input.terminalId)
		: undefined;
	if (input.terminalId && !binding) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "That agent session is no longer running",
			cause: { kind: "SESSION_NOT_ACTIVE" },
		});
	}

	const result = await deps.readPrContext(input.worktreePath);
	if (!result.ok) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: contextFailure(result.reason),
		});
	}
	const { context } = result;
	// Unlike the manual path (GitHub needs commits between base and head),
	// a dirty tree is enough here: the skill commits it before opening.
	if (!hasSomethingToShip(context)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Nothing to open a pull request from — no commits ahead of ${context.base.name} and no uncommitted changes`,
		});
	}

	const skill = await deps.resolveSkill({ worktreePath: input.worktreePath });
	if (!skill) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"The create-pr skill is missing from this Superset install — reinstall or add .agents/skills/create-pr/SKILL.md to the repository",
		});
	}
	const prompt = sanitizePromptForPty(
		buildCreatePrPrompt({ skill, context, draft: input.draft }),
	);

	if (input.terminalId && binding) {
		const sent = await deps.sendToTerminal({
			workspaceId: input.workspaceId,
			terminalId: input.terminalId,
			text: prompt,
		});
		if ("error" in sent) throw toTerminalSessionError(sent);
		return {
			mode: "terminal",
			terminalId: input.terminalId,
			agentId: binding.agentId,
			skillSource: skill.source,
		};
	}

	const agent =
		input.agent ??
		deps.db
			.select({ id: hostAgentConfigs.id })
			.from(hostAgentConfigs)
			.orderBy(asc(hostAgentConfigs.displayOrder))
			.get()?.id;
	if (!agent) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"No agent is configured on this host — add one in Settings → Agents, then try again",
			cause: { kind: "NO_AGENT_CONFIGURED" },
		});
	}
	const launched = await deps.runAgent({
		workspaceId: input.workspaceId,
		agent,
		prompt,
	});
	return {
		mode: "new-session",
		terminalId: launched.sessionId,
		agentLabel: launched.label,
		skillSource: skill.source,
	};
}

export function buildCreateWithAgentDeps(
	ctx: HostServiceContext,
): CreateWithAgentDeps {
	return {
		db: ctx.db,
		terminalAgentStore: ctx.terminalAgentStore,
		readPrContext: async (worktreePath) => {
			const gitEnv = await createGitEnvResolver(ctx.credentials)(worktreePath);
			return getHostWorkerPool().run(
				gitPrContextTask,
				{ worktreePath, gitEnv },
				{ timeoutMs: 30_000 },
			);
		},
		resolveSkill: resolveCreatePrSkill,
		sendToTerminal: ({ workspaceId, terminalId, text }) =>
			writeFramedInputToSession({
				workspaceId,
				terminalId,
				text,
				submit: true,
				db: ctx.db,
				eventBus: ctx.eventBus,
			}),
		runAgent: (args) => runAgentInWorkspace(ctx, args),
	};
}

export const createWithAgent = protectedProcedure
	.input(createWithAgentInput)
	.mutation(async ({ ctx, input }) => {
		const worktreePath = resolveWorktreePath(ctx, input.workspaceId);
		return createPullRequestWithAgent(buildCreateWithAgentDeps(ctx), {
			...input,
			worktreePath,
		});
	});
