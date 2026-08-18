import type { PullRequestStateFilter } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsFilterStore";
import type { PullRequestReviewFilter } from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/pullRequestReviewFilter";
import { PullRequestSearchBar } from "./components/PullRequestSearchBar";
import { PullRequestStateChips } from "./components/PullRequestStateChips";

interface PullRequestsTopBarProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	projectFilters: string[];
	onProjectFiltersChange: (projectIds: string[]) => void;
	authorFilter: string | null;
	onAuthorFilterChange: (author: string | null) => void;
	reviewFilter: PullRequestReviewFilter | null;
	onReviewFilterChange: (review: PullRequestReviewFilter | null) => void;
	stateFilter: PullRequestStateFilter;
	onStateFilterChange: (state: PullRequestStateFilter) => void;
}

export function PullRequestsTopBar({
	searchQuery,
	onSearchChange,
	projectFilters,
	onProjectFiltersChange,
	authorFilter,
	onAuthorFilterChange,
	reviewFilter,
	onReviewFilterChange,
	stateFilter,
	onStateFilterChange,
}: PullRequestsTopBarProps) {
	return (
		<div
			data-pull-requests-toolbar
			className="shrink-0 border-b border-border px-4 py-2"
		>
			<div className="flex flex-col gap-2">
				<PullRequestStateChips
					value={stateFilter}
					onChange={onStateFilterChange}
				/>
				<PullRequestSearchBar
					searchQuery={searchQuery}
					onSearchChange={onSearchChange}
					projectFilters={projectFilters}
					onProjectFiltersChange={onProjectFiltersChange}
					authorFilter={authorFilter}
					onAuthorFilterChange={onAuthorFilterChange}
					reviewFilter={reviewFilter}
					onReviewFilterChange={onReviewFilterChange}
				/>
			</div>
		</div>
	);
}
