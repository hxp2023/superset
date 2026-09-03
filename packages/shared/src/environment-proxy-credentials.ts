import { validateSecretKey } from "./environment-secrets";

/**
 * A proxy credential is a secret the sandbox can use but never read: the
 * provider's egress proxy injects it into requests to the named hosts, and
 * the sandbox only holds a placeholder in the env var the tool reads.
 */
export type ProxyCredentialProvider = "anthropic" | "openai" | "custom";

export const PROXY_CREDENTIAL_PROVIDERS: readonly ProxyCredentialProvider[] = [
	"anthropic",
	"openai",
	"custom",
];

/** Where the secret goes in the template the edge fills in. */
export const PROXY_SECRET_TOKEN = "{{secret}}";

export interface ProxyCredentialRule {
	/** Env var set to the placeholder inside the sandbox, so the tool thinks it is configured. */
	placeholderEnv: string;
	/** Hosts the header is injected for; `*.` wildcards allowed. */
	destinations: string[];
	/** Header the edge overwrites on matching requests. */
	header: string;
	/** Header value, with `{{secret}}` where the secret goes. */
	valueTemplate: string;
}

export const PROXY_CREDENTIAL_PRESETS: Record<
	Exclude<ProxyCredentialProvider, "custom">,
	ProxyCredentialRule & { name: string }
> = {
	anthropic: {
		name: "Anthropic API key",
		placeholderEnv: "ANTHROPIC_API_KEY",
		destinations: ["api.anthropic.com"],
		header: "x-api-key",
		valueTemplate: PROXY_SECRET_TOKEN,
	},
	openai: {
		name: "OpenAI API key",
		placeholderEnv: "OPENAI_API_KEY",
		destinations: ["api.openai.com"],
		header: "Authorization",
		valueTemplate: `Bearer ${PROXY_SECRET_TOKEN}`,
	},
};

export const MAX_PROXY_DESTINATIONS = 20;
const DESTINATION_PATTERN =
	/^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const HEADER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_TEMPLATE_LENGTH = 256;
const MAX_NAME_LENGTH = 80;

export function parseDestinations(input: string): string[] {
	return input
		.split(/[\s,]+/)
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

export type ProxyCredentialValidation =
	| { valid: true }
	| { valid: false; field: "name" | keyof ProxyCredentialRule; error: string };

export function validateProxyCredential(
	input: ProxyCredentialRule & { name: string },
): ProxyCredentialValidation {
	const name = input.name.trim();
	if (!name) return { valid: false, field: "name", error: "Name is required" };
	if (name.length > MAX_NAME_LENGTH) {
		return {
			valid: false,
			field: "name",
			error: `Name must be ${MAX_NAME_LENGTH} characters or fewer`,
		};
	}
	const placeholder = validateSecretKey(input.placeholderEnv.trim());
	if (!placeholder.valid) {
		return { valid: false, field: "placeholderEnv", error: placeholder.error };
	}
	if (input.destinations.length === 0) {
		return {
			valid: false,
			field: "destinations",
			error: "At least one host is required",
		};
	}
	if (input.destinations.length > MAX_PROXY_DESTINATIONS) {
		return {
			valid: false,
			field: "destinations",
			error: `At most ${MAX_PROXY_DESTINATIONS} hosts`,
		};
	}
	for (const destination of input.destinations) {
		if (!DESTINATION_PATTERN.test(destination)) {
			return {
				valid: false,
				field: "destinations",
				error: `"${destination}" is not a hostname`,
			};
		}
	}
	if (!HEADER_PATTERN.test(input.header.trim())) {
		return {
			valid: false,
			field: "header",
			error: "Header must be a header name, like Authorization",
		};
	}
	const template = input.valueTemplate.trim();
	if (!template.includes(PROXY_SECRET_TOKEN)) {
		return {
			valid: false,
			field: "valueTemplate",
			error: `Template must contain ${PROXY_SECRET_TOKEN}`,
		};
	}
	if (template.length > MAX_TEMPLATE_LENGTH || /[\r\n]/.test(template)) {
		return {
			valid: false,
			field: "valueTemplate",
			error: "Template must be one line",
		};
	}
	return { valid: true };
}
