import { describe, expect, it } from "bun:test";
import { buildRestackCommand } from "./buildRestackCommand";

describe("buildRestackCommand", () => {
	it("hands a native stack to gh, which already rebased the remote", () => {
		expect(
			buildRestackCommand({
				source: "github",
				trunk: "main",
				mergedHeadOid: "abc123",
			}),
		).toBe("gh stack sync");
	});

	it("replays an inferred chain onto the fresh trunk from the merged head", () => {
		expect(
			buildRestackCommand({
				source: "inferred",
				trunk: "main",
				mergedHeadOid: "abc123",
			}),
		).toBe("git fetch origin main && git rebase --onto origin/main abc123");
	});

	it("quotes a trunk name the shell would otherwise split", () => {
		expect(
			buildRestackCommand({
				source: "inferred",
				trunk: "release/2026 q3",
				mergedHeadOid: "abc123",
			}),
		).toBe(
			"git fetch origin 'release/2026 q3' && git rebase --onto 'origin/release/2026 q3' abc123",
		);
	});
});
