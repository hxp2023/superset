const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_SIZE = 16 * 1024;
// Size rather than count is the limit that means anything: the values are
// handed to the provider in one `spec.runtime.envs` payload, so bytes are what
// cost. A count cap would be a worse proxy for the same thing — five 16 KB
// values exceed this while satisfying any sane count. The provider itself
// imposes no count worth mirroring; 250 variables were accepted and visible
// inside a sandbox when measured.
const MAX_TOTAL_SIZE = 64 * 1024;

/**
 * These reach a sandbox through the same `spec.runtime.envs` payload that
 * carries its identity, so a user-supplied `ORGANIZATION_ID` would make a
 * workspace serve under another organization — a cross-tenant failure reachable
 * from a settings form. Prefixes cover the whole identity surface; bare names
 * cover shell and host-service configuration that would break the sandbox.
 */
const RESERVED_PREFIXES: Array<{ prefix: string; reason: string }> = [
	{
		prefix: "SUPERSET_",
		reason: "carries the workspace's identity into the sandbox",
	},
	{ prefix: "HOST_SERVICE_", reason: "configures the sandbox's own server" },
	{ prefix: "BLAXEL_", reason: "belongs to the sandbox provider" },
];

const RESERVED_KEYS = new Set([
	"ORGANIZATION_ID",
	"AUTH_TOKEN",
	"HOST_DB_PATH",
	"HOST_MIGRATIONS_FOLDER",
	"PORT",
	"NODE_ENV",
	"PATH",
	"HOME",
	"USER",
	"SHELL",
	"TERM",
	"PWD",
	"LANG",
	"IS_SANDBOX",
]);

export function reservedKeyReason(key: string): string | null {
	const normalized = key.toUpperCase();
	if (RESERVED_KEYS.has(normalized)) {
		return `${normalized} is set by the sandbox itself, so a value here would be ignored or break it`;
	}
	const matched = RESERVED_PREFIXES.find((entry) =>
		normalized.startsWith(entry.prefix),
	);
	if (matched) {
		return `Names starting with ${matched.prefix} are reserved — that prefix ${matched.reason}`;
	}
	return null;
}

export function isReservedKey(key: string): boolean {
	return reservedKeyReason(key) !== null;
}

export function validateSecretKey(
	key: string,
): { valid: true } | { valid: false; error: string } {
	if (!KEY_PATTERN.test(key))
		return {
			valid: false,
			error:
				"Use letters, numbers and underscores only, starting with a letter or underscore",
		};
	if (key.length > MAX_KEY_LENGTH)
		return {
			valid: false,
			error: `Key must be <= ${MAX_KEY_LENGTH} characters`,
		};
	const reserved = reservedKeyReason(key);
	if (reserved) return { valid: false, error: reserved };
	return { valid: true };
}

export function validateSecretValue(
	value: string,
): { valid: true } | { valid: false; error: string } {
	if (Buffer.byteLength(value) > MAX_VALUE_SIZE)
		return {
			valid: false,
			error: `Value must be <= ${MAX_VALUE_SIZE / 1024}KB`,
		};
	return { valid: true };
}

export {
	KEY_PATTERN,
	MAX_KEY_LENGTH,
	MAX_VALUE_SIZE,
	MAX_TOTAL_SIZE,
	RESERVED_KEYS,
	RESERVED_PREFIXES,
};
