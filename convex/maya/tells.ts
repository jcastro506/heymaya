/**
 * ⭐ Tell research (Sprint 4) — the denylist, measured rather than assumed.
 *
 * §7.5.2 ships a table of "what makes text sound like AI" — delve, tapestry,
 * triadic lists, the *"it's not X, it's Y"* reversal, rhetorical-question
 * openers. The sprint is explicit that it is **"a starting hypothesis, not the
 * finding"**, and that the real list should be derived from *measured*
 * differences between human and model text **in this niche**.
 *
 * This measures it. First run, 2026-08-07 — 63 real niche posts against 16 of
 * hers — and most of the hypothesis did not survive.
 *
 * ## What the measurement found
 *
 * | feature | human | hers | |
 * |---|---|---|---|
 * | lexical (delve · tapestry · …) | **0.00** | **0.00** | ⛔ absent from BOTH |
 * | "it's not X, it's Y" | 0.00 | 0.00 | ⛔ absent from both |
 * | triadic lists | 0.25 | **0.00** | ⚠️ **humans use them MORE** |
 * | rhetorical-question opener | 3.17 | **0.00** | ⚠️ **humans use them MORE** |
 * | emoji | 4.33 | **0.00** | ⭐ her tell |
 * | hashtags | 6.81 | **0.40** | ⭐ her tell |
 * | starts lowercase | 4.76 | **31.25** | ⭐ her tell |
 *
 * ### Three conclusions, none of them in the hypothesis
 *
 * 1. ⛔ **The lexical denylist defends against nothing.** "delve", "tapestry",
 *    "game-changer" appear **zero times** in 63 real posts and zero times in
 *    hers. It is a 2023 tell, and in this niche it is dead weight.
 *
 * 2. ⚠️ **Two hypothesised tells point the wrong way.** Triadic lists and
 *    question openers are *more* human here. A critic penalising them would
 *    push her **away** from how this niche actually writes — the hypothesis
 *    would have made her worse.
 *
 * 3. ⭐ **Her real tells are ABSENCES.** No emoji where humans average 4.33 per
 *    100 words; almost no hashtags against 6.81. **A denylist can only catch
 *    what is present** — it is structurally incapable of catching what is
 *    missing, which is why nothing we had could see her actual tell.
 *
 * And the fourth, which is the anti-slop work biting itself: she starts a post
 * lowercase **6.6× more often than humans do**. Trying hard not to sound like a
 * machine has produced a new signature — performed casualness.
 *
 * ⚠️ **n=16 on her side.** These are directional, not settled. The point of
 * this file is that the number re-measures as the corpus grows, so the denylist
 * stops being a thing someone wrote down once.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * The §7.5.2 lexical hypothesis, kept so it can keep being TESTED.
 *
 * Not deleted despite measuring zero: a niche where these do appear would want
 * to know, and a list that vanished the moment it read zero could never say so.
 */
export const HYPOTHESISED_LEXICAL = [
  "delve",
  "tapestry",
  "landscape",
  "game-changer",
  "unlock",
  "leverage",
  "seamless",
  "robust",
  "elevate",
  "it's worth noting",
  "in today's",
] as const;

export interface TextFeatures {
  /** Per 100 words, so a long post and a short one compare. */
  emDash: number;
  triadic: number;
  notXButY: number;
  lexical: number;
  emoji: number;
  hashtag: number;
  /** Percentages across the sample, not per word. */
  questionOpener: number;
  lowercaseStart: number;
  meanSentenceWords: number;
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function measure(text: string): TextFeatures {
  const words = text.match(/[A-Za-z']+/g) ?? [];
  const w = Math.max(words.length, 1);
  const per100 = (n: number) => (100 * n) / w;
  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);

  const lexicalHits = HYPOTHESISED_LEXICAL.reduce(
    (n, term) => n + (text.toLowerCase().split(term).length - 1),
    0
  );

  return {
    emDash: per100((text.match(/—/g) ?? []).length),
    triadic: per100((text.match(/\w+,\s\w+,?\s(?:and|&)\s\w+/g) ?? []).length),
    notXButY: per100(
      (text.match(/(?:it'?s|this is|that'?s)\s+not\s+[^.,]{2,30}[,—]\s*it'?s/gi) ?? [])
        .length
    ),
    lexical: per100(lexicalHits),
    emoji: per100((text.match(EMOJI) ?? []).length),
    hashtag: per100((text.match(/#/g) ?? []).length),
    questionOpener:
      /^\s*(What|Why|How|Ever)\b/.test(text) || sentences[0]?.trim().endsWith("?")
        ? 100
        : 0,
    lowercaseStart: /^[a-z]/.test(text.trim()) ? 100 : 0,
    meanSentenceWords:
      sentences.length === 0
        ? 0
        : sentences.reduce((n, s) => n + (s.match(/[A-Za-z']+/g) ?? []).length, 0) /
          sentences.length,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export interface Tell {
  feature: keyof TextFeatures;
  human: number;
  hers: number;
  delta: number;
  /** Which way it points — the hypothesis got two of these backwards. */
  direction: "she does it more" | "she does it less";
  detail: string;
}

/**
 * Minimum samples on the smaller side before a difference is reported.
 *
 * ⚠️ Below this the deltas are noise wearing a decimal point. A tell derived
 * from eight posts would get written into the critic and shape months of
 * output — §14.3 already warns that this product cannot run experiments at
 * founder-scale volume, and this is the same trap one layer down.
 */
export const MIN_SAMPLES = 12;

/** How far apart before it's a tell rather than variation. */
export const TELL_THRESHOLD = 0.6;

export function compare(input: {
  human: string[];
  hers: string[];
}): { ok: boolean; tells: Tell[]; detail: string } {
  const { human, hers } = input;
  if (human.length < MIN_SAMPLES || hers.length < MIN_SAMPLES) {
    return {
      ok: false,
      tells: [],
      detail: `${human.length} human and ${hers.length} of hers — need ${MIN_SAMPLES} of each before a difference means anything`,
    };
  }

  const hf = human.map(measure);
  const mf = hers.map(measure);
  const tells: Tell[] = [];

  for (const key of Object.keys(hf[0]) as Array<keyof TextFeatures>) {
    if (key === "meanSentenceWords") continue;
    const h = mean(hf.map((f) => f[key]));
    const m = mean(mf.map((f) => f[key]));
    const scale = Math.max(h, m);
    // Both near zero is agreement, not a finding — this is what retires the
    // lexical hypothesis rather than letting 0.00 vs 0.00 read as a match.
    if (scale <= 0.15) continue;
    if (Math.abs(m - h) < TELL_THRESHOLD * scale) continue;

    const more = m > h;

    /**
     * ⚠️ A ratio against zero is not a ratio.
     *
     * The first run reported *"the niche uses emoji 433.2× more than she
     * does"* — she uses zero, so the multiple was 4.33 divided by an epsilon.
     * It reads as a precise measurement and is an artifact of the guard
     * against dividing by nothing.
     *
     * When one side is zero the honest sentence says NEVER, and gives the
     * other side's rate so the size of the gap is still visible. This is the
     * same shape as a sub-cent cost rendering as $0.00: a number that looks
     * exact and means something else.
     */
    const ZERO = 0.05;
    const detail =
      m < ZERO
        ? `she never uses ${key}; the niche averages ${h.toFixed(1)} per 100 words`
        : h < ZERO
          ? `she uses ${key} ${m.toFixed(1)} per 100 words; the niche essentially never does`
          : more
            ? `she uses ${key} ${(m / h).toFixed(1)}× more than the niche does`
            : `the niche uses ${key} ${(h / m).toFixed(1)}× more than she does`;

    tells.push({
      feature: key,
      human: h,
      hers: m,
      delta: m - h,
      direction: more ? "she does it more" : "she does it less",
      detail,
    });
  }

  tells.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    ok: true,
    tells,
    detail:
      tells.length === 0
        ? "nothing separates her from the niche on these features"
        : `${tells.length} measurable difference${tells.length === 1 ? "" : "s"} — biggest: ${tells[0].detail}`,
  };
}

/**
 * Measure this customer's tells against their own niche.
 *
 * Reuses the two corpora the cringe eval already assembles, so this costs
 * nothing beyond the comparison and can never disagree with the eval about
 * what "her writing" means.
 */
export const measureTells = internalAction({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; tells: Tell[]; detail: string }> => {
    const hers = await ctx.runQuery(internal.maya.cringeEval.herWriting, {
      customerId: args.customerId,
      limit: 40,
    });
    const human = await ctx.runQuery(internal.maya.cringeEval.humanSamples, {
      customerId: args.customerId,
      limit: 200,
    });
    return compare({ human, hers });
  },
});
