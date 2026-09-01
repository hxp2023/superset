import { describe, expect, test } from "bun:test";
import type { HostProjectsQueryTarget } from "../useHostProjects/useHostProjects.utils";
import {
	type HostTagFolderSetting,
	type HostTagFoldersResult,
	mergeHostTagFolders,
} from "./useHostTagFolders.utils";

const setting = (
	color: string,
	overrides: Partial<HostTagFolderSetting> = {},
): HostTagFolderSetting => ({
	scope: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	tag: "api",
	displayName: null,
	color,
	tabOrder: null,
	...overrides,
});

const result = (
	machineId: string,
	isLocal: boolean,
	settings: HostTagFolderSetting[],
): HostTagFoldersResult => ({
	target: {
		machineId,
		organizationId: "org",
		hostUrl: `http://${machineId}`,
		isLocal,
	} satisfies HostProjectsQueryTarget,
	status: "ready",
	settings,
});

describe("mergeHostTagFolders", () => {
	test("deduplicates replicas and prefers the local host regardless of input order", () => {
		const remote = result("remote", false, [setting("#ff0000")]);
		const local = result("local", true, [setting("#0000ff")]);
		expect(mergeHostTagFolders([remote, local])).toEqual([setting("#0000ff")]);
		expect(mergeHostTagFolders([local, remote])).toEqual([setting("#0000ff")]);
	});

	test("uses stable host identity ordering when no local replica exists", () => {
		const alpha = result("alpha", false, [setting("#111111")]);
		const zeta = result("zeta", false, [setting("#999999")]);
		expect(mergeHostTagFolders([zeta, alpha])).toEqual([setting("#111111")]);
	});

	test("treats local nulls as explicit resets instead of filling from a stale replica", () => {
		const remote = result("remote", false, [
			setting("#ff0000", { displayName: "Remote label" }),
		]);
		const local = result("local", true, [
			setting("#0000ff", { displayName: "Local label", color: null }),
		]);
		expect(mergeHostTagFolders([remote, local])).toEqual([
			setting("#0000ff", { displayName: "Local label", color: null }),
		]);
	});

	test("preserves independent tags and scopes", () => {
		const rows = mergeHostTagFolders([
			result("local", true, [
				setting("#111111"),
				setting("#222222", { tag: "web" }),
				setting("#333333", { scope: "sessions" }),
			]),
		]);
		expect(rows).toHaveLength(3);
	});
});
