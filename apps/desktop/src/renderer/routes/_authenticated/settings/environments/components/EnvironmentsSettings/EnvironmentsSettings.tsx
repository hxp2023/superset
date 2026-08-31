import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Skeleton } from "@superset/ui/skeleton";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import { HiOutlineCube, HiOutlinePlus } from "react-icons/hi2";
import { useActiveOrganizationId } from "renderer/hooks/useActiveOrganizationId";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { EnvironmentSecrets } from "./components/EnvironmentSecrets";

export function EnvironmentsSettings() {
	const { t } = useLingui();
	const organizationId = useActiveOrganizationId();
	const utils = cloudTrpc.useUtils();
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [sourceKind, setSourceKind] = useState<"image" | "fork">("image");
	const [sourceRef, setSourceRef] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const { data: environments, isPending } = cloudTrpc.environment.list.useQuery(
		{ organizationId: organizationId ?? "" },
		{ enabled: Boolean(organizationId) },
	);

	const create = cloudTrpc.environment.create.useMutation({
		onSuccess: async () => {
			await utils.environment.list.invalidate();
			setShowCreate(false);
			setName("");
			setSourceRef("");
			toast.success(
				t({
					id: "settings.environments.created",
					message: "Environment created",
				}),
			);
		},
		onError: (error) => toast.error(errorMessage(error)),
	});

	const archive = cloudTrpc.environment.archive.useMutation({
		onSuccess: async () => {
			await utils.environment.list.invalidate();
			setSelectedId(null);
		},
		onError: (error) => toast.error(errorMessage(error)),
	});

	if (selectedId) {
		return (
			<EnvironmentSecrets
				environmentId={selectedId}
				onBack={() => setSelectedId(null)}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="font-medium text-lg">
						<Trans id="settings.environments.title">Environments</Trans>
					</h2>
					<p className="max-w-prose text-muted-foreground text-sm">
						<Trans id="settings.environments.description">
							The starting point a cloud workspace boots from — a base image, or
							a sandbox you configured and want to fork.
						</Trans>
					</p>
				</div>
				<Button onClick={() => setShowCreate(true)} size="sm">
					<HiOutlinePlus className="size-4" />
					<Trans id="settings.environments.new">New environment</Trans>
				</Button>
			</div>

			{isPending ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			) : environments && environments.length > 0 ? (
				<div className="flex flex-col divide-y rounded-md border">
					{environments.map((environment) => (
						<div
							className="flex items-center justify-between gap-4 p-3"
							key={environment.id}
						>
							<button
								className="flex min-w-0 flex-1 items-center gap-3 text-left"
								onClick={() => setSelectedId(environment.id)}
								type="button"
							>
								<HiOutlineCube className="size-4 shrink-0 text-muted-foreground" />
								<span className="flex min-w-0 flex-col">
									<span className="truncate font-medium text-sm">
										{environment.name}
									</span>
									<span className="truncate font-mono text-muted-foreground text-xs">
										{environment.sourceKind} · {environment.sourceRef}
									</span>
								</span>
							</button>
							<Button
								onClick={() => archive.mutate({ id: environment.id })}
								size="sm"
								variant="ghost"
							>
								<Trans id="settings.environments.archive">Archive</Trans>
							</Button>
						</div>
					))}
				</div>
			) : (
				<p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
					<Trans id="settings.environments.empty">
						No environments yet. Create one to start a cloud workspace from it.
					</Trans>
				</p>
			)}

			<Dialog onOpenChange={setShowCreate} open={showCreate}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							<Trans id="settings.environments.createTitle">
								New environment
							</Trans>
						</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="environment-name">
								<Trans id="settings.environments.nameLabel">Name</Trans>
							</Label>
							<Input
								id="environment-name"
								onChange={(event) => setName(event.target.value)}
								placeholder={t({
									id: "settings.environments.namePlaceholder",
									message: "monorepo-warm",
								})}
								value={name}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="environment-kind">
								<Trans id="settings.environments.kindLabel">Source</Trans>
							</Label>
							<Select
								onValueChange={(value) =>
									setSourceKind(value as "image" | "fork")
								}
								value={sourceKind}
							>
								<SelectTrigger id="environment-kind">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="image">
										<Trans id="settings.environments.kindImage">
											Image — build a sandbox from a container image
										</Trans>
									</SelectItem>
									<SelectItem value="fork">
										<Trans id="settings.environments.kindFork">
											Fork — copy a sandbox you already configured
										</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="environment-ref">
								{sourceKind === "image" ? (
									<Trans id="settings.environments.refImage">
										Image reference
									</Trans>
								) : (
									<Trans id="settings.environments.refFork">
										Sandbox to fork
									</Trans>
								)}
							</Label>
							<Input
								className="font-mono"
								id="environment-ref"
								onChange={(event) => setSourceRef(event.target.value)}
								placeholder={
									sourceKind === "image"
										? "superset-hostsvc:hoockx6bbvtx"
										: "ws-golden-monorepo"
								}
								value={sourceRef}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button onClick={() => setShowCreate(false)} variant="outline">
							<Trans id="settings.environments.cancel">Cancel</Trans>
						</Button>
						<Button
							disabled={!name.trim() || !sourceRef.trim() || !organizationId}
							onClick={() => {
								if (!organizationId) return;
								create.mutate({
									organizationId,
									name: name.trim(),
									sourceKind,
									sourceRef: sourceRef.trim(),
								});
							}}
						>
							<Trans id="settings.environments.create">Create</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
