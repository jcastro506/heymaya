/**
 * Sprint 2.14a — Comment-tree mining for high-signal evidence cards.
 *
 * After Sprint 2.13a's per-card LLM scoring identifies high-pain cards,
 * fetch the comment trees for the TOP N reddit cards (default 10) and
 * LLM-extract:
 *   - additional pain expressions found in the replies (often more
 *     load-bearing than the OP — "I tried Ollama but the UI is awful"
 *     in a comment is stronger buyer-signal than the OP question)
 *   - top buyer-quality commenters with their stated stance
 *   - one-paragraph summary of the conversation shape
 *
 * Why: live N=3 validation 2026-05-24 showed the current pipeline
 * only sees the OP text, missing ~50% of buyer signal that lives in
 * comments. A reddit thread "Best Mac GUI for ollama?" gets to top-3
 * for ModelHub. The 30 replies arguing "LM Studio sucks because…" /
 * "I switched to Open WebUI but…" are pure buyer-pain expressions
 * — invisible to us today.
 *
 * Scope: Reddit only in 2.14a. HN comments come in 2.14b (Algolia
 * has a separate item-tree endpoint; different shape).
 *
 * Cost: ~$0.07 per onboarding (10 ScrapeCreators comment calls +
 * 10 batched Flash Lite extraction calls).
 *
 * Per [[feedback-trust-llm-judgment-no-hardcoded-rules]] — the LLM
 * picks "which pains matter" and "which commenters are buyers"; we
 * don't apply heuristics like "highest-upvote comment wins."
 */

import { callOpenRouter } from "../agents/modelRouter/openRouterClient";
import { ScrapeCreatorsClient } from "../integrations/scrapeCreators/client";
import { redditPostComments } from "./scrapeCreatorsGtmResearch";

export const COMMENT_MINER_MODEL = "google/gemini-3.1-flash-lite";
export const DEFAULT_TOP_N = 10;
export const PAIN_THRESHOLD = 0.6;
export const MAX_COMMENTS_PER_CARD = 30;

export interface CardForMining {
  /** gtmEvidenceCards row id (string form) */
  id: string;
  url: string;
  title?: string;
  snippet: string;
  /** From Sprint 2.13a LLM scoring; mining gates on this */
  painMatch: number;
}

export interface CommentInsights {
  extractedPains: string[];
  topCommenters: Array<{
    author: string;
    stance: string;
    buyerQuality: number;
  }>;
  summary: string;
  commentCount: number;
}

export interface MiningResult {
  cardId: string;
  insights: CommentInsights | null;
  /** Reason mining was skipped or failed (informational) */
  skipReason?: string;
}

const MINER_PROMPT = `\
You are reading a Reddit thread (OP + up to 30 replies) to find \
buyer-pain signal that's stronger than what the OP alone shows.

For the given product and the thread, return JSON with these fields:

extractedPains — up to 5 distinct pain expressions found in REPLIES \
that the product would address. Each item is a SHORT verbatim quote \
or paraphrase (≤100 chars). Skip the OP — only mine the replies. \
If no replies express pain the product addresses, return [].

topCommenters — up to 3 commenters whose stance + recent context \
makes them high-quality buyer leads. Each item:
  - author: their username
  - stance: ONE short sentence on what they said (their pain, their \
    current setup, their decision)
  - buyerQuality: 0.0-1.0 (how strongly are they a buyer for THIS \
    product specifically — 1.0 = perfect target, 0.0 = not a buyer)

summary — ONE paragraph (≤300 chars) describing the conversation \
shape: what's the OP asking, what are commenters recommending or \
complaining about, is there consensus or controversy. Plain English \
no jargon.

DO NOT inflate scores. Most threads have 0-2 buyer leads. Don't \
list every commenter. Most replies are noise.

Return ONLY a JSON object (no prose, no markdown fence). If no \
useful signal at all, return:
{ "extractedPains": [], "topCommenters": [], "summary": "no useful \
signal", "commentCount": 0 }\
`;

interface RedditComment {
  author: string;
  body: string;
  score: number;
}

function parseMinerResponse(raw: string): unknown {
  let s = raw.trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) s = fenceMatch[1]!.trim();
  const objStart = s.indexOf("{");
  if (objStart > 0) s = s.slice(objStart);
  const objEnd = s.lastIndexOf("}");
  if (objEnd >= 0 && objEnd < s.length - 1) s = s.slice(0, objEnd + 1);
  return JSON.parse(s);
}

function normalizeInsights(
  raw: unknown,
  commentCount: number
): CommentInsights | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const pains = Array.isArray(r.extractedPains)
    ? r.extractedPains
        .filter((p): p is string => typeof p === "string")
        .slice(0, 5)
        .map((p) => p.slice(0, 200))
    : [];
  const commentersRaw = Array.isArray(r.topCommenters) ? r.topCommenters : [];
  const topCommenters: CommentInsights["topCommenters"] = [];
  for (const c of commentersRaw.slice(0, 3)) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    if (typeof obj.author !== "string") continue;
    topCommenters.push({
      author: obj.author.slice(0, 80),
      stance: typeof obj.stance === "string" ? obj.stance.slice(0, 200) : "",
      buyerQuality:
        typeof obj.buyerQuality === "number"
          ? Math.max(0, Math.min(1, obj.buyerQuality))
          : 0,
    });
  }
  return {
    extractedPains: pains,
    topCommenters,
    summary:
      typeof r.summary === "string"
        ? r.summary.slice(0, 400)
        : "no summary returned",
    commentCount,
  };
}

/**
 * Fetch comments for one card + LLM-extract insights. Returns null
 * insights when the card has no fetchable comments OR the LLM call
 * fails. Caller-side: skipReason carries diagnostic info.
 */
export async function mineCommentsForCard(
  card: CardForMining,
  product: {
    productName: string;
    productUrl: string;
    icpPainPhrases: ReadonlyArray<string>;
    productCategoryKeywords: ReadonlyArray<string>;
  },
  opts: {
    scrapeClient: ScrapeCreatorsClient;
    apiKey?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<MiningResult> {
  // 1. Fetch comments via ScrapeCreators
  const wrapperResult = await redditPostComments(opts.scrapeClient, card.url, {
    limit: MAX_COMMENTS_PER_CARD,
  });
  if (wrapperResult.statusDetail !== "ok" || wrapperResult.items.length === 0) {
    return {
      cardId: card.id,
      insights: null,
      skipReason: `no comments (${wrapperResult.statusDetail})`,
    };
  }

  const comments: RedditComment[] = wrapperResult.items
    .filter((it) => it.excerpt && it.author)
    .map((it) => ({
      author: it.author!,
      body: it.excerpt!.slice(0, 800),
      score: it.engagement.likes ?? it.engagement.upvotes ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMMENTS_PER_CARD);

  if (comments.length === 0) {
    return {
      cardId: card.id,
      insights: null,
      skipReason: "no usable comments after filter",
    };
  }

  // 2. LLM extraction
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      cardId: card.id,
      insights: null,
      skipReason: "OPENROUTER_API_KEY not set",
    };
  }

  const productBlock = [
    `Product: ${product.productName}`,
    `URL: ${product.productUrl}`,
    product.productCategoryKeywords.length
      ? `Category: ${product.productCategoryKeywords.slice(0, 6).join(", ")}`
      : "",
    product.icpPainPhrases.length
      ? `Buyer pain phrases:\n${product.icpPainPhrases.slice(0, 4).map((p) => `  - "${p}"`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const threadBlock = `\
OP title: ${card.title ?? "(no title)"}
OP snippet: ${card.snippet.slice(0, 400)}
OP url: ${card.url}

Replies (${comments.length}, sorted by score):
${comments
  .map(
    (c, i) =>
      `${i + 1}. @${c.author} [${c.score}↑]: ${c.body.slice(0, 500)}`
  )
  .join("\n\n")}`;

  let completion;
  try {
    completion = await callOpenRouter({
      model: COMMENT_MINER_MODEL,
      messages: [
        { role: "system", content: MINER_PROMPT },
        { role: "user", content: `${productBlock}\n\n${threadBlock}` },
      ],
      thinkingBudget: "none",
      maxOutputTokens: 1200,
      apiKey,
      fetchImpl: opts.fetchImpl,
    });
  } catch (err) {
    return {
      cardId: card.id,
      insights: null,
      skipReason: `LLM call failed: ${(err as Error).message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = parseMinerResponse(completion.content);
  } catch (err) {
    return {
      cardId: card.id,
      insights: null,
      skipReason: `LLM parse failed: ${(err as Error).message}`,
    };
  }

  const insights = normalizeInsights(parsed, comments.length);
  if (!insights) {
    return {
      cardId: card.id,
      insights: null,
      skipReason: "LLM response not normalizable",
    };
  }
  return { cardId: card.id, insights };
}

/**
 * Pick the top N reddit cards by painMatch (above PAIN_THRESHOLD)
 * and mine each in bounded-concurrency parallel. Cards below the
 * threshold are skipped — they're not high-signal enough to spend
 * an API call mining.
 */
export async function mineTopRedditCards(
  cards: ReadonlyArray<CardForMining & { source: string }>,
  product: {
    productName: string;
    productUrl: string;
    icpPainPhrases: ReadonlyArray<string>;
    productCategoryKeywords: ReadonlyArray<string>;
  },
  opts: {
    scrapeClient: ScrapeCreatorsClient;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    topN?: number;
    concurrency?: number;
  }
): Promise<{
  results: MiningResult[];
  attempted: number;
  succeeded: number;
}> {
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const concurrency = opts.concurrency ?? 3;

  const eligible = cards
    .filter((c) => c.source === "reddit" && c.painMatch >= PAIN_THRESHOLD)
    .sort((a, b) => b.painMatch - a.painMatch)
    .slice(0, topN);

  const results: MiningResult[] = [];
  for (let i = 0; i < eligible.length; i += concurrency) {
    const slice = eligible.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      slice.map((card) =>
        mineCommentsForCard(card, product, {
          scrapeClient: opts.scrapeClient,
          apiKey: opts.apiKey,
          fetchImpl: opts.fetchImpl,
        }).catch((err) => ({
          cardId: card.id,
          insights: null,
          skipReason: `unexpected: ${(err as Error).message}`,
        }))
      )
    );
    results.push(...batchResults);
  }

  const succeeded = results.filter((r) => r.insights !== null).length;
  return { results, attempted: eligible.length, succeeded };
}
