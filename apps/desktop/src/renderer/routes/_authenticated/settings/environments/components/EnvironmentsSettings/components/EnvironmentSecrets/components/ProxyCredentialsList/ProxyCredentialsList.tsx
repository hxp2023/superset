import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useCallback, useEffect, useState } from "react";
import { HiOutlinePlus } from "react-icons/hi2";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import {
	type ProxyCredential,
	ProxyCredentialRow,
} from "./components/ProxyCredentialRow";

interface ProxyCredentialsListProps {
	environmentId: string;
	/** Bumped by the parent after a save; refetches without remounting. */
	refreshToken?: number;
	onAdd: () => void;
}

export function ProxyCredentialsList({
	environmentId,
	refreshToken,
	onAdd,
}: ProxyCredentialsListProps) {
	const [credentials, setCredentials] = useState<ProxyCredential[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const fetchCredentials = useCallback(async () => {
		try {
			const result =
				await apiTrpcClient.environment.proxyCredentials.list.query({
					environmentId,
				});
			setCredentials(result);
		} catch (err) {
			console.error("[proxy-credentials/fetch] Failed to fetch:", err);
		} finally {
			setIsLoading(false);
		}
	}, [environmentId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a trigger, not an input
	useEffect(() => {
		fetchCredentials();
	}, [fetchCredentials, refreshToken]);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-end">
				<Button size="sm" onClick={onAdd}>
					<HiOutlinePlus className="h-4 w-4 mr-1.5" />
					<Trans id="settings.environments.proxy.add">
						Add Proxy Credential
					</Trans>
				</Button>
			</div>

			{isLoading ? null : credentials.length === 0 ? (
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
							onDeleted={fetchCredentials}
						/>
					))}
				</div>
			)}
		</div>
	);
}
