import { string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveImessageHost } from "../target";

export default command({
	description: "Show the iMessage bridge's settings and state",
	options: {
		host: string().desc("Host to inspect (default: this machine)"),
	},
	run: async ({ ctx, options }) => {
		const target = await resolveImessageHost(ctx, options.host);
		const result = await target.client.imessage.get.query();
		const lines = [
			`state: ${result.status.state}`,
			`handles: ${result.handles.join(", ") || "(none)"}`,
			`active chat: ${result.status.activeChatIdentifier ?? "(none yet)"}`,
		];
		if (result.status.lastError)
			lines.push(`error: ${result.status.lastError}`);
		return { data: result, message: lines.join("\n") };
	},
});
