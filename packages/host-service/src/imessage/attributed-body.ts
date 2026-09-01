/**
 * Since macOS Ventura, Messages stores many bodies only in
 * `message.attributedBody` — a NeXT "typedstream" archive — leaving
 * `message.text` NULL (~12% of rows on a long-lived install). Full typedstream
 * parsing is not needed to recover the plain text: the first NSString in the
 * archive is the message body, preceded by a one/two/four-byte length.
 */
const NSSTRING_MARKER = Buffer.from("NSString");
/** Bytes between the NSString class name and its length field. */
const NSSTRING_HEADER_SKIP = 5;

export function extractTextFromAttributedBody(
	body: Uint8Array | null,
): string | null {
	if (!body || body.length === 0) return null;
	const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);

	const marker = buf.indexOf(NSSTRING_MARKER);
	if (marker === -1) return null;

	let at = marker + NSSTRING_MARKER.length + NSSTRING_HEADER_SKIP;
	if (at >= buf.length) return null;

	let length: number;
	const lead = buf[at] as number;
	if (lead === 0x81) {
		if (at + 3 > buf.length) return null;
		length = buf.readUInt16LE(at + 1);
		at += 3;
	} else if (lead === 0x82) {
		if (at + 5 > buf.length) return null;
		length = buf.readUInt32LE(at + 1);
		at += 5;
	} else {
		length = lead;
		at += 1;
	}

	if (length === 0 || at + length > buf.length) return null;
	return buf.toString("utf8", at, at + length);
}
