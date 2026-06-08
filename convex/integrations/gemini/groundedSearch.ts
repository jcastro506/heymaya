/**
 * Sprint 2.0 — Gemini grounded web search.
 *
 * Replaces the broken ScrapeCreators Google worker (which has been
 * returning 0 cards every test). Uses Gemini's native Google Search
 * grounding tool to do live web search + cited responses.
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=<GEMINI_API_KEY>
 *   { tools: [{ google_search: {} }], contents: [...] }
 *
 * Pricing (as of 2026): ~$35/1k grounded queries on top of Gemini's
 * normal per-token rates. At our scale (~5 queries per Google research
 * run) that's ~$0.18 per research job for Google coverage — significantly
 * cheaper than us trying to scrape Google ourselves.
 *
 * Returns the same ResearchRawItem[] shape as other platform wrappers.
 *
 * Auth: `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY` fallback).
 * Missing key returns ok-shape with empty items + statusDetail
 * "gemini_key_missing" so the orchestrator gracefully degrades.
 */

import type { ResearchRawItem, WrapperResult } from "../../gtmMaya/scrapeCreatorsGtmResearch";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 45_000;

interface GroundedChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface GroundingSupport {
  segment?: {
    startIndex?: number;
    endIndex?: number;
    text?: string;
  };
  groundingChunkIndices?: number[];
}

interface GroundingMetadata {
  groundingChunks?: GroundedChunk[];
  groundingSupports?: GroundingSupport[];
  webSearchQueries?: string[];
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
  };
  groundingMetadata?: GroundingMetadata;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

function hashQuery(query: string): string {
  let acc = 0;
  for (let i = 0; i < query.length; i++) acc = (acc * 31 + query.charCodeAt(i)) | 0;
  return (acc >>> 0).toString(16).padStart(8, "0");
}

/**
 * Resolve domain root from a URL for the author field. Falls back to
 * empty string on parse error.
 */
function domainOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Map Gemini's grounding metadata into ResearchRawItem cards. One card
 * per cited web source. The model's generated text becomes excerpts on
 * each card (split via groundingSupports.segment ranges when present;
 * falls back to the chunk title + truncated combined text otherwise).
 */
function extractCards(
  response: GeminiResponse,
  query: string,
  rawRef: string
): ResearchRawItem[] {
  const candidate = response.candidates?.[0];
  if (!candidate) return [];

  const chunks = candidate.groundingMetadata?.groundingChunks ?? [];
  const supports = candidate.groundingMetadata?.groundingSupports ?? [];
  const fullText = (candidate.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();

  const supportByChunk = new Map<number, string[]>();
  for (const support of supports) {
    const segText = support.segment?.text?.trim();
    if (!segText) continue;
    for (const idx of support.groundingChunkIndices ?? []) {
      const list = supportByChunk.get(idx) ?? [];
      list.push(segText);
      supportByChunk.set(idx, list);
    }
  }

  const cards: ResearchRawItem[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const url = chunk.web?.uri;
    const title = chunk.web?.title ?? domainOf(url);
    if (!url) continue;
    const supportSegments = supportByChunk.get(i) ?? [];
    const excerpt =
      supportSegments.length > 0
        ? supportSegments.join(" … ").slice(0, 2000)
        : fullText.slice(0, 800) || null;
    cards.push({
      platform: "google",
      externalId: url,  // URL itself as externalId — Gemini doesn't surface a separate ID
      url,
      title: title ?? null,
      excerpt,
      author: domainOf(url),
      createdAtMs: null,  // Gemini grounding doesn't carry per-source timestamps
      engagement: {
        likes: null,
        comments: null,
        shares: null,
        views: null,
        upvotes: null,
        downvotes: null,
      },
      tags: ["google:grounded", `query:${query.slice(0, 40)}`],
      rawRef,
    });
  }
  return cards;
}

export interface GeminiGroundedSearchOptions {
  /** Override the default Gemini model. Must support google_search tool. */
  model?: string;
  /** Max output tokens for the generated response. Default 1024. */
  maxOutputTokens?: number;
}

/**
 * Run a single grounded search query through Gemini. Returns one
 * ResearchRawItem per cited source. Soft-fails on missing API key,
 * network error, or empty grounding.
 */
export async function geminiGroundedSearch(
  query: string,
  options: GeminiGroundedSearchOptions = {}
): Promise<WrapperResult> {
  const rawRef = `google:gemini-grounded:${hashQuery(query)}`;
  const apiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return { items: [], statusDetail: "gemini_key_missing" };
  }

  const model = options.model ?? DEFAULT_MODEL;
  const maxOutputTokens = options.maxOutputTokens ?? 1024;
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Search the web and produce a concise factual summary of what you find for this query, citing your sources. Focus on credible, recent, useful results. Query: "${query}"`,
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      maxOutputTokens,
      temperature: 0.2,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        items: [],
        statusDetail: `gemini_http_${res.status}:${errBody.slice(0, 200)}`,
      };
    }
    const parsed = (await res.json()) as GeminiResponse;
    const items = extractCards(parsed, query, rawRef);
    return { items, statusDetail: items.length === 0 ? "empty_result" : "ok" };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { items: [], statusDetail: "gemini_timeout" };
    }
    return {
      items: [],
      statusDetail: `gemini_error:${(err as Error).message.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
