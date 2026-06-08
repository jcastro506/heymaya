/**
 * Apify Tweet Scraper V2 integration — keyword search across X.
 *
 * ScrapeCreators has no Twitter keyword search endpoint (only profile / single
 * tweet / community lookups), so the GTM orchestrator's Sprint 4 Twitter
 * worker has been a silent no-op since day one — it hit a phantom
 * `/v1/twitter/search` and got 404 every call. This module replaces that
 * path with Apify's apidojo/tweet-scraper actor:
 *
 *   POST https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?token=<APIFY_API_TOKEN>
 *   body: { searchTerms: [<query>], maxItems: 25, sort: "Latest", tweetLanguage: "en" }
 *
 * Pricing: $0.40 per 1,000 tweets. At our scale (~6 calls × 25 tweets per
 * research job) that's ~$0.06 per job — about 18% of the Reddit/TikTok
 * spend. Reasonable.
 *
 * Auth: `APIFY_API_TOKEN` Convex env var (operator-provided).
 * Missing token returns ok-shape with empty items + statusDetail
 * "apify_token_missing" so the Twitter worker reports `insufficient_evidence`
 * instead of crashing the orchestrator.
 */

import type { ResearchRawItem, WrapperResult } from "../../gtmMaya/scrapeCreatorsGtmResearch";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const ACTOR_ID = "apidojo~tweet-scraper";
const RUN_SYNC_TIMEOUT_MS = 120_000;

interface ApifyTweetAuthor {
  userName?: string;
  name?: string;
  followers?: number;
}

interface ApifyTweet {
  type?: string;
  id?: string;
  url?: string;
  text?: string;
  retweetCount?: number;
  replyCount?: number;
  likeCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  quoteCount?: number;
  createdAt?: string;  // RFC 822 — "Fri Nov 24 17:49:36 +0000 2023"
  lang?: string;
  author?: ApifyTweetAuthor;
}

function hashSearchTerm(query: string): string {
  let acc = 0;
  for (let i = 0; i < query.length; i++) acc = (acc * 31 + query.charCodeAt(i)) | 0;
  return (acc >>> 0).toString(16).padStart(8, "0");
}

function parseTwitterDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeApifyTweet(tweet: ApifyTweet, rawRef: string): ResearchRawItem | null {
  if (!tweet.id || !tweet.text) return null;
  const url =
    tweet.url ??
    (tweet.author?.userName
      ? `https://x.com/${tweet.author.userName}/status/${tweet.id}`
      : `https://x.com/i/web/status/${tweet.id}`);
  const author = tweet.author?.userName ?? tweet.author?.name ?? null;
  return {
    platform: "twitter",
    externalId: tweet.id,
    url,
    title: null,  // tweets have no title — text IS the content
    excerpt: tweet.text.slice(0, 2000),
    author,
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

export interface ApifyTwitterSearchOptions {
  /** Max tweets to return (default 25). Apify rounds up to 50 minimum for billing. */
  maxItems?: number;
  /** "Latest" returns most recent. "Top" returns highest engagement. */
  sort?: "Latest" | "Top";
  /** ISO 639-1 language code (e.g. "en"). Defaults to "en". */
  tweetLanguage?: string;
  /** Minimum likes — useful to filter out spam/empty replies. */
  minimumFavorites?: number;
  /** Skip retweets if true (we usually want originals). */
  skipRetweets?: boolean;
}

/**
 * Keyword search across X via the Apify tweet-scraper actor. Returns at
 * most `maxItems` tweets matching the query. Soft-fails (returns empty
 * items + statusDetail) on missing API token, network errors, or empty
 * results so the orchestrator's Twitter worker treats them as
 * `insufficient_evidence` rather than crashing.
 */
export async function apifyTwitterSearch(
  query: string,
  options: ApifyTwitterSearchOptions = {}
): Promise<WrapperResult> {
  const rawRef = `twitter:apify-search:${hashSearchTerm(query)}`;
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return {
      items: [],
      statusDetail: "apify_token_missing",
    };
  }

  const maxItems = Math.max(1, options.maxItems ?? 25);
  const input: Record<string, unknown> = {
    searchTerms: [query],
    maxItems,
    sort: options.sort ?? "Latest",
    tweetLanguage: options.tweetLanguage ?? "en",
  };
  if (typeof options.minimumFavorites === "number") {
    input.minimumFavorites = options.minimumFavorites;
  }
  if (options.skipRetweets) {
    input.includeSearchTerms = true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUN_SYNC_TIMEOUT_MS);

  try {
    const url = `${APIFY_BASE_URL}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        items: [],
        statusDetail: `apify_http_${res.status}:${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as ApifyTweet[];
    const items: ResearchRawItem[] = [];
    for (const tweet of data ?? []) {
      const normalized = normalizeApifyTweet(tweet, rawRef);
      if (normalized) items.push(normalized);
    }
    return { items, statusDetail: items.length === 0 ? "empty_result" : "ok" };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { items: [], statusDetail: "apify_timeout" };
    }
    return {
      items: [],
      statusDetail: `apify_error:${(err as Error).message.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
