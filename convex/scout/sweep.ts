/**
 * The niche sweep (plan §3.2, §6 Sprint 2): once a day per distinct lane keyword
 * across the fleet, search TikTok and Instagram, write observations tagged with the
 * keyword, and turn the fastest-moving posts into `shape` signals for every creator
 * whose dossier carries that keyword. Shared by keyword, never by creator.
 *
 * v1 ranking: views per hour since posting within the search page; the top few per
 * keyword become candidates. Format cards and corroboration (§13.2) refine this once
 * the watcher runs on the lane.
 */

import { v } from "convex/values";
import { coverKey, rememberMedia } from "../media";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { THRESHOLDS } from "../config/thresholds";
import { pairedRows } from "../core/schedule";

const PER_KEYWORD = 3;

interface Post {
  postId: string;
  url: string | null;
  caption: string | null;
  postedAt: number | null;
  metrics: { viewCount: number | null; likeCount: number | null; commentCount: number | null; shareCount: number | null; saveCount: number | null };
  authorHandle?: string | null;
  thumbnailUrl?: string | null;
  raw?: { is_ad?: boolean; author?: { unique_id?: string } } | null;
}

/** Every distinct validated keyword across dossiers, with the creators who carry it. */
export const distinctKeywords = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ keyword: string; creatorIds: Id<"creators">[] }>> => {
    const map = new Map<string, Id<"creators">[]>();
    for (const c of await pairedRows(ctx)) {
      for (const k of c.keywords.slice(0, 8)) map.set(k, [...(map.get(k) ?? []), c.creatorId]);
    }
    return [...map.entries()].map(([keyword, creatorIds]) => ({ keyword, creatorIds }));
  },
});

export const keywordsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Array<{ keyword: string; creatorIds: Id<"creators">[] }>> => {
    const row = await ctx.db.query("schedule").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).first();
    return (row?.keywords ?? []).slice(0, 8).map((keyword) => ({ keyword, creatorIds: [a.creatorId] }));
  },
});

export const recordSearch = internalMutation({
  args: { platform: v.union(v.literal("tiktok"), v.literal("instagram")), keyword: v.string(), posts: v.any(), now: v.number() },
  handler: async (ctx, a): Promise<Array<{ postId: string; url: string; author: string; velocity: number; views: number; ageHours: number }>> => {
    const posts = (a.posts as Post[]).filter((p) => p.postId);
    await rememberMedia(ctx, posts.filter((p) => p.thumbnailUrl).slice(0, 12).map((p) => ({ platform: a.platform, kind: "cover" as const, key: coverKey(a.platform, p.url, p.postId) ?? p.postId, url: p.thumbnailUrl! })));
    const out: Array<{ postId: string; url: string; author: string; velocity: number; views: number; ageHours: number }> = [];
    for (const p of posts) {
      const createTime = p.postedAt ? (p.postedAt < 1e12 ? p.postedAt * 1000 : p.postedAt) : a.now;
      const ageHours = Math.max(0.5, (a.now - createTime) / 3_600_000);
      const views = p.metrics.viewCount ?? 0;
      const author = (p.authorHandle ?? p.raw?.author?.unique_id ?? "").replace(/^@/, "");
      const url = p.url ?? (a.platform === "tiktok" && author ? `https://www.tiktok.com/@${author}/video/${p.postId}` : "");
      if (p.raw?.is_ad) continue;
      await ctx.db.insert("observations", {
        platform: a.platform,
        postId: p.postId,
        authorHandle: author,
        url,
        createTime,
        sampledAt: a.now,
        ageHours,
        views,
        likes: p.metrics.likeCount ?? 0,
        comments: p.metrics.commentCount ?? 0,
        shares: p.metrics.shareCount ?? 0,
        saves: p.metrics.saveCount ?? undefined,
        clipId: (p as { clipId?: string | null }).clipId ?? undefined,
        keywords: [a.keyword],
        source: `search.${a.platform}`,
        paidPromotion: false,
      });
      out.push({ postId: p.postId, url, author, velocity: views / ageHours, views, ageHours: Number(ageHours.toFixed(1)) });
    }
    return out.sort((x, y) => y.velocity - x.velocity).slice(0, PER_KEYWORD);
  },
});

export const writeShapes = internalMutation({
  args: { creatorId: v.id("creators"), keyword: v.string(), picks: v.array(v.object({ postId: v.string(), url: v.string(), author: v.string(), velocity: v.number(), views: v.number(), ageHours: v.number() })), now: v.number() },
  handler: async (ctx, a): Promise<{ written: number }> => {
    const existing = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).collect()) as Doc<"signals">[];
    const seen = new Set(existing.flatMap((s) => s.sourcePostIds));
    let written = 0;
    for (const p of a.picks) {
      if (!p.url || seen.has(p.postId)) continue;
      await ctx.db.insert("signals", {
        creatorId: a.creatorId,
        kind: "shape",
        sourcePostIds: [p.postId],
        score: Math.min(10, Number((p.velocity / 1000).toFixed(2))), // views per hour, in thousands; a lane-relative score arrives with benchmarks
        corroboration: { accounts: 0, soundRising: false },
        verdict: "pending",
        url: p.url,
        detected: `top of the lane for "${a.keyword}" this week: ${p.views.toLocaleString()} views at ${p.ageHours}h by @${p.author}; ${p.url}`,
        why: `top of the lane for "${a.keyword}" this week: ${p.views.toLocaleString()} views at ${p.ageHours}h by @${p.author}; ${p.url}`,
        thresholdsVersion: THRESHOLDS.version,
        createdAt: a.now,
      });
      written += 1;
    }
    return { written };
  },
});

export const run = internalAction({
  // `creatorId`: only that creator's keywords (the living simulation; eval creators aren't in the fleet sweep).
  args: { creatorId: v.optional(v.id("creators")) },
  handler: async (ctx, args): Promise<{ keywords: number; signals: number; failed: number }> => {
    const now = Date.now();
    const keywords = args.creatorId ? await ctx.runQuery(internal.scout.sweep.keywordsFor, { creatorId: args.creatorId }) : await ctx.runQuery(internal.scout.sweep.distinctKeywords, {});
    let signals = 0, failed = 0;
    for (const { keyword, creatorIds } of keywords) {
      for (const platform of ["tiktok", "instagram"] as const) {
        try {
          const r = await ctx.runAction(internal.reads.read.read, {
            kind: platform === "tiktok" ? "search.keyword" : "search.reels",
            params: platform === "tiktok" ? { keyword, window: "this-week", sort: "most-liked" } : { keyword, window: "last-week" },
          });
          const value = r.value as { posts?: Post[]; raw?: unknown } | Post[] | null;
          const posts = Array.isArray(value) ? value : (value?.posts ?? []);
          if (!posts.length) continue;
          const picks = await ctx.runMutation(internal.scout.sweep.recordSearch, { platform, keyword, posts, now });
          for (const creatorId of creatorIds) {
            const { written } = await ctx.runMutation(internal.scout.sweep.writeShapes, { creatorId, keyword, picks, now });
            signals += written;
          }
        } catch (error) {
          failed += 1;
          console.error(`[sweep] ${platform}/${keyword}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return { keywords: keywords.length, signals, failed };
  },
});
