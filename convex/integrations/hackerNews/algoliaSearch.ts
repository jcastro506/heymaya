/**
 * Sprint 2.0 — Hacker News search via Algolia.
 *
 * HN's native Firebase API has no search endpoint. Algolia hosts a free,
 * unauth, no-rate-limit search index over all of HN at
 * https://hn.algolia.com/api/v1/. Endpoints:
 *
 *   GET /search?query=...&tags=story&hitsPerPage=20  (relevance-ranked)
 *   GET /search_by_date?query=...                    (newest first)
 *
 * No API key required. We use this for the GTM HN worker — finding active
 * threads where the operator's product fits as a natural reply (Show HN
 * comments, "Ask HN" threads, niche stories with high comment volume).
 *
 * Returns the same `ResearchRawItem[]` shape as other platform wrappers so
 * platformWorkers can dump rows into gtmEvidenceCards without per-platform
 * branching.
 */

import type { ResearchRawItem, WrapperResult } from "../../gtmMaya/scrapeCreatorsGtmResearch";

const ALGOLIA_HN_BASE = "https://hn.algolia.com/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

interface AlgoliaHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
  url?: string | null;
  author?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at_i?: number | null;
  created_at?: string | null;
  _tags?: string[];
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
  nbHits?: number;
  page?: number;
}

function hashQuery(query: string): string {
  let acc = 0;
  for (let i = 0; i < query.length; i++) acc = (acc * 31 + query.charCodeAt(i)) | 0;
  return (acc >>> 0).toString(16).padStart(8, "0");
}

function hitUrl(hit: AlgoliaHit): string {
  if (hit.url) return hit.url;
  if (hit.objectID) return `https://news.ycombinator.com/item?id=${hit.objectID}`;
  return "https://news.ycombinator.com";
}

function hitTitle(hit: AlgoliaHit): string | null {
  return hit.title ?? hit.story_title ?? null;
}

function hitExcerpt(hit: AlgoliaHit): string | null {
  const raw = hit.comment_text ?? hit.story_text ?? null;
  if (!raw) return null;
  // Algolia returns HTML-encoded text in some fields; basic strip.
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function normalizeHit(hit: AlgoliaHit, rawRef: string): ResearchRawItem | null {
  if (!hit.objectID || (!hitTitle(hit) && !hitExcerpt(hit))) return null;
  return {
    // HN doesn't fit cleanly in the existing GtmPlatform enum
    // (reddit/tiktok/twitter/instagram/google); reuse "google" tag-bucket
    // for citation purposes since "hn" isn't in the enum. The orchestrator
    // tracks HN via the `runHackerNewsWorker` action's `platform` field
    // which is "google" temporarily — see Sprint 2.0 follow-up to add HN
    // as a proper enum value across the schema. For now we still surface
    // the cards under platform:"google" with tag hn:true.
    platform: "google",
    externalId: hit.objectID,
    url: hitUrl(hit),
    title: hitTitle(hit),
    excerpt: hitExcerpt(hit),
    author: hit.author ?? null,
    createdAtMs: hit.created_at_i ? hit.created_at_i * 1000 : null,
    engagement: {
      likes: hit.points ?? null,
      comments: hit.num_comments ?? null,
      shares: null,
      views: null,
      upvotes: hit.points ?? null,
      downvotes: null,
    },
    tags: ["hn:true", ...(hit._tags ?? []).map((t) => `hn:${t}`)],
    rawRef,
  };
}

export interface HackerNewsSearchOptions {
  /** Sort by relevance (default) or date (newest first). */
  sort?: "relevance" | "date";
  /** Limit results per query. Default 20, max 100. */
  hitsPerPage?: number;
  /** Restrict to a tag — "story", "comment", "ask_hn", "show_hn", "front_page". */
  tag?: "story" | "comment" | "ask_hn" | "show_hn" | "front_page" | "poll";
  /** Restrict to results created in the last N days (Unix-seconds query). */
  withinDays?: number;
  /** Minimum point threshold (e.g. 10 to filter low-engagement noise). */
  minPoints?: number;
}

/**
 * Search Hacker News via Algolia's free search index. No auth required.
 * Returns ok-shape with empty items on network error or empty result so
 * the orchestrator's worker treats it as `insufficient_evidence` rather
 * than crashing.
 */
export async function hackerNewsSearch(
  query: string,
  options: HackerNewsSearchOptions = {}
): Promise<WrapperResult> {
  const rawRef = `google:hn-algolia:${hashQuery(query)}`;
  const sort = options.sort ?? "relevance";
  const hitsPerPage = Math.min(Math.max(1, options.hitsPerPage ?? 20), 100);
  const path = sort === "date" ? "/search_by_date" : "/search";
  const url = new URL(ALGOLIA_HN_BASE + path);
  // Sprint 2.0 — strip surrounding double quotes. Algolia treats quotes as
  // strict exact-phrase match; multi-word queries like `"how do I run local
  // llm on mac"` then match zero results because no HN post title contains
  // that exact phrase. The platform-agnostic query builder (Sprint 3)
  // wraps in quotes for ScrapeCreators-era Google semantics; here we want
  // relevance-ranked partial match, which is Algolia's default.
  const cleanedQuery = query.replace(/^"(.+)"$/, "$1");
  url.searchParams.set("query", cleanedQuery);
  url.searchParams.set("hitsPerPage", String(hitsPerPage));
  if (options.tag) url.searchParams.set("tags", options.tag);

  // numericFilters supports created_at_i + points
  const numericFilters: string[] = [];
  if (typeof options.withinDays === "number" && options.withinDays > 0) {
    const cutoff = Math.floor(Date.now() / 1000) - options.withinDays * 86400;
    numericFilters.push(`created_at_i>=${cutoff}`);
  }
  if (typeof options.minPoints === "number" && options.minPoints > 0) {
    numericFilters.push(`points>=${options.minPoints}`);
  }
  if (numericFilters.length > 0) {
    url.searchParams.set("numericFilters", numericFilters.join(","));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        items: [],
        statusDetail: `algolia_hn_http_${res.status}:${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as AlgoliaResponse;
    const items: ResearchRawItem[] = [];
    for (const hit of data.hits ?? []) {
      const item = normalizeHit(hit, rawRef);
      if (item) items.push(item);
    }
    return { items, statusDetail: items.length === 0 ? "empty_result" : "ok" };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { items: [], statusDetail: "algolia_hn_timeout" };
    }
    return {
      items: [],
      statusDetail: `algolia_hn_error:${(err as Error).message.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
