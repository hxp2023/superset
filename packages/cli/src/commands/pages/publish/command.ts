import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { boolean, CLIError, positional, string } from "@superset/cli-framework";
import { lookup as lookupMimeType } from "mime-types";
import { command } from "../../../lib/command";
import { resolveWorkspaceId } from "../workspaceRef";
import {
	collectDirectoryPublish,
	type DirectoryAsset,
	videoCodecWarning,
} from "./directory";
import {
	EXTERNAL_ENTRY_PREFIX,
	externalEntryPath,
	resolveEntryPath,
} from "./entryPath";
import { registerWatch, watchTerminalId } from "./registerWatch";

const VISIBILITIES = ["just_me", "org"] as const;

export default command({
	description: "Publish an HTML file, or a directory of files, as a page",
	args: [
		positional("path")
			.required()
			.desc(
				"Path to the .html file, or a directory whose index.html is the page",
			),
	],
	options: {
		title: string().desc("Page title (defaults to the file or directory name)"),
		description: string().desc("Short description"),
		label: string()
			.alias("l")
			.desc("What changed in this version, shown in the version history"),
		visibility: string().desc(`One of: ${VISIBILITIES.join(", ")}`),
		page: string().desc(
			"Publish a new version of this page id, instead of resolving by workspace",
		),
		workspace: string().desc(
			"Workspace to publish into, by name or id (defaults to $SUPERSET_WORKSPACE_ID)",
		),
		noWatch: boolean().desc(
			"Do not watch this page for new comments from this session",
		),
	},
	run: async ({ ctx, args, options }) => {
		const inputPath = resolve(process.cwd(), args.path as string);
		const stat = statSync(inputPath, { throwIfNoEntry: false });
		if (!stat) {
			throw new CLIError(`No such file or directory: ${args.path}`);
		}

		let entryFilePath = inputPath;
		let assets: DirectoryAsset[] = [];
		const isDirectory = stat.isDirectory();
		if (isDirectory) {
			try {
				({ entryFilePath, assets } = collectDirectoryPublish(inputPath));
			} catch (error) {
				throw new CLIError(
					error instanceof Error ? error.message : String(error),
					"A directory publish serves index.html as the page and every other file at its relative path",
				);
			}
		} else {
			if (!stat.isFile()) {
				throw new CLIError(`No such file: ${args.path}`);
			}
			if (extname(inputPath).toLowerCase() !== ".html") {
				throw new CLIError(
					"Only .html files can be published as a page",
					"Publish a single self-contained file, or a directory whose index.html references its assets by relative path",
				);
			}
		}
		if (
			options.visibility &&
			!VISIBILITIES.includes(options.visibility as never)
		) {
			throw new CLIError(
				`Invalid visibility: ${options.visibility}`,
				`Use one of: ${VISIBILITIES.join(", ")}`,
			);
		}

		const html = readFileSync(entryFilePath, "utf8");

		const entryPath =
			resolveEntryPath({
				filePath: entryFilePath,
				workspacePath: process.env.SUPERSET_WORKSPACE_PATH,
			}) ??
			(isDirectory
				? `${EXTERNAL_ENTRY_PREFIX}${basename(inputPath)}/index.html`
				: externalEntryPath(entryFilePath));

		const workspaceRef = options.workspace ?? process.env.SUPERSET_WORKSPACE_ID;
		if (!workspaceRef && !options.page) {
			throw new CLIError(
				"No workspace to publish into",
				"Run this inside a Superset workspace, pass --workspace <name|id>, or pass --page <id> to add a version to an existing page",
			);
		}
		const workspaceId = workspaceRef
			? await resolveWorkspaceId({
					value: workspaceRef,
					organizationId: ctx.config.organizationId,
					userJwt: ctx.bearer,
					api: ctx.api,
				})
			: undefined;
		const link = workspaceId ? { entryPath, workspaceId } : undefined;

		// Republishing a directory re-uploads only what changed: hashes are
		// compared against the previous version's files. Best effort — a
		// failed lookup just means every asset uploads.
		let previous: Map<string, { fileId: string; sha256: string }> | null = null;
		if (assets.length > 0) {
			try {
				const target = options.page
					? { pageId: options.page }
					: link
						? { workspaceId: link.workspaceId, entryPath: link.entryPath }
						: null;
				const resolved = target
					? await ctx.api.page.resolveByEntryPath.query(target)
					: null;
				if (resolved?.latestVersionId) {
					const listed = await ctx.api.file.list.query({
						parentKind: "page_version",
						parentId: resolved.latestVersionId,
					});
					previous = new Map();
					for (const item of listed) {
						if (item.path) {
							previous.set(item.path, {
								fileId: item.file.id,
								sha256: item.file.sha256,
							});
						}
					}
				}
			} catch {
				previous = null;
			}
		}

		const warnings: string[] = [];
		const published: { path: string; fileId: string }[] = [];
		let reused = 0;
		for (const asset of assets) {
			const bytes = readFileSync(asset.filePath);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			const warning = videoCodecWarning(asset.path, bytes.subarray(0, 16));
			if (warning) warnings.push(warning);

			const match = previous?.get(asset.path);
			if (match && match.sha256 === sha256) {
				published.push({ path: asset.path, fileId: match.fileId });
				reused += 1;
				continue;
			}

			const created = await ctx.api.file.createUpload.mutate({
				name: basename(asset.path),
				contentType: lookupMimeType(asset.path) || "application/octet-stream",
				sizeBytes: asset.sizeBytes,
				sha256,
			});
			const response = await fetch(created.uploadUrl, {
				method: "PUT",
				headers: created.headers,
				body: bytes,
			});
			if (!response.ok) {
				throw new CLIError(
					`Uploading ${asset.path} failed (${response.status})`,
				);
			}
			await ctx.api.file.complete.mutate({ id: created.id });
			published.push({ path: asset.path, fileId: created.id });
		}

		const defaultTitle =
			isDirectory && !options.title
				? basename(inputPath).replace(/[-_]+/g, " ").trim()
				: undefined;

		const page = await ctx.api.page.publish.mutate({
			content: Buffer.from(html, "utf8").toString("base64"),
			contentType: "text/html",
			filename: basename(entryFilePath),
			...(link ?? {}),
			...(published.length > 0 ? { assets: published } : {}),
			...(options.page ? { pageId: options.page } : {}),
			...(options.title
				? { title: options.title }
				: defaultTitle
					? { title: defaultTitle }
					: {}),
			...(options.description ? { description: options.description } : {}),
			...(options.label ? { label: options.label } : {}),
			...(options.visibility
				? { visibility: options.visibility as (typeof VISIBILITIES)[number] }
				: {}),
		});

		const external =
			link && entryPath.startsWith(EXTERNAL_ENTRY_PREFIX) && !options.page
				? `\nOutside the workspace, so this page is keyed as "${entryPath}"`
				: "";
		const assetNote =
			assets.length > 0
				? `\n${assets.length} asset${assets.length === 1 ? "" : "s"}${reused > 0 ? ` (${reused} unchanged, not re-uploaded)` : ""}`
				: "";
		const warningNote = warnings.length > 0 ? `\n${warnings.join("\n")}` : "";

		const terminalId = watchTerminalId();
		const organizationId = ctx.config.organizationId;
		let watching = false;
		let watchNote = "";

		if (
			!options.noWatch &&
			workspaceId !== undefined &&
			terminalId !== undefined &&
			organizationId !== undefined
		) {
			try {
				await registerWatch({
					pageId: page.id,
					slug: page.slug,
					title: page.title,
					workspaceId,
					terminalId,
					organizationId,
					userJwt: ctx.bearer,
					api: ctx.api,
				});
				watching = true;
				watchNote =
					"\nWatching for comments — they will be sent to this session";
			} catch (error) {
				watchNote = `\nNot watching for comments: ${
					error instanceof Error ? error.message : "could not reach the host"
				}`;
			}
		}

		return {
			data: { ...page, watching, assets: published },
			message: `Published "${page.title}" v${page.version}\n${page.url}${assetNote}${warningNote}${external}${watchNote}`,
		};
	},
});
