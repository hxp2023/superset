import { eq } from "drizzle-orm";
import type { HostDb } from "../../db/index.ts";
import { workspaces } from "../../db/schema.ts";
import {
	checkDockerAvailable,
	listManagedContainers,
	removeContainer,
} from "./docker-cli.ts";

/**
 * Startup sweep: remove Superset-managed containers whose workspace row is
 * gone or archived (deleted while docker was down, crashed mid-destroy).
 * Never starts containers — the first PTY of a live workspace does that.
 * Quiet no-op when docker isn't running.
 */
export async function runSandboxReconcile(db: HostDb): Promise<void> {
	const availability = await checkDockerAvailable();
	if (!availability.ok) return;

	const containers = await listManagedContainers();
	if (containers.length === 0) return;

	for (const container of containers) {
		const workspace = container.workspaceId
			? db.query.workspaces
					.findFirst({
						where: eq(workspaces.id, container.workspaceId),
					})
					.sync()
			: undefined;
		const live = workspace && workspace.archivedAt === null;
		if (live) continue;
		console.log(
			`[sandbox] reconcile: removing orphan container ${container.name}`,
		);
		await removeContainer(container.name);
	}
}
