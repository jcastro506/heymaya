/**
 * Their voice, quoted rather than described (plan §13.10; added after the first live run).
 *
 * ⚠️ THE BUG THIS FIXES. Until now the only thing the writer knew about how a creator
 * writes was the dossier's adjectives: "punchy, self-deprecating text hooks". Not one
 * sentence the creator had actually written was ever in front of the model. So when it
 * was asked for an overlay in their voice it filled the gap from its training data and
 * produced the median TikTok caption — "waking up at 5am and convincing myself it was
 * pure marathon discipline". Grammatically theirs, actually nobody's.
 *
 * You cannot describe a voice into existence. You quote it. Everything here is drawn from
 * rows we already have: their captions, and the on-screen text and spoken hooks the watch
 * pass read off their own videos.
 *
 * Two halves, deliberately:
 *  1. `styleFacts` — deterministic, countable habits (length, case, emoji, questions,
 *     hashtags). No model can hallucinate these and no model can argue with them.
 *  2. The exemplars — their actual best-performing lines, ranked by multiple, verbatim.
 */

import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** How many of their own lines go in front of the writer. Enough to hear a pattern, not enough to crowd the prompt. */
export const EXEMPLAR_CAP = 8;
const LINE_CAP = 140;

export interface VoiceLine {
  text: string;
  /** Where it came from: their caption, or text that was literally on screen, or what they said out loud. */
  kind: "caption" | "on-screen" | "spoken";
  multiple: number | null;
}

export interface StyleFacts {
  n: number;
  medianWords: number | null;
  lowercaseStartPct: number | null;
  emojiPct: number | null;
  questionPct: number | null;
  medianHashtags: number | null;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function pct(hits: number, n: number): number | null {
  return n === 0 ? null : Math.round((hits / n) * 100);
}

/**
 * Countable habits, from their captions. Pure.
 *
 * These matter more than they look. "They write in lowercase, around 9 words, and almost
 * never ask a question" is a harder constraint than any adjective, and it is checkable.
 */
export function styleFacts(captions: string[], hashtagCounts: number[] = []): StyleFacts {
  const texts = captions.map((c) => c.trim()).filter((c) => c.length > 0);
  const n = texts.length;
  if (n === 0) return { n: 0, medianWords: null, lowercaseStartPct: null, emojiPct: null, questionPct: null, medianHashtags: null };
  // Strip hashtags before counting words: they are metadata, not how someone writes.
  const words = texts.map((t) => t.replace(/#[\p{L}\p{N}_]+/gu, "").trim().split(/\s+/).filter(Boolean).length);
  const lower = texts.filter((t) => {
    const first = t.replace(/^[^\p{L}]+/u, "")[0];
    return first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase();
  }).length;
  return {
    n,
    medianWords: median(words),
    lowercaseStartPct: pct(lower, n),
    emojiPct: pct(texts.filter((t) => EMOJI.test(t)).length, n),
    questionPct: pct(texts.filter((t) => t.includes("?")).length, n),
    medianHashtags: hashtagCounts.length ? median(hashtagCounts) : null,
  };
}

function clean(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length < 3) return null;
  const lowered = t.toLowerCase();
  if (lowered === "none" || lowered === "unknown" || lowered === "n/a") return null;
  return t.length > LINE_CAP ? `${t.slice(0, LINE_CAP)}…` : t;
}

/** Their best lines, best first, deduped, with where each came from. */
export async function voiceFor(ctx: QueryCtx, creatorId: Id<"creators">): Promise<{ lines: VoiceLine[]; style: StyleFacts }> {
  const posts = (await ctx.db
    .query("ownPosts")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .order("desc")
    .take(60)) as Doc<"ownPosts">[];

  const style = styleFacts(posts.map((p) => p.caption), posts.map((p) => p.hashtags.length));

  /**
   * Ranked by how far above their own normal each post went. A post with no multiple yet is
   * not evidence of anything, so it sorts last rather than being dropped.
   *
   * Sprint 4c: a line that BEAT their normal is worth more than a line that merely exists,
   * so the ranking is the outcome itself. Nothing here needs a tap from the creator.
   */
  const ranked = [...posts].sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1));
  const cards = (await ctx.db
    .query("ownPostReads")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .order("desc")
    .take(60)) as Doc<"ownPostReads">[];
  const cardByPost = new Map<string, Doc<"ownPostReads">>();
  for (const c of cards) if (!cardByPost.has(c.ownPostId)) cardByPost.set(c.ownPostId, c);

  const lines: VoiceLine[] = [];
  const seen = new Set<string>();
  const push = (text: string | null, kind: VoiceLine["kind"], multiple: number | null) => {
    if (!text) return;
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    lines.push({ text, kind, multiple });
  };

  for (const p of ranked) {
    if (lines.length >= EXEMPLAR_CAP) break;
    const card = cardByPost.get(p._id) as { card?: { hook?: { onScreenText?: unknown; spokenLine?: unknown } } } | undefined;
    const hook = card?.card?.hook;
    // On-screen text first: it is the line the product is being asked to write.
    push(clean(hook?.onScreenText), "on-screen", p.multiple ?? null);
    if (lines.length >= EXEMPLAR_CAP) break;
    push(clean(p.caption.replace(/#[\p{L}\p{N}_]+/gu, "").trim()), "caption", p.multiple ?? null);
    if (lines.length >= EXEMPLAR_CAP) break;
    push(clean(hook?.spokenLine), "spoken", p.multiple ?? null);
  }

  return { lines: lines.slice(0, EXEMPLAR_CAP), style };
}

/**
 * The prefix block. Instructions live here, next to the evidence, because a rule about
 * matching their voice is meaningless without their voice underneath it.
 */
export function voiceSection(v: { lines: VoiceLine[]; style: StyleFacts }): string {
  if (v.lines.length === 0) {
    return `# How they actually write\nYou have not read enough of their posts to quote them yet. Do not guess at a house style: keep any line you write plain and concrete, and say it is one to try.`;
  }
  const s = v.style;
  const habits = [
    s.medianWords !== null ? `usually about ${s.medianWords} words` : null,
    s.lowercaseStartPct !== null ? `${s.lowercaseStartPct}% start lowercase` : null,
    s.emojiPct !== null ? `${s.emojiPct}% use an emoji` : null,
    s.questionPct !== null ? `${s.questionPct}% ask a question` : null,
    s.medianHashtags !== null ? `usually ${s.medianHashtags} hashtags` : null,
  ].filter(Boolean).join(" · ");

  const quoted = v.lines
    .map((l) => `- "${l.text}" [${l.kind}${l.multiple !== null ? `, ${l.multiple}× their normal` : ""}]`)
    .join("\n");

  return [
    `# How they actually write — THEIR OWN LINES, VERBATIM`,
    `Counted from ${s.n} of their captions: ${habits || "not enough to count"}.`,
    quoted,
    `Any caption, hook or on-screen text you write must be one THEY could have written: same length, same case, same kind of joke. Match these lines, do not describe them.`,
    `Rules that follow from the above:`,
    `- The overlay IS the joke. Never explain the joke inside it ("...and convincing myself it was discipline" is explaining).`,
    `- One concrete noun from their actual life. No abstract nouns: discipline, motivation, journey, mindset, grind.`,
    `- If any creator in this niche could post the line word for word, it is wrong. Write the one only they could post.`,
    `- Never open with a borrowed format: "pov:", "nobody: / me:", "the way I", "it's giving", "tell me why", "that one friend who", "main character".`,
  ].join("\n");
}

export const forCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ lines: VoiceLine[]; style: StyleFacts }> => await voiceFor(ctx, a.creatorId),
});
