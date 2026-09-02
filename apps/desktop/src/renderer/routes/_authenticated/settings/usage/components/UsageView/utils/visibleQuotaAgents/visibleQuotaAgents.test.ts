import { describe, expect, it } from "bun:test";
import { visibleQuotaAgents } from "./visibleQuotaAgents";

describe("visibleQuotaAgents", () => {
	it("keeps the managed agents when the host has no logins at all", () => {
		expect(visibleQuotaAgents([])).toEqual(["claude", "codex"]);
	});

	it("keeps Claude Code beside a lone Codex login so Add account stays reachable", () => {
		expect(visibleQuotaAgents([{ agent: "codex" }])).toEqual([
			"claude",
			"codex",
		]);
	});

	it("shows Grok and Antigravity only once they have a login", () => {
		expect(visibleQuotaAgents([{ agent: "agy" }, { agent: "claude" }])).toEqual(
			["claude", "codex", "agy"],
		);
	});
});
