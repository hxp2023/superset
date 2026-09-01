import { string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveImessageHost } from "../target";

export default command({
	description: "Turn the iMessage bridge off (keeps the allowlist)",
	options: {
		host: string().desc("Host to configure (default: this machine)"),
	},
	run: async ({ ctx, options }) => {
		const target = await resolveImessageHost(ctx, options.host);
		const current = await target.client.imessage.get.query();
		const result = await target.client.imessage.set.mutate({
			enabled: false,
			handles: current.handles,
		});
		return { data: result, message: "iMessage bridge disabled" };
	},
});
