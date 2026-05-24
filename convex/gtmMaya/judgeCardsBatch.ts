/**
 * Sprint 2.13a — LLM per-card scoring (batched).
 *
 * Replaces the engagement-rank heuristic in platformWorkers.ts:
 *   const painMatch = Math.min(1.0, totalSignal / 100);
 *
 * Why: that formula ranks by upvotes/likes, not by whether the text
 * expresses the product's actual pain. Live N=3 validation on
 * 2026-05-24 showed Bezel's #1 Reddit pick was "From 2019 Dell to
 * MacBook Pro M5" (803↑) — high engagement, zero pain match for an
 * iPhone-mirror app. ModelHub happened to look right only because
 * the dev-tools shape lined up with what engagement-based scoring
 * promotes.
 *
 * What this does:
 *   1. Take a batch of evidence cards + the product context
 *   2. Single Gemini Flash Lite call returns JSON array of scores
 *   3. Each card gets painMatch / buyerMatch / channelFit (0-1)
 *      plus a one-sentence reason
 *   4. Caller (researchWorker) patches the gtmEvidenceCards rows
 *
 * Cost: ~$0.001 per batch of 25 cards. 400 cards → 16 calls → $0.02
 * per onboarding. Cheap.
 *
 * Per [[feedback-trust-llm-judgment-no-hardcoded-rules]] — no
 * weighted formulas, no thresholds, no hardcoded category-to-channel
 * lookup. The LLM reads the product + the text and judges.
 */

import { callOpenRouter } from "../agents/modelRouter/openRouterClient";

export const CARD_SCORER_MODEL = "google/gemini-3-flash-lite";
export const BATCH_SIZE = 25;

export interface CardForScoring {
  id: string;
  source: string;
  title?: string;
  snippet: string;
  author?: string;
  engagement?: {
    likes?: number;
    comments?: number;
    upvotes?: number;
    views?: number;
  };
}

export interface ProductContextForScoring {
  productName: string;
  productUrl: string;
  founderWhy?: string;
  /** From app.keywordExpansion.icpPainPhrases */
  icpPainPhrases: ReadonlyArray<string>;
  /** From app.keywordExpansion.productCategoryKeywords */
  productCategoryKeywords: ReadonlyArray<string>;
  /** Free-form product description / category to ground judgment */
  category?: string;
}

export interface CardScore {
  id: string;
  painMatch: number;
  buyerMatch: number;
  channelFit: number;
  reason: string;
}

const SCORER_PROMPT_INSTRUCTIONS = `\
You are scoring scraped social media posts to decide which ones are real \
buyer-signal for a specific product. Score each post 0.0-1.0 on three \
dimensions, then write one sentence of reasoning.

painMatch — does the TEXT itself express the pain this product solves?
  1.0 = explicitly describes the exact pain in their own words
  0.7 = describes an adjacent pain that the product also addresses
  0.4 = mentions the product category or competitor but not pain
  0.1 = post is in the right topic but the author has no pain
  0.0 = irrelevant / off-topic

buyerMatch — is this person plausibly the kind of person who would BUY \
this product?
  1.0 = the author IS the textbook buyer
  0.7 = adjacent persona, plausibly converts
  0.4 = wrong segment but right industry
  0.0 = not a buyer (e.g. a different demographic, a journalist, a bot)

channelFit — would replying to / engaging with this thread lead to a \
real conversation (or a polite ignore)?
  1.0 = active recent thread with high engagement and clear question
  0.7 = good thread but older or low engagement
  0.4 = thread exists but reply would feel out of place
  0.0 = locked, dead, or off-topic to reply

DO NOT reward posts just because they have lots of upvotes/likes. \
Engagement is upstream of these scores — judge the TEXT.

DO NOT inflate scores to seem helpful. Most scraped posts are noise. \
If a post is off-topic, score it 0.0 across the board. Real signal is \
rare; scoring everything 0.6 hides the real signal under noise.

Return ONLY a JSON array. No prose before or after. Each element:
{ "id": "...", "painMatch": 0.0, "buyerMatch": 0.0, "channelFit": 0.0, "reason": "..." }

The reason must be ONE sentence in plain English (no jargon, no \
internal terms like "ICP" or "buyer fit"). It should make sense to \
the product's founder reading it cold.\
`;

function buildScorerMessages(
  cards: ReadonlyArray<CardForScoring>,
  product: ProductContextForScoring
): Array<{ role: string; content: string }> {
  const productBlock = [
    `Product: ${product.productName}`,
    `URL: ${product.productUrl}`,
    product.founderWhy ? `Founder's why: ${product.founderWhy}` : "",
    product.category ? `Category: ${product.category}` : "",
    product.productCategoryKeywords.length
      ? `What it does (category keywords): ${product.productCategoryKeywords.join(", ")}`
      : "",
    product.icpPainPhrases.length
      ? `How buyers describe their pain (verbatim phrases):\n${product.icpPainPhrases.map((p) => `  - "${p}"`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const cardsBlock = cards
    .map((c, i) => {
      const eng = c.engagement ?? {};
      const engBits = [
        eng.upvotes != null ? `${eng.upvotes}↑` : null,
        eng.likes != null && eng.upvotes == null ? `${eng.likes}↑` : null,
        eng.comments != null ? `${eng.comments}💬` : null,
        eng.views != null ? `${eng.views} views` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const headline = c.title ? c.title : "(no title)";
      const author = c.author ? `by @${c.author}` : "";
      // Cap snippet at 400 chars — long posts blow the prompt budget
      // and tail content rarely changes pain judgment.
      const snippet = c.snippet.slice(0, 400);
      return `\
${i + 1}. id=${c.id} source=${c.source} ${engBits}
   title: ${headline}
   ${author}
   text: ${snippet}`;
    })
    .join("\n\n");

  return [
    {
      role: "system",
      content: SCORER_PROMPT_INSTRUCTIONS,
    },
    {
      role: "user",
      content: `${productBlock}\n\n# Posts to score (${cards.length})\n\n${cardsBlock}`,
    },
  ];
}

/**
 * Extract the JSON array from the model's response. The model is
 * instructed to return ONLY a JSON array, but Gemini occasionally
 * wraps it in a markdown code fence or adds a leading sentence.
 * Strip both.
 */
function parseScorerResponse(raw: string): unknown {
  let s = raw.trim();
  // Strip ```json ... ``` fences if present
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1]!.trim();
  // Strip any leading prose before the first '['
  const arrayStart = s.indexOf("[");
  if (arrayStart > 0) s = s.slice(arrayStart);
  // Strip any trailing prose after the last ']'
  const arrayEnd = s.lastIndexOf("]");
  if (arrayEnd >= 0 && arrayEnd < s.length - 1) s = s.slice(0, arrayEnd + 1);
  return JSON.parse(s);
}

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Normalize one row from the LLM response. Bad rows return null
 * (caller drops them — undefined behavior would mean the card keeps
 * its existing 0.5 placeholder score, which is safer than crashing).
 */
function normalizeRow(row: unknown): CardScore | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    painMatch: clamp01(r.painMatch),
    buyerMatch: clamp01(r.buyerMatch),
    channelFit: clamp01(r.channelFit),
    reason: typeof r.reason === "string" ? r.reason.slice(0, 240) : "",
  };
}

export interface ScoreBatchResult {
  scores: CardScore[];
  /** IDs that were in input but missing from output (LLM dropped them) */
  missingIds: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Score a single batch of cards. Throws on auth failure or empty
 * model response; returns partial results when the LLM returns a
 * malformed-but-parseable array.
 */
export async function scoreCardsBatch(
  cards: ReadonlyArray<CardForScoring>,
  product: ProductContextForScoring,
  opts?: { apiKey?: string; fetchImpl?: typeof fetch }
): Promise<ScoreBatchResult> {
  if (cards.length === 0) {
    return { scores: [], missingIds: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const apiKey = opts?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "judgeCardsBatch: OPENROUTER_API_KEY not set — cannot score cards"
    );
  }

  const messages = buildScorerMessages(cards, product);
  const completion = await callOpenRouter({
    model: CARD_SCORER_MODEL,
    messages,
    thinkingBudget: "none", // pure judgment task, no reasoning chain needed
    maxOutputTokens: 4000,
    apiKey,
    fetchImpl: opts?.fetchImpl,
  });

  let parsed: unknown;
  try {
    parsed = parseScorerResponse(completion.content);
  } catch (err) {
    throw new Error(
      `judgeCardsBatch: failed to parse LLM response — ${(err as Error).message}; raw start: ${completion.content.slice(0, 120)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `judgeCardsBatch: LLM returned non-array (${typeof parsed}); raw start: ${completion.content.slice(0, 120)}`
    );
  }

  const scores: CardScore[] = [];
  const seenIds = new Set<string>();
  for (const row of parsed) {
    const norm = normalizeRow(row);
    if (norm && !seenIds.has(norm.id)) {
      scores.push(norm);
      seenIds.add(norm.id);
    }
  }

  const inputIds = new Set(cards.map((c) => c.id));
  const missingIds: string[] = [];
  for (const id of inputIds) {
    if (!seenIds.has(id)) missingIds.push(id);
  }

  return {
    scores,
    missingIds,
    usage: {
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
    },
  };
}

/**
 * Score a large set of cards by splitting into BATCH_SIZE-sized
 * batches and calling the LLM in parallel. Bounded concurrency keeps
 * us under OpenRouter's per-account rate limit (3 RPS by default).
 */
export async function scoreAllCardsForProduct(
  cards: ReadonlyArray<CardForScoring>,
  product: ProductContextForScoring,
  opts?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    /** Max parallel LLM calls. Default 3. */
    concurrency?: number;
    /** Override default batch size (for tests). */
    batchSize?: number;
  }
): Promise<{
  scores: CardScore[];
  missingIds: string[];
  totalUsage: { inputTokens: number; outputTokens: number };
  batchCount: number;
}> {
  const size = opts?.batchSize ?? BATCH_SIZE;
  const concurrency = opts?.concurrency ?? 3;

  const batches: CardForScoring[][] = [];
  for (let i = 0; i < cards.length; i += size) {
    batches.push(cards.slice(i, i + size));
  }

  const allScores: CardScore[] = [];
  const allMissingIds: string[] = [];
  let totalIn = 0;
  let totalOut = 0;

  // Bounded-concurrency runner — process batches in chunks of `concurrency`
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map((batch) =>
        scoreCardsBatch(batch, product, {
          apiKey: opts?.apiKey,
          fetchImpl: opts?.fetchImpl,
        }).catch((err) => {
          // One batch failure shouldn't kill the whole scoring pass.
          // Log + return empty for this batch; the unscored cards
          // keep their insert-time placeholder.
          console.warn(
            `[judgeCardsBatch] batch failed: ${(err as Error).message}`
          );
          return {
            scores: [] as CardScore[],
            missingIds: batch.map((c) => c.id),
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        })
      )
    );
    for (const r of results) {
      allScores.push(...r.scores);
      allMissingIds.push(...r.missingIds);
      totalIn += r.usage.inputTokens;
      totalOut += r.usage.outputTokens;
    }
  }

  return {
    scores: allScores,
    missingIds: allMissingIds,
    totalUsage: { inputTokens: totalIn, outputTokens: totalOut },
    batchCount: batches.length,
  };
}
