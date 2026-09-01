import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Canary for scripts/test-preload.ts. This file deliberately sets nothing up:
 * if the preload is dropped from a bunfig, or a run loads this package's tests
 * without it, these fail instead of the suite quietly writing the developer's
 * real ~/.superset — which is how the default agent-account pointers got
 * clobbered before (see scripts/test-preload.ts).
 */
describe("Superset home isolation", () => {
	function requireIsolatedHome(): string {
		const isolated = process.env.SUPERSET_HOME_DIR;
		if (
			!isolated ||
			resolve(isolated) === resolve(join(homedir(), ".superset"))
		) {
			throw new Error("SUPERSET_HOME_DIR is not isolated for tests");
		}
		return isolated;
	}

	it("points SUPERSET_HOME_DIR somewhere other than the real home", () => {
		expect(requireIsolatedHome()).toBeTruthy();
	});

	it("resolves the account pointer dir inside the isolated home", async () => {
		// Validate before importing or calling the pointer writer. If the preload
		// disappears, this canary must fail without reproducing the real-home
		// clobber it exists to prevent.
		const isolated = requireIsolatedHome();
		const { syncDefaultAccountPointer } = await import(
			"../src/trpc/router/usage/default-account.ts"
		);
		syncDefaultAccountPointer("codex", null);
		const { existsSync } = await import("node:fs");
		expect(existsSync(join(isolated, "state", "default-codex-home"))).toBe(
			true,
		);
	});
});
