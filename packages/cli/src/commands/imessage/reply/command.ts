import { positional, string } from "@superset/cli-framework";
import { command } from "../../../lib/command";
import { resolveImessageHost } from "../target";

export default command({
	description:
		"Text the user back over iMessage — agents use this to answer messages the bridge delivered",
	options: {
		to: string().desc(
			"Allowlisted handle to text (default: the conversation the last message came from)",
		),
		host: string().desc("Host that runs the bridge (default: this machine)"),
	},
	args: [positional("body").required().desc("Message text")],
	run: async ({ ctx, options, args }) => {
		const target = await resolveImessageHost(ctx, options.host);
		const result = await target.client.imessage.reply.mutate({
			text: args.body as string,
			to: options.to,
		});
		return { data: result, message: `Sent to ${result.to}` };
	},
});
