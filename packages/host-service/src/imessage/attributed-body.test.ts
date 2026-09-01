import { describe, expect, it } from "bun:test";
import { extractTextFromAttributedBody } from "./attributed-body.ts";

/** typedstream fragment: ...NSString + 5 header bytes + length + utf8 body. */
function blob(text: string, lengthEncoding: "short" | "u16" | "u32"): Buffer {
	const body = Buffer.from(text, "utf8");
	const header = Buffer.from("streamtyped garbage NSString", "latin1");
	const skip = Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]);
	let length: Buffer;
	if (lengthEncoding === "short") {
		length = Buffer.from([body.length]);
	} else if (lengthEncoding === "u16") {
		length = Buffer.alloc(3);
		length[0] = 0x81;
		length.writeUInt16LE(body.length, 1);
	} else {
		length = Buffer.alloc(5);
		length[0] = 0x82;
		length.writeUInt32LE(body.length, 1);
	}
	const trailer = Buffer.from("iI NSDictionary trailing", "latin1");
	return Buffer.concat([header, skip, length, body, trailer]);
}

describe("extractTextFromAttributedBody", () => {
	it("reads a short-length body", () => {
		expect(extractTextFromAttributedBody(blob("ship it", "short"))).toBe(
			"ship it",
		);
	});

	it("reads a two-byte length body", () => {
		const text = "x".repeat(300);
		expect(extractTextFromAttributedBody(blob(text, "u16"))).toBe(text);
	});

	it("reads a four-byte length body", () => {
		const text = "y".repeat(70_000);
		expect(extractTextFromAttributedBody(blob(text, "u32"))).toBe(text);
	});

	it("keeps multi-byte characters intact", () => {
		expect(extractTextFromAttributedBody(blob("déployé 🚀", "short"))).toBe(
			"déployé 🚀",
		);
	});

	it("returns null without an NSString marker", () => {
		expect(
			extractTextFromAttributedBody(Buffer.from("streamtyped nothing here")),
		).toBeNull();
	});

	it("returns null for empty or missing bodies", () => {
		expect(extractTextFromAttributedBody(null)).toBeNull();
		expect(extractTextFromAttributedBody(Buffer.alloc(0))).toBeNull();
	});

	it("returns null when the declared length overruns the buffer", () => {
		const truncated = blob("hello world", "short").subarray(0, 40);
		expect(extractTextFromAttributedBody(truncated)).toBeNull();
	});
});
