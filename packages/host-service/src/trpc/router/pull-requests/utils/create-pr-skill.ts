import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MANAGED_SKILL_MARKER } from "@superset/agent-setup";
import { getBundledPluginDir } from "@superset/agent-setup/config";

export const CREATE_PR_SKILL_NAME = "create-pr";

/** Repo-relative path a project writes to override the skill. */
export const PROJECT_SKILL_RELATIVE_PATH = path.join(
	".agents",
	"skills",
	CREATE_PR_SKILL_NAME,
	"SKILL.md",
);

/** Home-relative path a user writes to override the skill for every
 * project. Unprefixed on purpose: it is never provisioned, so nothing
 * Superset does can overwrite or reap it. */
export const USER_SKILL_RELATIVE_PATH = path.join(
	".agents",
	"skills",
	CREATE_PR_SKILL_NAME,
	"SKILL.md",
);

/** Home-relative path of the copy managed-skills provisions for every agent
 * CLI. It carries the managed marker; a user who edits it and leaves the
 * marker in place gets it overwritten on the next sync, which is why the
 * unprefixed path above is the one advertised for edits. */
export const MANAGED_SKILL_RELATIVE_PATH = path.join(
	".agents",
	"skills",
	`superset-${CREATE_PR_SKILL_NAME}`,
	"SKILL.md",
);

export type CreatePrSkillSource = "project" | "user" | "bundled";

export interface ResolvedCreatePrSkill {
	source: CreatePrSkillSource;
	path: string;
	/** SKILL.md without its frontmatter or the managed-file marker. */
	body: string;
}

/** Drops the YAML frontmatter block and the provisioner's marker comment.
 * Line endings are normalized first so a CRLF file (Windows editors) is
 * parsed the same way. */
export function stripSkillFrontmatter(content: string): string {
	let body = content.replace(/\r\n?/g, "\n");
	if (body.startsWith("---\n")) {
		const end = body.indexOf("\n---\n", 4);
		if (end !== -1) body = body.slice(end + "\n---\n".length);
	}
	return body.replaceAll(`${MANAGED_SKILL_MARKER}\n`, "").trim();
}

/** Null only when the path is absent; any other read failure (permissions,
 * a directory in the file's place) propagates with the path attached, so a
 * broken override is reported rather than silently replaced. */
async function readIfExists(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return null;
		throw new Error(
			`Could not read create-pr skill at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

/**
 * The `create-pr` skill the agent follows, most specific first: the project's
 * own `.agents/skills/create-pr` (or `.claude/skills/create-pr`, which Claude
 * Code reads directly), the user's `~/.agents/skills/create-pr`, the copy
 * managed-skills provisioned (user-owned once its marker is removed), then
 * the bundled default. Null only when the bundle itself is missing.
 */
export async function resolveCreatePrSkill({
	worktreePath,
	homeDir = os.homedir(),
	bundledPluginDir = getBundledPluginDir(),
}: {
	worktreePath: string;
	homeDir?: string;
	bundledPluginDir?: string;
}): Promise<ResolvedCreatePrSkill | null> {
	const candidates: Array<{ source: CreatePrSkillSource; path: string }> = [
		{
			source: "project",
			path: path.join(worktreePath, PROJECT_SKILL_RELATIVE_PATH),
		},
		{
			source: "project",
			path: path.join(
				worktreePath,
				".claude",
				"skills",
				CREATE_PR_SKILL_NAME,
				"SKILL.md",
			),
		},
		{ source: "user", path: path.join(homeDir, USER_SKILL_RELATIVE_PATH) },
		{ source: "user", path: path.join(homeDir, MANAGED_SKILL_RELATIVE_PATH) },
		{
			source: "bundled",
			path: path.join(
				bundledPluginDir,
				"skills",
				CREATE_PR_SKILL_NAME,
				"SKILL.md",
			),
		},
	];
	for (const candidate of candidates) {
		const content = await readIfExists(candidate.path);
		if (content === null) continue;
		const body = stripSkillFrontmatter(content);
		if (!body) continue;
		return { ...candidate, body };
	}
	return null;
}
