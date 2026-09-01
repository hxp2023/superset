/**
 * Parsing a `.env` is not as small a job as it looks: quotes come in three
 * flavours, values span lines, comments sit at the end of them, and a file
 * written on Windows arrives with carriage returns attached.
 *
 * dotenv already gets this right and is a dependency of this app, but it cannot
 * be imported here — its module root pulls in `fs`, `path`, `os` and `crypto`,
 * and this is renderer code with no Node available. What is portable is its
 * parser, which is a single expression; it is reproduced below rather than
 * approximated. dotenv is BSD-2-Clause.
 *
 * Source: https://github.com/motdotla/dotenv `lib/main.js`
 */
const LINE =
	/(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

const INVALID = {
	ok: false as const,
	error: "Please upload a valid .env file.",
};

export interface EnvEntry {
	key: string;
	value: string;
}

export function parseEnvContent(content: string): EnvEntry[] {
	const entries: EnvEntry[] = [];
	// One line-ending convention, so a CRLF file does not leave a carriage
	// return on the end of every value — including inside a multi-line one,
	// where trimming the line would not have reached it.
	const normalised = content.replace(/\r\n?/gm, "\n");

	LINE.lastIndex = 0;
	let match = LINE.exec(normalised);
	while (match !== null) {
		const key = match[1];
		let value = (match[2] ?? "").trim();
		const quote = value[0];

		value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
		// Escapes are only escapes inside double quotes; elsewhere a backslash
		// is a literal the value is entitled to contain.
		if (quote === '"') {
			value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
		}

		entries.push({ key, value });
		match = LINE.exec(normalised);
	}

	return entries;
}

/**
 * Valid means "the parser found something to import", deliberately: deriving
 * this from `parseEnvContent` is what stops the two disagreeing, which a
 * separate line pattern quietly allowed — a file could pass this check and
 * then parse into different entries, or none.
 */
export function validateEnvContent(
	text: string,
): { ok: true } | { ok: false; error: string } {
	if (text.includes("\0")) return INVALID;
	return parseEnvContent(text).length > 0 ? { ok: true } : INVALID;
}
