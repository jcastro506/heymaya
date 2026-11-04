/**
 * The one post her opening is built on (2026-11-03). The first read used to open with what she liked and end
 * on a "which direction?" survey, with no number and no idea; the operator wanted proof she watched, in the
 * first ten seconds. Code picks the post and the number (grounded or silent); she says why it worked and
 * what to film next.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { platformOn } from "../config/platforms";

export interface StandoutPost { caption: string; views: number; comments: number; multiple: number | null }
export interface Standout { line: string; kind: "multiple" | "comments" | "views"; posts: number; /** The figure the read must cite, as written in `line`. */ cite: string }

/** Fewer posts than this and there's no honest "best": she asks for the one they're proudest of instead. */
export const STANDOUT_MIN_POSTS = 3;

/** "12.4K", "980", "1.2M": the way views read on TikTok. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

function named(caption: string): string {
  const c = caption.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
  return c ? `"${c.length > 70 ? `${c.slice(0, 67).trimEnd()}…` : c}"` : "a post with no caption";
}

/**
 * Pure: their standout post as one fact line, or null when there are too few posts to say. Above their
 * usual views first (a real multiple), then the one people talked about most, then simply the most watched.
 */
export function standout(posts: StandoutPost[]): Standout | null {
  if (posts.length < STANDOUT_MIN_POSTS) return null;
  const byMultiple = posts.filter((p) => p.multiple !== null && p.multiple >= 1.5).sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))[0];
  if (byMultiple) {
    const m = byMultiple.multiple!;
    // A viral outlier reads as a silly multiple ("610×", live 2026-11-03): past 10×, the two view counts say it plainly.
    const usual = compact(byMultiple.views / m);
    const how = m >= 10 ? `got ${compact(byMultiple.views)} views, against a usual ${usual}` : `did about ${m.toFixed(1).replace(/\.0$/, "")}× their usual views (${compact(byMultiple.views)}, against a usual ${usual})`;
    return { kind: "multiple", posts: posts.length, line: `${named(byMultiple.caption)} ${how}`, cite: compact(byMultiple.views) };
  }
  const comments = [...posts].map((p) => p.comments).sort((a, b) => a - b);
  const median = comments[Math.floor(comments.length / 2)];
  const talked = [...posts].sort((a, b) => b.comments - a.comments)[0];
  if (talked.comments >= 5 && talked.comments >= 2 * Math.max(1, median)) {
    return { kind: "comments", posts: posts.length, line: `${named(talked.caption)} got the most comments of anything they posted (${talked.comments}, against a usual ${median})`, cite: String(talked.comments) };
  }
  const watched = [...posts].sort((a, b) => b.views - a.views)[0];
  return { kind: "views", posts: posts.length, line: `${named(watched.caption)} is their most-watched recent post (${compact(watched.views)} views); nothing stands far above the rest yet`, cite: compact(watched.views) };
}

/** Pure: does the read cite the standout's figure? Case-insensitive ("837k" counts). */
export function citesStandout(text: string, s: Pick<Standout, "cite">): boolean {
  return text.toLowerCase().includes(s.cite.toLowerCase());
}

export const forCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<Standout | null> => {
    const rows = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(40)) as Doc<"ownPosts">[];
    const posts = rows.filter((p) => platformOn(p.platform) && p.contentType === "video").map((p) => ({ caption: p.caption, views: p.metrics.views, comments: p.metrics.comments, multiple: p.multiple ?? null }));
    return standout(posts);
  },
});
