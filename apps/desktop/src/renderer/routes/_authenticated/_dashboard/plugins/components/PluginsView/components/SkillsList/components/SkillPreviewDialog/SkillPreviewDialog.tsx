import { Badge } from "@superset/ui/badge";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Spinner } from "@superset/ui/spinner";
import { Switch } from "@superset/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { XIcon } from "lucide-react";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SkillIcon } from "renderer/routes/_authenticated/_dashboard/plugins/components/SkillIcon";
import { useSkillMutations } from "../../hooks/useSkillMutations";

interface SkillPreviewDialogProps {
	skill: { name: string; description: string } | null;
	onClose: () => void;
}

export function SkillPreviewDialog({
	skill,
	onClose,
}: SkillPreviewDialogProps) {
	const { data, isLoading } = electronTrpc.plugins.getSkillContent.useQuery(
		{ name: skill?.name ?? "" },
		{ enabled: skill !== null },
	);
	const { disabledSkills, setEnabled, isBusy } = useSkillMutations();
	const isEnabled = skill !== null && !disabledSkills.has(skill.name);

	return (
		<Dialog open={skill !== null} onOpenChange={(open) => !open && onClose()}>
			{/* Fixed height so every skill opens the same-size modal; content
			    scrolls. bg-card lifts it off the page background; the sm:
			    variant is needed to beat the dialog's built-in sm:max-w-lg. */}
			<DialogContent
				showCloseButton={false}
				// Without this, Radix auto-focuses the Switch on open (it's the
				// first focusable element in the header row), which also opens
				// its tooltip via :focus even though the user never hovered it.
				onOpenAutoFocus={(event) => event.preventDefault()}
				className="flex h-[80vh] max-w-4xl flex-col bg-card sm:max-w-4xl"
			>
				<div className="flex items-start justify-between gap-3">
					<DialogHeader className="flex-1">
						<DialogTitle className="flex items-center gap-2">
							{skill !== null && (
								<SkillIcon skillName={skill.name} className="size-7" />
							)}
							{skill?.name}
							<Badge
								variant="outline"
								className="h-4 rounded px-1 text-[9px] font-medium tracking-wide text-muted-foreground uppercase"
							>
								Skill
							</Badge>
							<Badge variant="secondary">Managed</Badge>
						</DialogTitle>
						<DialogDescription>{skill?.description}</DialogDescription>
					</DialogHeader>
					<div className="flex shrink-0 items-center gap-3">
						{skill !== null && (
							<Tooltip delayDuration={700}>
								{/* The Switch has its own data-state (checked/unchecked) that
								    its styling depends on; asChild directly on it would let
								    Radix's Slot overwrite that with the tooltip's own
								    data-state, so the trigger target is this inert span instead. */}
								<TooltipTrigger asChild>
									<span className="inline-flex">
										<Switch
											checked={isEnabled}
											disabled={isBusy}
											aria-label={`${skill.name} enabled`}
											onCheckedChange={(checked) =>
												setEnabled(skill.name, checked)
											}
										/>
									</span>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{isEnabled ? "Disable skill" : "Enable skill"}
								</TooltipContent>
							</Tooltip>
						)}
						<DialogClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
							<XIcon />
							<span className="sr-only">Close</span>
						</DialogClose>
					</div>
				</div>
				{/* zoom scales the whole markdown type ramp down without fighting
				    the renderer's own rem-based stylesheet. */}
				<div className="min-h-0 flex-1 overflow-y-auto [zoom:0.85]">
					{isLoading ? (
						<div className="flex justify-center py-8">
							<Spinner className="size-5" />
						</div>
					) : data?.content ? (
						<MarkdownRenderer content={data.content} />
					) : (
						<p className="text-sm text-muted-foreground">
							Could not load this skill's content.
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
