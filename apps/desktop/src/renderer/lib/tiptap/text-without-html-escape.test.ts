import { GlobalRegistrator } from "@happy-dom/global-registrator";

// happy-dom over the preloaded plain-object document — TipTap's Editor needs
// real DOM APIs. bun runs test files sequentially in one process and
// happy-dom's globals are process-wide, so register once and unregister after.
const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();

const { afterAll, describe, expect, it } = await import("bun:test");
const { Editor } = await import("@tiptap/core");
const { Document } = await import("@tiptap/extension-document");
const { Paragraph } = await import("@tiptap/extension-paragraph");
const { Markdown } = await import("tiptap-markdown");
const { TextWithoutHtmlEscape } = await import("./text-without-html-escape");

afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

/** Serializes a document holding exactly the text a user typed. */
function serializeTyped(text: string): string {
	const editor = new Editor({
		extensions: [
			Document,
			Paragraph,
			TextWithoutHtmlEscape,
			Markdown.configure({
				html: true,
				transformPastedText: true,
				transformCopiedText: true,
			}),
		],
		content: {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text }] }],
		},
	});
	const storage = editor.storage as unknown as Record<
		string,
		{ getMarkdown?: () => string }
	>;
	return storage.markdown?.getMarkdown?.() ?? "";
}

describe("TextWithoutHtmlEscape", () => {
	it("keeps angle brackets as typed", () => {
		// Stock tiptap-markdown emits "2 &gt; 1 and a &lt; b", which reaches
		// agent CLIs verbatim over the launch heredoc.
		expect(serializeTyped("2 > 1 and a < b")).toBe("2 > 1 and a < b");
	});

	it("keeps shell redirects and generics intact", () => {
		expect(serializeTyped("run build > out.log")).toBe("run build > out.log");
		expect(serializeTyped("returns Array<string>")).toBe(
			"returns Array<string>",
		);
	});

	it("does not rewrite a literal entity the user typed", () => {
		expect(serializeTyped("&gt;")).toBe("&gt;");
	});

	it("still escapes real markdown syntax", () => {
		expect(serializeTyped("a * b")).toBe("a \\* b");
	});
});
