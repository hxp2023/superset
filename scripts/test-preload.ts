/**
 * Test preload: give every test run its own Superset home.
 *
 * Production code resolves `~/.superset` from `SUPERSET_HOME_DIR` (see
 * agent-setup's resolveSupersetHomeDir and the mirror in the usage router's
 * default-account.ts). A test that calls such code with the variable unset
 * writes to the developer's REAL home. That is not hypothetical: the default
 * agent-account tests wrote `$TMPDIR` into the live
 * `~/.superset/state/default-codex-home` pointer, which every Superset
 * terminal and agent launch then injected as `CODEX_HOME`, so Codex ran
 * signed out with none of its session history and re-logins landed in a
 * directory macOS periodically purges.
 *
 * Setting it here — before any test module loads — makes that whole class of
 * accident impossible rather than something each test file has to remember.
 *
 * The override is unconditional, and that is the point. Every Superset
 * terminal exports `SUPERSET_HOME_DIR=~/.superset`, and that is where the
 * team runs `bun test`, so the variable is not merely unset-and-forgotten —
 * it arrives already aimed at the real home. A `??=` default would be a
 * no-op in exactly the environment that needs it. Tests wanting a specific
 * home still set one in their own `beforeEach`, which runs after this.
 *
 * Loaded from the root bunfig.toml and re-entered by each package preload
 * that has one; `test/superset-home-isolation.test.ts` fails loudly if a run
 * ever loses it.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SUPERSET_HOME_DIR = mkdtempSync(
	join(tmpdir(), "superset-test-home-"),
);
