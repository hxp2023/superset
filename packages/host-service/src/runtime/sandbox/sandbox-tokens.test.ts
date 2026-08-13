import { afterEach, describe, expect, test } from "bun:test";
import {
	dropHookToken,
	getOrCreateHookToken,
	resetHookTokensForTests,
	verifyHookToken,
} from "./sandbox-tokens.ts";

describe("sandbox hook tokens", () => {
	afterEach(() => {
		resetHookTokensForTests();
	});

	test("stable per workspace and distinct across workspaces", () => {
		const a = getOrCreateHookToken("ws-a");
		expect(getOrCreateHookToken("ws-a")).toBe(a);
		expect(getOrCreateHookToken("ws-b")).not.toBe(a);
	});

	test("verification is tolerant of absence, strict on mismatch", () => {
		// No token registered (host workspace): everything passes.
		expect(verifyHookToken("ws-none", undefined)).toBe(true);
		expect(verifyHookToken("ws-none", "whatever")).toBe(true);

		const token = getOrCreateHookToken("ws-a");
		// Token-less request from a pre-update notify script passes.
		expect(verifyHookToken("ws-a", undefined)).toBe(true);
		expect(verifyHookToken("ws-a", token)).toBe(true);
		expect(verifyHookToken("ws-a", "wrong")).toBe(false);
		expect(verifyHookToken("ws-a", `${token}x`)).toBe(false);
	});

	test("dropped tokens stop constraining verification", () => {
		getOrCreateHookToken("ws-a");
		dropHookToken("ws-a");
		expect(verifyHookToken("ws-a", "anything")).toBe(true);
	});
});
