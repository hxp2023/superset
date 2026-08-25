import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { useEffect, useRef, useState } from "react";
import { LuLoaderCircle } from "react-icons/lu";

interface PullRequestCommentComposerProps {
	/** Short description of what the comment is anchored to ("Line 42"),
	 *  shown in the composer header. */
	contextLabel: string;
	placeholder?: string;
	submitLabel?: string;
	onCancel: () => void;
	onSubmit: (body: string) => void | Promise<void>;
}

// A trimmed twin of the v2-workspace DiffPane's AgentCommentComposer shell
// (same popover chrome, esc-to-dismiss, ⌘/Ctrl+Enter to submit) minus the
// agent-target picker, since this composer posts a plain GitHub review
// comment instead of an AI prompt.
export function PullRequestCommentComposer({
	contextLabel,
	placeholder = "Leave a comment",
	submitLabel = "Comment",
	onCancel,
	onSubmit,
}: PullRequestCommentComposerProps) {
	const [body, setBody] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const canSubmit = body.trim().length > 0 && !submitting;

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setSubmitting(true);
		try {
			await onSubmit(body.trim());
		} catch (error) {
			// User-facing errors are the caller's responsibility (toasted from
			// the mutation's onError) — just don't let a rejection leak out of
			// this form's synchronous handlers.
			console.error("[PullRequestCommentComposer] submit failed", error);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form
			className="diff-comment mx-3 my-1.5 overflow-hidden rounded-lg border border-border/80 bg-popover font-sans text-popover-foreground shadow-[0_4px_16px_-4px_rgba(0,0,0,0.12),0_2px_4px_-2px_rgba(0,0,0,0.06)]"
			onSubmit={(e) => {
				e.preventDefault();
				void handleSubmit();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					onCancel();
				}
				if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
					e.preventDefault();
					void handleSubmit();
				}
			}}
		>
			<div className="flex items-center justify-between px-3 pt-2 pb-1">
				<span className="min-w-0 truncate text-[11px] font-medium tracking-tight text-muted-foreground">
					{contextLabel}
				</span>
				<span className="text-[10px] tracking-tight text-muted-foreground/70">
					esc to dismiss
				</span>
			</div>
			<div className="px-3 pb-2">
				<textarea
					ref={textareaRef}
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder={placeholder}
					rows={3}
					className={cn(
						"block w-full resize-none bg-transparent text-[13px] leading-snug text-foreground",
						"placeholder:text-muted-foreground/60",
						"focus:outline-none focus-visible:outline-none",
					)}
				/>
			</div>
			<div className="flex items-center justify-end gap-1 border-t border-border/60 bg-muted/30 px-2.5 py-1.5">
				<Button
					type="button"
					size="xs"
					variant="ghost"
					onClick={onCancel}
					disabled={submitting}
					className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
				>
					Cancel
				</Button>
				<Button
					type="submit"
					size="xs"
					disabled={!canSubmit}
					className="h-7 gap-1.5 px-2.5 text-[11px] font-medium disabled:opacity-40"
				>
					{submitting && <LuLoaderCircle className="size-3 animate-spin" />}
					<span>{submitting ? "Sending…" : submitLabel}</span>
				</Button>
			</div>
		</form>
	);
}
