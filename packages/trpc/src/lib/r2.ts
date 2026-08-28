import { AwsClient } from "aws4fetch";
import { env } from "../env";

export function storageEnv(): {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
} {
	const {
		CLOUDFLARE_ACCOUNT_ID,
		R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY,
		R2_BUCKET,
	} = env;
	if (
		!CLOUDFLARE_ACCOUNT_ID ||
		!R2_ACCESS_KEY_ID ||
		!R2_SECRET_ACCESS_KEY ||
		!R2_BUCKET
	) {
		throw new Error("R2 storage is not configured");
	}
	return {
		accountId: CLOUDFLARE_ACCOUNT_ID,
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY,
		bucket: R2_BUCKET,
	};
}

let client: AwsClient | null = null;

function aws(): AwsClient {
	if (!client) {
		const { accessKeyId, secretAccessKey } = storageEnv();
		client = new AwsClient({
			accessKeyId,
			secretAccessKey,
			service: "s3",
			region: "auto",
		});
	}
	return client;
}

function objectUrl(key: string): string {
	const { accountId, bucket } = storageEnv();
	const path = key.split("/").map(encodeURIComponent).join("/");
	return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${path}`;
}

export async function putObject({
	key,
	body,
	contentType,
}: {
	key: string;
	body: Uint8Array | string;
	contentType: string;
}): Promise<void> {
	const response = await aws().fetch(objectUrl(key), {
		method: "PUT",
		// A Node Buffer is not a BodyInit to the fetch types; copying is cheap
		// at the sizes stored here.
		body: typeof body === "string" ? body : new Uint8Array(body),
		headers: { "Content-Type": contentType },
	});
	if (!response.ok) {
		throw new Error(`R2 put failed (${response.status}) for ${key}`);
	}
}

/** The object's response, streaming, or null when it does not exist. */
export async function getObject(key: string): Promise<Response | null> {
	const response = await aws().fetch(objectUrl(key));
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`R2 get failed (${response.status}) for ${key}`);
	}
	return response;
}

/** Deletes are idempotent: a missing key is not an error. */
export async function deleteObjects(keys: readonly string[]): Promise<void> {
	await Promise.all(
		keys.map(async (key) => {
			const response = await aws().fetch(objectUrl(key), { method: "DELETE" });
			if (!response.ok && response.status !== 404) {
				throw new Error(`R2 delete failed (${response.status}) for ${key}`);
			}
		}),
	);
}

export async function presignedGetUrl(
	key: string,
	expiresInSeconds = 60 * 60,
): Promise<string> {
	const url = new URL(objectUrl(key));
	url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
	const signed = await aws().sign(
		new Request(url.toString(), { method: "GET" }),
		{
			aws: { signQuery: true },
		},
	);
	return signed.url;
}
