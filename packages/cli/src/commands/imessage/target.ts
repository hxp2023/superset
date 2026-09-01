import { CLIError } from "@superset/cli-framework";
import { getHostId } from "@superset/shared/host-info";
import type { CliContext } from "../../lib/command";
import {
	type ResolvedHostTarget,
	resolveHostTarget,
} from "../../lib/host-target";

/**
 * The bridge lives on the Mac that is signed into Messages — the local host
 * unless --host points at another machine.
 */
export async function resolveImessageHost(
	ctx: CliContext,
	hostId: string | undefined,
): Promise<ResolvedHostTarget> {
	const organizationId = ctx.config.organizationId;
	if (!organizationId) {
		throw new CLIError("No active organization", "Run: superset auth login");
	}
	return resolveHostTarget({
		requestedHostId: hostId ?? getHostId(),
		organizationId,
		userJwt: ctx.bearer,
		api: ctx.api,
	});
}
