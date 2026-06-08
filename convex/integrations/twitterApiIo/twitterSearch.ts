/**
 * TwitterAPI.io integration — keyword search across X.
 *
 * Replacement for the previous Apify-based X search wrapper. Apify free
 * tier could not actually scrape X (returned `noResults: true` for every
 * query due to missing residential proxies). TwitterAPI.io has a real
 * working keyword-search endpoint at a simpler price point ($0.15/1K
 * tweets, ~$0.00015 minimum per call, sign-up onboarding credit).
 *
 *   GET https://api.twitterapi.io/twitter/tweet/advanced_search?query=...&queryType=Latest
 *   Header: x-api-key: <TWITTERAPI_IO_KEY>
 *
 * Auth: `TWITTERAPI_IO_KEY` Convex env var. Missing key returns ok-shape
 * with empty items + statusDetail "twitterapi_io_key_missing" so the
 * orchestrator's Twitter worker reports `insufficient_evidence` instead
 * of crashing.
 */

import type { ResearchRawItem, WrapperResult } from "../../gtmMaya/scrapeCreatorsGtmResearch";

const BASE_URL = "https://api.twitterapi.io";
const SEARCH_PATH = "/twitter/tweet/advanced_search";
const REQUEST_TIMEOUT_MS = 30_000;

interface TwitterApiIoAuthor {
  userName?: string;
  name?: string;
  followers?: number;
}

interface TwitterApiIoTweet {
  type?: string;
  id?: string;
  url?: string;
  text?: string;
  source?: string;
  retweetCount?: number;
  replyCount?: number;
  likeCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  createdAt?: string;
  lang?: string;
  author?: TwitterApiIoAuthor;
}

interface TwitterApiIoSearchResponse {
  tweets?: TwitterApiIoTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
}

function hashQuery(query: string): string {
  let acc = 0;
  for (let i = 0; i < query.length; i++) acc = (acc * 31 + query.charCodeAt(i)) | 0;
  return (acc >>> 0).toString(16).padStart(8, "0");
}

function parseTwitterDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTweet(tweet: TwitterApiIoTweet, rawRef: string): ResearchRawItem | null {
  if (!tweet.id || !tweet.text) return null;
  const url =
    tweet.url ??
    (tweet.author?.userName
      ? `https://x.com/${tweet.author.userName}/status/${tweet.id}`
      : `https://x.com/i/web/status/${tweet.id}`);
  return {
    platform: "twitter",
    externalId: tweet.id,
    url,
    title: null,
    excerpt: tweet.text.slice(0, 2000),
    author: tweet.author?.userName ?? tweet.author?.name ?? null,
    createdAtMs: parseTwitterDate(tweet.createdAt),
    engagement: {
      likes: tweet.likeCount ?? null,
      comments: tweet.replyCount ?? null,
      shares: tweet.retweetCount ?? null,
      views: tweet.viewCount ?? null,
      upvotes: null,
      downvotes: null,
    },
    tags: tweet.lang ? [`lang:${tweet.lang}`] : [],
    rawRef,
  };
}

export interface TwitterApiIoSearchOptions {
  /** "Latest" returns most recent. "Top" returns highest engagement. */
  queryType?: "Latest" | "Top";
  /** Max pages to fetch (each page = up to 20 tweets). Default 1. */
  maxPages?: number;
  /** ISO language filter — appended to query as ` lang:<code>` (not a separate param). */
  language?: string;
}

/**
 * Keyword search across X. Returns at most `maxPages * 20` tweets matching
 * the query. Soft-fails (returns empty items + statusDetail) on missing
 * API key, network errors, or empty results.
 */
export async function twitterApiIoSearch(
  query: string,
  options: TwitterApiIoSearchOptions = {}
): Promise<WrapperResult> {
  const rawRef = `twitter:twitterapi-io-search:${hashQuery(query)}`;
  const apiKey = process.env.TWITTERAPI_IO_KEY;
  if (!apiKey) {
    return { items: [], statusDetail: "twitterapi_io_key_missing" };
  }

  const finalQuery = options.language
    ? `${query} lang:${options.language}`
    : query;
  const queryType = options.queryType ?? "Latest";
  const maxPages = Math.max(1, options.maxPages ?? 1);

  const items: ResearchRawItem[] = [];
  let cursor = "";
  let statusDetail = "ok";

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(BASE_URL + SEARCH_PATH);
    url.searchParams.set("query", finalQuery);
    url.searchParams.set("queryType", queryType);
    if (cursor) url.searchParams.set("cursor", cursor);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { "x-api-key": apiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        statusDetail = `twitterapi_io_http_${res.status}:${body.slice(0, 200)}`;
        break;
      }
      const data = (await res.json()) as TwitterApiIoSearchResponse;
      for (const tweet of data.tweets ?? []) {
        const normalized = normalizeTweet(tweet, rawRef);
        if (normalized) items.push(normalized);
      }
      if (!data.has_next_page) break;
      cursor = data.next_cursor ?? "";
      if (!cursor) break;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        statusDetail = "twitterapi_io_timeout";
      } else {
        statusDetail = `twitterapi_io_error:${(err as Error).message.slice(0, 200)}`;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  if (items.length === 0 && statusDetail === "ok") {
    statusDetail = "empty_result";
  }
  return { items, statusDetail };
}
