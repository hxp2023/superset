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
import { usePullRequestsSplitViewStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsSplitViewStore";
import type {
	AgentSessionPlacement,
	AgentTarget,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AgentCommentComposer";

/** Poll cadence for the PR link while an agent is working on it. */
const PR_POLL_MS = 3_000;
/** How often to ask the host to re-sync the PR link from GitHub while
 * waiting — the background sync alone can lag the agent's `gh pr create`
 * by a full tick. */
const PR_REFRESH_MS = 15_000;
/** After the agent reports it finished, how long the PR gets to show up
 * (one forced refresh plus a couple of polls) before we call it a miss. */
const AGENT_FINISHED_GRACE_MS = 12_000;
/** A freshly launched agent that never registers a binding in this long
 * didn't start (bad command, missing binary, shell wedge). */
const ATTACH_TIMEOUT_MS = 90_000;
/** Hard stop so the control never spins forever. */
const GIVE_UP_MS = 10 * 60 * 1000;
/** Screen lines read back when the agent stops, looking for the PR URL it
 * reports — the last thing the skill has it print. */
const SNAPSHOT_LINES = 400;

const PR_URL_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g;

export interface AgentCreatePrStatus {
	terminalId: string;
	agentLabel: string;
	startedAt: number;
	/** True when the dispatch launched this terminal (no live agent was
	 * around); its binding appears only once the agent attaches. */
	fresh: boolean;
	/** Host-clock `lastEventAt` of the target when dispatched; later hook
	 * events are the agent reacting to this prompt. */
	dispatchedAfter: number;
	/** Stops to disregard before one counts as "done": one when the target
	 * was mid-task at dispatch (its next Stop closes that task and the
	 * prompt runs after), none when it was idle or freshly launched. */
	stopsToIgnore: number;
}

export interface UseCreatePrWithAgentResult {
	/** Hands the PR to the current target. Resolves once dispatched (not once created). */
	dispatch: () => Promise<void>;
	/** Drops the in-progress state without touching the agent. */
	stopWaiting: () => void;
	status: AgentCreatePrStatus | null;
	isDispatching: boolean;
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

/** Last PR number in a screen's text — `gh pr create` echoes the URL and
 * the skill has the agent print it again as its final line. */
export function findReportedPrNumber(text: string): number | null {
	let last: number | null = null;
	for (const match of text.matchAll(PR_URL_RE)) {
		const number = Number(match[1]);
		if (Number.isFinite(number)) last = number;
	}
	return last;
}

/** The terminal target's post-dispatch outcome, read off its binding. */
type TerminalOutcome =
	| { kind: "none" }
	| { kind: "stopped"; at: number }
	| { kind: "failed"; at: number };

/**
 * Owns the agent-driven Create PR flow for one workspace. The target is the
 * diff composer's model, picked by the caller: a live agent terminal in the
 * workspace, or a new agent terminal launched with the prompt as its first
 * turn. Dispatch goes through `pullRequests.createWithAgent`; then this
 * watches the agent's binding for the outcome. Success is the PR link
 * appearing, or the PR URL on the agent's screen once it stops — the latter
 * keeps the flow honest when the link sync (a GitHub call that can be
 * rate-limited) is failing.
 */
export function useCreatePrWithAgent({
	workspaceId,
	projectId,
	target,
	placement,
	onPrCreated,
	onOpenTerminal,
}: {
	workspaceId: string;
	projectId: string | null;
	/** Where the prompt goes; null while sessions/configs are still loading. */
	target: AgentTarget | null;
	/** Where a new session's pane opens. */
	placement: AgentSessionPlacement;
	/** Fired once the PR link appears so the control flips to its PR face. */
	onPrCreated: () => void;
	/** Opens a freshly launched agent's pane right after dispatch. */
	onOpenTerminal?: (
		terminalId: string,
		placement: AgentSessionPlacement,
	) => void;
}): UseCreatePrWithAgentResult {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const trpcUtils = workspaceTrpc.useUtils();
	const bindings = useTerminalAgentBindings(workspaceId);

	const [status, setStatus] = useState<AgentCreatePrStatus | null>(null);
	// Post-dispatch Stop timestamps seen on the target, and whether its
	// binding has been seen at all (a fresh launch has none until the agent
	// attaches). Both reset per dispatch.
	const [stopsSeen, setStopsSeen] = useState<number[]>([]);
	const [seenBinding, setSeenBinding] = useState(false);
	// PR number read off the agent's screen once it stops; reset per dispatch.
	const [reportedPrNumber, setReportedPrNumber] = useState<number | null>(null);
	// The bindings map the dispatch was made against: a *different* map that
	// lacks the target means the host reported it gone (the map is only
	// rebuilt when the query data changes), whereas an unchanged map says
	// nothing new yet.
	const dispatchBindingsRef = useRef<Map<string, TerminalAgentBinding> | null>(
		null,
	);

	const createMutation =
		workspaceTrpc.pullRequests.createWithAgent.useMutation();
	const refreshMutation =
		workspaceTrpc.pullRequests.refreshByWorkspaces.useMutation();

	const stopWaiting = useCallback(() => setStatus(null), []);

	const dispatch = useCallback(async () => {
		if (!target) return;
		const liveTarget =
			target.kind === "existing"
				? (bindings.get(target.terminalId) ?? null)
				: null;
		try {
			const result = await createMutation.mutateAsync({
				workspaceId,
				...(target.kind === "existing"
					? { terminalId: target.terminalId }
					: { agent: target.configId }),
			});
			dispatchBindingsRef.current = bindings;
			setStopsSeen([]);
			setReportedPrNumber(null);
			setSeenBinding(result.mode === "terminal");
			const label =
				result.mode === "terminal"
					? agentLabel(result.agentId)
					: result.agentLabel;
			setStatus({
				terminalId: result.terminalId,
				agentLabel: label,
				startedAt: Date.now(),
				fresh: result.mode === "new-session",
				dispatchedAfter:
					result.mode === "terminal" ? (liveTarget?.lastEventAt ?? 0) : 0,
				stopsToIgnore:
					result.mode === "terminal" && liveTarget && isWorking(liveTarget)
						? 1
						: 0,
			});
			if (result.mode === "new-session") {
				onOpenTerminal?.(result.terminalId, placement);
			}
			toast.info(
				t({
					id: "workspace.shipControl.agentCreatingPr",
					message: "Agent is creating the pull request…",
				}),
				{
					description:
						result.mode === "terminal"
							? t({
									id: "workspace.shipControl.agentSentTo",
									message: `Sent to ${label}`,
								})
							: t({
									id: "workspace.shipControl.agentStartedNewSession",
									message: `Started ${label} in a new terminal`,
								}),
				},
			);
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
		onOpenTerminal,
		placement,
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

	const onPrCreatedRef = useRef(onPrCreated);
	onPrCreatedRef.current = onPrCreated;
	const refreshRef = useRef(refreshMutation);
	refreshRef.current = refreshMutation;
	const lastRefreshAtRef = useRef(0);
	// Why the last link refresh failed (GitHub rate limit, offline…): a
	// finished agent with no link is then "unconfirmed", not "no PR".
	const lastRefreshErrorRef = useRef<unknown>(null);
	const requestRefresh = useCallback(
		(force: boolean) => {
			const now = Date.now();
			if (!force && now - lastRefreshAtRef.current < PR_REFRESH_MS) return;
			if (refreshRef.current.isPending) return;
			lastRefreshAtRef.current = now;
			refreshRef.current
				.mutateAsync({ workspaceIds: [workspaceId] })
				.then(() => {
					lastRefreshErrorRef.current = null;
				})
				.catch((error) => {
					lastRefreshErrorRef.current = error;
					console.warn("[create-pr-with-agent] PR link refresh failed", error);
				});
		},
		[workspaceId],
	);

	const openPr = useCallback(
		(number: number) => {
			if (projectId == null) return;
			usePullRequestsSplitViewStore.getState().expandDetail();
			void navigate({
				to: "/pull-requests/$prNumber",
				params: { prNumber: String(number) },
				search: { project: projectId },
			});
		},
		[navigate, projectId],
	);

	// The binding tells us when the agent attached, stopped, failed, or died.
	const targetBinding = status
		? (bindings.get(status.terminalId) ?? null)
		: null;
	useEffect(() => {
		if (!status || !targetBinding) return;
		setSeenBinding(true);
		if (targetBinding.lastEventType !== "Stop") return;
		const at = targetBinding.lastEventAt;
		if (at <= status.dispatchedAfter) return;
		setStopsSeen((seen) => (seen.includes(at) ? seen : [...seen, at]));
	}, [status, targetBinding]);

	const terminalOutcome = useMemo<TerminalOutcome>(() => {
		if (!status || !targetBinding) return { kind: "none" };
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

	// When the agent stops, read its screen for the PR URL it reported.
	const stoppedAt =
		terminalOutcome.kind === "stopped" ? terminalOutcome.at : null;
	useEffect(() => {
		if (stoppedAt === null || !status) return;
		let cancelled = false;
		trpcUtils.terminal.snapshot
			.fetch({
				workspaceId,
				terminalId: status.terminalId,
				maxLines: SNAPSHOT_LINES,
			})
			.then((snapshot) => {
				if (cancelled) return;
				const number = findReportedPrNumber(snapshot.text);
				if (number !== null) setReportedPrNumber(number);
			})
			.catch((error) => {
				console.warn("[create-pr-with-agent] terminal snapshot failed", error);
			});
		return () => {
			cancelled = true;
		};
	}, [stoppedAt, status, trpcUtils, workspaceId]);
	// Success: the PR link appeared, or the agent's screen shows the PR it
	// opened. The latter is what makes the flow reliable when the link sync
	// is failing.
	const createdPrNumber = waiting
		? (prQuery.data?.number ?? reportedPrNumber)
		: null;
	useEffect(() => {
		if (createdPrNumber === null) return;
		setStatus(null);
		onPrCreatedRef.current();
		// Nudge the link sync so the control's PR badge follows as soon as
		// GitHub lets it — harmless when the link is already there.
		requestRefresh(true);
		// `String(...)` keeps the placeholder positional ({0}) so this shares
		// the manual flow's catalog entry instead of forking it.
		toast.success(
			t({
				id: "workspace.shipControl.prCreated",
				message: `PR #${String(createdPrNumber)} created`,
			}),
			{
				action: {
					label: t({
						id: "workspace.shipControl.openPrToastAction",
						message: "Open",
					}),
					onClick: () => openPr(createdPrNumber),
				},
			},
		);
	}, [createdPrNumber, openPr, requestRefresh, t]);

	// The agent's hook reported a failed turn.
	const failedAt =
		terminalOutcome.kind === "failed" ? terminalOutcome.at : null;
	useEffect(() => {
		if (failedAt === null) return;
		setStatus(null);
		toast.error(
			t({
				id: "workspace.shipControl.agentFailed",
				message: "The agent couldn't create the pull request",
			}),
			{
				description: t({
					id: "workspace.shipControl.agentFinishedNoPrHint",
					message: "Check what it reported, or create the PR manually",
				}),
			},
		);
	}, [failedAt, t]);

	// A terminal whose binding vanished after we saw it died under the agent.
	const targetGone =
		status !== null &&
		seenBinding &&
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

	// A fresh launch that never attaches didn't start.
	const attachPending = status?.fresh === true && !seenBinding;
	useEffect(() => {
		if (!attachPending || !status) return;
		const timer = window.setTimeout(
			() => {
				setStatus(null);
				toast.error(
					t({
						id: "workspace.shipControl.agentDidNotStart",
						message: "The agent didn't start",
					}),
					{
						description: t({
							id: "workspace.shipControl.agentDidNotStartHint",
							message: "Check its terminal for the launch error",
						}),
					},
				);
			},
			Math.max(0, status.startedAt + ATTACH_TIMEOUT_MS - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [attachPending, status, t]);

	// The agent said it's done: force a GitHub re-sync, then give the link
	// (and the snapshot) a short grace window before reporting a miss.
	useEffect(() => {
		if (stoppedAt === null) return;
		requestRefresh(true);
		const timer = window.setTimeout(() => {
			setStatus(null);
			const refreshError = lastRefreshErrorRef.current;
			if (refreshError !== null) {
				// The agent may well have opened it; we just couldn't ask
				// GitHub. Say that rather than blaming the agent.
				toast.warning(
					t({
						id: "workspace.shipControl.agentFinishedUnconfirmed",
						message:
							"The agent finished, but the pull request couldn't be confirmed",
					}),
					{
						description: t({
							id: "workspace.shipControl.agentFinishedUnconfirmedHint",
							message: `GitHub sync failed: ${errorMessage(refreshError)}. Check the agent's report; the PR may already exist`,
						}),
					},
				);
				return;
			}
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
	}, [stoppedAt, requestRefresh, t]);

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
	};
}
