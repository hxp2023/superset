const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * Reads the raw body with a size cap. The Content-Length check is cheap and
 * refuses before reading; the byte check after reading is the one that holds,
 * since the header is sender-controlled.
 */
export async function cappedBody(
	request: Request,
	maxBytes = DEFAULT_MAX_BYTES,
): Promise<string | Response> {
	if (Number(request.headers.get("content-length")) > maxBytes) {
		return Response.json({ error: "Body too large" }, { status: 413 });
	}
	const body = await request.text();
	if (Buffer.byteLength(body) > maxBytes) {
		return Response.json({ error: "Body too large" }, { status: 413 });
	}
	return body;
}

/** JSON.parse that answers 400 instead of throwing. */
export function parseJson<T>(body: string): T | Response {
	try {
		return JSON.parse(body) as T;
	} catch {
		return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
	}
}
