export interface UsercontentEnv {
	STORAGE: R2Bucket;
	/** Base URL pages hang off, e.g. https://pages.supersetusercontent.com */
	USERCONTENT_URL: string;
	/** Where a reader without a ticket is sent to sign in and come back. */
	APP_URL: string;
	/** Space-separated CSP sources allowed to frame a page. */
	FRAME_ANCESTORS: string;
	/** Shared with the API, which mints the tickets this origin verifies. */
	USERCONTENT_TOKEN_SECRET: string;
	/** Set during rotation so tickets signed with the old secret still open. */
	USERCONTENT_TOKEN_SECRET_PREVIOUS?: string;
	/** Optional; Sentry capture is a no-op until the secret is set. */
	SENTRY_DSN?: string;
}
