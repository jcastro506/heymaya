/**
 * Every number she states about them is one we have (2026-11-12). The season sim's grader flagged wrong figures
 * that the model critic let through: "a 400k normal" for someone near 57k, "well over double your usual" for
 * about 6×, follower counts that disagreed with each other. A model judging "is this number in the evidence" is
 * a judgment; whether 400k is near 57k is arithmetic, so code does it, before the critic's model call.
 *
 * What's checked: view and follower counts ("31K views", "half a million", "100k followers") and multiples
 * ("3.1×", "double your usual"). A claim passes when it is within tolerance of one of their real figures (each
 * post's views and multiple, their normal per platform, their followers), of a number in the evidence that
 * message was written from, or of a number they said themselves lately. Prices, dates, times and counts of
 * things are not checked.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { multipleFor, normalsByPlatform } from "./normal";

export type Claim = { value: number; unit: "count" | "multiple"; text: string };

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6 };

/** Pure: "31.2K" → 31200; "1,200" → 1200; "2.4M" → 2.4e6. */
export function toNumber(n: string, suffix?: string): number {
  const base = Number(n.replace(/,/g, ""));
  return base * (suffix ? SCALE[suffix.toLowerCase()] ?? 1 : 1);
}

/** Pure: the view/follower counts and multiples a text claims. */
export function claimsIn(text: string): Claim[] {
  const out: Claim[] = [];
  const t = text.replace(/[’]/g, "'");
  // "31K views", "1.2M followers", "half a million views", "a million followers", "300k" right before views/plays
  for (const m of t.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s?(k|m|thousand|million|mil)?\b\s*(views|view|followers|follower|plays)\b/gi)) out.push({ value: toNumber(m[1], m[2]), unit: "count", text: m[0] });
  for (const m of t.matchAll(/\b(half a|a|one)\s+(million|thousand)\s+(views|followers|plays)\b/gi)) out.push({ value: (m[1].toLowerCase() === "half a" ? 0.5 : 1) * SCALE[m[2].toLowerCase()], unit: "count", text: m[0] });
  // "crossed a million", "past 100k", "hit 50k" (a count without the word views, said as a milestone)
  for (const m of t.matchAll(/\b(crossed|passed|past|hit|at|over|nearly|almost)\s+(half a million|a million|(\d[\d,]*(?:\.\d+)?)\s?(k|m|million))\b/gi)) {
    if (/views|followers|plays/i.test(t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12))) continue; // counted above
    const v = /half a million/i.test(m[2]) ? 5e5 : /^a million$/i.test(m[2]) ? 1e6 : toNumber(m[3] ?? "0", m[4]);
    if (v >= 1000) out.push({ value: v, unit: "count", text: m[0] });
  }
  // Multiples: "3.1×", "3x your normal", "double/triple/twice your usual"
  for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s?(?:x|×)(?=\s|$|[,.;:!?)])/gi)) out.push({ value: Number(m[1]), unit: "multiple", text: m[0] });
  for (const m of t.matchAll(/\b(double|twice|triple|three times|four times|five times|ten times)\b[^.]{0,30}\b(usual|normal|average)\b/gi)) {
    const w = m[1].toLowerCase();
    out.push({ value: w === "double" || w === "twice" ? 2 : w === "triple" || w === "three times" ? 3 : w === "four times" ? 4 : w === "five times" ? 5 : 10, unit: "multiple", text: m[0] });
  }
  return out;
}

/** Pure: every number written anywhere in a value (evidence JSON, their messages), with its k/m scale. */
export function numbersIn(value: unknown): number[] {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Array.from(s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?\b/gi), (m) => toNumber(m[1], m[2])).filter((n) => Number.isFinite(n));
}

/**
 * Pure: the claims nothing backs. Counts within 15% of a fact (or said as a milestone — "crossed 100k" — with a
 * real figure at or above it and under three times it); multiples within 15% (0.2 at the low end).
 */
export function unbacked(claims: Claim[], facts: { counts: number[]; multiples: number[]; free: number[] }): Claim[] {
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(tol * b, 0);
  return claims.filter((c) => {
    if (c.unit === "multiple") {
      const pool = [...facts.multiples, ...facts.free.filter((n) => n > 0 && n < 1000)];
      return !pool.some((f) => Math.abs(f - c.value) <= Math.max(0.2, f * 0.15));
    }
    const pool = [...facts.counts, ...facts.free];
    if (pool.some((f) => near(c.value, f, 0.15))) return false;
    const milestone = /crossed|passed|past|hit|over/i.test(c.text);
    if (milestone && pool.some((f) => f >= c.value && f < c.value * 3)) return false;
    if (/nearly|almost/i.test(c.text) && pool.some((f) => f <= c.value && f >= c.value * 0.75)) return false;
    return true;
  });
}

/** Their real figures: each post's views and multiple, their normal, their followers, and numbers they said lately. */
export const factsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ counts: number[]; multiples: number[]; theirs: number[] }> => {
    const now = Date.now();
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"ownPosts">[];
    const normals = normalsByPlatform(posts, now);
    const counts = posts.flatMap((p) => [p.metrics.views, p.metrics.likes, p.metrics.comments, p.metrics.shares, p.metrics.saves ?? 0]).filter((n) => n > 0);
    for (const n of normals.values()) if (n) counts.push(n.value);
    const multiples = posts.flatMap((p) => [multipleFor(p, normals), p.multiple, p.reachMultiple]).filter((m): m is number => typeof m === "number");
    const snaps = (await ctx.db.query("followerSnapshots").withIndex("by_creator_day", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(20)) as Doc<"followerSnapshots">[];
    counts.push(...snaps.map((s) => s.followers));
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const dossierFollowers = (c?.dossier as { followers?: unknown } | undefined)?.followers;
    if (typeof dossierFollowers === "number") counts.push(dossierFollowers);
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", now - 14 * 86_400_000)).order("desc").take(40)) as Doc<"messages">[];
    const theirs = numbersIn(msgs.filter((m) => m.direction === "in").map((m) => m.body).join(" "));
    return { counts, multiples, theirs };
  },
});

export type NumbersCreatorId = Id<"creators">;
