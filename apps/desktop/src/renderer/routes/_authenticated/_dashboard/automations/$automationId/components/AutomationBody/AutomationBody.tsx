import { Trans, useLingui } from "@lingui/react/macro";
import type { SelectAutomationRun } from "@superset/db/schema";
import { errorMessage } from "@superset/i18n/errors";
import type { DraftTrigger } from "@superset/shared/automation-triggers";
import type { RouterOutputs } from "@superset/trpc";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { cn } from "@superset/ui/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { EmojiTextInput } from "renderer/components/EmojiTextInput";
import { MarkdownEditor } from "renderer/components/MarkdownEditor";
import { useHostUrl } from "renderer/hooks/host-service/useHostTargetUrl";
import { useV2AgentChoices } from "renderer/hooks/useV2AgentChoices";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { useWorkspaceHostOptions } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/components/DevicePicker/hooks/useWorkspaceHostOptions/useWorkspaceHostOptions";
import { AgentPicker } from "../../../components/AgentPicker";
import { useTriggerDrafts } from "../../../components/TriggersEditor/hooks/useTriggerDrafts";
import { useProjectFileSearch } from "../../../hooks/useProjectFileSearch";
import { matchAgentChoice } from "../../../utils/agentIdentity";
import { PreviousRunsList } from "../PreviousRunsList";
import {
	type AutomationUpdatePatch,
	type ScopeDraft,
	TriggersCard,
} from "../TriggersCard";

type DetailTab = "settings" | "runs";

export function AutomationBody({
	automation,
	recentRuns,
	ownerName,
	readOnly,
	onToggleEnabled,
	toggleDisabled,
}: {
	/** `get` output plus the prompt body, which rides its own procedure. */
	automation: RouterOutputs["automation"]["get"] & { prompt: string };
	recentRuns: SelectAutomationRun[];
	ownerName?: string | null;
	readOnly?: boolean;
	onToggleEnabled: (enabled: boolean) => void;
	toggleDisabled?: boolean;
}) {
	const { t } = useLingui();
	const [tab, setTab] = useState<DetailTab>("settings");
	const [prompt, setPrompt] = useState(automation.prompt);
	const lastSyncedPromptRef = useRef(automation.prompt);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (automation.prompt !== lastSyncedPromptRef.current) {
			lastSyncedPromptRef.current = automation.prompt;
			setPrompt(automation.prompt);
		}
	}, [automation.prompt]);

	// One save state for the page.
	//
	// The scope chips, the title and the agent used to write the moment they
	// changed while the trigger set waited for a Save — two habits on one page,
	// and the trigger set is the one that cannot autosave (a half-built row is
	// invalid by construction). So everything edited here is a draft now, and
	// one Save commits them together in a single patch. The Active switch is
	// deliberately excluded: it is the kill switch, and a pause that waits for
	// a second click is a pause that did not happen.
	const savedSettings = useMemo(
		() => ({
			name: automation.name,
			v2ProjectId: automation.v2ProjectId,
			targetHostId: automation.targetHostId,
			v2WorkspaceId: automation.v2WorkspaceId,
			tags: automation.tags,
			agent: automation.agent,
		}),
		[
			automation.name,
			automation.v2ProjectId,
			automation.targetHostId,
			automation.v2WorkspaceId,
			automation.tags,
			automation.agent,
		],
	);
	const [settings, setSettings] = useState(savedSettings);
	const [settingsDirty, setSettingsDirty] = useState(false);
	// Adopt what the server has whenever it moves under us, unless there are
	// edits here — those were never sent, so nothing upstream can supersede them.
	const savedKey = JSON.stringify(savedSettings);
	const [prevSavedKey, setPrevSavedKey] = useState(savedKey);
	if (savedKey !== prevSavedKey) {
		setPrevSavedKey(savedKey);
		if (!settingsDirty) setSettings(savedSettings);
	}
	const editSettings = (patch: Partial<typeof savedSettings>) => {
		setSettings((current) => ({ ...current, ...patch }));
		setSettingsDirty(true);
	};

	const updateMutation = useMutation({
		mutationFn: (patch: AutomationUpdatePatch) =>
			apiTrpcClient.automation.update.mutate({ id: automation.id, ...patch }),
		// Only the trigger set gets a confirmation. Every other patch shows its
		// own result — the picker relabels, the toggle flips — but a saved
		// trigger set looks exactly like the unsaved one it replaced.
		onSuccess: (_result, patch) => {
			if (patch.triggers)
				toast.success(
					t({
						id: "dashboard.automations.body.triggersSavedToast",
						message: "Triggers saved",
					}),
				);
		},
		// The pickers re-render from the Electric-synced row, so a rejected
		// update silently snaps back without this.
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({
						id: "dashboard.automations.body.updateFailedToast",
						message: "Failed to update automation",
					}),
				),
			),
	});

	const [savedAt, setSavedAt] = useState(0);
	// The trigger set's own rules still apply — it is the part that can be
	// invalid — so the page saves through the same hook, which validates first
	// and only clears its dirty state once the write actually lands.
	const commit = useCallback(
		async (triggers: DraftTrigger[]) => {
			await updateMutation.mutateAsync({ ...settings, triggers });
			setSettingsDirty(false);
			setSavedAt(Date.now());
		},
		[updateMutation, settings],
	);

	const {
		drafts,
		dirty: triggersDirty,
		saving,
		shownProblems,
		banner,
		edit: editTriggers,
		save,
		discard: discardTriggers,
	} = useTriggerDrafts(
		useMemo(
			() =>
				automation.triggers.map((trigger) => ({
					id: trigger.id,
					config: trigger.config as DraftTrigger["config"],
				})),
			[automation.triggers],
		),
		commit,
	);

	const dirty = triggersDirty || settingsDirty;
	const discard = () => {
		discardTriggers();
		setSettings(savedSettings);
		setSettingsDirty(false);
	};

	const setPromptMutation = useMutation({
		mutationFn: (next: string) =>
			apiTrpcClient.automation.setPrompt.mutate({
				id: automation.id,
				prompt: next,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["automation-versions", automation.id],
			});
		},
		onError: (error) =>
			toast.error(
				errorMessage(
					error,
					t({
						id: "dashboard.automations.body.promptUpdateFailedToast",
						message: "Failed to update prompt",
					}),
				),
			),
	});

	const searchFiles = useProjectFileSearch({
		hostId: automation.targetHostId ?? null,
		projectId: automation.v2ProjectId,
	});

	const { localHostId } = useWorkspaceHostOptions();
	const hostId = automation.targetHostId ?? localHostId ?? null;
	const hostUrl = useHostUrl(hostId);
	const { agents: hostAgents, isFetched: hostAgentsFetched } =
		useV2AgentChoices(hostUrl);
	// Only warn once the host's terminal configs have loaded — the Superset
	// chat entry is flag-gated, so list length alone can't tell "not loaded
	// yet / host unreachable" apart from "agent missing".
	const agentMissing =
		hostAgentsFetched &&
		hostAgents.length > 0 &&
		!matchAgentChoice(hostAgents, automation.agent);

	return (
		<div className="flex-1 overflow-y-auto px-12 py-8">
			{/* Full width, not a centered max-w column: a Slack sentence is wider
			    than 3xl and would wrap onto a second line, shifting the rows below
			    every time one renders. */}
			<div className="flex w-full flex-col">
				<EmojiTextInput
					value={settings.name}
					// Into the draft on every keystroke, not on blur: the draft is what
					// Save commits, and a blur that races the click on Save would drop
					// the rename silently.
					onChange={(next) => editSettings({ name: next })}
					editable={!readOnly}
					onBlur={(next) => {
						if (readOnly) return;
						// Trim on the way out; an empty title falls back to the saved one
						// rather than saving a nameless automation.
						editSettings({ name: next.trim() || automation.name });
					}}
					placeholder={t({
						id: "dashboard.automations.body.titlePlaceholder",
						message: "Automation title",
					})}
					className="mb-3 text-2xl font-semibold"
				/>
				<div className="flex items-center gap-2 text-sm">
					<Switch
						checked={automation.enabled}
						onCheckedChange={onToggleEnabled}
						disabled={readOnly || toggleDisabled}
						aria-label={
							automation.enabled
								? t({
										id: "dashboard.automations.body.pauseAriaLabel",
										message: "Pause automation",
									})
								: t({
										id: "dashboard.automations.body.resumeAriaLabel",
										message: "Resume automation",
									})
						}
					/>
					<span className="text-muted-foreground">
						{automation.enabled ? (
							<Trans id="dashboard.automations.body.statusActive">Active</Trans>
						) : (
							<Trans id="dashboard.automations.body.statusPaused">Paused</Trans>
						)}
					</span>
					{ownerName && (
						<>
							<span className="text-border">|</span>
							<span className="text-muted-foreground">{ownerName}</span>
						</>
					)}

					{/* The page's one save. Up here rather than on the Triggers row
					    because it now commits the title, the scope and the agent too —
					    and because a Save that sits above the rows cannot drift down
					    the page as triggers are added, taking the reason it was
					    refused with it. */}
					{banner && (
						<p className="flex min-w-0 items-center gap-1.5 text-[13px] text-amber-600 dark:text-amber-400">
							<LuTriangleAlert className="size-3.5 shrink-0" />
							<span className="truncate">{banner}</span>
						</p>
					)}
					{dirty && !readOnly && (
						<div className="ml-auto flex shrink-0 items-center gap-1.5">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={discard}
								disabled={saving}
								className="h-7 text-[13px]"
							>
								<Trans id="dashboard.automations.body.discard">Discard</Trans>
							</Button>
							<Button
								type="button"
								size="sm"
								onClick={save}
								disabled={saving}
								className="h-7 text-[13px]"
							>
								{saving ? (
									<Trans id="dashboard.automations.body.saving">
										Saving...
									</Trans>
								) : (
									<Trans id="dashboard.automations.body.save">Save</Trans>
								)}
							</Button>
						</div>
					)}
				</div>
				{readOnly && (
					<p className="select-text cursor-text mt-2 text-xs text-muted-foreground">
						<Trans id="dashboard.automations.body.ownedByNotice">
							Owned by{" "}
							{ownerName ??
								t({
									id: "dashboard.automations.body.teammateFallback",
									message: "a teammate",
								})}{" "}
							— only they can edit this automation.
						</Trans>
					</p>
				)}

				<div className="mt-6 mb-6 flex items-center gap-1">
					{(
						[
							{
								value: "settings",
								label: t({
									id: "dashboard.automations.body.tabSettings",
									message: "Settings",
								}),
							},
							{
								value: "runs",
								label: t({
									id: "dashboard.automations.body.tabRunHistory",
									message: "Run History",
								}),
							},
						] as const
					).map((tabOption) => (
						<button
							key={tabOption.value}
							type="button"
							onClick={() => setTab(tabOption.value)}
							className={cn(
								"rounded-md px-3 py-1.5 text-sm transition-colors",
								tab === tabOption.value
									? "bg-accent font-medium text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{tabOption.label}
						</button>
					))}
				</div>

				{tab === "settings" ? (
					<fieldset disabled={readOnly} className="contents">
						<TriggersCard
							automation={automation}
							hostId={hostId}
							readOnly={readOnly}
							scope={{
								v2ProjectId: settings.v2ProjectId,
								targetHostId: settings.targetHostId,
								v2WorkspaceId: settings.v2WorkspaceId,
								tags: settings.tags,
							}}
							onScopeChange={(patch: Partial<ScopeDraft>) =>
								editSettings(patch)
							}
							drafts={drafts}
							onEditTriggers={editTriggers}
							problems={shownProblems}
							savedAt={savedAt}
						/>

						<span className="mt-8 mb-2 text-sm text-muted-foreground">
							<Trans id="dashboard.automations.body.instructions">
								Instructions
							</Trans>
						</span>
						<div className="flex flex-col rounded-xl border border-border bg-card/40">
							<div className="min-h-[240px] px-4 py-3">
								<MarkdownEditor
									content={prompt}
									onChange={setPrompt}
									editable={!readOnly}
									onSave={(next) => {
										if (readOnly) return;
										if (next !== automation.prompt) {
											setPromptMutation.mutate(next);
										}
									}}
									placeholder={t({
										id: "dashboard.automations.body.promptPlaceholder",
										message: "Add prompt e.g. look for crashes in $sentry",
									})}
									searchFiles={searchFiles}
								/>
							</div>
							<div className="flex items-center px-2.5 pb-2.5">
								<AgentPicker
									hostId={hostId}
									disabled={readOnly}
									value={settings.agent}
									onChange={(id) => {
										// The picker is scoped to `hostId` and emits a preset slug
										// when unambiguous, falling back to the instance UUID. If
										// the automation was previously auto-routed (targetHostId
										// null), pin it to the host this value came from so a
										// UUID-shaped agent can't be dispatched to a host that's
										// never seen it.
										const patch: AutomationUpdatePatch = { agent: id };
										if (!settings.targetHostId && hostId) {
											patch.targetHostId = hostId;
										}
										editSettings(patch);
									}}
								/>
							</div>
						</div>
						{agentMissing && (
							<p className="select-text cursor-text mt-2 text-xs text-amber-600 dark:text-amber-500">
								<Trans id="dashboard.automations.body.agentMissingWarning">
									This agent no longer exists on the selected device (its agents
									may have been reset). Runs will fail until you pick a new one.
								</Trans>
							</p>
						)}
					</fieldset>
				) : (
					<PreviousRunsList runs={recentRuns} />
				)}
			</div>
		</div>
	);
}
