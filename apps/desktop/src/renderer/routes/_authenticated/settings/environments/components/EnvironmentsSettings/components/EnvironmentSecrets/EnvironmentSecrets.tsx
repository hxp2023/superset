import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useCallback, useState } from "react";
import { HiOutlineArrowLeft } from "react-icons/hi2";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { AddProxyCredentialSheet } from "./components/AddProxyCredentialSheet";
import { AddSecretSheet } from "./components/AddSecretSheet";
import { EditSecretDialog } from "./components/EditSecretDialog";
import { EnvironmentVariablesList } from "./components/EnvironmentVariablesList";
import { ProxyCredentialsList } from "./components/ProxyCredentialsList";

interface EnvironmentSecretsProps {
	environmentId: string;
	onBack: () => void;
}

interface EditingSecret {
	id: string;
	key: string;
	value: string;
	sensitive: boolean;
}

export function EnvironmentSecrets({
	environmentId,
	onBack,
}: EnvironmentSecretsProps) {
	const [isAddOpen, setIsAddOpen] = useState(false);
	const [isAddProxyOpen, setIsAddProxyOpen] = useState(false);
	const [editing, setEditing] = useState<EditingSecret | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const { data: environment } = cloudTrpc.environment.get.useQuery({
		id: environmentId,
	});

	const reload = useCallback(() => setReloadKey((key) => key + 1), []);

	return (
		<div className="p-6 max-w-4xl w-full">
			<div className="mb-8 flex items-center gap-3">
				<Button
					className="h-8 w-8 shrink-0"
					onClick={onBack}
					size="icon"
					variant="ghost"
				>
					<HiOutlineArrowLeft className="h-4 w-4" />
				</Button>
				<div className="min-w-0">
					{/* Always exactly one line of text: an empty heading has no line
					    box at all, so the header grew when the name resolved. A
					    non-breaking space is the same height as the name. */}
					<h2 className="text-xl font-semibold truncate">
						{environment?.name ?? "\u00A0"}
					</h2>
					<p className="text-sm text-muted-foreground mt-1">
						<Trans id="settings.environments.detailDescription">
							What every sandbox started from this environment carries.
						</Trans>
					</p>
				</div>
			</div>

			<h3 className="text-base font-semibold mb-4">
				<Trans id="settings.environments.variables.title">Variables</Trans>
			</h3>
			<EnvironmentVariablesList
				environmentId={environmentId}
				onAdd={() => setIsAddOpen(true)}
				refreshToken={reloadKey}
				onEdit={(secret) =>
					setEditing({
						id: secret.id,
						key: secret.key,
						value: secret.value,
						sensitive: secret.sensitive,
					})
				}
			/>

			<div className="mt-10">
				<div className="mb-4">
					<h3 className="text-base font-semibold">
						<Trans id="settings.environments.proxy.title">
							Proxy credentials
						</Trans>
					</h3>
					<p className="text-sm text-muted-foreground mt-1 max-w-prose">
						<Trans id="settings.environments.proxy.description">
							Keys the sandbox can use but never read. The edge injects each one
							into requests to the hosts you name; inside the sandbox the tool
							only sees a placeholder.
						</Trans>
					</p>
					{environment?.sourceKind === "fork" && (
						<p className="text-sm text-muted-foreground mt-2 max-w-prose">
							<Trans id="settings.environments.proxy.forkNote">
								This environment starts from a fork, which cannot carry the
								proxy yet. These apply once it starts from an image.
							</Trans>
						</p>
					)}
				</div>
				<ProxyCredentialsList
					addDisabled={environment?.sourceKind === "fork"}
					environmentId={environmentId}
					onAdd={() => setIsAddProxyOpen(true)}
				/>
			</div>

			<AddSecretSheet
				environmentId={environmentId}
				onOpenChange={setIsAddOpen}
				onSaved={reload}
				open={isAddOpen}
			/>

			<AddProxyCredentialSheet
				environmentId={environmentId}
				onOpenChange={setIsAddProxyOpen}
				open={isAddProxyOpen}
			/>

			{editing && (
				<EditSecretDialog
					environmentId={environmentId}
					onOpenChange={(open) => {
						if (!open) setEditing(null);
					}}
					onSaved={reload}
					open={Boolean(editing)}
					secret={editing}
				/>
			)}
		</div>
	);
}
