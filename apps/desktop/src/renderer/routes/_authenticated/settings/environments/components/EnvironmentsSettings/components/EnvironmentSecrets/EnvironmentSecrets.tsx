import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Skeleton } from "@superset/ui/skeleton";
import { toast } from "@superset/ui/sonner";
import { Textarea } from "@superset/ui/textarea";
import { useState } from "react";
import {
	HiOutlineArrowLeft,
	HiOutlineLockClosed,
	HiOutlineTrash,
} from "react-icons/hi2";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { parseEnvFile } from "../../../../utils/env-file";

interface EnvironmentSecretsProps {
	environmentId: string;
	onBack: () => void;
}

export function EnvironmentSecrets({
	environmentId,
	onBack,
}: EnvironmentSecretsProps) {
	const { t } = useLingui();
	const utils = cloudTrpc.useUtils();
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [pasted, setPasted] = useState("");

	const { data: environment } = cloudTrpc.environment.get.useQuery({
		id: environmentId,
	});
	const { data: secrets, isPending } =
		cloudTrpc.environment.secrets.list.useQuery({ environmentId });

	const invalidate = async () => {
		await utils.environment.secrets.list.invalidate({ environmentId });
	};

	const setSecret = cloudTrpc.environment.secrets.set.useMutation({
		onSuccess: invalidate,
		onError: (error) => toast.error(errorMessage(error)),
	});
	const removeSecret = cloudTrpc.environment.secrets.remove.useMutation({
		onSuccess: invalidate,
		onError: (error) => toast.error(errorMessage(error)),
	});

	const importPasted = async () => {
		const entries = parseEnvFile(pasted);
		if (entries.length === 0) return;
		let added = 0;
		const skipped: string[] = [];
		for (const entry of entries) {
			try {
				await setSecret.mutateAsync({
					environmentId,
					key: entry.key,
					value: entry.value,
				});
				added += 1;
			} catch {
				skipped.push(entry.key);
			}
		}
		setPasted("");
		toast.success(
			t({
				id: "settings.environments.imported",
				message: `Added ${added} variables`,
			}),
		);
		if (skipped.length > 0) {
			toast.warning(
				t({
					id: "settings.environments.importSkipped",
					message: `Skipped reserved or invalid keys: ${skipped.join(", ")}`,
				}),
			);
		}
	};

	return (
		<div className="p-6 max-w-4xl w-full">
			<div className="mb-8 flex items-start gap-3">
				<Button
					className="h-8 w-8 shrink-0"
					onClick={onBack}
					size="icon"
					variant="ghost"
				>
					<HiOutlineArrowLeft className="h-4 w-4" />
				</Button>
				<div className="min-w-0">
					<h2 className="text-xl font-semibold truncate">
						{environment?.name}
					</h2>
					<p className="text-sm text-muted-foreground mt-1">
						<Trans id="settings.environments.secretsDescription">
							Variables set on every sandbox started from this environment.
							Names Superset uses itself are rejected, so nothing here can
							change a workspace's identity.
						</Trans>
					</p>
				</div>
			</div>

			{isPending ? (
				<div className="divide-y divide-border">
					<div className="py-3">
						<Skeleton className="h-5 w-full" />
					</div>
					<div className="py-3">
						<Skeleton className="h-5 w-full" />
					</div>
				</div>
			) : secrets && secrets.length > 0 ? (
				<div className="divide-y divide-border">
					{secrets.map((secret) => (
						<div
							className="group flex items-center justify-between gap-4 py-3"
							key={secret.id}
						>
							<div className="flex items-center gap-3 min-w-0">
								<HiOutlineLockClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
								<div className="text-sm font-mono truncate">{secret.key}</div>
							</div>
							<Button
								className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
								onClick={() =>
									removeSecret.mutate({ environmentId, key: secret.key })
								}
								size="icon"
								variant="ghost"
							>
								<HiOutlineTrash className="h-4 w-4" />
							</Button>
						</div>
					))}
				</div>
			) : (
				<div className="text-center py-12 text-sm text-muted-foreground">
					<Trans id="settings.environments.noSecrets">No variables yet.</Trans>
				</div>
			)}

			<div className="mt-8 flex items-end gap-2">
				<div className="flex flex-1 flex-col gap-2">
					<Label htmlFor="secret-key">
						<Trans id="settings.environments.keyLabel">Name</Trans>
					</Label>
					<Input
						className="font-mono"
						id="secret-key"
						onChange={(event) => setKey(event.target.value)}
						placeholder="DATABASE_URL"
						value={key}
					/>
				</div>
				<div className="flex flex-1 flex-col gap-2">
					<Label htmlFor="secret-value">
						<Trans id="settings.environments.valueLabel">Value</Trans>
					</Label>
					<Input
						className="font-mono"
						id="secret-value"
						onChange={(event) => setValue(event.target.value)}
						type="password"
						value={value}
					/>
				</div>
				<Button
					disabled={!key.trim()}
					onClick={() => {
						setSecret.mutate({ environmentId, key: key.trim(), value });
						setKey("");
						setValue("");
					}}
				>
					<Trans id="settings.environments.addSecret">Add</Trans>
				</Button>
			</div>

			<div className="flex flex-col gap-2">
				<Label htmlFor="secret-paste">
					<Trans id="settings.environments.pasteLabel">Paste a .env file</Trans>
				</Label>
				<Textarea
					className="font-mono text-xs"
					id="secret-paste"
					onChange={(event) => setPasted(event.target.value)}
					placeholder={"KEY=value\nOTHER_KEY=value"}
					rows={4}
					value={pasted}
				/>
				<Button
					className="self-start"
					disabled={!pasted.trim()}
					onClick={importPasted}
					variant="outline"
				>
					<Trans id="settings.environments.import">Import</Trans>
				</Button>
			</div>
		</div>
	);
}
