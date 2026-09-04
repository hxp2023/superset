import { useLingui } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import type { IconType } from "react-icons";
import { LuCircleAlert, LuCircleCheck, LuGitMerge } from "react-icons/lu";
import type { StackReadiness } from "../../types";

const EMERALD = "text-emerald-600 [.dark_&]:text-[#34d399]";

interface StackReadinessLineProps {
	readiness: StackReadiness;
	className?: string;
}

/**
 * The stack's verdict in one sentence. Stacks land bottom-up, so the useful
 * number is how far up the merge button reaches, not how many layers are
 * green.
 */
export function StackReadinessLine({
	readiness,
	className,
}: StackReadinessLineProps) {
	const { t } = useLingui();
	let Icon: IconType;
	let tone: string;
	let text: string;
	switch (readiness.kind) {
		case "landed": {
			Icon = LuGitMerge;
			tone = "text-violet-600 [.dark_&]:text-[#b0a6d9]";
			text = t({
				message: "Every layer has landed",
			});
			break;
		}
		case "all-ready": {
			Icon = LuCircleCheck;
			tone = EMERALD;
			text = t({
				message: "Every layer is ready to land",
			});
			break;
		}
		case "ready-through": {
			const number = readiness.number;
			Icon = LuCircleCheck;
			tone = EMERALD;
			text = t({
				message: `Ready to land through #${number}`,
			});
			break;
		}
		case "blocked": {
			const number = readiness.number;
			Icon = LuCircleAlert;
			tone = "text-amber-600 [.dark_&]:text-[#fbbf24]";
			text = t({
				message: `Blocked at #${number}`,
			});
			break;
		}
	}
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-1 text-[10px] font-medium",
				tone,
				className,
			)}
		>
			<Icon className="size-3.5 shrink-0" aria-hidden="true" />
			<span className="truncate" title={text}>
				{text}
			</span>
		</div>
	);
}
