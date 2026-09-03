import { Trans, useLingui } from "@lingui/react/macro";
import { PROXY_SECRET_TOKEN } from "@superset/shared/environment-proxy-credentials";
import { Avatar } from "@superset/ui/atoms/Avatar";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { format } from "date-fns";
import { useCallback, useState } from "react";
import { HiEllipsisHorizontal, HiOutlineShieldCheck } from "react-icons/hi2";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";

export interface ProxyCredential {
	id: string;
	provider: "anthropic" | "openai" | "custom";
	name: string;
	placeholderEnv: string;
	destinations: string[];
	header: string;
	valueTemplate: string;
	createdAt: Date;
	updatedAt: Date;
	createdBy: { id: string; name: string; image: string | null } | null;
}

const PROVIDER_LABELS: Record<ProxyCredential["provider"], string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	custom: "Custom",
};

interface ProxyCredentialRowProps {
	environmentId: string;
	credential: ProxyCredential;
	onDeleted: () => void;
}

export function ProxyCredentialRow({
	environmentId,
	credential,
	onDeleted,
}: ProxyCredentialRowProps) {
	const { t } = useLingui();
	const [isDeleting, setIsDeleting] = useState(false);

	const handleDelete = useCallback(async () => {
		if (
			!confirm(
				t({
					id: "settings.environments.proxy.deleteConfirm",
					message: `Delete proxy credential "${credential.name}"?`,
				}),
			)
		)
			return;
		setIsDeleting(true);
		try {
			await apiTrpcClient.environment.proxyCredentials.remove.mutate({
				environmentId,
				id: credential.id,
			});
			onDeleted();
		} catch (err) {
			console.error("[proxy-credentials/delete] Failed to delete:", err);
			toast.error(
				err instanceof Error
					? err.message
					: t({
							id: "settings.environments.proxy.deleteFailed",
							message: "Failed to delete proxy credential",
						}),
			);
		} finally {
			setIsDeleting(false);
		}
	}, [credential.id, credential.name, environmentId, onDeleted, t]);

	const injected = credential.valueTemplate.replace(
		PROXY_SECRET_TOKEN,
		"••••••••",
	);

	return (
		<div
			className={cn(
				"flex items-center px-4 py-4 border-b last:border-b-0 group hover:bg-accent/30 transition-colors",
				isDeleting && "opacity-50 pointer-events-none",
			)}
		>
			<div className="flex items-center justify-center size-9 rounded-full border bg-background shrink-0">
				<HiOutlineShieldCheck className="h-4 w-4 text-muted-foreground" />
			</div>

			<div className="min-w-0 flex-1 basis-0 ml-3">
				<div className="flex items-center gap-2 min-w-0">
					<span className="font-medium text-sm truncate">
						{credential.name}
					</span>
					<span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
						{PROVIDER_LABELS[credential.provider]}
					</span>
				</div>
				<p className="font-mono text-xs text-muted-foreground truncate mt-0.5">
					{credential.placeholderEnv} · {credential.destinations.join(", ")} ·{" "}
					{credential.header}: {injected}
				</p>
			</div>

			<div className="flex items-center justify-end gap-2 flex-1 basis-0 text-xs text-muted-foreground">
				<span>
					<Trans id="settings.environments.proxy.added">Added</Trans>{" "}
					{format(new Date(credential.createdAt), "MMM d")}
				</span>
				{credential.createdBy && (
					<Avatar
						size="xs"
						fullName={credential.createdBy.name}
						image={credential.createdBy.image}
					/>
				)}
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 ml-3">
						<HiEllipsisHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onClick={handleDelete}
						className="text-destructive focus:text-destructive"
					>
						<Trans id="settings.environments.proxy.delete">Delete</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
