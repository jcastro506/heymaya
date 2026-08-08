/**
 * The cringe eval (Sprint 4.5) — does she actually sound human?
 *
 * Sprint 4's exit criterion is *"a stranger can't tell it isn't the founder
 * writing."* Six anti-slop layers are built and **nothing measured whether they
 * work**, so the answer was a vibe — and vibes drift silently across prompt
 * edits, model swaps and corpus changes.
 *
 * ## Pairwise, not a pile
 *
 * The judge sees ONE real post and ONE of hers, and picks which was written by
 * a machine. Accuracy over N pairs, where **50% is a perfect score** — that's
 * chance, meaning it cannot tell.
 *
 * Pairwise rather than labelling a shuffled heap because a heap lets the judge
 * drift its threshold ("that's 12 AI ones, surely too many") and the number
 * stops meaning anything. A forced choice between two has one clean baseline.
 *
 * ## The trap this is built to avoid
 *
 * **An eval that always passes.** A judge that says "human" to everything
 * scores a perfect 50% and is measuring nothing — it would quietly bless
 * whatever we ship. So every run includes a **control**: deliberately synthetic
 * marketing copy. If the judge doesn't catch the control, the run is VOID, not
 * a pass.
 *
 * That inversion is the whole design. Without it this file is a rubber stamp.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { similarity } from "./quality";
import type { Doc } from "../_generated/dataModel";

/**
 * A different family from the writer, and not a reasoning model.
 *
 * The judge cannot be Luna: a model asked whether text sounds like a machine,
 * on text it wrote, is being asked to notice its own defaults. Same trap as the
 * critic, one level up.
 */
export const JUDGE_MODEL = "google/gemini-3.1-flash-lite";

/** Below this, "sounds human" is a coin flip on sample size alone. */
export const MIN_PAIRS = 8;

/**
 * How far from chance is a real signal.
 *
 * 50% is perfect. 60% on 10 pairs is one extra correct call and means nothing.
 * 75% means the judge is finding something and so will a reader.
 */
export const DETECTABLE_AT = 0.75;

/**
 * ⭐ SOUNDING HUMAN AND BEING WORTH POSTING ARE DIFFERENT CLAIMS.
 *
 * Measured live 2026-08-05: asked for ten *varied* posts she returned one idea
 * ten times — *"CSV in. Dashboard out."*, *"One paste between your CSV and a
 * dashboard."*, *"Dashboard, without the dashboard project."* — and the pairwise
 * judge scored them at **exactly chance.** Correctly, too: each one reads like a
 * person wrote it.
 *
 * **The register was fine and the week was still empty.** A judge comparing one
 * post to one caption cannot see that the other nine were the same post, so the
 * eval passed something no founder would accept.
 *
 * So variety is scored separately, with no model in the loop — self-similarity
 * across the batch, reusing the same measure the quality gate already uses
 * against prior posts.
 */
export interface VarietyResult {
  /** The WORST pair — the one a founder would notice. */
  maxSimilarity?: number;
  /** How many pairs are effectively the same post. */
  duplicatePairs?: number;
  /** Mean pairwise similarity across her batch. Lower is better. */
  meanSimilarity: number;
  /** Share of posts containing the single most common content word. */
  topicCoverage: number;
  /** That word, so the detail can name it rather than assert a number. */
  dominantTerm?: string;
  varied: boolean;
  detail: string;
}

/**
 * Thresholds, measured rather than guessed.
 *
 * The first version of this used 0.35 mean similarity and **passed a batch of
 * seven posts that were all the same sentence.** Jaccard over word sets
 * punishes length differences, so *"CSV in. Dashboard out."* and *"Building
 * solo is hard enough. Widgetly turns a CSV into a dashboard in one paste."*
 * score as barely related — they share one long word out of nine.
 *
 * Measured on the real batches:
 *
 * |                    | same idea ×7 | genuinely varied ×4 |
 * |---|---|---|
 * | mean similarity    | **0.170**    | 0.019 |
 * | topic coverage     | **1.00**     | 0.50 |
 *
 * **Coverage is the sharper signal**: it asks what share of the batch contains
 * the single most common content word. `dashboard` appeared in 7 of 7. A batch
 * where every post is about one thing IS one idea, however differently phrased
 * — and phrasing is exactly what word-overlap measures and topic doesn't.
 *
 * ⚠️ Both numbers come from **two observed batches**. They separate these cases
 * cleanly and will need revisiting on real data; that is a reason to record
 * scores per run, not a reason to trust the constants.
 */
export const MAX_MEAN_SIMILARITY = 0.1;
export const MAX_TOPIC_COVERAGE = 0.85;

/**
 * ⭐ Two posts this alike are the same post.
 *
 * ⚠️ The mean above **cannot detect repetition, structurally**, and the first
 * live run proved it. Sixteen of her posts contained five near-duplicate pairs
 * — including these two, at 0.87 —
 *
 *   "When you're building alone, a CSV shouldn't BECOME a dashboard project."
 *   "When you're building alone, a CSV shouldn't TURN INTO a dashboard project."
 *
 * — and `scoreVariety` returned `varied: true` with a mean of 0.073, because
 * 115 dissimilar pairs averaged the five away.
 *
 * Repetition is a property of the WORST pair, never the average. And it is the
 * failure the product actually cares about: §3.2 says saying the same thing
 * twice "is how she stops sounding like an employee."
 */
export const NEAR_DUPLICATE_AT = 0.5;

function contentWords(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3)
  );
}

export function scoreVariety(posts: string[]): VarietyResult {
  if (posts.length < 2) {
    return {
      meanSimilarity: 0,
      topicCoverage: 0,
      varied: true,
      detail: "one post — nothing to compare it against",
    };
  }

  let total = 0;
  let count = 0;
  let maxSimilarity = 0;
  const duplicates: Array<[string, string]> = [];
  for (let i = 0; i < posts.length; i += 1) {
    for (let j = i + 1; j < posts.length; j += 1) {
      const sim = similarity(posts[i], posts[j]);
      total += sim;
      count += 1;
      if (sim > maxSimilarity) maxSimilarity = sim;
      if (sim >= NEAR_DUPLICATE_AT) duplicates.push([posts[i], posts[j]]);
    }
  }
  const mean = total / count;

  const freq = new Map<string, number>();
  for (const post of posts) {
    for (const word of contentWords(post)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  const [dominantTerm, hits] =
    [...freq.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const topicCoverage = hits / posts.length;

  // Worst pair FIRST. A single duplicate fails variety however varied the rest
  // is — the founder notices the repeat, not the average.
  const varied =
    duplicates.length === 0 &&
    mean <= MAX_MEAN_SIMILARITY &&
    topicCoverage <= MAX_TOPIC_COVERAGE;

  return {
    meanSimilarity: mean,
    maxSimilarity,
    duplicatePairs: duplicates.length,
    topicCoverage,
    dominantTerm: dominantTerm || undefined,
    varied,
    detail: duplicates.length
      ? `${duplicates.length} pair${duplicates.length === 1 ? "" : "s"} say the same thing — closest: "${duplicates[0][0].slice(0, 60)}…" and "${duplicates[0][1].slice(0, 60)}…"`
      : varied
        ? `${Math.round(mean * 100)}% average overlap — these are different posts`
        : topicCoverage > MAX_TOPIC_COVERAGE
          ? `"${dominantTerm}" appears in ${hits} of ${posts.length} posts — this is one idea, however differently phrased`
          : `${Math.round(mean * 100)}% average overlap — this is one idea rewritten ${posts.length} times`,
  };
}

export interface EvalResult {
  pairs: number;
  /** How often the judge correctly identified hers. 0.5 = chance = ideal. */
  accuracy: number;
  verdict: "indistinguishable" | "detectable" | "void";
  /** Why, in words. */
  detail: string;
  /** Did the judge catch the deliberately-synthetic control? */
  controlCaught: boolean;
  /** Register is not the whole story — see VarietyResult. */
  variety: VarietyResult;
  perPair: Array<{ hers: string; real: string; judgedCorrectly: boolean }>;
}

/**
 * ⭐ THE CONTROL. Deliberately, unmistakably synthetic.
 *
 * Every §7.5.2 tell at once: triadic list, the "it's not X — it's Y" reversal,
 * relentless positivity, engagement bait, and the register that gives it away
 * — *too complete*. If a judge calls this human, it is not judging.
 */
export const SYNTHETIC_CONTROL =
  "Unlock the power of seamless data workflows. In today's fast-paced business " +
  "landscape, teams need solutions that are fast, simple, and powerful. It's not " +
  "just a dashboard — it's a game-changer for how you leverage your data. " +
  "What's your biggest reporting challenge? Let us know below! 👇";

const JUDGE_SYSTEM = `You are shown two social posts. Exactly one was written by an AI.

Return STRICT JSON, no prose:
{ "ai": "A" | "B", "why": string }

- "why": one short clause naming what gave it away, so a human can check you.
- Judge the WRITING, not the subject. A post about software is not more likely to be AI than a post about a dog.
- Real people write fragments, use lowercase, trail off, don't transition smoothly, and leave typos. They make ONE point and stop.
- AI writes to be complete. It covers the topic, balances its paragraphs, closes with a summary, and never leaves anything unresolved.
- If you genuinely cannot tell, still pick one — a coin flip is the correct answer to an indistinguishable pair, and guessing is what makes the score meaningful.`;

export function buildJudgePrompt(a: string, b: string): string {
  return [
    "POST A:",
    a.trim(),
    "",
    "POST B:",
    b.trim(),
    "",
    "Which one was written by an AI? Strict JSON only.",
  ].join("\n");
}

export function parseJudgement(content: string): "A" | "B" | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as { ai?: unknown };
    return parsed.ai === "A" || parsed.ai === "B" ? parsed.ai : null;
  } catch {
    return null;
  }
}

/**
 * Score a set of judgements.
 *
 * `accuracy` is how often the judge found her post. **Lower is better, and 0.5
 * is the target** — not zero. A judge that is reliably WRONG (0.0) is just as
 * informative as one that is reliably right: it means her posts are
 * systematically distinguishable, we just had the sign backwards. So the
 * verdict is about DISTANCE from chance, in either direction.
 */
export function scoreRun(
  judgements: Array<{ correct: boolean }>,
  controlCaught: boolean
): Omit<EvalResult, "perPair" | "variety"> {
  const pairs = judgements.length;
  if (!controlCaught) {
    return {
      pairs,
      accuracy: 0,
      verdict: "void",
      detail:
        "the judge failed to spot deliberately synthetic marketing copy — it isn't judging, so this run means nothing",
      controlCaught: false,
    };
  }
  if (pairs < MIN_PAIRS) {
    return {
      pairs,
      accuracy: 0,
      verdict: "void",
      detail: `only ${pairs} pairs — too few to tell a signal from a coin`,
      controlCaught: true,
    };
  }

  const correct = judgements.filter((j) => j.correct).length;
  const accuracy = correct / pairs;
  const distance = Math.abs(accuracy - 0.5);

  return {
    pairs,
    accuracy,
    verdict: distance >= DETECTABLE_AT - 0.5 ? "detectable" : "indistinguishable",
    detail:
      distance >= DETECTABLE_AT - 0.5
        ? `the judge sorted ${Math.round(accuracy * 100)}% of pairs correctly — it can tell, and so will a reader`
        : `the judge sorted ${Math.round(accuracy * 100)}% of pairs, near enough to chance that it can't tell`,
    controlCaught: true,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Real human posts from this niche, already collected.
 *
 * These come from the scroll — actual captions written by actual people in the
 * founder's market. That is what makes this eval honest: the comparison is
 * against the register she is trying to match, not against generic "good
 * writing".
 */
export const humanSamples = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<string[]> => {
    const rows = (await ctx.db
      .query("observations")
      .withIndex("by_customer_and_captured", (q) =>
        q.eq("customerId", args.customerId)
      )
      .order("desc")
      .take(200)) as Doc<"observations">[];

    const seen = new Set<string>();
    return rows
      .map((r) => r.text.trim())
      // Long enough to have a voice, short enough to be one post.
      .filter((t) => t.length >= 60 && t.length <= 400)
      // Hashtag soup is not writing, and pairing against it flatters her.
      .filter((t) => (t.match(/#/g) ?? []).length <= 4)
      .filter((t) => {
        const key = t.toLowerCase().slice(0, 60);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, args.limit ?? 10);
  },
});

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Run the eval.
 *
 * Her posts are supplied rather than generated here, deliberately: generating
 * them inside the eval would let the eval and the writer drift together, and a
 * test that moves with the thing it measures measures nothing. The caller
 * produces them the same way production does.
 */
export const runEval = internalAction({
  args: {
    customerId: v.id("customers"),
    herPosts: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<EvalResult> => {
    const humans = await ctx.runQuery(internal.maya.cringeEval.humanSamples, {
      customerId: args.customerId,
      limit: args.herPosts.length,
    });

    const { callModel } = await import("./llm");
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";

    const judge = async (a: string, b: string): Promise<"A" | "B" | null> => {
      const completion = await callModel(ctx, {
      customerId: args.customerId,
      purpose: "cringe_eval",
        apiKey,
        model: JUDGE_MODEL,
        temperature: 0,
        maxTokens: 500,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: buildJudgePrompt(a, b) },
        ],
      });
      return completion.ok ? parseJudgement(completion.content) : null;
    };

    // The control first. If this fails, nothing after it means anything.
    const controlHuman = humans[0] ?? "just shipped the thing. took way longer than i thought it would.";
    const controlPick = await judge(SYNTHETIC_CONTROL, controlHuman);
    const controlCaught = controlPick === "A";

    const perPair: EvalResult["perPair"] = [];
    const judgements: Array<{ correct: boolean }> = [];

    for (let i = 0; i < Math.min(args.herPosts.length, humans.length); i += 1) {
      const hers = args.herPosts[i];
      const real = humans[i];
      // Alternate which slot she occupies, so a judge with a positional bias
      // ("it's usually B") scores at chance instead of looking clever.
      const hersIsA = i % 2 === 0;
      const pick = await judge(hersIsA ? hers : real, hersIsA ? real : hers);
      if (!pick) continue;
      const judgedCorrectly = hersIsA ? pick === "A" : pick === "B";
      judgements.push({ correct: judgedCorrectly });
      perPair.push({ hers, real, judgedCorrectly });
    }

    return {
      ...scoreRun(judgements, controlCaught),
      variety: scoreVariety(args.herPosts),
      perPair,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Running it on what she actually published                                   */
/* -------------------------------------------------------------------------- */

/**
 * ⭐ Run the eval against her REAL posts, not a sample someone typed.
 *
 * `runEval` takes `herPosts` as an argument and had **no caller** — so the
 * instrument Sprint 4.5 exists to build has never measured anything.
 * Twenty-eighth find.
 *
 * That matters more than one more unwired module, because §18's Sprint 4 exit
 * is *"a stranger can't tell it isn't the founder writing"* and this is the
 * only thing that can answer it. Six anti-slop layers were built and the number
 * that says whether they work has never existed.
 *
 * ⚠️ It reads `placements`, not `drafts`. A draft is what she proposed; a
 * placement is what a stranger actually saw. Measuring drafts would grade the
 * work rather than the product — and would include everything the founder
 * rejected, which is precisely the writing we want excluded.
 */
export const runEvalOnPublished = internalAction({
  args: {
    customerId: v.id("customers"),
    sinceDays: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; result?: EvalResult; detail: string }> => {
    const now = args.now ?? Date.now();
    const since = now - (args.sinceDays ?? 60) * 86_400_000;

    const placements = await ctx.runQuery(internal.maya.archive.timeline, {
      customerId: args.customerId,
      since,
      limit: 50,
    });
    const herPosts = placements
      .filter((p) => p.kind === "post" && p.linkStatus === "live")
      .map((p) => p.snapshotText)
      .filter((t) => t.trim().length > 0);

    /**
     * ⚠️ Below the floor this is not a weak signal, it is noise. §18 Sprint
     * 4.5 sets `MIN_PAIRS` for a reason: an accuracy computed from three pairs
     * swings on one judge call, and a number that moves at random is worse
     * than no number because someone will act on it.
     */
    if (herPosts.length < MIN_PAIRS) {
      return {
        ok: false,
        detail: `only ${herPosts.length} published posts — needs ${MIN_PAIRS} before the number means anything`,
      };
    }

    const result = await ctx.runAction(internal.maya.cringeEval.runEval, {
      customerId: args.customerId,
      herPosts,
    });
    return {
      ok: result.verdict !== "void",
      result,
      /**
       * A void run is reported as a FAILURE, not a pass. If the judge missed
       * the synthetic control it was not judging — and the accuracy from that
       * run is a number with nothing behind it.
       */
      detail:
        result.verdict === "void"
          ? "the run is void — the judge missed the planted synthetic post, so its verdict on the real ones means nothing"
          : result.detail,
    };
  },
});

/**
 * ⭐ Everything SHE has written, for the eval's other half.
 *
 * `runEval` takes `herPosts` as an argument and nothing ever assembled them,
 * which is why Sprint 4.5's entire deliverable had zero callers: the eval was
 * finished and uncallable. This is the missing half.
 *
 * ## Why drafts count, not only placements
 *
 * The question is *"can a stranger tell this wasn't written by the founder"* —
 * a property of the WRITING, not of whether it got published. A draft she wrote
 * and the founder never answered is exactly as diagnostic as one that went
 * live, and excluding it would mean the eval can't run until a week of
 * placements exists. On this account that is the difference between 6 samples
 * and enough.
 *
 * ⚠️ Rejected drafts are excluded, and deliberately. The founder said no to
 * those, so they are a measure of what we stopped shipping rather than of what
 * we ship — including them would flatter the number in the one direction that
 * matters.
 */
export const herWriting = internalQuery({
  args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<string[]> => {
    const limit = args.limit ?? 20;

    const placements = (await ctx.db
      .query("placements")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"placements">[];

    const drafts = (await ctx.db
      .query("drafts")
      .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
      .collect()) as Doc<"drafts">[];

    const seen = new Set<string>();
    const out: string[] = [];
    const push = (text: string | undefined) => {
      if (!text) return;
      const t = text.trim();
      // Same shape filter as the human side, so the judge cannot win on length
      // alone — a 20-character reply beside a 300-character post is a tell
      // about the sampling, not about the writing.
      if (t.length < 60 || t.length > 400) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };

    // Newest first: the eval should measure what she writes NOW, not what she
    // wrote before the last prompt change.
    for (const p of [...placements].sort((a, b) => b.publishedAt - a.publishedAt)) {
      push(p.snapshotText);
    }
    for (const d of [...drafts].sort((a, b) => b.proposedAt - a.proposedAt)) {
      if (d.outcome === "rejected") continue;
      push(d.snapshotText);
    }
    return out.slice(0, limit);
  },
});

/**
 * Run the eval for one customer, assembling both sides.
 *
 * The entry point that was missing. Returns the shortfall by name when there
 * isn't enough of her writing yet — a small-n eval is worse than none, because
 * a 3-pair run swings 33 points on one judgement and reads as a signal.
 */
export const runEvalForCustomer = internalAction({
  args: { customerId: v.id("customers") },
  handler: async (
    ctx,
    args
  ): Promise<EvalResult | { ok: false; error: string }> => {
    const herPosts = await ctx.runQuery(internal.maya.cringeEval.herWriting, {
      customerId: args.customerId,
    });
    if (herPosts.length < MIN_PAIRS) {
      return {
        ok: false,
        error: `only ${herPosts.length} of her posts are long enough to compare — need ${MIN_PAIRS}`,
      };
    }
    return await ctx.runAction(internal.maya.cringeEval.runEval, {
      customerId: args.customerId,
      herPosts,
    });
  },
});
