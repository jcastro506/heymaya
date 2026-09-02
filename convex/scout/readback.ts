/**
 * The daily readback (plan §6 Sprint 4, §21.5): refresh the creator's own posts and
 * metrics once a day, recompute multiples, and turn a post crossing 3× their baseline
 * into a `win` signal so she can say something while it is happening. Idea matching
 * (§13.5, the `match-post` skill) attaches here next.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { THRESHOLDS } from "../config/thresholds";

export const WIN_MULTIPLE = 3;

export const pairedCreators = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"creators">; handles: { tiktok?: string; instagram?: string } }>> => {
    const rows = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    return rows.filter((c) => c.channel.paired && c.plan.status !== "deleting").map((c) => ({ id: c._id, handles: c.handles }));
  },
});

export const writeWins = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ written: number }> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"ownPosts">[];
    const existing = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"signals">[];
    const seen = new Set(existing.filter((s) => s.kind === "win").flatMap((s) => s.sourcePostIds));
    let written = 0;
    for (const p of posts) {
      const ageHours = (a.now - p.createTime) / 3_600_000;
      if (seen.has(p.postId) || p.multiple === undefined || p.multiple < WIN_MULTIPLE || ageHours > 7 * 24) continue;
      await ctx.db.insert("signals", {
        creatorId: a.creatorId,
        kind: "win",
        sourcePostIds: [p.postId],
        score: p.multiple,
        corroboration: { accounts: 0, soundRising: false },
        verdict: "pending",
        why: `their own post is at ${p.multiple}× their normal (${p.metrics.views.toLocaleString()} views, ${Math.round(ageHours)}h old); ${p.url}`,
        thresholdsVersion: THRESHOLDS.version,
        createdAt: a.now,
      });
      written += 1;
    }
    return { written };
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; wins: number; failed: number }> => {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const creators = await ctx.runQuery(internal.scout.readback.pairedCreators, {});
    let wins = 0, failed = 0;
    for (const c of creators) {
      try {
        for (const platform of ["tiktok", "instagram"] as const) {
          const handle = c.handles[platform];
          if (!handle) continue;
          const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform, handle, sort: "latest", slot: `readback-${day}` }, creatorId: c.id });
          const posts = Array.isArray(r.value) ? r.value : [];
          await ctx.runMutation(internal.onboarding.ingest.upsertOwnPosts, { creatorId: c.id, posts, now, handle });
        }
        await ctx.runMutation(internal.onboarding.ingest.computeMultiples, { creatorId: c.id });
        await ctx.runMutation(internal.review.predictions.scoreDue, { creatorId: c.id, now }); // §13.6: the 48 h outcome beside the call
        const { written } = await ctx.runMutation(internal.scout.readback.writeWins, { creatorId: c.id, now });
        wins += written;
        // §13.5: did they make one of the ideas? A judgment, per new post, against the last 14 days of ideas.
        await ctx.runAction(internal.scout.matchPost.run, { creatorId: c.id });
      } catch (error) {
        failed += 1;
        console.error(`[readback] ${c.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { creators: creators.length, wins, failed };
  },
});
