import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { Input } from "@superset/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { ListFilter, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import {
	DEFAULT_FILE_EXPLORER_EXCLUDES,
	type FileExplorerFilter,
} from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";

interface FilesTabFilterBarProps {
	query: string;
	onQueryChange: (next: string) => void;
}

function isFilterActive(filter: FileExplorerFilter): boolean {
	const presetSet = new Set<string>(DEFAULT_FILE_EXPLORER_EXCLUDES);
	const currentSet = new Set(filter.excludeNames);
	if (filter.hideGitignored) return true;
	if (currentSet.size !== presetSet.size) return true;
	for (const name of presetSet) if (!currentSet.has(name)) return true;
	return false;
}

export function FilesTabFilterBar({
	query,
	onQueryChange,
}: FilesTabFilterBarProps) {
	const { preferences, setFileExplorerFilter } = useV2UserPreferences();
	const filter = preferences.fileExplorerFilter;
	const [customDraft, setCustomDraft] = useState("");

	const presetExcludes = useMemo(
		() => [...DEFAULT_FILE_EXPLORER_EXCLUDES] as string[],
		[],
	);
	const customExcludes = useMemo(
		() => filter.excludeNames.filter((n) => !presetExcludes.includes(n)),
		[filter.excludeNames, presetExcludes],
	);

	const filterActive = isFilterActive(filter);

	function togglePreset(name: string, checked: boolean) {
		setFileExplorerFilter((prev) => {
			const set = new Set(prev.excludeNames);
			if (checked) set.add(name);
			else set.delete(name);
			return { ...prev, excludeNames: [...set] };
		});
	}

	function removeCustom(name: string) {
		setFileExplorerFilter((prev) => ({
			...prev,
			excludeNames: prev.excludeNames.filter((n) => n !== name),
		}));
	}

	function addCustom() {
		const trimmed = customDraft.trim();
		if (!trimmed) return;
		setFileExplorerFilter((prev) => {
			if (prev.excludeNames.includes(trimmed)) return prev;
			return { ...prev, excludeNames: [...prev.excludeNames, trimmed] };
		});
		setCustomDraft("");
	}

	function resetToDefaults() {
		setFileExplorerFilter({
			excludeNames: [...DEFAULT_FILE_EXPLORER_EXCLUDES],
			hideGitignored: false,
		});
	}

	return (
		<div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1.5">
			<div className="relative flex-1">
				<Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					placeholder="Search files"
					className="h-7 pl-6 pr-6 text-xs"
					spellCheck={false}
				/>
				{query && (
					<button
						type="button"
						onClick={() => onQueryChange("")}
						className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
						aria-label="Clear search"
					>
						<X className="size-3" />
					</button>
				)}
			</div>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="relative size-7 shrink-0"
								aria-label="Filter files"
							>
								<ListFilter className="size-3.5" />
								{filterActive && (
									<span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
								)}
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom">Filter</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="w-64">
					<DropdownMenuLabel>Hide</DropdownMenuLabel>
					{presetExcludes.map((name) => (
						<DropdownMenuCheckboxItem
							key={name}
							checked={filter.excludeNames.includes(name)}
							onCheckedChange={(checked) =>
								togglePreset(name, Boolean(checked))
							}
							onSelect={(e) => e.preventDefault()}
						>
							<span className="font-mono text-xs">{name}</span>
						</DropdownMenuCheckboxItem>
					))}
					{customExcludes.length > 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-xs text-muted-foreground">
								Custom
							</DropdownMenuLabel>
							{customExcludes.map((name) => (
								<div
									key={name}
									className="flex items-center justify-between gap-2 px-2 py-1 text-sm"
								>
									<span className="truncate font-mono text-xs">{name}</span>
									<button
										type="button"
										onClick={() => removeCustom(name)}
										className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
										aria-label={`Remove ${name}`}
									>
										<X className="size-3" />
									</button>
								</div>
							))}
						</>
					)}
					<div className="flex items-center gap-1 px-2 py-1.5">
						<Input
							value={customDraft}
							onChange={(e) => setCustomDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									addCustom();
								}
							}}
							placeholder="Add folder/file name"
							className="h-7 text-xs"
							spellCheck={false}
						/>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 shrink-0"
							onClick={addCustom}
							disabled={!customDraft.trim()}
							aria-label="Add exclude"
						>
							<Plus className="size-3.5" />
						</Button>
					</div>
					<DropdownMenuSeparator />
					<DropdownMenuCheckboxItem
						checked={filter.hideGitignored}
						onCheckedChange={(checked) =>
							setFileExplorerFilter((prev) => ({
								...prev,
								hideGitignored: Boolean(checked),
							}))
						}
						onSelect={(e) => e.preventDefault()}
					>
						Hide gitignored files
					</DropdownMenuCheckboxItem>
					<DropdownMenuSeparator />
					<button
						type="button"
						onClick={resetToDefaults}
						className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						Reset to defaults
					</button>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
