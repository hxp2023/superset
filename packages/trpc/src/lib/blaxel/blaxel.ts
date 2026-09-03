/**
 * Called directly rather than behind a provider interface: there is one
 * provider, so an interface would be a second thing to keep in sync with no
 * second implementation to justify it.
 *
 * Previews are private, so Blaxel's edge rejects unauthenticated requests
 * before they reach host-service. Clients connect directly with a brokered
 * token — no relay hop, so websockets work and the sandbox can still sleep.
 */

import { SandboxInstance, settings, updateSandbox } from "@blaxel/core";
import { CLOUD_AGENT_LAUNCH_ENV_NAMES } from "@superset/shared/cloud-agent-launch";
import { SANDBOX_CREDENTIAL_PLACEHOLDER } from "@superset/shared/constants";
import {
	PROXY_SECRET_TOKEN,
	type ProxyCredentialRule,
} from "@superset/shared/environment-proxy-credentials";
import { env } from "../../env";
import { userError } from "../../i18n-error";

/** Short enough that a leaked token is bounded; minted per access. */
const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;
const PREVIEW_NAME = "hostsvc";
const HOST_SERVICE_PORT = 4879;

interface ProxyRoute {
	destinations: string[];
	headers: Record<string, string>;
	secrets: Record<string, string>;
}

/**
 * One route per model provider, each carrying the header that provider
 * authenticates with. Secrets are scoped to their own rule — a key declared
 * here cannot be resolved by any other destination.
 */
function agentCredentialRoutes(): CredentialRoute[] {
	return [
		{
			env: { name: "ANTHROPIC_API_KEY", value: SANDBOX_CREDENTIAL_PLACEHOLDER },
			route: {
				destinations: ["api.anthropic.com"],
				headers: { "x-api-key": "{{SECRET:anthropic-api-key}}" },
				secrets: { "anthropic-api-key": env.ANTHROPIC_API_KEY },
			},
		},
		{
			env: { name: "OPENAI_API_KEY", value: SANDBOX_CREDENTIAL_PLACEHOLDER },
			route: {
				destinations: ["api.openai.com"],
				headers: { Authorization: "Bearer {{SECRET:openai-api-key}}" },
				secrets: { "openai-api-key": env.OPENAI_API_KEY },
			},
		},
	];
}

/** A placeholder in the sandbox env and the edge rule that makes it work. */
interface CredentialRoute {
	env: { name: string; value: string };
	route: ProxyRoute;
}

/** `*.example.com` covers `api.example.com`; a bare host covers itself. */
function destinationCovers(pattern: string, host: string): boolean {
	if (pattern === host) return true;
	if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
	if (host.startsWith("*.")) return pattern.endsWith(host.slice(1));
	return false;
}

/**
 * An environment's own proxy credentials, as routes. Each secret is scoped
 * to its rule, and a rule for a host the org defaults also cover replaces
 * the default (placeholder and route together): the environment's key is
 * the one its owner chose.
 */
function environmentCredentialRoutes(
	credentials: Array<ProxyCredentialRule & { value: string }>,
	defaults: CredentialRoute[],
): CredentialRoute[] {
	const covered = (host: string) =>
		credentials.some((credential) =>
			credential.destinations.some((pattern) =>
				destinationCovers(pattern, host),
			),
		);
	const kept = defaults.filter(
		(entry) => !entry.route.destinations.some(covered),
	);
	const own = credentials.map((credential, index) => {
		const secretName = `environment-${index}`;
		return {
			env: {
				name: credential.placeholderEnv,
				value: SANDBOX_CREDENTIAL_PLACEHOLDER,
			},
			route: {
				destinations: credential.destinations,
				headers: {
					[credential.header]: credential.valueTemplate.replaceAll(
						PROXY_SECRET_TOKEN,
						`{{SECRET:${secretName}}}`,
					),
				},
				secrets: { [secretName]: credential.value },
			},
		};
	});
	return [...kept, ...own];
}

function configureBlaxel(): void {
	settings.setConfig({
		apiKey: env.BLAXEL_API_KEY,
		workspace: env.BLAXEL_WORKSPACE,
	});
}

export interface ProvisionedSandbox {
	providerSandboxId: string;
	sandboxUrl: string;
}

/**
 * Creates the sandbox and its private preview. Returns once the preview URL
 * exists — not once anything is listening on it, which is the caller's job.
 */
export interface SandboxEnvironment {
	sourceKind: "image" | "fork";
	sourceRef: string;
}

async function forkSandbox(
	name: string,
	sourceSandbox: string,
	workspaceEnv: Record<string, string>,
): Promise<SandboxInstance> {
	const source = await SandboxInstance.get(sourceSandbox);
	await source.fork(name);
	const forked = await SandboxInstance.get(name);

	const spec = structuredClone(forked.spec) as {
		runtime?: { envs?: Array<{ name: string; value: string }> };
	};
	const inherited = spec.runtime?.envs ?? [];
	const replaced = new Set<string>();
	const envs = inherited.map((entry) => {
		const override = workspaceEnv[entry.name];
		if (override === undefined) return entry;
		replaced.add(entry.name);
		return { name: entry.name, value: override };
	});
	for (const [key, value] of Object.entries(workspaceEnv)) {
		if (!replaced.has(key)) envs.push({ name: key, value });
	}
	if (!spec.runtime) spec.runtime = {};
	spec.runtime.envs = envs;

	await updateSandbox({
		path: { sandboxName: name },
		body: {
			...(forked as never as { sandbox: object }).sandbox,
			spec,
		} as never,
		throwOnError: true,
	});
	return await SandboxInstance.get(name);
}

export async function provisionSandbox(args: {
	name: string;
	environment: SandboxEnvironment;
	/**
	 * Everything the sandbox needs to configure itself. It reads these on boot
	 * and seeds its own project and workspace rows, which is why provisioning
	 * has nothing to run inside it afterwards.
	 */
	workspaceEnv: Record<string, string>;
	/**
	 * The environment's proxy credentials. Only an image sandbox can carry
	 * them: the proxy exists from creation or not at all, and a fork is
	 * created without it (docs/cloud-sandbox-mismatches.md).
	 */
	proxyCredentials?: Array<ProxyCredentialRule & { value: string }>;
	memoryMb?: number;
	region?: string;
}): Promise<ProvisionedSandbox> {
	configureBlaxel();
	const memoryMb = args.memoryMb ?? 8192;
	const region = args.region ?? env.BLAXEL_REGION;
	// Every proxy credential lands in two places of the create call: its
	// placeholder in `envs`, so the tool inside thinks it is configured, and
	// its rule in `network.proxy.routing`, where the edge swaps the placeholder
	// for the secret on requests to the rule's hosts. The org's model keys are
	// the same shape, so they are merged here and replaced host by host.
	const credentials = environmentCredentialRoutes(
		args.proxyCredentials ?? [],
		agentCredentialRoutes(),
	);
	const placeholders = new Set(credentials.map((entry) => entry.env.name));
	const envs = [
		// A variable with a placeholder's name loses: the edge would overwrite
		// the header anyway, so the env says so rather than pretending.
		...Object.entries(args.workspaceEnv)
			.filter(([name]) => !placeholders.has(name))
			.map(([name, value]) => ({ name, value })),
		...credentials.map((entry) => entry.env),
	];
	const routing = credentials.map((entry) => entry.route);

	const sandbox =
		args.environment.sourceKind === "fork"
			? // A fork copies the source's files and env but is created without
				// the proxy, which can only exist from creation, so neither the
				// placeholders nor the routing can reach it.
				await forkSandbox(
					args.name,
					args.environment.sourceRef,
					args.workspaceEnv,
				)
			: await SandboxInstance.createIfNotExists({
					name: args.name,
					image: args.environment.sourceRef,
					// The writable root is tmpfs sized at half of this; there is no
					// separate disk (docs/cloud-sandbox-mismatches.md).
					memory: memoryMb,
					ports: [{ target: HOST_SERVICE_PORT, protocol: "HTTP" }],
					region,
					envs,
					// Routing is fixed at creation, so a sandbox can never be re-pointed at
					// a different secret later in its life.
					network: { proxy: { routing } },
				} as never);

	// The desktop renderer is a browser: without CORS on the provider's edge
	// every request to the sandbox fails preflight. The wildcard origin grants
	// no ambient authority — the preview token gates the sandbox and a browser
	// never attaches it on its own, so a hostile page can't ride a user's
	// session the way it could with a cookie. It does mean a *leaked* token is
	// usable from any origin, which is one more reason the TTL is short.
	const preview = await sandbox.previews.createIfNotExists({
		metadata: { name: PREVIEW_NAME },
		spec: {
			port: HOST_SERVICE_PORT,
			public: false,
			responseHeaders: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Headers": "*",
				"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
			},
		},
	} as never);

	const sandboxUrl = preview.spec?.url;
	if (!sandboxUrl) {
		throw userError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Sandbox preview has no URL",
			i18nKey: "serverError.blaxel.sandboxPreviewHasNoUrl",
		});
	}

	// Start host-service and return — the only thing provisioning runs inside a
	// sandbox, and it is not awaited. The script needs a second or two; the
	// client discovers the result by polling the health endpoint it already
	// polls, so there is nothing to wait for here.
	await sandbox.process.exec({
		name: "host-service",
		command: "/app/start.sh",
		waitForCompletion: false,
	} as never);

	return { providerSandboxId: args.name, sandboxUrl };
}

const INHERITED_IDENTITY: Array<[path: string, recursive: boolean]> = [
	["/data/host.db", false],
	["/data/host.db-wal", false],
	["/data/host.db-shm", false],
	["/data/.workspace-bootstrapped", false],
	["/data/.sandbox-agent-launched", false],
	["/data/.superset-db-branch", false],
	["/root/.superset/host", true],
	["/root/.gitconfig", false],
];

const INHERITED_IDENTITY_ENVS = new Set([
	"ORGANIZATION_ID",
	"SUPERSET_SANDBOX_BRANCH",
	"SUPERSET_SANDBOX_GIT_TOKEN",
	"SUPERSET_SANDBOX_PROJECT_NAME",
	"SUPERSET_SANDBOX_REPO_URL",
	"SUPERSET_SANDBOX_WORKSPACE_ID",
	"SUPERSET_SANDBOX_WORKSPACE_NAME",
	...CLOUD_AGENT_LAUNCH_ENV_NAMES,
]);

export async function promoteSandboxToEnvironment(args: {
	sourceSandbox: string;
	goldenName: string;
}): Promise<string> {
	configureBlaxel();
	const source = await SandboxInstance.get(args.sourceSandbox);
	await source.fork(args.goldenName);

	const golden = await SandboxInstance.get(args.goldenName);

	for (const name of ["host-service", "diag-start"]) {
		await golden.process.stop(name).catch((error) => {
			if (!isSandboxNotFound(error)) throw error;
		});
	}

	for (const [path, recursive] of INHERITED_IDENTITY) {
		await golden.fs.rm(path, recursive).catch((error) => {
			if (!isSandboxNotFound(error)) throw error;
		});
	}

	await golden.process.exec({
		name: "prepare-environment",
		command: "pkill -f pty-daemon.js || true",
		waitForCompletion: true,
	} as never);

	// Blaxel copies the source's env into the fork and env is immutable after
	// creation, so the promoting workspace's credentials would otherwise ride
	// into a shared environment every later workspace forks from. The git token
	// is the dangerous one: provisioning only sets it when the clone needs it,
	// so a public-repo workspace would inherit the promoter's instead.
	const current = await SandboxInstance.get(args.goldenName);
	const spec = structuredClone(current.spec) as {
		runtime?: { envs?: Array<{ name: string; value: string }> };
	};
	if (spec.runtime?.envs) {
		spec.runtime.envs = spec.runtime.envs.filter(
			(entry) => !INHERITED_IDENTITY_ENVS.has(entry.name),
		);
		await updateSandbox({
			path: { sandboxName: args.goldenName },
			body: {
				...(current as never as { sandbox: object }).sandbox,
				spec,
			} as never,
			throwOnError: true,
		});
	}

	return args.goldenName;
}

export interface PreviewAccess {
	url: string;
	token: string;
	expiresAt: Date;
}

export async function mintPreviewAccess(
	providerSandboxId: string,
): Promise<PreviewAccess> {
	configureBlaxel();
	const sandbox = await SandboxInstance.get(providerSandboxId);
	const preview = await sandbox.previews.get(PREVIEW_NAME);
	const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS);
	const token = await preview.tokens.create(expiresAt);
	const value = (token as { value?: string }).value;
	const url = preview.spec?.url;
	if (!value || !url) {
		throw userError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Could not mint sandbox access token",
			i18nKey: "serverError.blaxel.couldNotMintSandboxAccessToken",
		});
	}
	return { url, token: value, expiresAt };
}

/** Best-effort: a sandbox already gone is the state we wanted. */
export async function deleteSandbox(providerSandboxId: string): Promise<void> {
	configureBlaxel();
	try {
		await SandboxInstance.delete(providerSandboxId);
	} catch (error) {
		if (!isSandboxNotFound(error)) throw error;
	}
}

/**
 * The SDK's not-found error carries the status on the object, not in the
 * message — its `message` is empty — so a text match alone lets a workspace
 * whose sandbox never came up (a failed provision, or one already torn down)
 * refuse deletion forever.
 */
function isSandboxNotFound(error: unknown): boolean {
	if (typeof error === "object" && error !== null) {
		const { code, error: reason } = error as {
			code?: unknown;
			error?: unknown;
		};
		if (code === 404) return true;
		if (typeof reason === "string" && /not found/i.test(reason)) return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	return /not found|404/i.test(message);
}
