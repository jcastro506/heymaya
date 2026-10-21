/**
 * The readback (plan §6 Sprint 4, §21.5; every 6 h since B1): refresh the creator's own posts
 * and metrics, recompute multiples, and turn a post crossing 3× their baseline
 * into a `win` signal so she can say something while it is happening. Idea matching
 * (§13.5, the `match-post` skill) attaches here next.
 */

import { enabledPlatforms } from "../config/platforms";
import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { THRESHOLDS } from "../config/thresholds";
import { pairedRows } from "../core/schedule";
import { addNoticed, type NewCandidate } from "../core/editor";

export const WIN_MULTIPLE = 3;

export const pairedCreators = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"creators">; handles: { tiktok?: string; instagram?: string } }>> => {
    return (await pairedRows(ctx)).filter((c) => c.status !== "deleting").map((c) => ({ id: c.creatorId, handles: c.handles }));
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
      // Sprint 4e: a win is judged on reach where the account is connected, and says so.
      const onReach = p.reachMultiple !== undefined;
      const mult = p.reachMultiple ?? p.multiple;
      if (seen.has(p.postId) || mult === undefined || mult < WIN_MULTIPLE || ageHours > 7 * 24) continue;
      await ctx.db.insert("signals", {
        creatorId: a.creatorId,
        kind: "win",
        sourcePostIds: [p.postId],
        score: mult,
        corroboration: { accounts: 0, soundRising: false },
        verdict: "pending",
        url: p.url,
        detected: onReach && p.connected?.reach != null
          ? `their own post reached ${p.connected.reach.toLocaleString()} people, ${mult}× their normal reach (connected; ${p.metrics.views.toLocaleString()} views, ${Math.round(ageHours)}h old); ${p.url}`
          : `their own post is at ${mult}× their normal (${p.metrics.views.toLocaleString()} views, ${Math.round(ageHours)}h old); ${p.url}`,
        why: onReach && p.connected?.reach != null
          ? `their own post reached ${p.connected.reach.toLocaleString()} people, ${mult}× their normal reach (connected; ${p.metrics.views.toLocaleString()} views, ${Math.round(ageHours)}h old); ${p.url}`
          : `their own post is at ${mult}× their normal (${p.metrics.views.toLocaleString()} views, ${Math.round(ageHours)}h old); ${p.url}`,
        thresholdsVersion: THRESHOLDS.version,
        createdAt: a.now,
      });
      written += 1;
    }
    return { written };
  },
});

/**
 * Pure (2026-10-21): the day after they post, an honest read is a candidate for her one text. A tester asked
 * "what do you think" about a post that did 0.41× her usual and got cheering; a friend who knows TikTok says
 * what worked and the one thing to try. Wins (3×+) have their own path; this is every other post, once.
 */
export function postReadCandidate(p: Pick<Doc<"ownPosts">, "postId" | "url" | "caption" | "createTime" | "multiple" | "reachMultiple" | "metrics">, card: unknown, now: number): NewCandidate | null {
  const ageH = (now - p.createTime) / 3_600_000;
  const mult = p.reachMultiple ?? p.multiple;
  if (ageH < 18 || ageH > 48 || mult === undefined || mult >= WIN_MULTIPLE) return null;
  const how = mult >= 1.3 ? "above their usual" : mult >= 0.8 ? "about their usual" : "below their usual";
  const saw = card && typeof card === "object" ? JSON.stringify(card).slice(0, 400) : "";
  return {
    id: `post_read:${p.postId}`, kind: "post_read", sourceKey: `post_read:${p.postId}`, base: 3, ttlMs: 30 * 3_600_000, link: p.url,
    summary: `their post from yesterday ("${p.caption.split("\n")[0].slice(0, 70)}") is doing ${how} (${p.metrics.views.toLocaleString()} views, ${mult}× their normal)${saw ? `; what you saw in it: ${saw}` : ""}`,
  };
}

export const noticePostRead = internalMutation({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ added: boolean }> => {
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(10)) as Doc<"ownPosts">[];
    const reads = (await ctx.db.query("ownPostReads").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"ownPostReads">[];
    for (const p of posts) {
      const cand = postReadCandidate(p, reads.find((r) => r.ownPostId === p._id)?.card ?? null, a.now);
      if (cand) return await addNoticed(ctx, a.creatorId, cand, a.now); // the newest one only
    }
    return { added: false };
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{ creators: number; wins: number; failed: number }> => {
    const now = Date.now();
    const bucket = `${new Date(now).toISOString().slice(0, 10)}-${Math.floor(new Date(now).getUTCHours() / 6)}`; // one feed read per 6 h slot
    const creators = await ctx.runQuery(internal.scout.readback.pairedCreators, {});
    let wins = 0, failed = 0;
    for (const c of creators) {
      try {
        for (const platform of enabledPlatforms()) {
          const handle = c.handles[platform];
          if (!handle) continue;
          const r = await ctx.runAction(internal.reads.read.read, { kind: "account.posts", params: { platform, handle, sort: "latest", slot: `readback-${bucket}` }, creatorId: c.id });
          const posts = Array.isArray(r.value) ? r.value : [];
          const up = await ctx.runMutation(internal.onboarding.ingest.upsertOwnPosts, { creatorId: c.id, posts, now, handle });
          // 2026-09-07: her picture of them froze at onboarding; every new post is watched too,
          // so the person she knows keeps up with the person posting. A failed watch is a card
          // marked degraded, never a missing post.
          for (const ownPostId of up.insertedIds.slice(0, 3)) {
            try { await ctx.runAction(internal.onboarding.watch.watchPost, { creatorId: c.id, ownPostId }); } catch (err) { console.error(`[readback] watch failed: ${String(err).slice(0, 120)}`); }
            try { await ctx.runAction(internal.agent.postMemory.indexPost, { creatorId: c.id, ownPostId }); } catch (err) { console.error(`[readback] post memory failed: ${String(err).slice(0, 120)}`); }
            // §24: a viewer's line within the hour of noticing, from the card she just made.
            try { await ctx.runAction(internal.agent.cadence.sawIt, { creatorId: c.id, ownPostId, now }); } catch (err) { console.error(`[readback] saw-it failed: ${String(err).slice(0, 120)}`); }
          }
        }
        await ctx.runMutation(internal.onboarding.ingest.computeMultiples, { creatorId: c.id });
        // Avatars for their handles and the accounts they watch, only the ones still missing.
        try { await ctx.runAction(internal.media.refreshAvatars, { creatorId: c.id }); } catch (err) { console.error(`[readback] avatars: ${String(err).slice(0, 120)}`); }
        await ctx.runMutation(internal.review.predictions.scoreDue, { creatorId: c.id, now }); // §13.6: the 48 h outcome beside the call
        const { written } = await ctx.runMutation(internal.scout.readback.writeWins, { creatorId: c.id, now });
        wins += written;
        await ctx.runMutation(internal.scout.readback.noticePostRead, { creatorId: c.id, now });
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
