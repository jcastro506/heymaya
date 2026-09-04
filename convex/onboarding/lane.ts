/**
 * Finding the lane when they cannot name it (plan Sprint 4d).
 *
 * ⚠️ THE GAP. Onboarding asks for a sentence about what they make, and everything
 * downstream inherits it: the sweep's keywords, the roster's filter, the scout's fit test.
 * A creator who cannot write that sentence gets a weak lane and therefore a weak product,
 * and there was no path back. This is the same failure shape as the thin roster.
 *
 * She does not ask. She reads their posts, weights them by what performed, and states the
 * lane back for one tap. The signal comes from behaviour, never from a survey.
 *
 * Drift is the other half: a lane that was right in March is wrong in September, so the
 * weekly rewrite compares and she says so once.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export const LANE = {
  /** Enough posts to read a lane from behaviour rather than asking. */
  minPosts: 5,
  /** How many keywords the sweep needs to be worth running. */
  minKeywords: 3,
  maxKeywords: 8,
  /** A hashtag has to appear this often to be theirs rather than a one-off. */
  minHashtagUses: 2,
  /** Drift: this share of new keywords being unfamiliar is worth one question. */
  driftShare: 0.5,
} as const;

export interface PostLite { caption: string; hashtags: string[]; multiple: number | null }

const STOP = new Set(["the", "and", "for", "with", "you", "your", "this", "that", "just", "was", "are", "but", "not", "all", "get", "got", "out", "one", "day", "like", "when", "how", "why", "its", "it's", "fyp", "foryou", "foryoupage", "viral", "trending", "tiktok", "reels", "instagram"]);

/**
 * The lane, from their own posts. Hashtags they actually use, weighted by how the post did,
 * then caption words as a fallback. Pure, so it is testable and cannot drift on a whim.
 */
export function readLane(posts: PostLite[]): { keywords: string[]; confidence: "none" | "thin" | "solid"; basis: string } {
  if (posts.length === 0) return { keywords: [], confidence: "none", basis: "no posts read yet" };
  const weight = (m: number | null) => (m === null ? 1 : Math.max(0.3, Math.min(3, m)));
  const score = new Map<string, { w: number; n: number }>();
  const bump = (raw: string, w: number) => {
    const k = raw.toLowerCase().replace(/^#/, "").replace(/[^a-z0-9]/g, "");
    if (k.length < 3 || STOP.has(k)) return;
    const cur = score.get(k) ?? { w: 0, n: 0 };
    score.set(k, { w: cur.w + w, n: cur.n + 1 });
  };
  for (const p of posts) {
    const w = weight(p.multiple);
    for (const h of p.hashtags) bump(h, w);
  }
  // Hashtags used more than once are the strongest signal of what they think they make.
  let ranked = [...score.entries()].filter(([, v]) => v.n >= LANE.minHashtagUses).sort((a, b) => b[1].w - a[1].w);
  let basis = `the hashtags they use most, weighted by how those posts did`;
  if (ranked.length < LANE.minKeywords) {
    // Fall back to caption words, same weighting.
    for (const p of posts) for (const word of p.caption.split(/[^A-Za-z0-9']+/)) bump(word, weight(p.multiple) * 0.5);
    ranked = [...score.entries()].filter(([, v]) => v.n >= LANE.minHashtagUses).sort((a, b) => b[1].w - a[1].w);
    basis = `the words and hashtags that repeat across their posts, weighted by how those did`;
  }
  const keywords = ranked.slice(0, LANE.maxKeywords).map(([k]) => k);
  const confidence = posts.length >= LANE.minPosts && keywords.length >= LANE.minKeywords ? "solid" : keywords.length > 0 ? "thin" : "none";
  return { keywords, confidence, basis };
}

/** How she states it back, for one tap. Pure. */
export function laneQuestion(keywords: string[], topHooks: string[]): string {
  const lane = keywords.slice(0, 3).join(", ");
  const because = topHooks.length ? ` your best ones are the ${topHooks[0].slice(0, 60)} kind.` : "";
  return `from your posts, your lane looks like ${lane}.${because} right?`;
}

/** Drift: what share of the new keywords she has not seen before. Pure. */
export function driftShare(before: string[], after: string[]): number {
  if (after.length === 0) return 0;
  const known = new Set(before.map((k) => k.toLowerCase()));
  return after.filter((k) => !known.has(k.toLowerCase())).length / after.length;
}

export const inputsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ posts: PostLite[]; hooks: string[]; niche: string; keywords: string[] } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    const ranked = [...posts].sort((x, y) => (y.multiple ?? -1) - (x.multiple ?? -1));
    return {
      posts: posts.map((p) => ({ caption: p.caption, hashtags: p.hashtags, multiple: p.multiple ?? null })),
      hooks: ranked.slice(0, 2).map((p) => p.caption.replace(/#[\p{L}\p{N}_]+/gu, "").trim().slice(0, 70)).filter(Boolean),
      niche: c.niche,
      keywords: ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map(String),
    };
  },
});

/**
 * Write the lane they confirmed. It repoints the sweep and the roster, because both read
 * the dossier's keywords, so a lane change is a real change and not a note.
 */
export const confirm = internalMutation({
  args: { creatorId: v.id("creators"), keywords: v.array(v.string()), niche: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; keywords: string[] }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, keywords: [] };
    const keywords = Array.from(new Set(a.keywords.map((k) => k.toLowerCase().replace(/^#/, "").trim()).filter((k) => k.length >= 3))).slice(0, LANE.maxKeywords);
    if (keywords.length === 0) return { ok: false, keywords: [] };
    const dossier = { ...((c.dossier as Record<string, unknown> | undefined) ?? {}), keywords };
    await ctx.db.patch(a.creatorId, {
      dossier,
      ...(a.niche ? { niche: a.niche.slice(0, 300) } : c.niche ? {} : { niche: keywords.slice(0, 3).join(", ") }),
      laneConfirmedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true, keywords };
  },
});

export type LaneCreatorId = Id<"creators">;

/**
 * What she proposed, kept on a row so the button confirms the same keywords she said — not
 * a fresh read that may differ by the time they tap.
 */
export const stashRead = internalMutation({
  args: { creatorId: v.id("creators"), token: v.string(), keywords: v.array(v.string()) },
  handler: async (ctx, a): Promise<null> => {
    const existing = (await ctx.db.query("laneReads").withIndex("by_token", (q) => q.eq("creatorId", a.creatorId).eq("token", a.token)).first()) as Doc<"laneReads"> | null;
    if (existing) return null;
    await ctx.db.insert("laneReads", { creatorId: a.creatorId, token: a.token, keywords: a.keywords, at: Date.now() });
    return null;
  },
});

export const readByToken = internalQuery({
  args: { creatorId: v.id("creators"), token: v.string() },
  handler: async (ctx, a): Promise<Doc<"laneReads"> | null> =>
    (await ctx.db.query("laneReads").withIndex("by_token", (q) => q.eq("creatorId", a.creatorId).eq("token", a.token)).first()) as Doc<"laneReads"> | null,
});
