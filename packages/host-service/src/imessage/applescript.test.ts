import { describe, expect, it } from "bun:test";
import { buildSendArgs, sendImessage } from "./applescript.ts";
import { OUTBOUND_MARKER } from "./messages.ts";

describe("buildSendArgs", () => {
	it("passes text and target as argv after --, never spliced into the script", () => {
		const args = buildSendArgs("+15551234567", 'say "hi" & do bad things');
		expect(args[0]).toBe("-e");
		expect(args[2]).toBe("--");
		expect(args[3]).toBe(`${OUTBOUND_MARKER}say "hi" & do bad things`);
		expect(args[4]).toBe("+15551234567");
		expect(args[1]).not.toContain("say");
	});

	it("marks every outbound message so the bridge never re-ingests it", () => {
		const args = buildSendArgs("me@example.com", "done");
		expect(args[3]?.startsWith(OUTBOUND_MARKER)).toBe(true);
	});
});

describe("sendImessage", () => {
	it("invokes osascript with the built args", async () => {
		const calls: { file: string; args: string[] }[] = [];
		await sendImessage("+15551234567", "hello", async (file, args) => {
			calls.push({ file, args });
			return { stdout: "", stderr: "" };
		});
		expect(calls).toHaveLength(1);
		expect(calls[0]?.file).toBe("osascript");
		expect(calls[0]?.args.at(-1)).toBe("+15551234567");
	});
});
