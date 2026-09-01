/**
 * Builds the Blaxel sandbox image that hosts host-service.
 *
 * Deliberately carries no repository. This image is the one every customer
 * gets, and baking our monorepo into it shipped 230 MiB of somebody else's
 * code to all of them — while re-cloning on every build, because the layer sat
 * below a bundle that changes each time. Our own checkout is warmed in the
 * internal environment instead (scripts/sandbox/internal-setup.sh), which is a
 * fork, so it costs the people who benefit from it and nobody else.
 *
 *   BL_API_KEY=... BL_WORKSPACE=superset bun run scripts/sandbox/image.ts
 *   bun run scripts/sandbox/image.ts --dry   # print the Dockerfile only
 *
 * Two constraints keep a compiler out of this image, and both must hold:
 * node-pty's prebuilt binary links glibc, so Alpine's musl would force a
 * source build; and only the node-pty version this repo pins ships prebuilds
 * at all, so installing plain `node-pty` compiles even on Debian. A compile
 * needs build-essential + python3, roughly 315 MiB.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageInstance } from "@blaxel/core";
import {
	SANDBOX_CREDENTIAL_PLACEHOLDER,
	SANDBOX_IMAGE_NAME,
	SANDBOX_WORKSPACE_PATH,
} from "../../packages/shared/src/constants.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const HOST_SERVICE_PKG = join(
	REPO_ROOT,
	"packages",
	"host-service",
	"package.json",
);

/** Blaxel reserves 80, 443 and 8080; host-service's default is 4879. */
const HOST_SERVICE_PORT = 4879;
const IMAGE_NAME = process.env.SANDBOX_IMAGE_NAME ?? SANDBOX_IMAGE_NAME;

/**
 * Read from host-service rather than hardcoded: a sandbox running a
 * different better-sqlite3 than host-service was built against is a
 * native-ABI mismatch that surfaces as a runtime crash.
 */
function pinnedVersion(dep: string): string {
	const pkg = JSON.parse(readFileSync(HOST_SERVICE_PKG, "utf8")) as {
		dependencies?: Record<string, string>;
	};
	const version = pkg.dependencies?.[dep];
	if (!version) {
		throw new Error(
			`${dep} is not a host-service dependency — the sandbox image and host-service must agree on native module versions`,
		);
	}
	return version;
}

/**
 * Bumped by hand, on purpose: an agent CLI is the most user-visible thing in
 * the image, and a silent upgrade mid-fleet is how a working sandbox starts
 * behaving differently for no reason anyone can point at.
 */
/**
 * The repo's own package manager. Pinned for the same reason the agent CLIs
 * are: an unpinned install in a cached layer is a version nobody chose.
 */
const BUN_VERSION = "1.4.0";

const AGENT_CLI_VERSIONS = {
	claudeCode: "2.1.257",
	codex: "0.152.0",
} as const;

const natives = [
	`better-sqlite3@${pinnedVersion("better-sqlite3")}`,
	`node-pty@${pinnedVersion("node-pty")}`,
];

/**
 * Imported at module load but never executed, so they only need to resolve.
 * Mostly mastra's storage stack reached via provider-auth's credential store;
 * trimming that dependency would shrink both this list and the image.
 */
const runtimeResolutionOnly = [
	"@mastra/duckdb",
	"@anush008/tokenizers",
	"onnxruntime-node",
	"libsql",
	"@parcel/watcher",
	"@xterm/headless",
];

const BUNDLE = join(
	REPO_ROOT,
	"packages",
	"host-service",
	"dist",
	"host-service.js",
);

function assertBuilt(): void {
	if (!existsSync(BUNDLE)) {
		throw new Error(
			"packages/host-service/dist/host-service.js is missing — run `bun run --cwd packages/host-service build:host` first",
		);
	}
}

export const sandboxImage = ImageInstance.fromRegistry("node:24-bookworm-slim")
	// git for the workspace checkout, openssh-client for SSH remotes, ca-certificates
	// for HTTPS clones. Deliberately no build-essential/python3 — see the header.
	// `procps` is not padding: without it there is no `ps` or `pgrep`, which an
	// agent reaches for constantly and which this image genuinely lacked.
	// `tzdata`/`locales` keep dates and git's message locale from being wrong
	// rather than missing, and the network trio is what makes a connection
	// failure diagnosable from inside the box instead of a shrug.
	.aptInstall(
		"git",
		"git-lfs",
		"ca-certificates",
		"openssh-client",
		"curl",
		"wget",
		"procps",
		"rsync",
		"zip",
		"unzip",
		"tzdata",
		"locales",
		"less",
		"jq",
		"ripgrep",
		"sqlite3",
		"inotify-tools",
		"dnsutils",
		"iputils-ping",
		"netcat-openbsd",
		"vim",
		// A virtual display and a VNC server, so a sandbox can run and show a GUI
		// program. Capability rather than taste: any customer whose work has a
		// window needs it, and installing it on first use would mean an apt wait
		// the first time someone opens the pane.
		//
		// `xauth` is not optional despite looking like it — `xvfb-run` exits with
		// "xauth command not found" without it, which is how this was found.
		// x11vnc must be started with `-localhost`: the display is full control of
		// the machine, and the only thing that should reach it is host-service's
		// authenticated proxy.
		"xvfb",
		"xauth",
		"x11vnc",
		"openbox",
		// Verified missing the hard way twice: without iproute2 there is no `ss`,
		// and a listener check silently reports nothing rather than failing.
		"iproute2",
	)
	// Installed globally rather than via the install script's $HOME/.bun so it
	// resolves for every user and every non-login shell, which is what a
	// process started by the platform gets.
	.runCommands(
		`npm install -g bun@${BUN_VERSION} --no-audit --no-fund && bun --version`,
	)
	.workdir("/app")
	.runCommands("npm init -y")
	// The bundle is ESM; without this Node parses /app/*.js as CommonJS and
	// dies on the first `import`.
	.runCommands("npm pkg set type=module")
	.runCommands(`npm install ${natives.join(" ")} --no-audit --no-fund`)
	.runCommands(
		`npm install ${runtimeResolutionOnly.join(" ")} --no-audit --no-fund`,
	)
	// Fail the build rather than ship an image whose natives only load because
	// something silently compiled them.
	.runCommands(
		"test -d node_modules/node-pty/prebuilds/linux-x64 || (echo 'node-pty prebuild missing — it would compile at runtime' && exit 1)",
	)
	// The agents the sandbox can actually run. Without a CLI installed the
	// agent picker has nothing to offer, since a sandbox has none of the
	// user's locally-installed agents. Both read their key from the
	// environment, which is how the sandbox is handed credentials.
	// Pinned deliberately. Unpinned, this layer caches: a warm builder ships
	// whatever version it first resolved, months old and invisible, and a cold
	// one makes two builds a day apart differ. That is the same class of drift
	// as a stale host-service, and the reason this image exists as code.
	.runCommands(
		`npm install -g @anthropic-ai/claude-code@${AGENT_CLI_VERSIONS.claudeCode} @openai/codex@${AGENT_CLI_VERSIONS.codex} --no-audit --no-fund && claude --version && codex --version`,
	)
	// Every first run of the Claude TUI otherwise opens with a theme picker, an
	// "approve this API key?" prompt and a workspace trust dialog — three
	// confirmations before a sandbox agent can do anything, on a machine whose
	// answers are the same every time. These are the keys the TUI writes when
	// you answer them; `-p` runs never write them, which is why the prompts
	// survive a headless smoke test. `customApiKeyResponses` matches on the
	// key's last 20 characters, so it stays valid as long as the placeholder does.
	// The builtin agent launches `claude --dangerously-skip-permissions`, which
	// opens a fourth dialog — accept Bypass Permissions mode — that headless
	// runs never reach either; this is the key that answers it.
	.runCommands(
		`printf '%s' '${JSON.stringify({
			hasCompletedOnboarding: true,
			bypassPermissionsModeAccepted: true,
			theme: "dark",
			customApiKeyResponses: {
				approved: [SANDBOX_CREDENTIAL_PLACEHOLDER.slice(-20)],
				rejected: [],
			},
			projects: {
				[SANDBOX_WORKSPACE_PATH]: {
					hasTrustDialogAccepted: true,
					projectOnboardingSeenCount: 1,
				},
			},
		})}' > /root/.claude.json`,
	)
	// Lands in /app so the externalised natives resolve from its node_modules.
	// The third argument is the build-context name, which defaults to the
	// source's basename — both `dist` directories would otherwise collide and
	// silently ship host-service's bundle as the pty daemon.
	.addLocalDir("packages/host-service/dist", "/app", "hostsvc-dist")
	.addLocalDir(
		"packages/host-service/drizzle",
		"/app/drizzle",
		"hostsvc-drizzle",
	)
	// Agent lifecycle hook templates. host-service resolves these as
	// `agent-templates` beside its own bundle, which from /app/host-service.js
	// is /app/agent-templates; the CLI tarball does the same into lib/. Without
	// them every hook writer soft-fails and a sandbox gets wrappers with no
	// hooks — agents run but never report starting, finishing, or asking a
	// question, which is how this shipped unnoticed since the image was built.
	.addLocalDir(
		"packages/agent-setup/templates",
		"/app/agent-templates",
		"agent-templates",
	)
	// The supervisor resolves the daemon as ../../../pty-daemon/dist relative
	// to its own source path, which from /app/host-service.js lands at /.
	.addLocalDir("packages/pty-daemon/dist", "/pty-daemon/dist", "ptyd-dist")
	// The daemon is a separate process importing node-pty, and Node resolves
	// upward from /pty-daemon. Linked rather than installed twice so the two
	// can never diverge on the native addon's version.
	.runCommands("ln -s /app/node_modules /pty-daemon/node_modules")
	// The schema, baked. host-service creates it on first boot, which used to
	// mean provisioning ran host-service once just to initialise the database
	// and then killed it. Running that at build time instead removes the entire
	// step: a fresh sandbox copies a file.
	// Nothing above this needs a checkout: the schema bake runs host-service
	// against /app alone. A workspace clones its own repo on first boot.
	.runCommands(
		`cd /app && ORGANIZATION_ID=00000000-0000-0000-0000-000000000000 HOST_DB_PATH=/app/host.db.template HOST_MIGRATIONS_FOLDER=/app/drizzle AUTH_TOKEN=build SUPERSET_API_URL=https://example.invalid SUPERSET_HOST_RUN_MODE=sandbox node -e "$(printf '%s' 'const { spawn } = require("node:child_process"); const p = spawn("node", ["host-service.js"], { stdio: ["ignore", "pipe", "pipe"] }); let out = ""; const done = (code) => { try { p.kill("SIGTERM"); } catch {} process.exit(code); }; const watch = (chunk) => { out += chunk; if (out.includes("Initialized at")) setTimeout(() => done(0), 2000); }; p.stdout.on("data", watch); p.stderr.on("data", watch); setTimeout(() => { console.error(out.slice(-800)); done(1); }, 60000);')" `,
	)
	// SQLite in WAL mode leaves the schema in host.db.template-wal until
	// something checkpoints it, and a signalled process does not. Without this
	// the template ships as an empty 4 KiB file and every sandbox pays for the
	// migrations it was supposed to skip — which is why the size is asserted
	// rather than assumed.
	.runCommands(
		`cd /app && node -e 'const D = require("better-sqlite3"); const d = new D("/app/host.db.template"); d.pragma("journal_mode = DELETE"); d.close();' && test "$(stat -c %s /app/host.db.template)" -gt 100000 && rm -f /app/host.db.template-wal /app/host.db.template-shm`,
	)
	.addLocalFile("scripts/sandbox/start.sh", "/app/start.sh")
	.addLocalFile("scripts/sandbox/git-askpass.sh", "/app/git-askpass.sh")
	.runCommands("chmod +x /app/start.sh /app/git-askpass.sh")
	.env({ NODE_ENV: "production", PORT: String(HOST_SERVICE_PORT) })
	.expose(HOST_SERVICE_PORT);
// No .entrypoint(): the SDK only appends
// `ENTRYPOINT ["/usr/local/bin/sandbox-api"]` when an image declares none,
// and that binary is what serves /process, /fs and the preview routes.
// Declaring our own left a sandbox the platform could not talk to at all —
// every exec came back 502. `/app/start.sh` is launched through the process
// API instead, once, without waiting on it.

if (import.meta.main) {
	if (process.argv.includes("--dry")) {
		console.log(sandboxImage.dockerfile);
	} else {
		assertBuilt();
		console.log(`building ${IMAGE_NAME} with ${natives.join(", ")}`);
		const built = await sandboxImage.build({
			name: IMAGE_NAME,
			memory: 4096,
			onStatusChange: (status: string) => console.log(`  ${status}`),
		} as never);
		console.log(`built: ${built.metadata?.name ?? IMAGE_NAME}`);
	}
}
