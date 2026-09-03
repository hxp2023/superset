import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
import { formatDate } from "@superset/i18n/format";
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
import { HiEllipsisHorizontal, HiOutlineShieldCheck } from "react-icons/hi2";
import { cloudTrpc } from "renderer/lib/cloud-trpc";

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
}

export function ProxyCredentialRow({
	environmentId,
	credential,
}: ProxyCredentialRowProps) {
	const { t } = useLingui();
	const utils = cloudTrpc.useUtils();
	const remove = cloudTrpc.environment.proxyCredentials.remove.useMutation({
		onSuccess: async () => {
			try {
				await utils.environment.proxyCredentials.list.invalidate();
			} catch (error) {
				console.error("[proxy-credentials/list] Failed to refresh:", error);
			}
		},
		onError: (err) => {
			console.error("[proxy-credentials/delete] Failed to delete:", err);
			toast.error(
				err.message ||
					t({
						id: "settings.environments.proxy.deleteFailed",
						message: "Failed to delete proxy credential",
					}),
			);
		},
	});

	const handleDelete = () => {
		if (
			!confirm(
				i18n._({
					id: "settings.environments.proxy.deleteConfirmNamed",
					message: 'Delete proxy credential "{name}"?',
					values: { name: credential.name },
				}),
			)
		)
			return;
		remove.mutate({ environmentId, id: credential.id });
	};

	const injected = credential.valueTemplate.replaceAll(
		PROXY_SECRET_TOKEN,
		"••••••••",
	);

	return (
		<div
			className={cn(
				"flex items-center px-4 py-4 border-b last:border-b-0 group hover:bg-accent/30 transition-colors",
				remove.isPending && "opacity-50 pointer-events-none",
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
					{formatDate(new Date(credential.createdAt), {
						month: "short",
						day: "numeric",
					})}
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
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 ml-3"
						aria-label={t({
							id: "settings.environments.proxy.actions",
							message: "Proxy credential actions",
						})}
					>
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
