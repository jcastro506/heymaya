import { v } from "convex/values";
import { internalAction } from "../_generated/server";
/**
 * Research and sweep QUALITY gates.
 *
 * The product lives or dies on the quality of what it watches. A perception
 * layer that returns something on every run, and returns generic mush, is
 * worse than one that returns nothing — because nothing is visibly broken and
 * mush looks like it's working.
 *
 * §7.6.9 already says this about media, and it generalizes:
 *
 * > The failure mode to measure isn't "nothing came back." It's "something
 * > came back and it's a stock photo."
 *
 * ## What can and cannot be tested here
 *
 * "Is this insight smart?" is not assertable and this module does not pretend
 * otherwise. What IS assertable is that the output has the structural
 * properties good research requires — and, more usefully, that obvious garbage
 * is rejected. Every gate below is written so a known-bad input fails it:
 *
 *   a "trend" nobody engaged with · a claim with no source · a benchmark
 *   computed from two posts · twenty observations from one account · this
 *   week's insight identical to last week's · an insight naming nothing
 *   concrete at all
 *
 * Deliberately structural, per the repo rule: assert on structure and stable
 * identifiers, never on generated prose. Prose changes weekly; a test that
 * substring-matches it is a false-alarm generator.
 */

/* -------------------------------------------------------------------------- */
/* Freshness                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How old a thing may be before it stops being what it claims to be.
 *
 * A "trend" from three months ago is not a trend, it's history — and acting on
 * it is how a feed starts looking six months stale (§5.3). The windows differ
 * by kind because the underlying reality moves at different speeds: formats
 * turn over weekly, benchmarks monthly, a buyer map quarterly.
 */
export const FRESHNESS_WINDOW_MS: Record<string, number> = {
  trend: 7 * 24 * 3600_000,
  post: 30 * 24 * 3600_000,
  comment: 30 * 24 * 3600_000,
  metric: 7 * 24 * 3600_000,
  benchmark: 30 * 24 * 3600_000,
  buyer_map: 90 * 24 * 3600_000,
};

/** Minimum observations before a derived number means anything. */
export const MIN_SAMPLE_SIZE: Record<string, number> = {
  benchmark: 8,
  trend: 5,
  buyer_map: 10,
};

/**
 * A sweep that reads one account twenty times has not surveyed a niche. Below
 * this ratio of distinct authors to observations, the set is a monoculture and
 * any conclusion drawn from it is really a conclusion about one person.
 */
export const MIN_AUTHOR_DIVERSITY = 0.3;

/** Above this Jaccard similarity to a prior insight, it's a repeat, not news. */
export const MAX_SIMILARITY_TO_PRIOR = 0.8;

export interface Observation {
  sourceUrl?: string;
  authorHandle?: string;
  postedAt?: number;
  capturedAt?: number;
  kind: string;
  text?: string;
  metrics?: { views?: number; likes?: number; comments?: number; shares?: number };
}

export type QualityFailure =
  | { gate: "empty"; detail: string }
  | { gate: "stale"; detail: string; oldestAgeDays: number }
  | { gate: "ungrounded"; detail: string; missing: number }
  | { gate: "sample_too_small"; detail: string; got: number; need: number }
  | { gate: "monoculture"; detail: string; distinctAuthors: number; total: number }
  | { gate: "no_engagement"; detail: string }
  | { gate: "generic"; detail: string }
  | { gate: "repeat"; detail: string; similarity: number };

export interface QualityVerdict {
  ok: boolean;
  failures: QualityFailure[];
}

/* -------------------------------------------------------------------------- */
/* Specificity — the anti-generic gate                                         */
/* -------------------------------------------------------------------------- */

const HANDLE = /@[a-z0-9_.]{2,}/i;
const URL = /https?:\/\/\S+/i;
/** A real number, not a year and not a list index. */
const NUMBER = /\b\d{2,}(?:[.,]\d+)?%?\b/;

/**
 * ⭐ The hedge wordlist is GONE, and `judgeFiller` replaced it.
 *
 * It was thirteen words — engagement, audience, strategy, value — deciding
 * whether text was padding. That is a judgment call in a lookup table, and it
 * is wrong in the obvious direction: *"drive engagement"* is filler,
 * *"3 engagements on that post"* is a fact. A wordlist counts both.
 *
 * The operator's standing rule covers this: trust the model where the question
 * is judgment. A 13-word list is not a cheaper judge, it is a worse one.
 *
 * The gates BELOW stay deterministic, and the difference is worth naming:
 * "does this text contain a handle, a URL or a number" is **presence**, not
 * quality. No model is needed to see whether a digit is there.
 */

/**
 * Does this text name anything real?
 *
 * A handle, a URL, or a number is a hook into the world. Text with none of
 * them is unfalsifiable, and unfalsifiable is the signature of generated
 * filler. This is a floor, not a quality score — passing it doesn't make the
 * insight good, but failing it makes it worthless.
 */
export function namesSomethingConcrete(text: string): boolean {
  return HANDLE.test(text) || URL.test(text) || NUMBER.test(text);
}



/** Word-level Jaccard. Cheap, and good enough to catch a restated insight. */
export function similarity(a: string, b: string): number {
  const setOf = (s: string) =>
    new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3));
  const A = setOf(a);
  const B = setOf(b);
  if (A.size === 0 && B.size === 0) return 1;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  const union = A.size + B.size - shared;
  return union === 0 ? 0 : shared / union;
}

/* -------------------------------------------------------------------------- */
/* The gates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Assess a set of observations from one sweep.
 *
 * Returns every failure rather than the first, because a sweep is usually
 * wrong in more than one way at once and fixing them one run at a time is slow.
 */
export function assessSweep(input: {
  kind: string;
  observations: ReadonlyArray<Observation>;
  now: number;
}): QualityVerdict {
  const { kind, observations, now } = input;
  const failures: QualityFailure[] = [];

  if (observations.length === 0) {
    return {
      ok: false,
      failures: [{ gate: "empty", detail: "the sweep returned nothing" }],
    };
  }

  // ── Sample size ────────────────────────────────────────────────────────
  const need = MIN_SAMPLE_SIZE[kind];
  if (need !== undefined && observations.length < need) {
    failures.push({
      gate: "sample_too_small",
      detail: `${observations.length} observations can't support a ${kind}`,
      got: observations.length,
      need,
    });
  }

  // ── Freshness ──────────────────────────────────────────────────────────
  const window = FRESHNESS_WINDOW_MS[kind];
  if (window !== undefined) {
    const stamps = observations
      .map((o) => o.postedAt ?? o.capturedAt)
      .filter((t): t is number => typeof t === "number");
    if (stamps.length === 0) {
      failures.push({
        gate: "stale",
        detail: "no observation carries a date, so freshness can't be judged",
        oldestAgeDays: Infinity,
      });
    } else {
      const newest = Math.max(...stamps);
      if (now - newest > window) {
        failures.push({
          gate: "stale",
          detail: `nothing here is newer than ${Math.floor(
            (now - newest) / 86_400_000
          )} days — that's history, not a ${kind}`,
          oldestAgeDays: Math.floor((now - newest) / 86_400_000),
        });
      }
    }
  }

  // ── Grounding: every observation traces to a source ────────────────────
  const ungrounded = observations.filter((o) => !o.sourceUrl).length;
  if (ungrounded > 0) {
    failures.push({
      gate: "ungrounded",
      detail: `${ungrounded} of ${observations.length} observations have no source URL`,
      missing: ungrounded,
    });
  }

  // ── Author diversity ───────────────────────────────────────────────────
  const authors = new Set(
    observations.map((o) => o.authorHandle).filter(Boolean) as string[]
  );
  const ratio = authors.size / observations.length;
  // A single author is always a monoculture, however few observations there
  // are. The ratio alone is too weak at small N — 1 author across 3 posts is
  // 0.33 and would sail past the threshold while being exactly the problem.
  const singleVoice = authors.size === 1 && observations.length > 1;
  if (authors.size > 0 && (singleVoice || ratio < MIN_AUTHOR_DIVERSITY)) {
    failures.push({
      gate: "monoculture",
      detail: `${authors.size} distinct authors across ${observations.length} observations — that's one account's opinion, not a niche`,
      distinctAuthors: authors.size,
      total: observations.length,
    });
  }

  // ── Engagement: a "trend" nobody engaged with isn't one ────────────────
  if (kind === "trend" || kind === "benchmark") {
    const engaged = observations.filter((o) => {
      const m = o.metrics;
      if (!m) return false;
      return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.views ?? 0) > 0;
    }).length;
    if (engaged === 0) {
      failures.push({
        gate: "no_engagement",
        detail: `nothing in this ${kind} has a single like, view or reply — it isn't working, it's just recent`,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Assess one synthesized insight before it reaches the founder — or the idea
 * bank, which is worse, because a generic idea propagates into content.
 *
 * `priorInsights` are recent insights of the same kind. Restating last week's
 * finding in new words is the most common way research output degrades, and
 * it's invisible unless something compares.
 */
export function assessInsight(input: {
  text: string;
  citations: ReadonlyArray<string>;
  priorInsights?: ReadonlyArray<string>;
}): QualityVerdict {
  const { text, citations, priorInsights = [] } = input;
  const failures: QualityFailure[] = [];

  if (text.trim().length === 0) {
    return { ok: false, failures: [{ gate: "empty", detail: "no insight text" }] };
  }

  // Grounded or silent. An insight with no citation is a guess wearing a
  // finding's clothes.
  if (citations.length === 0) {
    failures.push({
      gate: "ungrounded",
      detail: "no citation — an insight with no source is a guess",
      missing: 1,
    });
  }

  if (!namesSomethingConcrete(text)) {
    failures.push({
      gate: "generic",
      detail:
        "names no handle, URL or number — this would read identically for any product in any niche",
    });
  }

  for (const prior of priorInsights) {
    const score = similarity(text, prior);
    if (score > MAX_SIMILARITY_TO_PRIOR) {
      failures.push({
        gate: "repeat",
        detail: "this is last week's finding in new words",
        similarity: Math.round(score * 100) / 100,
      });
      break;
    }
  }

  return { ok: failures.length === 0, failures };
}


/* -------------------------------------------------------------------------- */
/* The filler judge                                                            */
/* -------------------------------------------------------------------------- */

/** Cheap. This reads one short string and answers one question. */
export const FILLER_MODEL = "openai/gpt-oss-120b";

const FILLER_SYSTEM = `You are reading one line that a social media manager wants to post about, for a specific product.

One question: **would this line read identically for any product in any niche?**

Return STRICT JSON, no prose:
{ "filler": boolean, "why": string }

- "filler": true when the line is padding — words that survive the removal of every concrete fact. "Drive engagement with authentic content that resonates with your audience" is filler: nothing in it is about anything.
- "filler": false when it names something real — a person, a moment, a number, a specific complaint, a specific thing that happened. Specific and DULL is still false. You are not judging whether it is good.
- "why": one short clause.

⚠️ A word is not filler because of the word. "Engagement" in "drive engagement" is padding; "engagement" in "3 engagements on that post" is a measurement. Read the sentence, not the vocabulary.`;

export function parseFillerVerdict(
  raw: string
): { filler: boolean; why: string } | null {
  const fenced = raw.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(fenced) as Record<string, unknown>;
    if (typeof parsed.filler !== "boolean") return null;
    return {
      filler: parsed.filler,
      why: typeof parsed.why === "string" ? parsed.why : "",
    };
  } catch {
    return null;
  }
}

/**
 * ⭐ Is this line about anything?
 *
 * Fails OPEN: an unreachable judge must not silently reject every idea. §2.5 —
 * this is a quality nudge, not a safety gate, and the safety gate that DOES
 * fail closed lives at the publish boundary.
 */
export const judgeFiller = internalAction({
  args: { text: v.string() },
  handler: async (_ctx, args): Promise<{ filler: boolean; why: string }> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { filler: false, why: "" };
    const { callOpenRouter } = await import("../integrations/openrouter/client");
    const completion = await callOpenRouter({
      apiKey,
      model: FILLER_MODEL,
      temperature: 0,
      maxTokens: 300,
      messages: [
        { role: "system", content: FILLER_SYSTEM },
        { role: "user", content: args.text.slice(0, 600) },
      ],
    });
    if (!completion.ok) return { filler: false, why: "" };
    return parseFillerVerdict(completion.content) ?? { filler: false, why: "" };
  },
});
