import { Button } from "@superset/ui/button";
import { useEffect, useRef, useState } from "react";
import { LuCheck, LuCopy } from "react-icons/lu";

interface CopyableCommandProps {
	command: string;
}

export function CopyableCommand({ command }: CopyableCommandProps) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		};
	}, []);

	const copy = async () => {
		await navigator.clipboard.writeText(command);
		setCopied(true);
		if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1">
			<code className="min-w-0 flex-1 select-text cursor-text overflow-x-auto whitespace-nowrap font-mono text-xs">
				{command}
			</code>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="size-6 shrink-0"
				onClick={() => void copy()}
				aria-label="Copy command"
			>
				{copied ? (
					<LuCheck className="size-3.5 text-emerald-500" />
				) : (
					<LuCopy className="size-3.5" />
				)}
			</Button>
		</div>
	);
}
