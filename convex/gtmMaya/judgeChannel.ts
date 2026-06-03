/**
 * Sprint 2.13b — LLM channel-judge.
 *
 * Replaces the entire weighted-formula stack in channelScoring.ts
 * (scoreEvidenceCard / evaluateChannel / decideChannel / confidenceFor
 * / qualityFailures / channelRisks / firstWeekTestFor). One LLM call
 * per channel takes the LLM-scored cards from Sprint 2.13a plus the
 * product context and emits a structured channel decision.
 *
 * Why: live N=3 on 2026-05-24 exposed brittle thresholds —
 *   - Beehiiv: LinkedIn parked at 0.00 even though newsletter
 *     operators clearly live on LinkedIn
 *   - Bezel: X parked at 0.00 because no X evidence cards came back
 *     (TwitterAPI.io returned nothing for indie product names)
 *   - All 3 products: TikTok scored 0.80+ but always parked at low
 *     confidence (the score-vs-confidence gap was unexplained)
 *
 * The weighted formula can't model "this channel is right even when
 * the evidence is thin" — only an LLM that knows the product can.
 *
 * Per [[feedback-trust-llm-judgment-no-hardcoded-rules]] — the LLM
 * picks decision + confidence + reasoning + first-week test from
 * raw context, not threshold rules.
 */

import { callOpenRouter } from "../agents/modelRouter/openRouterClient";
import type {
  GtmChannel,
  GtmChannelDecision,
  GtmConfidence,
  GtmEvidenceCard,
} from "./channelScoring";

export const CHANNEL_JUDGE_MODEL = "google/gemini-3-flash-preview";

export interface JudgeChannelProductContext {
  productName: string;
  productUrl: string;
  founderWhy?: string;
  /** From app.keywordExpansion.icpPainPhrases */
  icpPainPhrases: ReadonlyArray<string>;
  /** From app.keywordExpansion.productCategoryKeywords */
  productCategoryKeywords: ReadonlyArray<string>;
  /** App stage — informs primary/secondary aggressiveness */
  stage: "idea" | "live-beta" | "paid" | "unknown";
  /** Operator's stated week goal */
  weekGoal: "feedback" | "signups" | "demos" | "revenue" | "unknown";
}

export interface JudgeChannelDecisionRow {
  channel: GtmChannel;
  score: number;
  decision: GtmChannelDecision;
  confidence: GtmConfidence;
  reasons: string[];
  risks: string[];
  /** Card IDs the LLM picked as the strongest evidence */
  evidenceCardIds: string[];
  /** LLM-designed concrete first-week test for this channel */
  firstWeekTest: string;
  qualityGate: {
    passed: boolean;
    failures: string[];
  };
  /** Sprint 2.15.4 — USD cost of this channel's LLM call. */
  costUsd?: number;
}

const CHANNEL_DESCRIPTIONS: Record<GtmChannel, string> = {
  reddit:
    "Reddit — subreddit-based, anonymous, comment-driven. Best when buyer asks 'what should I use for X' or vents about a tool. Strict anti-promo norms; reply value > self-promo.",
  x:
    "X (Twitter) — public timeline + replies, founder-led, fast. Best for indie hackers, dev tools, B2B SaaS founders building in public. Hashtags weak, communities exist but small.",
  hn:
    "Hacker News — research-only (buyer-pain signal via Algolia read + rare manual Show HN); NOT a posting/BET channel. Kept for backward compat only.",
  linkedin:
    "LinkedIn — professional B2B identity, long-form posts, employer-of-record audiences. Best for sales/marketing/enterprise tools, service businesses, B2B SaaS targeting corporate buyers.",
  tiktok:
    "TikTok — short-form video, format-driven, algorithm reach. Best for consumer products, visual demos, B2C, products with a clear 30-sec hook. Requires consistent posting cadence.",
  youtube:
    "YouTube — Shorts (short-form, hook-in-first-second, like TikTok) + long-form (founder-led, search-intent, compounds over time) + comment/transcript mining. Best for products with a real demo or teachable depth. Brief-only (no UGC creation); title=CTR is the lever.",
  product_hunt:
    "Product Hunt — single-day launch event + ongoing maker community. Best for one-time launch boost, not steady-state acquisition.",
};

const JUDGE_PROMPT = `\
You are a senior GTM strategist deciding whether a product should make \
a specific channel its PRIMARY, SECONDARY, or PARKED channel for the \
next 90 days.

You judge from evidence: real scraped posts from that channel, each \
already scored by a separate scorer for painMatch / buyerMatch / \
channelFit. You also know the product, its ICP, and the operator's \
stage and weekly goal.

YOUR JOB
For this channel, decide:
  - score (0.0-1.0): how confident are you this channel will produce \
    real buyer signal in 90 days?
  - decision: "primary" | "secondary" | "parked"
      primary    — the operator should spend ≥40% of GTM effort here
      secondary  — supplemental, 10-30% of effort, supports primary
      parked     — not worth pursuing now; revisit if primary stalls
  - confidence: "low" | "medium" | "high"
      Reflects how sure you are of the decision. Use "low" when the \
      evidence is thin OR conflicting OR off-audience.
  - reasons: 2-4 short bullets in plain English explaining the call. \
    No jargon. Lead with the strongest evidence.
  - risks: 1-3 short bullets of what could go wrong on this channel.
  - evidenceCardIds: up to 5 IDs of the cards that most strongly back \
    the decision. Pick by buyer-fit + pain-match, not engagement.
  - firstWeekTest: ONE specific low-stakes action the operator could \
    take in week 1 to validate this channel. Concrete (a specific \
    subreddit name, a specific post type, a specific account to engage \
    with). Skip generic advice.
  - qualityGate: { passed: boolean, failures: string[] }
      passed=false when the evidence is too thin OR off-audience to \
    trust the decision. Failures explain why.

RULES OF THUMB (use judgment, these are not strict thresholds):
- A channel can still be primary/secondary even with weak evidence IF \
  the channel is obviously right for the ICP. Example: a newsletter \
  platform almost certainly belongs on LinkedIn even if the scraper \
  pulled mostly noise.
- A channel with strong engagement but off-buyer evidence is parked. \
  Example: TikTok with 200 cards but they're all wrong-niche creators \
  using your category as a tangent.
- A channel where the buyer clearly doesn't live is parked regardless \
  of score. Example: an indie Mac utility doesn't belong on LinkedIn.
- If qualityGate.passed=false, the decision must be conservative \
  (parked unless the LLM has strong external prior).

OUTPUT
Return ONLY a JSON object (no prose before or after, no markdown \
fence). Schema:
{
  "score": 0.0,
  "decision": "primary" | "secondary" | "parked",
  "confidence": "low" | "medium" | "high",
  "reasons": ["...", "..."],
  "risks": ["..."],
  "evidenceCardIds": ["...", "..."],
  "firstWeekTest": "...",
  "qualityGate": { "passed": true, "failures": [] }
}\
`;

function buildJudgeMessages(
  channel: GtmChannel,
  cards: ReadonlyArray<GtmEvidenceCard>,
  product: JudgeChannelProductContext
): Array<{ role: string; content: string }> {
  // Show the LLM the top-30 cards by buyer-fit + pain-match. The
  // Sprint 2.13a scorer already prefers buyer-fit over engagement,
  // so this surfaces the cards most likely to back the decision.
  const ranked = [...cards].sort(
    (a, b) =>
      b.buyerMatch + b.painMatch + b.channelFit -
      (a.buyerMatch + a.painMatch + a.channelFit)
  );
  const top = ranked.slice(0, 30);

  const productBlock = [
    `Product: ${product.productName}`,
    `URL: ${product.productUrl}`,
    product.founderWhy ? `Founder why: ${product.founderWhy}` : "",
    `Stage: ${product.stage}`,
    `Week goal: ${product.weekGoal}`,
    product.productCategoryKeywords.length
      ? `Category keywords: ${product.productCategoryKeywords.join(", ")}`
      : "",
    product.icpPainPhrases.length
      ? `Verbatim buyer pain phrases:\n${product.icpPainPhrases.map((p) => `  - "${p}"`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const cardsBlock = top.length
    ? top
        .map((c, i) => {
          const eng = c.engagement ?? {};
          const engBits = [
            eng.likes != null ? `${eng.likes}↑` : null,
            eng.comments != null ? `${eng.comments}💬` : null,
            eng.views != null ? `${eng.views}v` : null,
          ]
            .filter(Boolean)
            .join(" ");
          // Sprint 2.14a — if comment-tree mining ran for this card,
          // surface the extracted reply-pains + summary to the judge.
          // ~50% of buyer signal lives in replies; OP-only would
          // miss it.
          const ci = c.commentInsights;
          const insightsBlock = ci
            ? `\n   replies (${ci.commentCount}): ${ci.summary}${ci.extractedPains.length ? "\n   reply-pains:\n     - " + ci.extractedPains.slice(0, 4).map((p) => p.slice(0, 140)).join("\n     - ") : ""}`
            : "";
          return `${i + 1}. id=${c.id} pain=${c.painMatch.toFixed(2)} buyer=${c.buyerMatch.toFixed(2)} fit=${c.channelFit.toFixed(2)} ${engBits}
   title: ${c.title ?? "(no title)"}
   snippet: ${c.snippet.slice(0, 220)}${insightsBlock}`;
        })
        .join("\n\n")
    : "(no evidence cards from this channel)";

  return [
    {
      role: "system",
      content: JUDGE_PROMPT,
    },
    {
      role: "user",
      content: `\
CHANNEL UNDER JUDGMENT: ${channel}
${CHANNEL_DESCRIPTIONS[channel]}

# Product
${productBlock}

# Evidence from ${channel} (top 30 by combined buyer/pain/fit, of ${cards.length} total)
${cardsBlock}`,
    },
  ];
}

function parseJudgeResponse(raw: string): unknown {
  let s = raw.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1]!.trim();
  const objStart = s.indexOf("{");
  if (objStart > 0) s = s.slice(objStart);
  const objEnd = s.lastIndexOf("}");
  if (objEnd >= 0 && objEnd < s.length - 1) s = s.slice(0, objEnd + 1);
  return JSON.parse(s);
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function asStringArray(x: unknown, cap = 5): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((s): s is string => typeof s === "string").slice(0, cap);
}

function asDecision(x: unknown): GtmChannelDecision {
  if (x === "primary" || x === "secondary" || x === "parked") return x;
  return "parked";
}

function asConfidence(x: unknown): GtmConfidence {
  if (x === "low" || x === "medium" || x === "high") return x;
  return "low";
}

/**
 * Judge a single channel. Throws on API auth / network / parse
 * failure (caller decides whether to fall back).
 */
export async function judgeChannel(
  channel: GtmChannel,
  cards: ReadonlyArray<GtmEvidenceCard>,
  product: JudgeChannelProductContext,
  opts?: { apiKey?: string; fetchImpl?: typeof fetch }
): Promise<JudgeChannelDecisionRow> {
  const apiKey = opts?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "judgeChannel: OPENROUTER_API_KEY not set — cannot judge channels"
    );
  }

  const messages = buildJudgeMessages(channel, cards, product);
  const completion = await callOpenRouter({
    model: CHANNEL_JUDGE_MODEL,
    messages,
    thinkingBudget: "medium",
    maxOutputTokens: 2000,
    apiKey,
    fetchImpl: opts?.fetchImpl,
  });

  let parsed: Record<string, unknown>;
  try {
    const p = parseJudgeResponse(completion.content);
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      throw new Error(`not an object (got ${typeof p})`);
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `judgeChannel(${channel}): failed to parse LLM response — ${(err as Error).message}; raw start: ${completion.content.slice(0, 120)}`
    );
  }

  const qg = (parsed.qualityGate ?? {}) as Record<string, unknown>;
  return {
    channel,
    score: clamp01(parsed.score),
    decision: asDecision(parsed.decision),
    confidence: asConfidence(parsed.confidence),
    reasons: asStringArray(parsed.reasons, 6),
    risks: asStringArray(parsed.risks, 4),
    evidenceCardIds: asStringArray(parsed.evidenceCardIds, 5),
    firstWeekTest:
      typeof parsed.firstWeekTest === "string"
        ? parsed.firstWeekTest.slice(0, 400)
        : "",
    qualityGate: {
      passed: qg.passed === true,
      failures: asStringArray(qg.failures, 4),
    },
    costUsd: completion.usage.costUsd ?? 0,
  };
}

/**
 * Judge all configured channels in parallel. Per-channel failures
 * are isolated — one channel's parse error doesn't kill the rest;
 * the failing channel is omitted from the returned array (caller
 * sees fewer scores than expected and can decide how to handle).
 */
export async function judgeAllChannels(
  cards: ReadonlyArray<GtmEvidenceCard>,
  product: JudgeChannelProductContext,
  opts?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    channels?: ReadonlyArray<GtmChannel>;
  }
): Promise<{
  decisions: JudgeChannelDecisionRow[];
  failedChannels: GtmChannel[];
  costUsd: number;
}> {
  const CHANNEL_SOURCE: Record<GtmChannel, GtmEvidenceCard["source"]> = {
    reddit: "reddit",
    x: "x",
    hn: "hn",
    linkedin: "linkedin",
    tiktok: "tiktok",
    youtube: "youtube",
    product_hunt: "competitor",
  };
  // The live set of channels that get scored → persisted into
  // gtmChannelScores → surfaced in the onboarding picker. The scored
  // BET set is the Zernio-postable channels: Reddit / X / LinkedIn /
  // TikTok / YouTube. TikTok and YouTube are Brief-only channels (Maya
  // hands over scripts + filming notes; no UGC creation). HN is
  // RESEARCH-ONLY (Algolia buyer-pain read + rare manual "Show HN") and
  // is deliberately EXCLUDED from BET scoring — it is not a posting
  // channel. It remains in the GtmChannel type / schema union only for
  // backward compat with historical rows. product_hunt is likewise
  // excluded (single-day launch event, not steady-state acquisition);
  // it too stays in the type/union for backward compat but is not
  // scored or surfaced here.
  const channels: ReadonlyArray<GtmChannel> = opts?.channels ?? [
    "reddit",
    "x",
    "linkedin",
    "tiktok",
    "youtube",
  ];

  const results = await Promise.all(
    channels.map(async (channel) => {
      const channelCards = cards.filter(
        (c) =>
          c.source === CHANNEL_SOURCE[channel] ||
          (channel === "product_hunt" && c.recommendedUse === "competitor")
      );
      try {
        const row = await judgeChannel(channel, channelCards, product, {
          apiKey: opts?.apiKey,
          fetchImpl: opts?.fetchImpl,
        });
        return { ok: true as const, channel, row };
      } catch (err) {
        console.warn(
          `[judgeChannel] ${channel} failed: ${(err as Error).message}`
        );
        return { ok: false as const, channel };
      }
    })
  );

  const decisions: JudgeChannelDecisionRow[] = [];
  const failedChannels: GtmChannel[] = [];
  let costUsd = 0;
  for (const r of results) {
    if (r.ok) {
      decisions.push(r.row);
      costUsd += r.row.costUsd ?? 0;
    } else {
      failedChannels.push(r.channel);
    }
  }
  return { decisions, failedChannels, costUsd };
}
