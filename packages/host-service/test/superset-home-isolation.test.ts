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
	it("points SUPERSET_HOME_DIR somewhere other than the real home", () => {
		const isolated = process.env.SUPERSET_HOME_DIR;
		expect(isolated).toBeTruthy();
		expect(resolve(isolated as string)).not.toBe(
			resolve(join(homedir(), ".superset")),
		);
	});

	it("resolves the account pointer dir inside the isolated home", async () => {
		const { syncDefaultAccountPointer } = await import(
			"../src/trpc/router/usage/default-account.ts"
		);
		syncDefaultAccountPointer("codex", null);
		const { existsSync } = await import("node:fs");
		expect(
			existsSync(
				join(
					process.env.SUPERSET_HOME_DIR as string,
					"state",
					"default-codex-home",
				),
			),
		).toBe(true);
	});
});
