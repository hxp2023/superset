/**
 * Coarse verb for an agent tool name. Tool names are the agent's own
 * (Claude's `Edit`, Grok's `bash`, …); matching is case-insensitive and
 * anything unrecognized falls through as the raw tool name.
 */
export type AgentActivityVerb =
	| "edit"
	| "read"
	| "run"
	| "search"
	| "fetch"
	| "delegate";

const VERB_BY_TOOL: Record<string, AgentActivityVerb> = {
	edit: "edit",
	multiedit: "edit",
	write: "edit",
	notebookedit: "edit",
	apply_patch: "edit",
	read: "read",
	bash: "run",
	shell: "run",
	grep: "search",
	glob: "search",
	ls: "search",
	webfetch: "fetch",
	websearch: "fetch",
	task: "delegate",
	agent: "delegate",
};

export interface AgentActivityDescription {
	/** Recognized verb, or null when the tool name should show as-is. */
	verb: AgentActivityVerb | null;
	tool: string;
	detail?: string;
}

export function describeAgentActivity(activity: {
	tool: string;
	detail?: string;
}): AgentActivityDescription {
	const verb = VERB_BY_TOOL[activity.tool.toLowerCase()] ?? null;
	return {
		verb,
		tool: activity.tool,
		...(activity.detail ? { detail: activity.detail } : {}),
	};
}
