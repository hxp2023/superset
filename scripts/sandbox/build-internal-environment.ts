/**
 * Builds our internal environment the way a customer builds theirs: fork the
 * published image, configure the fork, promote it.
 *
 *   BLAXEL_API_KEY=… BLAXEL_WORKSPACE=… bun run scripts/sandbox/build-internal-environment.ts
 *
 * Deliberately not a Dockerfile layer. Promote-to-environment is the product's
 * customization path, and an internal image built some other way is a path we
 * would never exercise. The setup itself lives in `internal-setup.sh` so the
 * result stays reproducible even though the artifact is a sandbox rather than
 * an image — a promoted fork is otherwise a pet, recoverable only from memory.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SandboxInstance, settings } from "@blaxel/core";

const IMAGE = process.env.BLAXEL_SANDBOX_IMAGE ?? "superset-hostsvc";
const REGION = process.env.BLAXEL_REGION ?? "us-pdx-1";
const SETUP = join(import.meta.dir, "internal-setup.sh");
const WORKSPACE = process.env.SUPERSET_SANDBOX_WORKSPACE_PATH ?? "/workspace";

settings.setConfig({
	apiKey: process.env.BLAXEL_API_KEY ?? "",
	workspace: process.env.BLAXEL_WORKSPACE ?? "",
});

const stamp = Date.now().toString(36);
const name = process.env.INTERNAL_ENVIRONMENT_NAME ?? `env-internal-${stamp}`;

console.log(`forking ${IMAGE} -> ${name}`);
const sandbox = await SandboxInstance.createIfNotExists({
	name,
	image: IMAGE,
	memory: 8192,
	storageMb: 20480,
	region: REGION,
} as never);
await sandbox.wait?.({ maxWait: 300000, interval: 2000 }).catch(() => {});

// The dev stack needs ~130 variables and an environment's secret store caps at
// 50, so the file goes in directly rather than through the secrets mechanism.
// That mechanism stays what it is for — a customer's per-organization values on
// an environment they don't own.
//
// This bakes real credentials into a sandbox that every internal workspace is
// forked from, so it is deliberately opt-in and deliberately not read from a
// default path: pass the file you mean.
const envFile = process.env.SUPERSET_INTERNAL_ENV_FILE;
if (envFile) {
	if (!existsSync(envFile)) {
		console.error(`SUPERSET_INTERNAL_ENV_FILE not found: ${envFile}`);
		process.exit(1);
	}
	const contents = readFileSync(envFile, "utf8");
	await sandbox.fs.write(`${WORKSPACE}/.env`, contents);
	const count = contents.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).length;
	console.log(`wrote ${WORKSPACE}/.env (${count} variables) — anyone who can`);
	console.log("create a workspace from this environment can read them");
} else {
	console.log("no SUPERSET_INTERNAL_ENV_FILE set; skipping .env");
	console.log("  (bun dev will not start without one)");
}

await sandbox.fs.write("/tmp/internal-setup.sh", readFileSync(SETUP, "utf8"));
console.log("running setup (dependency install takes several minutes)…");
const result = (await sandbox.process.exec({
	name: "internal-setup",
	command: `SUPERSET_SANDBOX_WORKSPACE_PATH=${WORKSPACE} bash /tmp/internal-setup.sh`,
	waitForCompletion: true,
} as never)) as { logs?: string; exitCode?: number };
console.log(result.logs ?? "");

if (result.exitCode) {
	console.error(
		`setup failed (exit ${result.exitCode}); sandbox ${name} left for inspection`,
	);
	process.exit(1);
}

console.log(`\nready: ${name}`);
console.log(
	"Promote it from the workspace UI, or insert an environments row with",
);
console.log(`  source_kind='fork'  source_ref='${name}'`);
