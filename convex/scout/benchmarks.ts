/**
 * Lane benchmarks (plan §6 Sprint 4 "the lane median", §13.7). Context is the product:
 * "400 views" means nothing; "400 views, and the lane's median this week is 3,100" is
 * a statement. Built from `observations`, the by-product of watching the lane, so no
 * vendor call. Adapted from the parked legacy module with its three guards kept: too
 * few posts is `unusable`, one loud account is not a lane, and every number carries
 * when it was computed.
 */

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const MIN_POSTS = 8;
export const MIN_AUTHORS = 3;
const WEEK_MS = 7 * 86_400_000;

export interface LaneBenchmark { usable: boolean; posts: number; authors: number; medianViews: number | null; p75Views: number | null; medianEngagementPerView: number | null; keywords: string[]; computedAt: number; why: string }

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

/** Pure. */
export function computeLaneBenchmark(obs: Array<{ authorHandle: string; views: number; likes: number; comments: number; shares: number; saves?: number; keywords: string[] }>, now: number): LaneBenchmark {
  const keywords = Array.from(new Set(obs.flatMap((o) => o.keywords)));
  const authors = new Set(obs.map((o) => o.authorHandle)).size;
  const withViews = obs.filter((o) => o.views > 0);
  const base = { posts: obs.length, authors, keywords, computedAt: now };
  if (withViews.length < MIN_POSTS) return { ...base, usable: false, medianViews: null, p75Views: null, medianEngagementPerView: null, why: `only ${withViews.length} posts with views this week (needs ${MIN_POSTS})` };
  if (authors < MIN_AUTHORS) return { ...base, usable: false, medianViews: null, p75Views: null, medianEngagementPerView: null, why: `only ${authors} account${authors === 1 ? "" : "s"} behind it (needs ${MIN_AUTHORS}); that is a person, not a lane` };
  const views = withViews.map((o) => o.views);
  const eng = withViews.map((o) => ((o.saves ?? 0) + o.shares + o.comments) / o.views);
  return { ...base, usable: true, medianViews: quantile(views, 0.5), p75Views: quantile(views, 0.75), medianEngagementPerView: quantile(eng, 0.5), why: `${withViews.length} posts from ${authors} accounts this week` };
}

/** This creator's lane this week: observations that carry any of their keywords, or come from an account they watch. */
export const laneFor = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<LaneBenchmark> => await laneBenchmarkFor(ctx, a.creatorId, a.now),
});

export async function laneBenchmarkFor(ctx: QueryCtx, creatorId: Id<"creators">, now: number): Promise<LaneBenchmark> {
  const a = { creatorId, now };
  {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const keywords = ((c?.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map((k) => k.toLowerCase());
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"trackedAccounts">[];
    const handles = new Set(tracked.filter((t) => t.status === "active").map((t) => t.handle));
    const rows = (await ctx.db.query("observations").withIndex("by_sampledAt", (q) => q.gte("sampledAt", a.now - WEEK_MS)).collect()) as Doc<"observations">[];
    // Dedupe by post, newest sample wins.
    const byPost = new Map<string, Doc<"observations">>();
    for (const r of rows) {
      if (!(r.keywords.some((k) => keywords.includes(k.toLowerCase())) || handles.has(r.authorHandle))) continue;
      const cur = byPost.get(r.postId);
      if (!cur || r.sampledAt > cur.sampledAt) byPost.set(r.postId, r);
    }
    return computeLaneBenchmark(Array.from(byPost.values()).map((r) => ({ authorHandle: r.authorHandle, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves, keywords: r.keywords })), a.now);
  }
}

export type LaneCreatorId = Id<"creators">;
