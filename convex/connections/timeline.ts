import { clip } from "../lib/clip";
/**
 * A2: how a connected post's views arrived, day by day (Zernio's post timeline), merged into the
 * post's `history` so the ONE shape definition (core/normal.shapeOf: early, spike, slow burn,
 * steady) reads it like any other reading. Nothing new to cite but the readings themselves.
 *
 * Live recording 2026-10-01 (fixtures.live-2026-10-01.json): the endpoint answered 200 with ONE
 * row per post (the day Zernio started reading the account), whose views equal the post's
 * lifetime views. So the rows are taken as cumulative when they never fall and end at or under
 * the lifetime count; as per-day gains when they sum to it; and otherwise not at all (no guess).
 * Daily rows only: there is no hour-by-hour read for a post.
 */

import { v } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { mergeHistory, type Point } from "../core/normal";
import { postAnalyticsPage, postTimeline, type ZernioClient } from "../integrations/zernio/index";
import { postIdFromUrl } from "./analytics";

export const TIMELINE = { postsPerAccount: 6, windowDays: 30 } as const;
const DAY = 86_400_000;
const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);

export interface TimelineDay { date: string; views: number }

/** Pure: the timeline response → its days with views, oldest first. Null when the shape is wrong. */
export function normalizeTimeline(raw: unknown): TimelineDay[] | null {
  if (!isObj(raw) || !Array.isArray(raw.timeline)) return null;
  const byDate = new Map<string, number>();
  for (const r of raw.timeline) {
    if (!isObj(r) || typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    const views = typeof r.views === "number" && Number.isFinite(r.views) && r.views >= 0 ? r.views : null;
    if (views === null) continue;
    byDate.set(r.date, Math.max(byDate.get(r.date) ?? 0, views));
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, views]) => ({ date, views }));
}

/**
 * Pure: the days as cumulative readings (end of each day, never after `now`), or null when they
 * can't be read either way. `lifetime` is the post's connected view count, the check on both readings.
 */
export function toReadings(days: TimelineDay[], lifetime: number | null, now: number): Point[] | null {
  if (!days.length) return null;
  const at = (d: string) => Math.min(now, Date.parse(`${d}T23:59:59Z`));
  const rising = days.every((d, i) => i === 0 || d.views >= days[i - 1].views);
  const last = days[days.length - 1].views;
  const tol = (x: number) => (lifetime === null ? true : x <= lifetime * 1.05 + 1);
  if (rising && tol(last)) return days.map((d) => ({ at: at(d.date), views: d.views }));
  const sum = days.reduce((s, d) => s + d.views, 0);
  if (lifetime !== null && sum <= lifetime * 1.05 + 1 && sum >= lifetime * 0.9) {
    let run = 0;
    return days.map((d) => ({ at: at(d.date), views: (run += d.views) }));
  }
  return null;
}

/** Merge the readings into the post's history. Scoped to the creator; a post that isn't theirs is ignored. */
export const merge = internalMutation({
  args: { creatorId: v.id("creators"), platform: v.union(v.literal("tiktok"), v.literal("instagram")), postId: v.string(), readings: v.array(v.object({ at: v.number(), views: v.number() })) },
  handler: async (ctx, a): Promise<{ merged: boolean; readings: number }> => {
    const p = (await ctx.db.query("ownPosts").withIndex("by_creator_post", (q) => q.eq("creatorId", a.creatorId).eq("platform", a.platform).eq("postId", a.postId)).first()) as Doc<"ownPosts"> | null;
    if (!p) return { merged: false, readings: 0 };
    const history = mergeHistory(p.history, a.readings.slice(0, 120));
    await ctx.db.patch(p._id, { history });
    return { merged: true, readings: history.length };
  },
});

type Row = { _id?: string; publishedAt?: string | null; platformPostUrl?: string | null; analytics?: Record<string, unknown> | null; platforms?: Array<{ platformPostUrl?: string | null; analytics?: Record<string, unknown> | null }> };

/** The daily read for one account (from insightsSync's pass): its posts of the last 30 days, at most six, newest first. */
export async function syncAccountTimelines(ctx: ActionCtx, c: ZernioClient, creatorId: Id<"creators">, acc: { accountId: string; platform: "tiktok" | "instagram" }, now: number, classify: (e: unknown) => string): Promise<{ posts: number; merged: number; failure?: string }> {
  let rows: Row[];
  try {
    const page = (await postAnalyticsPage(c, { accountId: acc.accountId, fromDate: new Date(now - TIMELINE.windowDays * DAY).toISOString().slice(0, 10), limit: 20 })) as { posts?: Row[] } | null;
    rows = (page?.posts ?? []).slice(0, TIMELINE.postsPerAccount);
  } catch (e) {
    // No add-on, no scope, not found: not available for this account, said by the other reads; not a failure.
    if (classify(e) === "not_available") return { posts: 0, merged: 0 };
    return { posts: 0, merged: 0, failure: e instanceof Error ? clip(e.message, 160) : "post list failed" };
  }
  let merged = 0;
  for (const r of rows) {
    const url = r.platforms?.[0]?.platformPostUrl ?? r.platformPostUrl ?? null;
    const postId = postIdFromUrl(url);
    if (!r._id || !postId) continue;
    const a = r.platforms?.[0]?.analytics ?? r.analytics ?? null;
    const lifetime = typeof a?.views === "number" ? a.views : null;
    try {
      const days = normalizeTimeline(await postTimeline(c, r._id));
      const readings = days ? toReadings(days, lifetime, now) : null;
      if (!readings) continue;
      const res = await ctx.runMutation(internal.connections.timeline.merge, { creatorId, platform: acc.platform, postId, readings });
      if (res.merged) merged++;
    } catch (e) {
      if (classify(e) === "not_available") return { posts: rows.length, merged };
      return { posts: rows.length, merged, failure: e instanceof Error ? clip(e.message, 160) : "timeline failed" };
    }
  }
  return { posts: rows.length, merged };
}
