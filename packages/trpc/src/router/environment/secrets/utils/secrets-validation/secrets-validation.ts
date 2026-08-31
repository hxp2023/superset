const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_SIZE = 16 * 1024;
const MAX_TOTAL_SIZE = 64 * 1024;
const MAX_SECRETS_PER_ENVIRONMENT = 50;

/**
 * These reach a sandbox through the same `spec.runtime.envs` payload that
 * carries its identity, so a user-supplied `ORGANIZATION_ID` would make a
 * workspace serve under another organization — a cross-tenant failure reachable
 * from a settings form. Prefixes cover the whole identity surface; bare names
 * cover shell and host-service configuration that would break the sandbox.
 */
const RESERVED_PREFIXES = ["SUPERSET_", "HOST_SERVICE_", "BLAXEL_"];

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

export function isReservedKey(key: string): boolean {
	const normalized = key.toUpperCase();
	if (RESERVED_KEYS.has(normalized)) return true;
	return RESERVED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function validateSecretKey(
	key: string,
): { valid: true } | { valid: false; error: string } {
	if (!KEY_PATTERN.test(key))
		return { valid: false, error: "Key must match [A-Za-z_][A-Za-z0-9_]*" };
	if (key.length > MAX_KEY_LENGTH)
		return {
			valid: false,
			error: `Key must be <= ${MAX_KEY_LENGTH} characters`,
		};
	if (isReservedKey(key))
		return {
			valid: false,
			error: `${key.toUpperCase()} is reserved by Superset`,
		};
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
	MAX_SECRETS_PER_ENVIRONMENT,
	RESERVED_KEYS,
	RESERVED_PREFIXES,
};
