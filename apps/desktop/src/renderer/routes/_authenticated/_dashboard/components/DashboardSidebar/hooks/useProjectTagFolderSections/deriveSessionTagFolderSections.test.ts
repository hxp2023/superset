import { describe, expect, test } from "bun:test";
import { SESSIONS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import { deriveSessionTagFolderSections } from "./deriveSessionTagFolderSections";

describe("deriveSessionTagFolderSections", () => {
	test("uses the host display name and colour while keeping the tag as id", () => {
		expect(
			deriveSessionTagFolderSections(
				[
					{ id: "session", projectId: null, tags: [" Perf "] },
					{ id: "project", projectId: "project-id", tags: ["ignored"] },
				],
				{
					tagSettings: [
						{
							projectId: SESSIONS_TAG_SCOPE,
							tag: "perf",
							displayName: "Performance",
							color: "#3b82f6",
						},
					],
					hiddenTagsByProject: new Map(),
				},
			),
		).toEqual([{ id: "perf", name: "Performance", color: "#3b82f6" }]);
	});

	test("falls back to normalized tag defaults and ignores other scopes", () => {
		expect(
			deriveSessionTagFolderSections(
				[
					{ id: "b", projectId: null, tags: ["Zeta"] },
					{ id: "a", projectId: null, tags: ["alpha"] },
				],
				{
					tagSettings: [
						{
							projectId: "00000000-0000-4000-8000-000000000000",
							tag: "alpha",
							displayName: "Wrong scope",
							color: "#ff0000",
						},
					],
					hiddenTagsByProject: new Map(),
				},
			),
		).toEqual([
			{ id: "alpha", name: "alpha", color: null },
			{ id: "zeta", name: "zeta", color: null },
		]);
	});
});
