import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_OUTBOUND_CHARS } from "../../../imessage/index.ts";
import {
	getImessageSettings,
	setImessageSettings,
} from "../../../imessage/settings";
import { protectedProcedure, router } from "../../index";

const setInputSchema = z.object({
	enabled: z.boolean(),
	handles: z
		.array(z.string().trim().min(3).max(320))
		.max(5, "Allowlist at most 5 handles"),
});

const replyInputSchema = z.object({
	text: z.string().trim().min(1).max(MAX_OUTBOUND_CHARS),
	to: z.string().trim().min(3).max(320).optional(),
});

export const imessageRouter = router({
	get: protectedProcedure.query(({ ctx }) => ({
		...getImessageSettings(ctx.db),
		status: ctx.runtime.imessage.status(),
	})),

	set: protectedProcedure.input(setInputSchema).mutation(({ ctx, input }) => {
		setImessageSettings(ctx.db, input);
		ctx.runtime.imessage.applySettings(input);
		return {
			...getImessageSettings(ctx.db),
			status: ctx.runtime.imessage.status(),
		};
	}),

	status: protectedProcedure.query(({ ctx }) => ctx.runtime.imessage.status()),

	reply: protectedProcedure
		.input(replyInputSchema)
		.mutation(async ({ ctx, input }) => {
			try {
				return await ctx.runtime.imessage.reply(input);
			} catch (error) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						error instanceof Error ? error.message : "Could not send iMessage",
				});
			}
		}),
});
