export interface ParsedEnvEntry {
	key: string;
	value: string;
}

export function parseEnvFile(contents: string): ParsedEnvEntry[] {
	const entries: ParsedEnvEntry[] = [];
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const withoutExport = line.startsWith("export ")
			? line.slice("export ".length).trim()
			: line;
		const separator = withoutExport.indexOf("=");
		if (separator <= 0) continue;
		const key = withoutExport.slice(0, separator).trim();
		let value = withoutExport.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
			(value.startsWith("'") && value.endsWith("'") && value.length > 1)
		) {
			value = value.slice(1, -1);
		}
		entries.push({ key, value });
	}
	return entries;
}
