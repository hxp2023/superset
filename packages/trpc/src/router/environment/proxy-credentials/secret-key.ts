/**
 * The encryption context binds a value to its row's name within the
 * environment and organization (the unique key), so a rotated secret keeps
 * its binding and a create can be one atomic upsert. Kept apart from the
 * router so provisioning can import it without pulling the router (and its
 * import of the environment router) into the module graph first.
 */
export function proxyCredentialSecretKey(name: string): string {
	return `proxy:${name}`;
}
