import { describe, expect, it } from "bun:test";
import { describeAgentActivity } from "./describeAgentActivity";

describe("describeAgentActivity", () => {
	it("maps known tools to a verb regardless of case", () => {
		expect(describeAgentActivity({ tool: "Edit", detail: "a.ts" })).toEqual({
			verb: "edit",
			tool: "Edit",
			detail: "a.ts",
		});
		expect(describeAgentActivity({ tool: "bash" }).verb).toBe("run");
		expect(describeAgentActivity({ tool: "WebFetch" }).verb).toBe("fetch");
	});

	it("falls through to the raw tool name for unknown tools", () => {
		expect(describeAgentActivity({ tool: "mcp__linear__get_issue" })).toEqual({
			verb: null,
			tool: "mcp__linear__get_issue",
		});
	});
});
