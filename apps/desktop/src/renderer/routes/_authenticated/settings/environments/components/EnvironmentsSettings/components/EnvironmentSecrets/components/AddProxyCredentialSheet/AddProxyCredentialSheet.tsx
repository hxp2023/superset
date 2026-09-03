import { Trans, useLingui } from "@lingui/react/macro";
import { SANDBOX_CREDENTIAL_PLACEHOLDER } from "@superset/shared/constants";
import {
	PROXY_CREDENTIAL_PRESETS,
	PROXY_SECRET_TOKEN,
	type ProxyCredentialProvider,
	parseDestinations,
	validateProxyCredential,
} from "@superset/shared/environment-proxy-credentials";
import { validateSecretValue } from "@superset/shared/environment-secrets";
import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@superset/ui/sheet";
import { toast } from "@superset/ui/sonner";
import { useEffect, useState } from "react";
import { cloudTrpc } from "renderer/lib/cloud-trpc";

interface AddProxyCredentialSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	environmentId: string;
}

interface Draft {
	provider: ProxyCredentialProvider;
	name: string;
	value: string;
	placeholderEnv: string;
	destinations: string;
	header: string;
	valueTemplate: string;
}

const PROVIDER_OPTIONS: { value: ProxyCredentialProvider; label: string }[] = [
	{ value: "anthropic", label: "Anthropic" },
	{ value: "openai", label: "OpenAI" },
	{ value: "custom", label: "Custom" },
];

function draftFor(provider: ProxyCredentialProvider): Draft {
	if (provider === "custom") {
		return {
			provider,
			name: "",
			value: "",
			placeholderEnv: "",
			destinations: "",
			header: "Authorization",
			valueTemplate: `Bearer ${PROXY_SECRET_TOKEN}`,
		};
	}
	const preset = PROXY_CREDENTIAL_PRESETS[provider];
	return {
		provider,
		name: preset.name,
		value: "",
		placeholderEnv: preset.placeholderEnv,
		destinations: preset.destinations.join(", "),
		header: preset.header,
		valueTemplate: preset.valueTemplate,
	};
}

function maskedSecret(value: string): string {
	if (!value) return "••••••••";
	return value.length > 8 ? `${value.slice(0, 4)}••••••••` : "••••••••";
}

export function AddProxyCredentialSheet({
	open,
	onOpenChange,
	environmentId,
}: AddProxyCredentialSheetProps) {
	const { t } = useLingui();
	const utils = cloudTrpc.useUtils();
	const [draft, setDraft] = useState<Draft>(() => draftFor("anthropic"));
	const [error, setError] = useState<{ field: string; message: string } | null>(
		null,
	);
	const create = cloudTrpc.environment.proxyCredentials.create.useMutation({
		onSuccess: async (_result, variables) => {
			await utils.environment.proxyCredentials.list.invalidate();
			toast.success(
				t({
					id: "settings.environments.proxy.saved",
					message: `Added ${variables.name}`,
				}),
			);
			onOpenChange(false);
		},
		onError: (err) => {
			console.error("[proxy-credentials/create] Failed to save:", err);
			toast.error(
				err.message ||
					t({
						id: "settings.environments.proxy.saveFailed",
						message: "Failed to save proxy credential",
					}),
			);
		},
	});

	useEffect(() => {
		if (open) {
			setDraft(draftFor("anthropic"));
			setError(null);
		}
	}, [open]);

	const isCustom = draft.provider === "custom";
	const hasContent =
		draft.value.trim() !== "" || (isCustom && draft.name.trim());

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && hasContent) {
			alert({
				title: t({
					id: "settings.environments.proxy.discardTitle",
					message: "Discard unsaved changes?",
				}),
				description: t({
					id: "settings.environments.proxy.discardDescription",
					message:
						"This proxy credential has not been saved. Are you sure you want to close?",
				}),
				actions: [
					{
						label: t({
							id: "settings.environments.proxy.cancel",
							message: "Cancel",
						}),
						variant: "outline",
						onClick: () => {},
					},
					{
						label: t({
							id: "settings.environments.proxy.discard",
							message: "Discard",
						}),
						variant: "destructive",
						onClick: () => onOpenChange(false),
					},
				],
			});
			return;
		}
		onOpenChange(nextOpen);
	};

	const update = (field: keyof Draft, value: string) => {
		if (error?.field === field) setError(null);
		setDraft((prev) => ({ ...prev, [field]: value }));
	};

	const handleSave = () => {
		const rule = {
			name: draft.name.trim(),
			placeholderEnv: draft.placeholderEnv.trim(),
			destinations: parseDestinations(draft.destinations),
			header: draft.header.trim(),
			valueTemplate: draft.valueTemplate.trim(),
		};
		const check = validateProxyCredential(rule);
		if (!check.valid) {
			setError({ field: check.field, message: check.error });
			return;
		}
		const value = validateSecretValue(draft.value.trim());
		if (!value.valid) {
			setError({ field: "value", message: value.error });
			return;
		}
		create.mutate({
			environmentId,
			provider: draft.provider,
			value: draft.value.trim(),
			...rule,
		});
	};

	const firstHost = parseDestinations(draft.destinations)[0] ?? "the host";
	const placeholderEnv = draft.placeholderEnv.trim() || "THE_ENV_VAR";
	const injectedValue = draft.valueTemplate.replace(
		PROXY_SECRET_TOKEN,
		maskedSecret(draft.value.trim()),
	);

	const fieldError = (field: string) =>
		error?.field === field ? (
			<p className="text-xs text-destructive">{error.message}</p>
		) : null;

	return (
		<Sheet open={open} onOpenChange={handleOpenChange}>
			<SheetContent className="sm:max-w-xl w-full flex flex-col gap-0 p-0">
				<SheetHeader className="p-6 pb-4">
					<SheetTitle>
						<Trans id="settings.environments.proxy.sheetTitle">
							Add Proxy Credential
						</Trans>
					</SheetTitle>
					<SheetDescription>
						<Trans id="settings.environments.proxy.sheetDescription">
							Injected at the edge into requests to the hosts below. The sandbox
							only sees a placeholder, so an agent can use the key but never
							read it.
						</Trans>
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto">
					<div className="px-6 space-y-5">
						<div className="space-y-1.5">
							<Label>
								<Trans id="settings.environments.proxy.provider">
									Provider
								</Trans>
							</Label>
							<Select
								value={draft.provider}
								onValueChange={(value) => {
									setError(null);
									setDraft(draftFor(value as ProxyCredentialProvider));
								}}
							>
								<SelectTrigger className="w-[220px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PROVIDER_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<Label>
								<Trans id="settings.environments.proxy.name">Name</Trans>
							</Label>
							<Input
								value={draft.name}
								disabled={!isCustom}
								onChange={(e) => update("name", e.target.value)}
								placeholder={t({
									id: "settings.environments.proxy.namePlaceholder",
									message: "Stripe secret key",
								})}
							/>
							{fieldError("name")}
						</div>

						<div className="space-y-1.5">
							<Label>
								<Trans id="settings.environments.proxy.secret">Secret</Trans>
							</Label>
							<Input
								type="password"
								autoComplete="off"
								value={draft.value}
								onChange={(e) => update("value", e.target.value)}
								className="font-mono text-sm"
								placeholder={
									draft.provider === "anthropic"
										? "sk-ant-…"
										: draft.provider === "openai"
											? "sk-proj-…"
											: ""
								}
							/>
							{fieldError("value")}
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-1.5">
								<Label>
									<Trans id="settings.environments.proxy.destinations">
										Hosts
									</Trans>
								</Label>
								<Input
									value={draft.destinations}
									disabled={!isCustom}
									onChange={(e) => update("destinations", e.target.value)}
									className="font-mono text-sm"
									placeholder="api.stripe.com, *.example.com"
								/>
								{fieldError("destinations")}
							</div>
							<div className="space-y-1.5">
								<Label>
									<Trans id="settings.environments.proxy.header">Header</Trans>
								</Label>
								<Input
									value={draft.header}
									disabled={!isCustom}
									onChange={(e) => update("header", e.target.value)}
									className="font-mono text-sm"
								/>
								{fieldError("header")}
							</div>
							<div className="space-y-1.5">
								<Label>
									<Trans id="settings.environments.proxy.template">
										Header value
									</Trans>
								</Label>
								<Input
									value={draft.valueTemplate}
									disabled={!isCustom}
									onChange={(e) => update("valueTemplate", e.target.value)}
									className="font-mono text-sm"
								/>
								{fieldError("valueTemplate")}
							</div>
							<div className="space-y-1.5">
								<Label>
									<Trans id="settings.environments.proxy.placeholderEnv">
										Variable the tool reads
									</Trans>
								</Label>
								<Input
									value={draft.placeholderEnv}
									disabled={!isCustom}
									onChange={(e) => update("placeholderEnv", e.target.value)}
									className="font-mono text-sm"
									placeholder="STRIPE_SECRET_KEY"
								/>
								{fieldError("placeholderEnv")}
							</div>
						</div>

						<div className="rounded-md border bg-muted/30 px-4 py-3 space-y-2">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
								<Trans id="settings.environments.proxy.howTitle">
									How it works
								</Trans>
							</p>
							<ol className="space-y-1.5 text-xs text-muted-foreground list-decimal pl-4">
								<li>
									<Trans id="settings.environments.proxy.howStep1">
										Inside the sandbox the tool reads
									</Trans>{" "}
									<code className="font-mono text-foreground">
										{placeholderEnv}={SANDBOX_CREDENTIAL_PLACEHOLDER}
									</code>
								</li>
								<li>
									<Trans id="settings.environments.proxy.howStep2">
										A request to
									</Trans>{" "}
									<code className="font-mono text-foreground">{firstHost}</code>{" "}
									<Trans id="settings.environments.proxy.howStep2b">
										leaves the sandbox with that placeholder in
									</Trans>{" "}
									<code className="font-mono text-foreground">
										{draft.header}
									</code>
								</li>
								<li>
									<Trans id="settings.environments.proxy.howStep3">
										At the edge the header becomes
									</Trans>{" "}
									<code className="font-mono text-foreground">
										{draft.header}: {injectedValue}
									</code>{" "}
									<Trans id="settings.environments.proxy.howStep3b">
										and the real value never enters the sandbox.
									</Trans>
								</li>
							</ol>
						</div>
					</div>
				</div>

				<div className="flex items-center justify-end border-t px-6 py-4">
					<Button
						onClick={handleSave}
						disabled={create.isPending || !draft.value.trim()}
					>
						{create.isPending ? (
							<Trans id="settings.environments.proxy.saving">Saving...</Trans>
						) : (
							<Trans id="settings.environments.proxy.save">Save</Trans>
						)}
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
