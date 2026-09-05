/**
 * What she may say about one of THEIR posts (plan Sprint 4e): the numbers, each with its
 * basis, and the four-way diagnosis. Every consumer of own-post numbers goes through here so
 * "connected wins, labelled; stale falls back and says so; never mix bases" is one rule in
 * one place rather than a habit each skill has to remember.
 */

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { derive, type Connected, type Derived } from "./analytics";
import { normalReach } from "./sync";

/** Connected numbers older than this are said with their age, and the public number is used for judgments. */
export const STALE_AFTER_MS = 48 * 3_600_000;

export interface PostNumbers {
  url: string;
  platform: string;
  ageHours: number;
  /** The one number she should lead with, and where it came from. */
  headline: { value: number; what: "reach" | "views"; basis: "connected" | "public"; asOfHours: number | null };
  /** vs their normal: on reach where it exists, on views otherwise. Says which. */
  multiple: { value: number; basis: "reach" | "views" } | null;
  lines: string[];       // citeable facts, each carrying its basis in words
  cannotKnow: string[];  // what this platform does not give her, in words
  derived: Derived | null;
}

export function connectedFrom(p: Doc<"ownPosts">): Connected | null {
  const c = p.connected;
  if (!c) return null;
  return { platform: p.platform as "tiktok" | "instagram", postId: p.postId, url: p.url, publishedAt: p.createTime, asOf: c.asOf, syncStatus: c.syncStatus as Connected["syncStatus"], views: c.views, likes: c.likes, comments: c.comments, shares: c.shares, saves: c.saves, impressions: c.impressions, reach: c.reach, clicks: c.clicks, follows: c.follows, avgWatchMs: c.avgWatchMs, totalWatchMs: c.totalWatchMs, skipRatePct: c.skipRatePct, durationSec: c.durationSec };
}

/** Pure given the rows. */
export function numbersFor(p: Doc<"ownPosts">, siblings: Doc<"ownPosts">[], now: number): PostNumbers {
  const c = connectedFrom(p);
  const ageHours = Math.round((now - p.createTime) / 3_600_000);
  const asOfHours = c?.asOf ? Math.round((now - c.asOf) / 3_600_000) : null;
  const fresh = c !== null && c.syncStatus === "synced" && asOfHours !== null && asOfHours <= STALE_AFTER_MS / 3_600_000;
  const lines: string[] = [];
  const cannotKnow: string[] = [];

  let headline: PostNumbers["headline"];
  if (fresh && c.reach !== null) headline = { value: c.reach, what: "reach", basis: "connected", asOfHours };
  else headline = { value: p.metrics.views, what: "views", basis: "public", asOfHours: null };

  let multiple: PostNumbers["multiple"] = null;
  if (fresh && p.reachMultiple !== undefined) multiple = { value: p.reachMultiple, basis: "reach" };
  else if (p.multiple !== undefined) multiple = { value: p.multiple, basis: "views" };

  let derived: Derived | null = null;
  if (c && fresh) {
    const others = siblings.filter((s) => s._id !== p._id);
    const normals = { reach: normalReach(others), engagementPerReach: null };
    derived = derive(c, normals);
    if (c.reach !== null) lines.push(`reached ${c.reach.toLocaleString()} people (connected, read ${asOfHours}h ago)`);
    if (c.impressions !== null && c.reach) lines.push(`${c.impressions.toLocaleString()} impressions, so about ${derived.distribution ?? "?"} views per person (connected)`);
    if (derived.retention !== null) lines.push(`watched ${Math.round(derived.retention * 100)}% of it on average (connected, Instagram Reels)`);
    if (c.skipRatePct !== null) lines.push(`${Math.round(c.skipRatePct)}% left in the first 3 seconds (connected; Meta calls this an estimate)`);
    if (c.follows !== null && c.follows > 0) lines.push(`${c.follows} people followed from it (connected)`);
  } else if (c && !fresh) {
    lines.push(`connected numbers are ${asOfHours !== null ? `${asOfHours}h old` : "not synced yet"}; judging on the public count`);
  }
  lines.push(`${p.metrics.views.toLocaleString()} views (public count, read ${Math.round((now - p.metricsAsOf) / 3_600_000)}h ago)`);

  if (p.platform === "tiktok") cannotKnow.push("watch time, retention and the skip rate: TikTok does not expose them to anyone");
  if (p.platform === "instagram" && (!c || c.durationSec === null)) cannotKnow.push("retention: it is only reported on Reels with a known duration");
  if (!c) cannotKnow.push("reach and impressions: no account connected, so only the public count");

  return { url: p.url, platform: p.platform, ageHours, headline, multiple, lines, cannotKnow, derived };
}

export async function numbersForPost(ctx: QueryCtx, ownPostId: Id<"ownPosts">, now = Date.now()): Promise<PostNumbers | null> {
  const p = (await ctx.db.get(ownPostId)) as Doc<"ownPosts"> | null;
  if (!p) return null;
  const siblings = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", p.creatorId)).order("desc").take(40)) as Doc<"ownPosts">[];
  return numbersFor(p, siblings, now);
}

export const forPost = internalQuery({
  args: { ownPostId: v.id("ownPosts"), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<PostNumbers | null> => await numbersForPost(ctx, a.ownPostId, a.now ?? Date.now()),
});

/** By URL, which is what the creator and the belt actually hold. Scoped to the creator. */
export const forUrl = internalQuery({
  args: { creatorId: v.id("creators"), url: v.string(), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<PostNumbers | null> => {
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(120)) as Doc<"ownPosts">[];
    const norm = (u: string) => u.replace(/\?.*$/, "").replace(/\/$/, "").toLowerCase();
    const id = a.url.match(/\/video\/(\d+)/)?.[1] ?? a.url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
    const p = rows.find((r) => norm(r.url) === norm(a.url)) ?? (id ? rows.find((r) => r.postId === id || r.url.includes(`/${id}`)) : undefined) ?? null;
    return p ? numbersFor(p, rows, a.now ?? Date.now()) : null;
  },
});

/** Their normal reach, for anyone re-basing a rung or a win. */
export const normals = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ reach: number | null; connectedPosts: number }> => {
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(40)) as Doc<"ownPosts">[];
    return { reach: normalReach(rows), connectedPosts: rows.filter((r) => r.connected).length };
  },
});

/** The words for a diagnosis, once, so every skill says the same thing. */
export const DIAGNOSIS_WORDS: Record<NonNullable<Derived["diagnosis"]>, string> = {
  not_distributed: "the platform barely showed it: reach well under their normal. The post itself is not the problem yet; the first three seconds and the posting time are the levers.",
  distributed_scrolled: "it was shown to the usual number of people and they scrolled: the promise in the first line did not land for this audience.",
  hook_lost_them: "the hook lost them: most viewers left inside three seconds. The open is the fix, not the topic.",
  held_them: "it held them: people watched most of it. Whatever the open did, do it again.",
  normal: "a normal post: reached about the usual number and they behaved about as usual.",
  unknown: "not enough connected data to say why; only the public count.",
};
