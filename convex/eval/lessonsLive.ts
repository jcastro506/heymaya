/**
 * Live check of the first-week lessons (onboarding/lessons) on a scenario persona (never delivered: eval
 * personas are suppressed in messages.send). It makes the persona look a day old, sends one message through
 * the real reply path, reads what she wrote and whether the lesson was recorded, then puts the persona back.
 * A few model calls; no vendor reads.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { lessonsSaid } from "../onboarding/lessons";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const snapshot = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a) => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !/^eval/.test(c.clerkUserId ?? "")) throw new Error("eval personas only");
    return { channel: c.channel, milestonesSaid: c.milestonesSaid ?? [] };
  },
});

export const setState = internalMutation({
  args: { creatorId: v.id("creators"), channel: v.any(), milestonesSaid: v.array(v.string()) },
  handler: async (ctx, a) => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c || !/^eval/.test(c.clerkUserId ?? "")) throw new Error("eval personas only");
    await ctx.db.patch(a.creatorId, { channel: a.channel, milestonesSaid: a.milestonesSaid });
  },
});

export const run = internalAction({
  args: { creatorId: v.id("creators"), say: v.string() },
  handler: async (ctx, a): Promise<{ reply: string[]; lessonOffered: string | null; recorded: string[] }> => {
    const before = await ctx.runQuery(internal.eval.lessonsLive.snapshot, { creatorId: a.creatorId });
    const now = Date.now();
    await ctx.runMutation(internal.eval.lessonsLive.setState, { creatorId: a.creatorId, channel: { ...before.channel, paired: true, pairedAt: now - 86_400_000 }, milestonesSaid: before.milestonesSaid.filter((s) => !s.startsWith("lesson:")) });
    try {
      const { messageId } = await ctx.runMutation(internal.core.messages.recordInbound, { creatorId: a.creatorId, surface: "telegram", body: a.say });
      const g = await ctx.runQuery(internal.agent.context.gather, { creatorId: a.creatorId, messageId });
      await ctx.runAction(internal.agent.converse.run, { creatorId: a.creatorId, messageId });
      await sleep(500);
      const out = await ctx.runQuery(internal.eval.burstLive.outSince, { creatorId: a.creatorId, since: now });
      const after = await ctx.runQuery(internal.eval.lessonsLive.snapshot, { creatorId: a.creatorId });
      return { reply: out.map((o) => o.body), lessonOffered: g?.lesson?.id ?? null, recorded: lessonsSaid(after.milestonesSaid).map((l) => l.id) };
    } finally {
      await ctx.runMutation(internal.eval.lessonsLive.setState, { creatorId: a.creatorId, channel: before.channel, milestonesSaid: before.milestonesSaid });
    }
  },
});
