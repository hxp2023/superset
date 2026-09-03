import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { AGENT_IDENTITY_LABELS } from "@superset/shared/agent-catalog";
import { toast } from "@superset/ui/sonner";
import { workspaceTrpc } from "@superset/workspace-client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	getTerminalAgentBindingsQueryKey,
	type TerminalAgentBinding,
	useTerminalAgentBindings,
} from "renderer/hooks/host-service/useTerminalAgentBindings";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { usePullRequestsSplitViewStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsSplitViewStore";

/** Poll cadence for the PR link while an agent is working on it. */
const PR_POLL_MS = 3_000;
/** How often to ask the host to re-sync the PR link from GitHub while
 * waiting — the background sync alone can lag the agent's `gh pr create`
 * by a full tick. */
const PR_REFRESH_MS = 15_000;
/** After the agent reports it finished, how long the PR gets to show up
 * (one forced refresh plus a couple of polls) before we call it a miss. */
const AGENT_FINISHED_GRACE_MS = 12_000;
/** Hard stop so the control never spins forever. */
const GIVE_UP_MS = 10 * 60 * 1000;

export type AgentCreatePrStatus =
	| {
			mode: "terminal";
			terminalId: string;
			agentLabel: string;
			startedAt: number;
			/** Host-clock `lastEventAt` of the target when dispatched; later hook
			 * events are the agent reacting to this prompt. */
			dispatchedAfter: number;
			/** Stops to disregard before one counts as "done": one when the
			 * target was mid-task at dispatch (its next Stop closes that task and
			 * the prompt runs after), none when it was idle. */
			stopsToIgnore: number;
	  }
	| {
			mode: "headless";
			runId: string;
			agentLabel: string;
			startedAt: number;
	  };

export interface UseCreatePrWithAgentResult {
	/** Hands the PR to an agent. Resolves once dispatched (not once created). */
	dispatch: () => Promise<void>;
	/** Drops the in-progress state without touching the agent. */
	stopWaiting: () => void;
	status: AgentCreatePrStatus | null;
	isDispatching: boolean;
	/** The live session the next dispatch would target, if any. */
	target: TerminalAgentBinding | null;
	/** Label for the agent the next dispatch would use (live or headless). */
	targetLabel: string | null;
}

function agentLabel(agentId: string): string {
	return (
		(AGENT_IDENTITY_LABELS as Record<string, string | undefined>)[agentId] ??
		agentId
	);
}

function isWorking(binding: TerminalAgentBinding): boolean {
	return (
		binding.lastEventType === "Start" ||
		binding.lastEventType === "PermissionRequest"
	);
}

/**
 * Which live session gets the prompt: the most recently active agent that
 * is not mid-task, else the most recent one (its TUI queues the message).
 */
function pickTarget(
	bindings: Map<string, TerminalAgentBinding>,
): TerminalAgentBinding | null {
	const sessions = [...bindings.values()].sort(
		(a, b) => b.lastEventAt - a.lastEventAt,
	);
	return sessions.find((session) => !isWorking(session)) ?? sessions[0] ?? null;
}

/** The terminal target's post-dispatch outcome, read off its binding. */
type TerminalOutcome =
	| { kind: "none" }
	| { kind: "stopped"; at: number }
	| { kind: "failed"; at: number };

/**
 * Owns the agent-driven Create PR flow for one workspace: picks the target
 * (a live agent terminal, else the default agent run headlessly by the
 * host), dispatches through `pullRequests.createWithAgent`, then watches for
 * the outcome. The PR itself arrives through the normal link sync — this
 * polls faster while waiting, nudges a GitHub re-sync when the agent stops,
 * and reports a miss when the agent finishes (or dies) without a PR.
 */
export function useCreatePrWithAgent({
	workspaceId,
	projectId,
	onPrCreated,
}: {
	workspaceId: string;
	projectId: string | null;
	/** Fired once the PR link appears so the control flips to its PR face. */
	onPrCreated: () => void;
}): UseCreatePrWithAgentResult {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const bindings = useTerminalAgentBindings(workspaceId);
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const { data: configs = [] } = useV2AgentConfigs(hostUrl);

	const [status, setStatus] = useState<AgentCreatePrStatus | null>(null);
	// Post-dispatch Stop timestamps seen on the terminal target; reset per
	// dispatch (see the terminal-outcome block below).
	const [stopsSeen, setStopsSeen] = useState<number[]>([]);
	const target = useMemo(() => pickTarget(bindings), [bindings]);
	// The bindings map the dispatch was made against: a *different* map that
	// lacks the target means the host reported it gone (the map is only
	// rebuilt when the query data changes), whereas an unchanged map says
	// nothing new yet.
	const dispatchBindingsRef = useRef<Map<string, TerminalAgentBinding> | null>(
		null,
	);
	const headlessConfig = configs[0] ?? null;
	const targetLabel = target
		? agentLabel(target.agentId)
		: (headlessConfig?.label ?? null);

	const createMutation =
		workspaceTrpc.pullRequests.createWithAgent.useMutation();
	const refreshMutation =
		workspaceTrpc.pullRequests.refreshByWorkspaces.useMutation();

	const stopWaiting = useCallback(() => setStatus(null), []);

	const dispatch = useCallback(async () => {
		const liveTarget = target;
		try {
			const result = await createMutation.mutateAsync({
				workspaceId,
				...(liveTarget
					? { terminalId: liveTarget.terminalId }
					: headlessConfig
						? { agent: headlessConfig.id }
						: {}),
			});
			dispatchBindingsRef.current = bindings;
			setStopsSeen([]);
			if (result.mode === "terminal") {
				const label = agentLabel(result.agentId);
				setStatus({
					mode: "terminal",
					terminalId: result.terminalId,
					agentLabel: label,
					startedAt: Date.now(),
					dispatchedAfter: liveTarget?.lastEventAt ?? 0,
					stopsToIgnore: liveTarget && isWorking(liveTarget) ? 1 : 0,
				});
				toast.info(
					t({
						id: "workspace.shipControl.agentCreatingPr",
						message: "Agent is creating the pull request…",
					}),
					{
						description: t({
							id: "workspace.shipControl.agentSentTo",
							message: `Sent to ${label}`,
						}),
					},
				);
			} else {
				const label = result.agentLabel;
				setStatus({
					mode: "headless",
					runId: result.runId,
					agentLabel: label,
					startedAt: Date.now(),
				});
				toast.info(
					t({
						id: "workspace.shipControl.agentCreatingPr",
						message: "Agent is creating the pull request…",
					}),
					{
						description: t({
							id: "workspace.shipControl.agentRunningHeadless",
							message: `Running ${label} in the background`,
						}),
					},
				);
			}
		} catch (error) {
			// The likeliest failure is a target whose pty died while its
			// session row lagged behind — refetch the bindings so the next
			// click doesn't aim at the same dead agent.
			if (liveTarget) {
				void queryClient.invalidateQueries({
					queryKey: getTerminalAgentBindingsQueryKey(workspaceId),
				});
			}
			toast.error(
				t({
					id: "workspace.shipControl.agentDispatchFailed",
					message: "Couldn't hand the pull request to an agent",
				}),
				{
					description: errorMessage(
						error,
						t({
							id: "workspace.shipControl.unknownError",
							message: "Unknown error",
						}),
					),
				},
			);
		}
	}, [
		bindings,
		createMutation,
		headlessConfig,
		queryClient,
		t,
		target,
		workspaceId,
	]);

	// ── Waiting for the outcome ────────────────────────────────────────

	const waiting = status !== null;
	// Same query key as usePRFlowState's, so the faster interval here just
	// tightens the shared observer while an agent is at work.
	const prQuery = workspaceTrpc.git.getPullRequest.useQuery(
		{ workspaceId },
		{ enabled: waiting, refetchInterval: waiting ? PR_POLL_MS : false },
	);
	const headlessStatusQuery =
		workspaceTrpc.pullRequests.agentCreateStatus.useQuery(
			{ workspaceId },
			{
				enabled: status?.mode === "headless",
				refetchInterval: status?.mode === "headless" ? PR_POLL_MS : false,
			},
		);
	// The query is keyed by workspace, so right after a retry it still holds
	// the previous run's outcome; only this dispatch's run counts.
	const headlessRun =
		status?.mode === "headless" &&
		headlessStatusQuery.data?.runId === status.runId
			? headlessStatusQuery.data
			: null;

	const onPrCreatedRef = useRef(onPrCreated);
	onPrCreatedRef.current = onPrCreated;
	const refreshRef = useRef(refreshMutation);
	refreshRef.current = refreshMutation;
	const lastRefreshAtRef = useRef(0);
	const requestRefresh = useCallback(
		(force: boolean) => {
			const now = Date.now();
			if (!force && now - lastRefreshAtRef.current < PR_REFRESH_MS) return;
			if (refreshRef.current.isPending) return;
			lastRefreshAtRef.current = now;
			refreshRef.current
				.mutateAsync({ workspaceIds: [workspaceId] })
				.catch((error) => {
					console.warn("[create-pr-with-agent] PR link refresh failed", error);
				});
		},
		[workspaceId],
	);

	// Success: the PR link appeared.
	const createdPr = waiting ? prQuery.data : null;
	useEffect(() => {
		if (!createdPr) return;
		setStatus(null);
		onPrCreatedRef.current();
		toast.success(
			t({
				id: "workspace.shipControl.prCreated",
				message: `PR #${createdPr.number} created`,
			}),
			{
				action: {
					label: t({
						id: "workspace.shipControl.openPrToastAction",
						message: "Open",
					}),
					onClick: () => {
						if (projectId == null) return;
						usePullRequestsSplitViewStore.getState().expandDetail();
						void navigate({
							to: "/pull-requests/$prNumber",
							params: { prNumber: String(createdPr.number) },
							search: { project: projectId },
						});
					},
				},
			},
		);
	}, [createdPr, navigate, projectId, t]);

	// Terminal mode: the binding tells us when the agent stopped, failed, or
	// died. Stops are counted through state (not a ref written mid-render)
	// keyed on the event timestamp, so each Stop is counted once however
	// many renders see it, and a Stop that arrives without its Start having
	// been observed (a fast turn between two refetches) still counts.
	const targetBinding =
		status?.mode === "terminal"
			? (bindings.get(status.terminalId) ?? null)
			: null;
	useEffect(() => {
		if (status?.mode !== "terminal" || !targetBinding) return;
		if (targetBinding.lastEventType !== "Stop") return;
		const at = targetBinding.lastEventAt;
		if (at <= status.dispatchedAfter) return;
		setStopsSeen((seen) => (seen.includes(at) ? seen : [...seen, at]));
	}, [status, targetBinding]);
	const terminalOutcome = useMemo<TerminalOutcome>(() => {
		if (status?.mode !== "terminal" || !targetBinding) return { kind: "none" };
		if (
			targetBinding.lastEventType === "Failed" &&
			targetBinding.lastEventAt > status.dispatchedAfter
		) {
			return { kind: "failed", at: targetBinding.lastEventAt };
		}
		const settled = stopsSeen[status.stopsToIgnore];
		return settled === undefined
			? { kind: "none" }
			: { kind: "stopped", at: settled };
	}, [status, stopsSeen, targetBinding]);

	// Definitive failures: the host saw the headless process exit non-zero,
	// or the live agent's hook reported a failed turn.
	const failure =
		headlessRun?.status === "failed"
			? {
					key: `headless:${headlessRun.runId}`,
					description: headlessRun.error ?? "",
				}
			: terminalOutcome.kind === "failed"
				? { key: `terminal:${terminalOutcome.at}`, description: "" }
				: null;
	const failureKey = failure?.key ?? null;
	const failureDescription = failure?.description ?? "";
	useEffect(() => {
		if (failureKey === null) return;
		setStatus(null);
		toast.error(
			t({
				id: "workspace.shipControl.agentHeadlessFailed",
				message: "The agent couldn't create the pull request",
			}),
			{ description: failureDescription || undefined },
		);
	}, [failureKey, failureDescription, t]);

	// A dispatched terminal whose binding vanished died under the agent.
	const targetGone =
		status?.mode === "terminal" &&
		targetBinding === null &&
		dispatchBindingsRef.current !== null &&
		bindings !== dispatchBindingsRef.current;
	useEffect(() => {
		if (!targetGone) return;
		setStatus(null);
		toast.error(
			t({
				id: "workspace.shipControl.agentSessionEnded",
				message: "The agent session ended before the pull request was created",
			}),
		);
	}, [targetGone, t]);

	// The agent said it's done: force a GitHub re-sync, then give the link a
	// short grace window before reporting a miss.
	const agentFinishedAt =
		headlessRun?.status === "succeeded"
			? (headlessRun.finishedAt ?? headlessRun.startedAt)
			: terminalOutcome.kind === "stopped"
				? terminalOutcome.at
				: null;
	useEffect(() => {
		if (agentFinishedAt === null || failureKey !== null) return;
		requestRefresh(true);
		const timer = window.setTimeout(() => {
			setStatus(null);
			toast.warning(
				t({
					id: "workspace.shipControl.agentFinishedNoPr",
					message: "The agent finished without opening a pull request",
				}),
				{
					description: t({
						id: "workspace.shipControl.agentFinishedNoPrHint",
						message: "Check what it reported, or create the PR manually",
					}),
				},
			);
		}, AGENT_FINISHED_GRACE_MS);
		return () => window.clearTimeout(timer);
	}, [agentFinishedAt, failureKey, requestRefresh, t]);

	// Periodic re-sync while waiting, and a hard give-up.
	useEffect(() => {
		if (!status) return;
		lastRefreshAtRef.current = status.startedAt;
		const interval = window.setInterval(
			() => requestRefresh(false),
			PR_REFRESH_MS,
		);
		const giveUp = window.setTimeout(
			() => {
				setStatus(null);
				toast.warning(
					t({
						id: "workspace.shipControl.agentGaveUp",
						message: "Still no pull request from the agent",
					}),
					{
						description: t({
							id: "workspace.shipControl.agentGaveUpHint",
							message:
								"Stopped waiting after 10 minutes — check the agent, or create the PR manually",
						}),
					},
				);
			},
			Math.max(0, status.startedAt + GIVE_UP_MS - Date.now()),
		);
		return () => {
			window.clearInterval(interval);
			window.clearTimeout(giveUp);
		};
	}, [status, requestRefresh, t]);

	return {
		dispatch,
		stopWaiting,
		status,
		isDispatching: createMutation.isPending,
		target,
		targetLabel,
	};
}
