/**
 * Sends the first glance (rules in firstGlanceRules.ts). Scheduled on pairing; waits for their posts
 * to land (a few retries), and stands down once her full first read has gone out or they're unpaired.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { FIRST_GLANCE, glanceLine, type GlancePost } from "./firstGlanceRules";

export const facts = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ paired: boolean; firstReadSent: boolean; posts: GlancePost[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const firstRead = await ctx.db.query("messages").withIndex("by_creator_and_dedupe", (q) => q.eq("creatorId", a.creatorId).eq("dedupeKey", `first_read:${a.creatorId}`)).first();
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    return { paired: c.channel.paired === true, firstReadSent: firstRead !== null, posts: posts.map((p) => ({ caption: p.caption, multiple: p.multiple ?? null, createTime: p.createTime })) };
  },
});

export const send = internalAction({
  args: { creatorId: v.id("creators"), attempt: v.number(), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ sent: boolean; reason: string }> => {
    const f = await ctx.runQuery(internal.onboarding.firstGlance.facts, { creatorId: a.creatorId });
    if (!f) return { sent: false, reason: "no creator" };
    if (!f.paired) return { sent: false, reason: "not paired" };
    if (f.firstReadSent) return { sent: false, reason: "her full read already went out" };
    if (f.posts.length === 0) {
      if (a.attempt + 1 >= FIRST_GLANCE.maxAttempts) return { sent: false, reason: "no posts yet; stood down" };
      await ctx.scheduler.runAfter(FIRST_GLANCE.retryMs, internal.onboarding.firstGlance.send, { creatorId: a.creatorId, attempt: a.attempt + 1 });
      return { sent: false, reason: "waiting for their posts" };
    }
    const line = glanceLine(f.posts, a.now ?? Date.now());
    if (!line) return { sent: false, reason: "nothing stands out yet" };
    await ctx.runMutation(internal.core.messages.send, { creatorId: a.creatorId, surface: "telegram", body: line, dedupeKey: `first_glance:${a.creatorId}`, proactive: true, kind: "status", awaitingAnswer: false });
    return { sent: true, reason: "sent" };
  },
});
