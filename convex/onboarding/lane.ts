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
import type { Lanes } from "./clusters";
import { GROWTH, type GrowthPlan } from "../agent/growth";

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

// Live 2026-09-05: "have" reached a creator as their lane. Caption words are the fallback
// and English is mostly glue, so the glue is listed and the bar for a caption word is higher.
const STOP = new Set(["the", "and", "for", "with", "you", "your", "this", "that", "just", "was", "are", "but", "not", "all", "get", "got", "out", "one", "day", "like", "when", "how", "why", "its", "it's", "fyp", "foryou", "foryoupage", "viral", "trending", "tiktok", "reels", "instagram",
  "have", "has", "had", "been", "being", "from", "what", "who", "they", "them", "their", "there", "here", "will", "would", "could", "should", "into", "about", "more", "most", "some", "than", "then", "over", "only", "also", "very", "really", "much", "many", "make", "made", "know", "think", "thing", "things", "people", "because", "where", "which", "while", "still", "even", "ever", "never", "always", "every", "part", "best", "good", "great", "love", "time", "today", "yeah", "okay", "want", "need", "going", "back", "down", "come", "came", "does", "did", "doing", "done", "can", "can't", "dont", "don't", "our", "we", "me", "my", "i'm", "im", "is", "it", "in", "on", "at", "to", "of", "a", "an", "so", "if", "or", "as", "be", "by", "no", "up", "us", "do", "go", "see", "saw", "new", "now", "him", "her", "his", "she", "he", "am", "let", "lets", "let's", "way", "off", "too", "any", "own", "these", "those", "seeing", "idea", "kind"]);
/** A caption word has to be at least this long; short English words are almost never a lane. */
const MIN_CAPTION_WORD = 5;

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
    for (const p of posts) for (const word of p.caption.split(/[^A-Za-z0-9']+/)) if (word.length >= MIN_CAPTION_WORD) bump(word, weight(p.multiple) * 0.5);
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
  const hook = topHooks[0] ? hookPhrase(topHooks[0]) : "";
  const because = hook ? ` your best ones are the "${hook}" kind.` : "";
  return `from your posts, your lane looks like ${lane}.${because} right?`;
}

/** The first clause of a caption, at most twelve words and never ending on glue, lowercased: something a person would quote. */
export function hookPhrase(caption: string): string {
  const first = caption.replace(/#[\p{L}\p{N}_]+/gu, "").trim().split(/[.!?\n]|, /)[0] ?? "";
  const words = first.trim().split(/\s+/).filter(Boolean).slice(0, 12);
  // A quote should not end on glue ("...seeing people who have no"). Trim trailing glue words.
  const glue = new Set(["who", "is", "the", "and", "of", "to", "a", "an", "that", "which", "with", "for", "in", "on", "at", "or", "but", "so", "if", "my", "your", "i", "was", "are", "no", "not", "have", "has", "had", "what", "how", "why", "when", "where"]);
  while (words.length > 3 && glue.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ").toLowerCase().replace(/[",]+$/g, "");
}

/** Drift: what share of the new keywords she has not seen before. Pure. */
export function driftShare(before: string[], after: string[]): number {
  if (after.length === 0) return 0;
  const known = new Set(before.map((k) => k.toLowerCase()));
  return after.filter((k) => !known.has(k.toLowerCase())).length / after.length;
}

/**
 * Sprint 4f: the lane proposal for an account that may have none. Three pieces of
 * evidence in fixed priority: what their audience already rewards (the cluster with the
 * best median multiple, at least two posts), who they wish they were (the admired roster's
 * words), and what they said (lowest). Agreement is a recommendation; a split between
 * rewarded and admired is the one question worth asking. Pure.
 */
export interface LaneCandidate { label: string; keywords: string[]; evidence: string; source: "rewarded" | "admired" | "stated" | "biggest" }
export interface LaneProposal {
  state: "known" | "unnamed" | "scattered" | "none";
  candidates: LaneCandidate[];
  /** What she would pick, and why, in one clause. */
  recommendation: LaneCandidate | null;
  /** The one question, or null when the evidence agrees. */
  question: string | null;
  /** The truth about the catalogue, one sentence, for the message. */
  read: string;
}

const overlap = (a: string[], b: string[]) => { const B = new Set(b.map((x) => x.toLowerCase())); return a.filter((x) => B.has(x.toLowerCase())).length; };

/** Pure: the first n words that do not share a stem ("runner running runtok" → "runner"). Three letters over-merges on purpose: fewer, plainly different words. */
export function distinctWords(words: string[], n: number): string[] {
  const out: string[] = [];
  for (const w of words) {
    const stem = w.toLowerCase().slice(0, 3);
    if (out.some((o) => o.toLowerCase().slice(0, 3) === stem)) continue;
    out.push(w);
    if (out.length >= n) break;
  }
  return out;
}

export function proposeLane(input: { lanes: Lanes | null; laneKeywords: string[]; admiredKeywords: string[]; stated: string; laneConfidence: "none" | "thin" | "solid" }): LaneProposal {
  const lanes = input.lanes;
  const statedWords = input.stated.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (!lanes || lanes.state === "none" || lanes.posts === 0) return { state: "none", candidates: [], recommendation: null, question: null, read: "no posts to read yet" };
  const clusters = lanes.clusters;
  // Live 2026-09-06: a group of test posts at 0× was called "rewarded". Rewarded means it
  // beats their normal, not that it is the least bad.
  const withM = clusters.filter((c) => c.medianMultiple !== null && c.medianMultiple >= 1 && c.postIds.length >= 2);
  const rewarded = withM.length ? [...withM].sort((a, b) => (b.medianMultiple ?? 0) - (a.medianMultiple ?? 0))[0] : null;
  const biggest = clusters[0] ?? null;
  const admiredMatch = clusters.map((c) => ({ c, n: overlap(c.keywords, input.admiredKeywords) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]?.c ?? null;
  const statedMatch = clusters.map((c) => ({ c, n: overlap(c.keywords, statedWords) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]?.c ?? null;

  const cand = (c: NonNullable<typeof biggest>, source: LaneCandidate["source"]): LaneCandidate => ({
    label: c.label, keywords: c.keywords, source,
    evidence: source === "rewarded" ? `your ${c.label} posts run ${c.medianMultiple}× your normal (${c.postIds.length} posts)` : source === "admired" ? `it is what the accounts you admire make, and you have ${c.postIds.length} posts there` : source === "stated" ? `it is what you said you make, and you have ${c.postIds.length} posts there` : `it is most of what you post (${Math.round(c.share * 100)}%)`,
  });
  const read = lanes.state === "scattered"
    ? `your posts pull in ${Math.max(2, clusters.length)} directions${biggest ? `; the biggest, ${biggest.label}, is only ${Math.round(biggest.share * 100)}% of them` : ""}`
    : biggest ? `most of your posts are ${biggest.label} (${Math.round(biggest.share * 100)}%)` : "your posts do not group yet";

  // Known: the sentence and the posts agree on the biggest group.
  if (lanes.state !== "scattered" && statedMatch && biggest && statedMatch.label === biggest.label) {
    const r = cand(biggest, "stated");
    return { state: "known", candidates: [r], recommendation: r, question: null, read };
  }
  if (lanes.state !== "scattered" && biggest) {
    const r = cand(biggest, rewarded && rewarded.label === biggest.label ? "rewarded" : "biggest");
    return { state: "unnamed", candidates: [r], recommendation: r, question: null, read };
  }
  // Scattered: triangulate.
  const candidates: LaneCandidate[] = [];
  if (rewarded) candidates.push(cand(rewarded, "rewarded"));
  // Who they admire is a candidate even when they have no posts there yet: that is often
  // exactly the case, and it is the lane they want.
  const admiredLane: LaneCandidate | null = admiredMatch
    ? cand(admiredMatch, "admired")
    : input.admiredKeywords.length >= 2
      ? { label: distinctWords(input.admiredKeywords, 2).join(" "), keywords: input.admiredKeywords.slice(0, 5), evidence: "it is what the accounts you admire make, and you have no posts there yet", source: "admired" }
      : null;
  if (admiredLane && !candidates.some((x) => x.label === admiredLane.label)) candidates.push(admiredLane);
  if (statedMatch && !candidates.some((x) => x.label === statedMatch.label)) candidates.push(cand(statedMatch, "stated"));
  if (!candidates.length && biggest) candidates.push(cand(biggest, "biggest"));
  if (!candidates.length && input.laneConfidence !== "none") candidates.push({ label: input.laneKeywords.slice(0, 2).join(" "), keywords: input.laneKeywords.slice(0, 5), evidence: "the words that repeat across your posts", source: "biggest" });
  const recommendation = candidates[0] ?? null;
  let question: string | null = null;
  if (rewarded && admiredLane && rewarded.label !== admiredLane.label) {
    question = `your best posts are the ${rewarded.label} ones, but the accounts you admire make ${admiredLane.label}. which one do you want to be?`;
  } else if (recommendation) {
    question = `i'd make ${recommendation.label} the lane for the next month and keep the rest as backdrop. go with that?`;
  }
  return { state: "scattered", candidates: candidates.slice(0, 3), recommendation, question, read };
}

export const inputsFor = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ posts: PostLite[]; hooks: string[]; niche: string; keywords: string[]; lanes: Lanes | null; admiredKeywords: string[]; laneQuestionsThisWeek: number } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c) return null;
    const posts = (await ctx.db.query("ownPosts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(60)) as Doc<"ownPosts">[];
    const ranked = [...posts].sort((x, y) => (y.multiple ?? -1) - (x.multiple ?? -1));
    // Sprint 4f: who they wish they were, as the words of the roster's observed posts.
    const tracked = (await ctx.db.query("trackedAccounts").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).take(20)) as Doc<"trackedAccounts">[];
    const kw = new Map<string, number>();
    for (const t of tracked.filter((t) => t.status !== "removed")) {
      const obs = (await ctx.db.query("observations").withIndex("by_author", (q) => q.eq("platform", t.platform).eq("authorHandle", t.handle)).order("desc").take(12)) as Doc<"observations">[];
      for (const o of obs) for (const k of o.keywords ?? []) kw.set(k.toLowerCase(), (kw.get(k.toLowerCase()) ?? 0) + 1);
    }
    // Day one: the roster's own words from the cluster read, before the sweep has sampled anyone.
    for (const k of ((c.lanes as Lanes | undefined)?.admiredKeywords ?? [])) kw.set(k.toLowerCase(), (kw.get(k.toLowerCase()) ?? 0) + 1);
    const admiredKeywords = [...kw.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k]) => k);
    // Bounded: at most two lane questions in the first week, ever.
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recent = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", weekAgo)).take(200)) as Doc<"messages">[];
    const laneQuestionsThisWeek = recent.filter((m) => m.direction === "out" && (m.buttons ?? []).some((b) => /^lane(pick)?:/.test(b.id))).length;
    return {
      posts: posts.map((p) => ({ caption: p.caption, hashtags: p.hashtags, multiple: p.multiple ?? null })),
      hooks: ranked.slice(0, 2).map((p) => p.caption.replace(/#[\p{L}\p{N}_]+/gu, "").trim().slice(0, 70)).filter(Boolean),
      niche: c.niche,
      keywords: ((c.dossier as { keywords?: string[] } | undefined)?.keywords ?? []).map(String),
      lanes: (c.lanes as Lanes | undefined) ?? null,
      admiredKeywords,
      laneQuestionsThisWeek,
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
  args: { creatorId: v.id("creators"), token: v.string(), keywords: v.array(v.string()), candidates: v.optional(v.array(v.object({ label: v.string(), keywords: v.array(v.string()) }))) },
  handler: async (ctx, a): Promise<null> => {
    const existing = (await ctx.db.query("laneReads").withIndex("by_token", (q) => q.eq("creatorId", a.creatorId).eq("token", a.token)).first()) as Doc<"laneReads"> | null;
    if (existing) return null;
    await ctx.db.insert("laneReads", { creatorId: a.creatorId, token: a.token, keywords: a.keywords, candidates: a.candidates, at: Date.now() });
    return null;
  },
});

/**
 * Sprint 4f: a tap on a candidate. Writes the lane (repointing the sweep and the roster),
 * and starts the growth plan from it. Scoped to the creator; another creator's token is
 * simply not found.
 */
export const pick = internalMutation({
  args: { creatorId: v.id("creators"), token: v.string(), index: v.number() },
  handler: async (ctx, a): Promise<{ ok: boolean; label?: string; plan?: GrowthPlan }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    const stash = (await ctx.db.query("laneReads").withIndex("by_token", (q) => q.eq("creatorId", a.creatorId).eq("token", a.token)).first()) as Doc<"laneReads"> | null;
    const cand = stash?.candidates?.[a.index];
    if (!c || !cand) return { ok: false };
    const keywords = Array.from(new Set(cand.keywords.map((k) => k.toLowerCase().replace(/^#/, "").trim()).filter((k) => k.length >= 3))).slice(0, LANE.maxKeywords);
    if (!keywords.length) return { ok: false };
    const now = Date.now();
    const dossier = { ...((c.dossier as Record<string, unknown> | undefined) ?? {}), keywords };
    // Live 2026-09-06: a ten-post account's cadence read as one a week and the plan took it.
    // A growth plan is a step up from what they did, never a copy of it: at least the default.
    const cadence = (c.dossier as { cadence?: { postsPerWeek?: number } } | undefined)?.cadence?.postsPerWeek;
    const postsPerWeek = Math.max(GROWTH.defaultPostsPerWeek, Math.min(7, Math.round(cadence ?? GROWTH.defaultPostsPerWeek)));
    const plan: GrowthPlan = { lane: cand.label, keywords, formats: [], postsPerWeek, hypothesis: `${postsPerWeek} a week on ${cand.label} should lift reach against their normal and bring follows`, startedAt: now, reviewAt: now + GROWTH.planWeeks * 7 * 86_400_000, status: "running", setBy: "tap" };
    await ctx.db.patch(a.creatorId, { dossier, niche: c.niche || cand.label, laneConfirmedAt: now, growthPlan: plan, updatedAt: now });
    return { ok: true, label: cand.label, plan };
  },
});

export const readByToken = internalQuery({
  args: { creatorId: v.id("creators"), token: v.string() },
  handler: async (ctx, a): Promise<Doc<"laneReads"> | null> =>
    (await ctx.db.query("laneReads").withIndex("by_token", (q) => q.eq("creatorId", a.creatorId).eq("token", a.token)).first()) as Doc<"laneReads"> | null,
});
