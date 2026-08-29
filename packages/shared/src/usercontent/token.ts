/**
 * The viewing ticket for a non-public page: minted by the API after it has
 * checked the session against the page's visibility, verified by the
 * usercontent origin with nothing but the shared secret. It carries no
 * identity — it says "this page (and optionally this version) may be read
 * until `exp`", nothing more. HMAC-SHA256 over WebCrypto so the same code
 * runs in Node, Workers, and browsers.
 */
export interface PageViewTokenClaims {
	pageId: string;
	/** When set, the token opens only this version. */
	version?: number;
	/** Expiry, in seconds since the epoch. */
	exp: number;
}

const KIND = "page";

interface WireClaims {
	/** Ticket kind, so a page ticket can never open something else. */
	k: typeof KIND;
	p: string;
	v?: number;
	e: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
	const padded =
		text.replace(/-/g, "+").replace(/_/g, "/") +
		"=".repeat((4 - (text.length % 4)) % 4);
	try {
		const binary = atob(padded);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

function hmacKey(secret: string) {
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function signPageViewToken(
	secret: string,
	claims: PageViewTokenClaims,
): Promise<string> {
	const wire: WireClaims = {
		k: KIND,
		p: claims.pageId,
		e: claims.exp,
		...(claims.version !== undefined ? { v: claims.version } : {}),
	};
	const payload = toBase64Url(encoder.encode(JSON.stringify(wire)));
	const signature = await crypto.subtle.sign(
		"HMAC",
		await hmacKey(secret),
		encoder.encode(payload),
	);
	return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * `secrets` is the current secret first, then any previous one still in its
 * grace period, so rotation never invalidates tickets already handed out.
 */
export async function verifyPageViewToken(
	secrets: string | readonly string[],
	token: string,
	now: number = Date.now(),
): Promise<PageViewTokenClaims | null> {
	const dot = token.indexOf(".");
	if (dot === -1) return null;
	const payload = token.slice(0, dot);
	const signature = fromBase64Url(token.slice(dot + 1));
	if (!signature) return null;

	let valid = false;
	for (const secret of typeof secrets === "string" ? [secrets] : secrets) {
		if (!secret) continue;
		valid = await crypto.subtle.verify(
			"HMAC",
			await hmacKey(secret),
			signature,
			encoder.encode(payload),
		);
		if (valid) break;
	}
	if (!valid) return null;

	const bytes = fromBase64Url(payload);
	if (!bytes) return null;
	let wire: unknown;
	try {
		wire = JSON.parse(decoder.decode(bytes));
	} catch {
		return null;
	}
	if (!wire || typeof wire !== "object") return null;
	const { k, p, v, e } = wire as Partial<WireClaims>;
	if (
		k !== KIND ||
		typeof p !== "string" ||
		typeof e !== "number" ||
		(v !== undefined && !Number.isInteger(v))
	) {
		return null;
	}
	if (e * 1000 <= now) return null;
	return { pageId: p, exp: e, ...(v !== undefined ? { version: v } : {}) };
}
