import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { HiOutlinePlus } from "react-icons/hi2";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { ProxyCredentialRow } from "./components/ProxyCredentialRow";

interface ProxyCredentialsListProps {
	environmentId: string;
	onAdd: () => void;
	/** A fork cannot carry the proxy, so nothing new can be added to one. */
	addDisabled?: boolean;
}

export function ProxyCredentialsList({
	environmentId,
	onAdd,
	addDisabled,
}: ProxyCredentialsListProps) {
	const {
		data: credentials,
		isPending,
		isError,
		refetch,
	} = cloudTrpc.environment.proxyCredentials.list.useQuery({ environmentId });

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-end">
				<Button size="sm" onClick={onAdd} disabled={addDisabled}>
					<HiOutlinePlus className="h-4 w-4 mr-1.5" />
					<Trans id="settings.environments.proxy.add">
						Add Proxy Credential
					</Trans>
				</Button>
			</div>

			{isPending ? null : isError ? (
				<div className="text-sm text-muted-foreground px-4 py-4 text-center border rounded-md">
					<span className="flex h-9 items-center justify-center gap-3">
						<Trans id="settings.environments.proxy.loadFailed">
							Could not load proxy credentials
						</Trans>
						<Button size="sm" variant="outline" onClick={() => refetch()}>
							<Trans id="settings.environments.proxy.retry">Try again</Trans>
						</Button>
					</span>
				</div>
			) : !credentials || credentials.length === 0 ? (
				<div className="text-sm text-muted-foreground px-4 py-4 text-center border rounded-md">
					<span className="flex h-9 items-center justify-center">
						<Trans id="settings.environments.proxy.empty">
							No proxy credentials yet
						</Trans>
					</span>
				</div>
			) : (
				<div className="border rounded-md">
					{credentials.map((credential) => (
						<ProxyCredentialRow
							credential={credential}
							environmentId={environmentId}
							key={credential.id}
						/>
					))}
				</div>
			)}
		</div>
	);
}
