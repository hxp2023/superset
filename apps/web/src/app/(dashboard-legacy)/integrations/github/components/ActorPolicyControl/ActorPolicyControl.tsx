"use client";

import type { GithubActorPolicy } from "@superset/db/schema";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/trpc/react";

const OPTIONS: Array<{
	value: GithubActorPolicy;
	label: string;
	description: string;
}> = [
	{
		value: "bot",
		label: "Superset",
		description: "Always opens PRs as Superset",
	},
	{
		value: "user_or_bot",
		label: "User",
		description:
			"Opens as the user when their Git account is connected, otherwise as Superset",
	},
	{
		value: "user_only",
		label: "User only",
		description:
			"Opens as the user; fails if their Git account isn't connected. Automations and service users fall back to Superset",
	},
];

interface ActorPolicyControlProps {
	organizationId: string;
	value: GithubActorPolicy;
	canEdit: boolean;
}

export function ActorPolicyControl({
	organizationId,
	value,
	canEdit,
}: ActorPolicyControlProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [current, setCurrent] = useState<GithubActorPolicy>(value);

	const updateMutation = useMutation(
		trpc.organization.settings.update.mutationOptions({
			onSuccess: (settings) => {
				setCurrent(settings.githubActorPolicy);
				queryClient.invalidateQueries({
					queryKey: trpc.organization.settings.get.queryKey({ organizationId }),
				});
			},
			onError: (error) => {
				setCurrent(value);
				toast.error(error.message);
			},
		}),
	);

	return (
		<div className="flex flex-col gap-2">
			<Select
				value={current}
				disabled={!canEdit || updateMutation.isPending}
				onValueChange={(next) => {
					const policy = next as GithubActorPolicy;
					setCurrent(policy);
					updateMutation.mutate({ organizationId, githubActorPolicy: policy });
				}}
			>
				<SelectTrigger className="w-full max-w-xs">
					<SelectValue>
						{OPTIONS.find((option) => option.value === current)?.label}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{OPTIONS.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							<div className="flex flex-col items-start gap-0.5">
								<span>{option.label}</span>
								<span className="max-w-sm whitespace-normal text-xs text-muted-foreground">
									{option.description}
								</span>
							</div>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{!canEdit && (
				<p className="text-xs text-muted-foreground">
					Only organization admins can change this.
				</p>
			)}
		</div>
	);
}
