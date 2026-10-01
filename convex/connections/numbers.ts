/**
 * What she may say about one of THEIR posts (plan Sprint 4e): the numbers, each with its
 * basis, and the four-way diagnosis. Every consumer of own-post numbers goes through here so
 * "connected wins, labelled; stale falls back and says so; never mix bases" is one rule in
 * one place rather than a habit each skill has to remember.
 */

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { derive, derivePublic, type Connected, type Derived } from "./analytics";
import { normalReach } from "./sync";
import { shapeEvidence, shapeOf, type Shape } from "../core/normal";
import { countryName } from "./accountInsights";

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
  /** B1: how the views arrived (core/normal.shapeOf): early, spike, slow_burn, steady, unknown. */
  shape: Shape;
  /** A2: the readings the shape rests on (connected daily timeline merged into the history), in citeable words. */
  shapeLine: string | null;
}

export function connectedFrom(p: Doc<"ownPosts">): Connected | null {
  const c = p.connected;
  if (!c) return null;
  return { platform: p.platform as "tiktok" | "instagram", postId: p.postId, url: p.url, publishedAt: p.createTime, asOf: c.asOf, syncStatus: c.syncStatus as Connected["syncStatus"], views: c.views, likes: c.likes, comments: c.comments, shares: c.shares, saves: c.saves, impressions: c.impressions, reach: c.reach, clicks: c.clicks, follows: c.follows, avgWatchMs: c.avgWatchMs, totalWatchMs: c.totalWatchMs, skipRatePct: c.skipRatePct, durationSec: c.durationSec, completionRate: c.completionRate ?? null, profileViews: c.profileViews ?? null, viewSources: c.viewSources ?? null, viewerTypes: c.viewerTypes ?? null, viewerCountries: c.viewerCountries ?? null };
}

const SOURCE_WORDS: Record<string, string> = { forYou: "For You", follow: "Following", search: "Search", personalProfile: "your profile", sound: "the sound page", directMessage: "DMs", other: "elsewhere" };

/** Pure: the top viewer countries in words, e.g. "United States 41%, Canada 9%". "other" (the tail) is left out. */
export function countriesLine(s: Record<string, number>): string {
  return Object.entries(s).filter(([k, v]) => k.toLowerCase() !== "other" && /^[A-Za-z]{2}$/.test(k) && v >= 0.01).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${countryName(k.toUpperCase())} ${Math.round(v * 100)}%`).join(", ");
}

/** Pure: how the views arrived, with the numbers it rests on, or null when the readings can't say. */
export function shapeLine(p: Doc<"ownPosts">, now: number): string | null {
  const e = shapeEvidence(p, now);
  if (!e) return null;
  const pct = (x: number) => Math.round((x / e.total) * 100);
  return `${e.byDay2.toLocaleString()} of ${e.total.toLocaleString()} views (${pct(e.byDay2)}%) had come by the end of day two${e.afterWeek !== null ? `; ${e.afterWeek.toLocaleString()} (${pct(e.afterWeek)}%) came after the first week` : ""} (from ${e.readings} readings)`;
}

/** Pure: the top surfaces in words, e.g. "84% from For You, 6% from Search". */
export function sourcesLine(s: Record<string, number>): string {
  return Object.entries(s).filter(([, v]) => v >= 0.03).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${Math.round(v * 100)}% from ${SOURCE_WORDS[k] ?? k}`).join(", ");
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
    // A1: TikTok's own reads (TikTok for Business connection, filled 24-48h after posting).
    if (c.completionRate !== null) lines.push(`${Math.round(c.completionRate * 100)}% watched to the end (connected, TikTok)`);
    if (c.viewSources) lines.push(`views came ${sourcesLine(c.viewSources)} (connected, TikTok)`);
    if (c.viewerTypes?.nonFollower !== undefined) lines.push(`${Math.round(c.viewerTypes.nonFollower * 100)}% of viewers didn't follow them yet (connected, TikTok)`);
    if (c.viewerTypes?.returnViewer !== undefined) lines.push(`${Math.round(c.viewerTypes.returnViewer * 100)}% were returning viewers (connected, TikTok)`);
    if (c.profileViews !== null) lines.push(`${c.profileViews.toLocaleString()} profile visits from it (connected, TikTok)`);
    // A2 (live recording 2026-10-01): TikTok's average watch per view. Its share of the length only
    // when the post's length is known from the public read; TikTok's connected numbers carry none.
    if (p.platform === "tiktok" && c.avgWatchMs !== null) {
      const sec = Math.round(c.avgWatchMs / 100) / 10;
      const len = p.durationSec && p.durationSec > 0 ? p.durationSec : null;
      lines.push(`watched ${sec}s on average${len ? `, about ${Math.round(Math.min(1, c.avgWatchMs / (len * 1000)) * 100)}% of its ${len}s` : ""} (connected, TikTok)`);
    }
    if (p.platform === "tiktok" && c.viewerCountries) lines.push(`viewers by country: ${countriesLine(c.viewerCountries)} (connected, TikTok)`);
  } else if (c && !fresh) {
    lines.push(`connected numbers are ${asOfHours !== null ? `${asOfHours}h old` : "not synced yet"}; judging on the public count`);
  }
  lines.push(`${p.metrics.views.toLocaleString()} views (public count, read ${Math.round((now - p.metricsAsOf) / 3_600_000)}h ago)`);

  if (!derived) derived = derivePublic(multiple?.value ?? null, now - p.createTime >= 48 * 3_600_000);
  if (p.platform === "tiktok") {
    // The truth from the 2026-10-01 recording: average watch time and the share who finished DO come
    // through TikTok's business-app connection; the skip rate and a second-by-second curve never do.
    const missing = [c?.avgWatchMs == null ? "average watch time" : null, c?.completionRate == null ? "the share who watched to the end" : null].filter(Boolean);
    if (missing.length) cannotKnow.push(`${missing.join(" and ")}: not for this post (TikTok reports these for accounts connected through TikTok's business app, 1-2 days after posting)`);
    cannotKnow.push("the skip rate and a second-by-second retention curve: TikTok doesn't give these");
    if (c && fresh && !c.viewerCountries) cannotKnow.push("where its viewers are: TikTok didn't report countries for this post");
  }
  if (p.platform === "instagram" && (!c || c.durationSec === null)) cannotKnow.push("retention: it is only reported on Reels with a known duration");
  if (!c) cannotKnow.push("reach and impressions: no account connected, so only the public count");

  return { url: p.url, platform: p.platform, ageHours, headline, multiple, lines, cannotKnow, derived, shape: shapeOf(p, now), shapeLine: shapeLine(p, now) };
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
  broke_out: "it broke out: well past their normal. Worth finding out why before the moment passes.",
  below_normal: "below their normal on the public count. Without connected numbers, whether few people were shown it or they scrolled can't be told apart.",
  not_distributed: "the platform barely showed it: reach well under their normal. The post itself is not the problem yet; the first three seconds and the posting time are the levers.",
  distributed_scrolled: "it was shown to the usual number of people and they scrolled: the promise in the first line did not land for this audience.",
  hook_lost_them: "the hook lost them: most viewers left inside three seconds. The open is the fix, not the topic.",
  held_them: "it held them: people watched most of it. Whatever the open did, do it again.",
  normal: "a normal post: reached about the usual number and they behaved about as usual.",
  unknown: "not enough connected data to say why; only the public count.",
};
