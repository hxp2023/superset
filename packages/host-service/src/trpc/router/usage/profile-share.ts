/**
 * Shares account-agnostic Claude state between a secondary profile dir and
 * the default `~/.claude` home via symlinks, so every login sees one
 * conversation history, one prompt history, and one config set — switching
 * accounts stops meaning losing `--resume`, skills, and settings.
 *
 * Identity stays per-profile by design: `.claude.json` (oauthAccount,
 * per-project trust, MCP auth) and the credential stores are never touched.
 * Runtime dirs (daemon/, cache/, telemetry/, backups/) stay local too — the
 * daemon's locks and sockets must not be shared between CLIs.
 *
 * Existing real state is merged, not clobbered. Session trees are renamed
 * aside, the symlink lands immediately, and files then move into `~/.claude`
 * one by one: renames preserve inodes, so a live session's open transcripts
 * stay valid and its paths resolve through the new link. The prompt history
 * is appended; a divergent settings.json is backed up beside the link.
 * Anything that cannot merge safely is left where it is.
 */

import {
	appendFileSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

/** Config the user authors once and expects everywhere. Linked only when
 * the profile has nothing of its own (absent or empty) — a profile that
 * deliberately diverged keeps its version. */
const CONFIG_DIRS = ["agents", "commands", "skills", "hooks", "plugins"];
const CONFIG_FILES = ["CLAUDE.md"];

/** Session-scoped state keyed by session UUID or cwd slug: safe to merge
 * file-by-file, since two profiles' sessions collide no more than two
 * concurrent sessions in one dir already do. */
const SESSION_DIRS = [
	"projects",
	"sessions",
	"session-env",
	"file-history",
	"shell-snapshots",
	"todos",
	"paste-cache",
	"tasks",
	"plans",
	"transcripts",
];

const MERGE_SUFFIX = ".superset-merge";

/** Resolved profile dir, or null when it IS a default home (never share a
 * default home into itself, and never operate on `~`). */
export function shareableProfileDir(
	configDir: string,
	mainHome: string,
): string | null {
	const resolved = resolve(configDir);
	const home = homedir();
	const excluded = new Set([
		home,
		join(home, ".claude"),
		join(home, ".config"),
		join(home, ".config", "claude"),
		resolve(mainHome),
	]);
	return excluded.has(resolved) ? null : resolved;
}

function lstatOrNull(path: string) {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

/**
 * Moves every file under `srcDir` into `dstDir`, creating dirs as needed.
 * Conflicts (a path that already exists in `dstDir`) are left behind in
 * `srcDir`; empty dirs are pruned as the move drains them.
 */
function moveTreeInto(srcDir: string, dstDir: string): void {
	for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
		const from = join(srcDir, entry.name);
		const to = join(dstDir, entry.name);
		if (entry.isDirectory()) {
			const toInfo = lstatOrNull(to);
			if (!toInfo) {
				renameSync(from, to);
				continue;
			}
			if (!toInfo.isDirectory()) continue;
			moveTreeInto(from, to);
		} else if (!lstatOrNull(to)) {
			renameSync(from, to);
		}
	}
	try {
		rmdirSync(srcDir);
	} catch {
		// Conflicts remain — the leftovers stay for the next run to retry.
	}
}

function linkConfigDir(profile: string, main: string, name: string): void {
	const src = join(profile, name);
	const info = lstatOrNull(src);
	if (info?.isSymbolicLink()) return;
	if (info && !info.isDirectory()) return;
	if (info && readdirSync(src).length > 0) return;
	mkdirSync(join(main, name), { recursive: true });
	if (info) rmdirSync(src);
	symlinkSync(join(main, name), src);
}

function linkConfigFile(profile: string, main: string, name: string): void {
	const src = join(profile, name);
	const target = join(main, name);
	const info = lstatOrNull(src);
	if (info?.isSymbolicLink()) return;
	if (info && (!info.isFile() || info.size > 0)) return;
	if (!lstatOrNull(target)) writeFileSync(target, "", { flag: "wx" });
	if (info) unlinkSync(src);
	symlinkSync(target, src);
}

function mergeAndLinkSessionDir(
	profile: string,
	main: string,
	name: string,
): void {
	const src = join(profile, name);
	const dst = join(main, name);
	const pending = `${src}${MERGE_SUFFIX}`;
	// Finish what an interrupted earlier merge left behind before anything
	// else — src may already be a symlink by now.
	if (lstatOrNull(pending)?.isDirectory()) {
		mkdirSync(dst, { recursive: true });
		moveTreeInto(pending, dst);
	}
	const info = lstatOrNull(src);
	if (info?.isSymbolicLink()) return;
	if (info && !info.isDirectory()) return;
	mkdirSync(dst, { recursive: true });
	if (!info) {
		symlinkSync(dst, src);
		return;
	}
	// Swap first, merge after: the path is only ever missing for the instant
	// between rename and symlink, and open file handles ride the renames.
	renameSync(src, pending);
	try {
		symlinkSync(dst, src);
	} catch {
		// A live CLI recreated the dir in the gap — restore and skip.
		moveTreeInto(pending, src);
		return;
	}
	moveTreeInto(pending, dst);
}

function mergeAndLinkHistory(profile: string, main: string): void {
	const src = join(profile, "history.jsonl");
	const dst = join(main, "history.jsonl");
	const pending = `${src}${MERGE_SUFFIX}`;
	if (lstatOrNull(pending)?.isFile()) {
		appendFileSync(dst, readFileSync(pending));
		unlinkSync(pending);
	}
	const info = lstatOrNull(src);
	if (info?.isSymbolicLink()) return;
	if (info && !info.isFile()) return;
	if (!lstatOrNull(dst)) appendFileSync(dst, "");
	if (!info) {
		symlinkSync(dst, src);
		return;
	}
	renameSync(src, pending);
	try {
		symlinkSync(dst, src);
	} catch {
		renameSync(pending, src);
		return;
	}
	appendFileSync(dst, readFileSync(pending));
	unlinkSync(pending);
}

function linkSettings(profile: string, main: string): void {
	const src = join(profile, "settings.json");
	const dst = join(main, "settings.json");
	const info = lstatOrNull(src);
	if (info?.isSymbolicLink()) return;
	if (info && !info.isFile()) return;
	const dstInfo = lstatOrNull(dst);
	if (dstInfo && !dstInfo.isFile()) return;
	if (!info && !dstInfo) return;
	if (!dstInfo) {
		// Main has no settings yet — the profile's become the shared ones.
		renameSync(src, dst);
	} else if (info) {
		renameSync(src, `${src}.pre-share-${Date.now()}`);
	}
	symlinkSync(dst, src);
}

/**
 * Best-effort per entry: one unmergeable path must not stop the rest, and a
 * partially shared profile is strictly better than an unshared one.
 */
export function shareClaudeProfileState(
	configDir: string,
	mainHome: string = join(homedir(), ".claude"),
): void {
	// Windows symlinks need elevation; profiles are a macOS/Linux feature.
	if (platform() === "win32") return;
	const profile = shareableProfileDir(configDir, mainHome);
	if (!profile) return;
	const main = resolve(mainHome);
	const steps: Array<() => void> = [
		...CONFIG_DIRS.map((name) => () => linkConfigDir(profile, main, name)),
		...CONFIG_FILES.map((name) => () => linkConfigFile(profile, main, name)),
		...SESSION_DIRS.map(
			(name) => () => mergeAndLinkSessionDir(profile, main, name),
		),
		() => mergeAndLinkHistory(profile, main),
		() => linkSettings(profile, main),
	];
	for (const step of steps) {
		try {
			step();
		} catch {
			// Skipped entry; retried on the next switch to this profile.
		}
	}
}
