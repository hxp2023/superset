/**
 * The encryption context binds a value to its row, never to a reusable
 * name. Kept apart from the router so provisioning can import it without
 * pulling the router (and its import of the environment router) into the
 * module graph first.
 */
export function proxyCredentialSecretKey(id: string): string {
	return `proxy:${id}`;
}
