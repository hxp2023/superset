import { CLIError, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveImessageHost } from "../target";

export default command({
	description:
		"Enable the iMessage bridge for the given conversation handle(s)",
	options: {
		handle: string()
			.variadic()
			.required()
			.desc(
				"Allowlisted sender — a phone in E.164 (+15551234567) or an email. Repeatable; replaces the current allowlist. Your own iMessage address watches the Messages-to-yourself chat",
			),
		host: string().desc("Host to configure (default: this machine)"),
	},
	run: async ({ ctx, options }) => {
		const target = await resolveImessageHost(ctx, options.host);
		const result = await target.client.imessage.set.mutate({
			enabled: true,
			handles: options.handle,
		});
		if (result.status.state === "error") {
			throw new CLIError(
				`Bridge could not start: ${result.status.lastError}`,
				"Grant Superset Full Disk Access (System Settings → Privacy & Security), then re-run",
			);
		}
		return {
			data: result,
			message: `iMessage bridge ${result.status.state} — text ${result.handles.join(" or ")} to reach your agents`,
		};
	},
});
