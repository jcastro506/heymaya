/**
 * The outbound firewall — what may leave, and how hard we stop it.
 *
 * Ported from `convex/gtmMaya/outboundFirewall.ts`, whose lists carry dated
 * production scar tissue that must not be re-derived. Where a rule looks
 * over-specific, it is usually a bug someone shipped.
 *
 * ## The enforcement ladder (standing rule: prompt-primary, no regex policing)
 *
 * | Layer | What it catches | Consequence |
 * |---|---|---|
 * | SOUL prompt | everything, first | **primary control** |
 * | Exact-string denylist | catastrophic leaks only | **block** |
 * | LLM critic, different model | slop, safety | **block** (fail closed) |
 * | Drift lists | jargon, mild slop | **LOG ONLY, never a drop** |
 *
 * The bottom row is the rule people get wrong. A non-catastrophic drift never
 * drops a message: v1 blackholed the founder's entire plan because "content
 * angle" and "relationship target" sat in a blocking list, and the delivery
 * retried into the same wall forever, stamping nothing.
 *
 * ## Two paths, deliberately different
 *
 * **Public posts hard-gate.** They go out under the founder's real name and
 * cannot be un-posted.
 *
 * **Private DMs sanitize and send.** The firewall's job there is voice quality,
 * not ban-safety, and a bounce that reaches nobody is strictly worse than a
 * comma where an em-dash was.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { callOpenRouter } from "../integrations/openrouter/client";

/**
 * The critic must be a DIFFERENT FAMILY from the writer.
 *
 * `luna` judging `luna-pro` grades its own register and catches nothing — they
 * are the same underlying model at different reasoning modes.
 *
 * ⚠️ **NO `openrouter/` PREFIX HERE.** That prefix is *OpenClaw's* way of
 * naming a provider; this calls OpenRouter's API **directly**, where the model
 * is the bare vendor slug. Shipping `openrouter/moonshotai/kimi-k2-0905` to
 * `/v1/chat/completions` names a model that does not exist.
 *
 * The exact mirror of the bug fixed this morning, where OpenClaw's config was
 * missing the prefix it *does* require. Same two words, opposite direction:
 *
 *   OpenClaw config      →  openrouter/moonshotai/kimi-k2-0905
 *   OpenRouter REST API  →  moonshotai/kimi-k2-0905
 *
 * ## Why gemini-flash-lite and not the two obvious alternatives
 *
 * Verified against `/api/v1/models` 2026-08-05:
 *
 * | model | in / 1M | out / 1M | verdict |
 * |---|---|---|---|
 * | `google/gemini-3.1-flash-lite` | $0.25 | $1.50 | ✅ |
 * | `moonshotai/kimi-k2-0905` | $0.60 | $2.50 | was this — 2.4× the price |
 * | `qwen/qwen3.7-flash` | $0.03 | $0.13 | cheapest, but a REASONING model |
 * | any `openai/*` | — | — | ⛔ the writer's own family |
 *
 * qwen is 8× cheaper and still wrong here. Its thinking is billed and budgeted
 * as completion, and **this gate fails closed** — a token-budget miscalculation
 * blocks every post rather than degrading. That exact failure was caught before
 * it ran, with `maxTokens: 300` against 188 reasoning tokens on a 21-token
 * prompt. At roughly one critique a day, predictability beats $0.02 a month.
 *
 * A cheap OpenAI model would be cheaper still and is disqualified outright: it
 * is the writer's family, which defeats the only rule this critic has.
 */
export const SAFETY_CRITIC_MODEL = "google/gemini-3.1-flash-lite";

/* -------------------------------------------------------------------------- */
/* Catastrophic — these block                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Our own machinery, in words. A founder should never learn these exist.
 *
 * v2 vocabulary — v1's list named `gtmTargetThreads` and `/lc_gtm/`, which no
 * longer exist. Leaking any of these reads as software talking about itself,
 * which is the single fastest way to stop sounding like an employee.
 */
export const INTERNAL_TERMS = [
  "product truth",
  "snapshotText",
  "linkStatus",
  "idempotency key",
  "idempotencyKey",
  "iron rule",
  "publish decision",
  "publishDecision",
  "hold reason",
  "spend ceiling",
  "dead letter",
  "dead-letter",
  "job queue",
  "queued job",
  "preflight",
  "posting mode",
  "show_me_first",
  "just_go",
  "workspace file",
  "bootstrap",
  "OpenClaw",
  "Zernio",
  "Convex",
  "placement row",
  "buyer map",
];

/**
 * Self-references. NOT any mention of AI.
 *
 * ⚠️ Bare "AI", "LLM" and "language model" were REMOVED from v1's list after a
 * verified failure on 2026-05-26: the matcher is a substring search, so bare
 * terms blocked legitimate product language — a customer whose product is
 * literally about local LLM workflows could never be written about. It looped
 * forever and never sent.
 *
 * The intent is "I am an AI", not "the AI market".
 */
export const AI_SELF_REFERENCES = [
  "as an AI",
  "I am an AI",
  "I'm an AI",
  "AI assistant",
  "AI agent",
  "your AI",
  "as an LLM",
  "I am an LLM",
  "I'm an LLM",
  "as a language model",
  "I am a language model",
  "I'm a language model",
  "as a large language model",
];

/* -------------------------------------------------------------------------- */
/* Drift — these LOG, never block                                              */
/* -------------------------------------------------------------------------- */

/**
 * Strategy jargon the founder shouldn't have to decode.
 *
 * **Log-only, and the reason is a scar.** These lived in the blocking list in
 * v1 and blackholed a delivered plan. Annoying is not catastrophic.
 */
export const JARGON_DRIFT_TERMS = [
  "channel scorecard",
  "content angle",
  "relationship target",
  "buyer journey",
  "stage-adaptive",
  "format library",
  "idea bank",
];

/** §7.5.2's lexical tells. The critic hunts shape; this only counts words. */
export const SLOP_PHRASES = [
  "game changer",
  "game-changer",
  "supercharge",
  "skyrocket",
  "10x your",
  "next level",
  "level up your",
  "deep dive",
  "dive deep",
  "delve",
  "tapestry",
  "in today's",
  "the world of",
  "the realm of",
  "it's worth noting",
  "rest assured",
  "seamless",
  "elevate your",
];

/* -------------------------------------------------------------------------- */

export type OutboundCategory =
  | "internal_term"
  | "ai_reference"
  | "jargon_drift"
  | "slop_phrase"
  | "ai_punctuation"
  | "safety_violation"
  /** ⭐ The critic could not run. Fails CLOSED on public posts. */
  | "safety_unverifiable";

export interface OutboundFinding {
  category: OutboundCategory;
  matched: string;
  excerpt: string;
}

function findMatches(
  text: string,
  needles: readonly string[],
  category: OutboundCategory
): OutboundFinding[] {
  const haystack = text.toLowerCase();
  const found: OutboundFinding[] = [];
  for (const needle of needles) {
    const at = haystack.indexOf(needle.toLowerCase());
    if (at === -1) continue;
    found.push({
      category,
      matched: needle,
      excerpt: text.slice(Math.max(0, at - 30), Math.min(text.length, at + 30)).trim(),
    });
  }
  return found;
}

/**
 * The two most recognisable "an AI wrote this" markers.
 *
 * A regex IS the right tool here — these are exact characters, not a fuzzy
 * judgment. Real people texting use periods, commas and line breaks.
 *
 * Exemptions matter more than the rule: URLs (`://`), clock times (`9:30`) and
 * ratios (`2:1`) all contain a colon and none of them are an AI tell.
 */
export function aiPunctuationTells(text: string): OutboundFinding[] {
  const found: OutboundFinding[] = [];
  const push = (matched: string, idx: number) => {
    found.push({
      category: "ai_punctuation",
      matched,
      excerpt: text.slice(Math.max(0, idx - 30), Math.min(text.length, idx + 30)).trim(),
    });
  };

  let match: RegExpExecArray | null;

  const dashRe = /[—–]/g;
  let dashes = 0;
  while ((match = dashRe.exec(text)) !== null && dashes < 5) {
    push("— (em-dash)", match.index);
    dashes += 1;
  }

  // The ASCII stand-in for an em-dash. A markdown bullet ("- " at line start)
  // has no word char before it, so it isn't matched.
  const spacedDashRe = /\S \- \S|\S \-\S|\S\- \S/g;
  let spaced = 0;
  while ((match = spacedDashRe.exec(text)) !== null && spaced < 5) {
    if (/\d \- \d/.test(match[0])) continue; // numeric range, fine
    push("- (hyphen used as a dash)", match.index);
    spaced += 1;
  }

  const colonRe = /[A-Za-z]:(\s|$)/g;
  let colons = 0;
  while ((match = colonRe.exec(text)) !== null && colons < 5) {
    const at = match.index + 1;
    const next = text[at + 1] ?? "";
    if (next === "/" || /\d/.test(next)) continue; // URL, time, ratio
    push(": (colon used as a header/label)", match.index);
    colons += 1;
  }

  return found;
}

/**
 * Everything that blocks a public post, before the critic runs.
 *
 * ⭐ Two lists, and only two, because the bar is **catastrophic**:
 *
 * - `INTERNAL_TERMS` — "snapshotText" or "iron rule" in a public post is our
 *   plumbing on the founder's account.
 * - `AI_SELF_REFERENCES` — "as an AI" under their real name is the single
 *   worst thing this product could publish.
 *
 * ⚠️ `aiPunctuationTells` used to be here and is NOT any more. It is drift now.
 * See the note on `driftSignals`.
 */
export function deterministicBlockers(text: string): OutboundFinding[] {
  return [
    ...findMatches(text, INTERNAL_TERMS, "internal_term"),
    ...findMatches(text, AI_SELF_REFERENCES, "ai_reference"),
  ];
}

/**
 * Everything worth counting and nothing worth dropping a message over.
 *
 * ⭐ **Punctuation moved here from the blocking list**, 2026-08-05, on the
 * operator's call and in line with the standing rule: *non-catastrophic drift
 * is logged, never dropped.*
 *
 * It was blocking on an em-dash, a hyphen-as-dash, **or a colon** — so
 * *"Here's the thing: it works"* never posted. Between the three, most
 * well-written posts were held, and a held post is indistinguishable from a
 * quiet day. That is the same mistake this file already carries a scar for one
 * list down: the jargon terms *"lived in the blocking list in v1 and
 * blackholed a delivered plan. Annoying is not catastrophic."*
 *
 * The tells are still real and she still avoids them — in `SOUL.md`, where the
 * standing rule says outbound discipline belongs. **The prompt is primary; the
 * denylist is for what a prompt structurally cannot catch.** An em-dash is not
 * that.
 */
export function driftSignals(text: string): OutboundFinding[] {
  return [
    ...findMatches(text, JARGON_DRIFT_TERMS, "jargon_drift"),
    ...findMatches(text, SLOP_PHRASES, "slop_phrase"),
    ...aiPunctuationTells(text),
  ];
}

/**
 * Repair the punctuation tells rather than bouncing the message.
 *
 * The private-DM path. A clean message comes back unchanged.
 */
export function sanitizeOutboundText(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/(\S) \- (\S)/g, "$1, $2")
    .replace(/([A-Za-z]):(\s)/g, "$1.$2")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* The critic                                                                  */
/* -------------------------------------------------------------------------- */

const SAFETY_SYSTEM = `You review one social post that is about to be published under a real founder's own name and account. You are the last check before it is public and cannot be undone.

Return STRICT JSON, no prose:
{ "safe": boolean, "category": string, "why": string }

Block it (safe:false) for any of:
- offensive, demeaning, or inflammatory content
- a factual claim about the product that could be false
- naming or disparaging a competitor
- a legal or medical overclaim ("guaranteed", "cures", "risk-free")
- personal data about anyone
- anything that reads as engagement bait or platform-ToS risk

Do NOT block for: being boring, being short, informality, lowercase, typos, or
opinions. Those are voice, not safety, and the founder chose the voice.

If you cannot tell, return safe:false with category "unclear". A human can
approve a held post; nobody can un-publish a bad one.`;

/**
 * The safety pass. **Fails CLOSED.**
 *
 * A critic that could not run is not a pass. This runs on a post about to go
 * out under someone's real name — if we don't know, we hold, because a held
 * post costs a message and a bad post costs an account.
 */
export const critiqueSafety = internalAction({
  args: { text: v.string() },
  handler: async (
    _ctx,
    args
  ): Promise<{ safe: boolean; findings: OutboundFinding[] }> => {
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const completion = await callOpenRouter({
      apiKey,
      model: SAFETY_CRITIC_MODEL,
      temperature: 0,
      /**
       * Not 300. The critic is a reasoning model, and reasoning tokens are
       * billed and budgeted as completion — 300 would have been consumed
       * before it wrote a verdict, returning empty content with
       * `finish_reason: "stop"`.
       *
       * This gate FAILS CLOSED, so an empty completion means every post is
       * held. A too-small budget here doesn't degrade the critic, it stops
       * the product.
       */
      maxTokens: 3_000,
      messages: [
        { role: "system", content: SAFETY_SYSTEM },
        { role: "user", content: `POST:\n${args.text}` },
      ],
    });

    if (!completion.ok) {
      return {
        safe: false,
        findings: [
          {
            category: "safety_unverifiable",
            matched: completion.reason,
            excerpt: args.text.slice(0, 120),
          },
        ],
      };
    }

    let verdict: { safe?: unknown; category?: unknown; why?: unknown };
    try {
      const body = completion.content.trim();
      const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const raw = fenced ? fenced[1] : body;
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      verdict = JSON.parse(raw.slice(first, last + 1)) as typeof verdict;
    } catch {
      // Unparseable is unverifiable, and unverifiable holds.
      return {
        safe: false,
        findings: [
          {
            category: "safety_unverifiable",
            matched: "critic returned unparseable output",
            excerpt: completion.content.slice(0, 120),
          },
        ],
      };
    }

    if (verdict.safe === true) return { safe: true, findings: [] };

    return {
      safe: false,
      findings: [
        {
          category: "safety_violation",
          matched: typeof verdict.category === "string" ? verdict.category : "unclear",
          excerpt: typeof verdict.why === "string" ? verdict.why.slice(0, 200) : "",
        },
      ],
    };
  },
});

/**
 * The full public-post gate: deterministic blockers, then the critic.
 *
 * The critic is skipped when a deterministic blocker already fired — it costs
 * money and the answer cannot change.
 */
export const checkPublicPost = internalAction({
  args: { text: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; findings: OutboundFinding[]; drift: OutboundFinding[] }> => {
    const drift = driftSignals(args.text);
    const blockers = deterministicBlockers(args.text);
    if (blockers.length > 0) return { ok: false, findings: blockers, drift };

    const safety = (await ctx.runAction(internal.maya.outbound.critiqueSafety, {
      text: args.text,
    })) as { safe: boolean; findings: OutboundFinding[] };

    return { ok: safety.safe, findings: safety.findings, drift };
  },
});

// Imported late so the module's pure half stays importable without codegen.
import { internal } from "../_generated/api";
