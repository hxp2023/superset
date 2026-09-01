import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SESSIONS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import { TRPCClientError } from "@trpc/client";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { seedProject } from "../helpers/seed";

describe("tag folders router integration", () => {
	let host: TestHost | undefined;

	afterEach(async () => {
		await host?.dispose();
		host = undefined;
	});

	test("accepts Sessions and existing project scopes", async () => {
		host = await createTestHost();
		const project = seedProject(host, { repoPath: "/tmp/tag-folder-project" });

		await host.trpc.tagFolders.upsert.mutate({
			scope: SESSIONS_TAG_SCOPE,
			tag: "api",
			color: "#0000ff",
		});
		await host.trpc.tagFolders.upsert.mutate({
			scope: project.id,
			tag: "api",
			color: "#ff0000",
		});

		const rows = await host.trpc.tagFolders.list.query();
		expect(rows).toHaveLength(2);
	});

	test("rejects arbitrary strings and nonexistent project UUIDs", async () => {
		host = await createTestHost();
		await expect(
			host.trpc.tagFolders.upsert.mutate({
				scope: "arbitrary-owner",
				tag: "api",
				color: "#ff0000",
			}),
		).rejects.toBeInstanceOf(TRPCClientError);

		try {
			await host.trpc.tagFolders.upsert.mutate({
				scope: randomUUID(),
				tag: "api",
				color: "#ff0000",
			});
			expect.unreachable("missing project scope should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(TRPCClientError);
			expect((error as TRPCClientError<unknown>).data?.code).toBe("NOT_FOUND");
		}
	});

	test("project removal atomically cleans its folder rows but keeps Sessions", async () => {
		host = await createTestHost();
		const project = seedProject(host, { repoPath: "/tmp/tag-folder-project" });
		await host.trpc.tagFolders.upsert.mutate({
			scope: project.id,
			tag: "api",
			color: "#ff0000",
		});
		await host.trpc.tagFolders.upsert.mutate({
			scope: SESSIONS_TAG_SCOPE,
			tag: "api",
			color: "#0000ff",
		});

		await host.trpc.project.remove.mutate({ projectId: project.id });
		const rows = await host.trpc.tagFolders.list.query();
		expect(rows).toEqual([
			{
				scope: SESSIONS_TAG_SCOPE,
				tag: "api",
				displayName: null,
				color: "#0000ff",
				tabOrder: null,
			},
		]);
	});
});
