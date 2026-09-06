/**
 * Growth expertise, and the growth plan (plan Sprint 4f).
 *
 * The playbook is prose she carries while she is new to a creator, while their lane is
 * unconfirmed, and while a growth plan is running. Every claim is tagged by how strong the
 * evidence is, because a guide who states folklore as fact is worse than none: the
 * platforms say a few things outright, the trade reports a few more consistently, and the
 * rest is guru arithmetic she must not repeat as a number.
 *
 * The plan is a row on the creator, enforced through the calendar: the week plan reads its
 * cadence, the review scores it, and she revises it out loud at the review date.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const GROWTH = {
  /** How long a plan runs before she revises it out loud. */
  planWeeks: 4,
  /** Default cadence when she sets a plan and the dossier has none. */
  defaultPostsPerWeek: 3,
} as const;

export interface GrowthPlan {
  lane: string;
  keywords: string[];
  formats: string[];
  postsPerWeek: number;
  hypothesis: string;
  startedAt: number;
  reviewAt: number;
  status: "running" | "revised" | "dropped";
  setBy: "tap" | "chat" | "review";
}

export const GROWTH_PLAYBOOK = `# How growing actually works (carry this; say only what the evidence carries)
What the platforms say outright: TikTok ranks each video on the strength of interest signals; finishing a longer video counts far more than weak signals like sharing a country. Captions, sounds and hashtags are how it works out what a video is about. Follower count and past hits are NOT direct factors, so a small account can be shown widely and a big one can be ignored. Instagram ranks reels on how likely a viewer is to reshare it, watch it through, like it, and open the audio page; low-resolution, watermarked, bordered, mostly-text and reposted reels are shown less.
What the trade reports consistently (not platform-stated; say "most accounts that grew" not a number): watch time and completion lead the weighting, so the first three seconds decide distribution; on reels, sends per person reached drive non-follower reach; an account posting across unrelated topics reaches fewer people because the system cannot place it, and two to five posts a week on one subject beats bursts; series and repeatable formats compound, because the second post rides the first.
Folklore you must not state as fact: fixed ratios ("seventy percent niche, thirty lifestyle"), posting-time superstitions, hashtag counts, "post daily or die". If they ask for a ratio, say the honest thing: nobody has a number, start with one subject and let their own results set the mix.
What you have that no guide has: their numbers. Where the account is connected you can see follows per post and followers per day, so a prescription is a plan you run and check, not advice. Propose the lane, the format, the cadence; the week plan carries it; the Sunday review says whether it moved followers and reach; at the review date you keep it, widen it, or switch, with the numbers.
How to guide someone who does not know how to grow: lead with what their own posts already show, name the one thing to do next, and say how thin the evidence is. One recommendation, one question at most. Never a quiz.`;

/** Pure: the prefix block, only while it earns its place. */
export function growthSection(input: { standing: "new" | "thin" | "solid"; laneConfirmed: boolean; plan: GrowthPlan | null; now: number; timeZone: string }): string | null {
  const running = input.plan?.status === "running";
  if (input.standing === "solid" && input.laneConfirmed && !running) return null;
  const day = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, month: "short", day: "numeric" }).format(t);
  const plan = input.plan
    ? `# Their growth plan (${input.plan.status}; set ${day(input.plan.startedAt)}, review ${day(input.plan.reviewAt)}${input.now >= input.plan.reviewAt && running ? " — DUE: revise it out loud with the numbers" : ""})\nLane: ${input.plan.lane} (${input.plan.keywords.join(", ")})\nFormats: ${input.plan.formats.join(", ") || "not fixed"} · ${input.plan.postsPerWeek} posts a week\nHypothesis: ${input.plan.hypothesis}`
    : `# Their growth plan\nNone yet. Once the lane is confirmed, set one: lane, format, cadence, one sentence on what should move.`;
  return `${GROWTH_PLAYBOOK}\n\n${plan}`;
}

export const setPlan = internalMutation({
  args: { creatorId: v.id("creators"), lane: v.string(), keywords: v.array(v.string()), formats: v.optional(v.array(v.string())), postsPerWeek: v.optional(v.number()), hypothesis: v.optional(v.string()), setBy: v.union(v.literal("tap"), v.literal("chat"), v.literal("review")), now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ ok: boolean; plan: GrowthPlan | null }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return { ok: false, plan: null };
    const now = a.now ?? Date.now();
    const dossier = c.dossier as { cadence?: { postsPerWeek?: number } } | undefined;
    const keywords = Array.from(new Set(a.keywords.map((k) => k.toLowerCase().replace(/^#/, "").trim()).filter((k) => k.length >= 3))).slice(0, 8);
    if (!a.lane.trim() || keywords.length === 0) return { ok: false, plan: null };
    // Explicit from chat is theirs; inferred from the dossier is a floor, never below the default.
    const postsPerWeek = a.postsPerWeek !== undefined ? Math.max(1, Math.min(7, Math.round(a.postsPerWeek))) : Math.max(GROWTH.defaultPostsPerWeek, Math.min(7, Math.round(dossier?.cadence?.postsPerWeek ?? GROWTH.defaultPostsPerWeek)));
    const plan: GrowthPlan = {
      lane: a.lane.trim().slice(0, 80),
      keywords,
      formats: (a.formats ?? []).map((f) => f.trim().slice(0, 40)).filter(Boolean).slice(0, 3),
      postsPerWeek,
      hypothesis: (a.hypothesis ?? `${postsPerWeek} a week on ${a.lane.trim()} should lift reach against their normal and bring follows`).slice(0, 200),
      startedAt: now,
      reviewAt: now + GROWTH.planWeeks * 7 * 86_400_000,
      status: "running",
      setBy: a.setBy,
    };
    await ctx.db.patch(a.creatorId, { growthPlan: plan, updatedAt: now });
    return { ok: true, plan };
  },
});

export const dropPlan = internalMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c?.growthPlan) return { ok: false };
    await ctx.db.patch(a.creatorId, { growthPlan: { ...(c.growthPlan as GrowthPlan), status: "dropped" }, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const readPlan = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<GrowthPlan | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return (c?.growthPlan as GrowthPlan | undefined) ?? null;
  },
});

/**
 * Pure: the growth facts the review needs. In-lane is a caption or hashtag carrying one of
 * the plan's keywords; follows come from connected numbers where present; the follower
 * delta from the daily snapshots.
 */
export function growthFacts(input: {
  plan: GrowthPlan | null;
  week: Array<{ caption: string; hashtags: string[]; multiple: number | null; follows: number | null }>;
  followers: Array<{ day: string; followers: number }>;
}): { inLane: number; outOfLane: number; inLaneMedianMultiple: number | null; outOfLaneMedianMultiple: number | null; follows: number | null; followerDelta: number | null; due: boolean } | null {
  if (!input.plan) return null;
  const kw = input.plan.keywords.map((k) => k.toLowerCase());
  const inLane = (p: { caption: string; hashtags: string[] }) => kw.some((k) => p.hashtags.some((h) => h.toLowerCase().includes(k)) || p.caption.toLowerCase().includes(k));
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round((s[Math.floor(s.length / 2)] ?? 0) * 100) / 100 : null; };
  const yes = input.week.filter(inLane);
  const no = input.week.filter((p) => !inLane(p));
  const follows = input.week.some((p) => p.follows !== null) ? input.week.reduce((s, p) => s + (p.follows ?? 0), 0) : null;
  const days = [...input.followers].sort((a, b) => a.day.localeCompare(b.day));
  const followerDelta = days.length >= 2 ? days[days.length - 1].followers - days[0].followers : null;
  return {
    inLane: yes.length,
    outOfLane: no.length,
    inLaneMedianMultiple: med(yes.map((p) => p.multiple).filter((m): m is number => m !== null)),
    outOfLaneMedianMultiple: med(no.map((p) => p.multiple).filter((m): m is number => m !== null)),
    follows,
    followerDelta,
    due: Date.now() >= input.plan.reviewAt && input.plan.status === "running",
  };
}
