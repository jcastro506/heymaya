/**
 * Sprint 2 — GTM ScrapeCreators wrappers.
 *
 * Per CLAWLAUNCH_GTM_MVP_EXECUTION_SPRINT.md § Sprint 2, this module adds
 * typed HTTP wrappers for the endpoints Maya GTM needs that aren't already
 * present in convex/integrations/scrapeCreators/endpoints.ts (which is
 * creator-Maya oriented). New surface:
 *
 *   Reddit:
 *     - searchAll(query, options)       → /v1/reddit/search
 *     - searchSubreddit(sub, query, opts) → /v1/reddit/subreddit/search
 *     - subredditPosts(sub, opts)        → /v1/reddit/subreddit
 *     - postComments(postUrl, opts)      → /v1/reddit/post/comments
 *
 *   TikTok (search/keyword/hashtag/trendingFeed live in endpoints.ts):
 *     - videoComments(awemeId, opts)     → /v1/tiktok/video/comments
 *     - videoTranscript(awemeId, opts)   → /v1/tiktok/video/transcript
 *
 *   X / Twitter:
 *     - twitterProfile(handle)           → /v1/twitter/profile
 *     - twitterUserTweets(handle, opts)  → /v1/twitter/user/tweets
 *     - twitterTweet(url)                → /v1/twitter/tweet
 *     - twitterSearch(query, opts)       → /v1/twitter/search
 *
 *   Instagram (profile/lastPosts live in endpoints.ts):
 *     - searchReels(query, opts)         → /v2/instagram/reels/search
 *
 *   Google (substitutes / pain probes):
 *     - googleSearch(query, opts)        → /v1/google/search
 *
 * Each wrapper:
 *   - is a pure async function — takes a ScrapeCreatorsClient + args, returns
 *     normalized `ResearchRawItem[]` plus a typed metadata envelope (page
 *     token, total hits if available, rawRef for citation-firewall).
 *   - normalizes the response into the shared `ResearchRawItem` shape so
 *     platform workers (Sprint 4) can write `gtmEvidenceCards` rows from
 *     mixed-platform sources without per-call shape branching.
 *   - throws on hard errors (HTTP 4xx, JSON parse fail). Soft errors
 *     (empty result, 5xx after retries) are returned as `{ items: [],
 *     statusDetail: "..."}` so callers can decide whether to retry or
 *     give up.
 *
 * Cost accounting + cache + cost-ledger writes live in the Sprint 4
 * worker layer, NOT here. This module is the HTTP surface only.
 */

import { z } from "zod";
import {
  ScrapeCreatorsClient,
  ScrapeCreatorsHttpError,
  ScrapeCreatorsRateLimitError,
} from "../integrations/scrapeCreators/client";

export type GtmPlatform = "reddit" | "tiktok" | "twitter" | "instagram" | "google";

/**
 * Normalized item every wrapper returns. Workers consume this to build
 * gtmEvidenceCards rows.
 */
export const ResearchRawItemSchema = z.object({
  platform: z.enum(["reddit", "tiktok", "twitter", "instagram", "google"]),
  /** Stable platform-side ID, used for dedup and citation. */
  externalId: z.string(),
  /** Public URL — required for citation-firewall. */
  url: z.string(),
  /** Short label / title / first line. */
  title: z.string().nullable(),
  /** Body excerpt — at most ~2000 chars. */
  excerpt: z.string().nullable(),
  /** Author handle / display name when available. */
  author: z.string().nullable(),
  /** When the item was created on the platform. */
  createdAtMs: z.number().nullable(),
  /** Engagement signals — sparse, only what the API provides. */
  engagement: z.object({
    likes: z.number().nullable(),
    comments: z.number().nullable(),
    shares: z.number().nullable(),
    views: z.number().nullable(),
    upvotes: z.number().nullable(),
    downvotes: z.number().nullable(),
  }),
  /** Platform-specific tags surfaced for downstream classification. */
  tags: z.array(z.string()),
  /** rawRef — the request fingerprint, used to trace evidence back to the
   *  exact call. Workers stamp this into gtmEvidenceCards.rawRef. */
  rawRef: z.string(),
});

export type ResearchRawItem = z.infer<typeof ResearchRawItemSchema>;

export interface WrapperResult {
  items: ResearchRawItem[];
  /** Soft status string for non-throwing failures. "ok" for success. */
  statusDetail: string;
  /** Provider-side pagination cursor when available. */
  nextCursor?: string;
}

function rawRefOf(
  platform: GtmPlatform,
  endpoint: string,
  paramHash: string
): string {
  return `${platform}:${endpoint}:${paramHash}`;
}

/**
 * Stable hash of query params (no secrets). 12-char hex from a simple
 * accumulator — collision-tolerant for citation purposes (we re-derive
 * the same key for the same call).
 */
function hashParams(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  const canonical = keys
    .map((k) => `${k}=${JSON.stringify(params[k] ?? null)}`)
    .join("&");
  let acc = 0;
  for (let i = 0; i < canonical.length; i++) {
    acc = (acc * 31 + canonical.charCodeAt(i)) | 0;
  }
  return (acc >>> 0).toString(16).padStart(8, "0");
}

// ──────────────────────────────────────────────────────────────────────
// Reddit
// ──────────────────────────────────────────────────────────────────────

export interface RedditSearchOptions {
  sort?: "relevance" | "top" | "new" | "comments";
  timeframe?: "hour" | "day" | "week" | "month" | "year" | "all";
  after?: string;
  trim?: boolean;
}

// ScrapeCreators Reddit response shape (verified 2026-05-24):
//   { success, credits_remaining, posts: [...], after }
// Each post is FLAT (no `.data` nesting) — fields read directly off the
// post object: { id, title, url, permalink?, author, subreddit, selftext?,
// score?, ups?, downs?, num_comments?, created_utc, link_flair_text? }.
// This differs from the older reddit.com JSON shape (data.children[].data)
// that the wrappers were originally written against — older code dropped
// every post silently because raw.data.children was always undefined.
interface RawRedditPost {
  id?: string;
  name?: string;
  title?: string;
  selftext?: string;
  author?: string;
  permalink?: string;
  url?: string;
  subreddit?: string;
  score?: number;
  ups?: number;
  downs?: number;
  num_comments?: number;
  created_utc?: number;
  link_flair_text?: string | null;
}

interface RawRedditListing {
  success?: boolean;
  posts?: RawRedditPost[];
  after?: string | null;
  // Legacy reddit.com shape kept for transition; never populated by the
  // ScrapeCreators API as of 2026-05-24.
  data?: { children?: { data?: RawRedditPost }[]; after?: string | null };
  ok?: boolean;
}

function normalizeRedditPost(post: RawRedditPost, rawRef: string): ResearchRawItem | null {
  if (!post?.id || !post.title) return null;
  const permalink = post.permalink
    ? post.permalink.startsWith("http")
      ? post.permalink
      : `https://www.reddit.com${post.permalink}`
    : post.url ?? `https://www.reddit.com/comments/${post.id}`;
  const created = post.created_utc ? Math.round(post.created_utc * 1000) : null;
  const tags: string[] = [];
  if (post.subreddit) tags.push(`sub:${post.subreddit}`);
  if (post.link_flair_text) tags.push(`flair:${post.link_flair_text}`);
  return {
    platform: "reddit",
    externalId: post.id,
    url: permalink,
    title: post.title,
    excerpt: post.selftext?.slice(0, 2000) ?? null,
    author: post.author ?? null,
    createdAtMs: created,
    engagement: {
      likes: post.score ?? post.ups ?? null,
      comments: post.num_comments ?? null,
      shares: null,
      views: null,
      upvotes: post.ups ?? null,
      downvotes: post.downs ?? null,
    },
    tags,
    rawRef,
  };
}

// Helper — extracts the post list whether the response is the new flat
// shape (`raw.posts`) or the legacy reddit.com nested shape
// (`raw.data.children[].data`). Returns [] gracefully if neither populated.
function redditPostsFromListing(raw: RawRedditListing): RawRedditPost[] {
  if (Array.isArray(raw.posts) && raw.posts.length > 0) return raw.posts;
  const legacy = raw.data?.children ?? [];
  return legacy
    .map((c) => c?.data)
    .filter((p): p is RawRedditPost => Boolean(p));
}

export async function searchRedditAll(
  client: ScrapeCreatorsClient,
  query: string,
  options: RedditSearchOptions = {}
): Promise<WrapperResult> {
  const params = {
    query,
    sort: options.sort ?? "relevance",
    timeframe: options.timeframe ?? "month",
    after: options.after,
    trim: options.trim ?? true,
  };
  const rawRef = rawRefOf("reddit", "search", hashParams(params));
  try {
    const raw = await client.request<RawRedditListing>("/v1/reddit/search", {
      query: params as Record<string, string | number | boolean | undefined>,
    });
    const posts = redditPostsFromListing(raw);
    const items = posts
      .map((p) => normalizeRedditPost(p, rawRef))
      .filter((x): x is ResearchRawItem => x !== null);
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.after ?? raw.data?.after ?? undefined,
    };
  } catch (err) {
    return softFail("reddit", err, rawRef);
  }
}

export async function searchRedditSubreddit(
  client: ScrapeCreatorsClient,
  subreddit: string,
  query: string,
  options: RedditSearchOptions = {}
): Promise<WrapperResult> {
  const cleanSub = subreddit.replace(/^r\//i, "").trim();
  const params = {
    subreddit: cleanSub,
    query,
    sort: options.sort ?? "relevance",
    timeframe: options.timeframe ?? "month",
    after: options.after,
    trim: options.trim ?? true,
  };
  const rawRef = rawRefOf("reddit", "subreddit/search", hashParams(params));
  try {
    const raw = await client.request<RawRedditListing>(
      "/v1/reddit/subreddit/search",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const posts = redditPostsFromListing(raw);
    const items = posts
      .map((p) => normalizeRedditPost(p, rawRef))
      .filter((x): x is ResearchRawItem => x !== null);
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.after ?? raw.data?.after ?? undefined,
    };
  } catch (err) {
    return softFail("reddit", err, rawRef);
  }
}

export async function subredditPosts(
  client: ScrapeCreatorsClient,
  subreddit: string,
  options: { sort?: "hot" | "new" | "top" | "rising"; after?: string; trim?: boolean } = {}
): Promise<WrapperResult> {
  const cleanSub = subreddit.replace(/^r\//i, "").trim();
  const params = {
    subreddit: cleanSub,
    sort: options.sort ?? "hot",
    after: options.after,
    trim: options.trim ?? true,
  };
  const rawRef = rawRefOf("reddit", "subreddit", hashParams(params));
  try {
    const raw = await client.request<RawRedditListing>(
      "/v1/reddit/subreddit",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const posts = redditPostsFromListing(raw);
    const items = posts
      .map((p) => normalizeRedditPost(p, rawRef))
      .filter((x): x is ResearchRawItem => x !== null);
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.after ?? raw.data?.after ?? undefined,
    };
  } catch (err) {
    return softFail("reddit", err, rawRef);
  }
}

interface RawRedditComment {
  data?: {
    id?: string;
    body?: string;
    author?: string;
    permalink?: string;
    score?: number;
    ups?: number;
    downs?: number;
    created_utc?: number;
    link_id?: string;
    parent_id?: string;
  };
  kind?: string;
}

interface RawRedditCommentThread {
  data?: { children?: RawRedditComment[] };
}

// Sprint 2.14a — ScrapeCreators returns flat `{ success, post, comments,
// more }` for /v1/reddit/post/comments, NOT the legacy reddit JSON
// listing format `[post, listing]`. Original wrapper was reading
// `thread.data.children` which always returned 0 comments — the bug
// silently returned statusDetail:"ok" with empty items so callers had
// no signal that comments were being dropped. Live-confirmed 2026-05-24
// when mining all 30 cards across N=3 returned "no comments (ok)".
interface RawScrapeCreatorsRedditComment {
  id?: string;
  body?: string;
  author?: string | null;
  score?: number;
  ups?: number;
  downs?: number;
  created_utc?: number;
  permalink?: string;
}

interface RawScrapeCreatorsRedditCommentsResponse {
  success?: boolean;
  post?: unknown;
  comments?: RawScrapeCreatorsRedditComment[];
  error?: string;
  errorStatus?: number;
}

export async function redditPostComments(
  client: ScrapeCreatorsClient,
  postUrl: string,
  options: { limit?: number; depth?: number } = {}
): Promise<WrapperResult> {
  const params = {
    url: postUrl,
    limit: options.limit ?? 50,
    depth: options.depth ?? 4,
  };
  const rawRef = rawRefOf("reddit", "post/comments", hashParams(params));
  try {
    const raw = await client.request<RawScrapeCreatorsRedditCommentsResponse>(
      "/v1/reddit/post/comments",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    if (raw && raw.success === false) {
      return softFail(
        "reddit",
        new Error(
          `ScrapeCreators reddit comments not_found: ${raw.error ?? "unknown"} (status ${raw.errorStatus ?? "?"})`
        ),
        rawRef
      );
    }
    const comments = raw?.comments ?? [];
    const items: ResearchRawItem[] = [];
    for (const c of comments) {
      if (!c?.id || !c.body) continue;
      items.push({
        platform: "reddit",
        externalId: c.id,
        url: c.permalink ? `https://www.reddit.com${c.permalink}` : postUrl,
        title: null,
        excerpt: c.body.slice(0, 2000),
        author: c.author ?? null,
        createdAtMs: c.created_utc ? Math.round(c.created_utc * 1000) : null,
        engagement: {
          likes: c.score ?? c.ups ?? null,
          comments: null,
          shares: null,
          views: null,
          upvotes: c.ups ?? null,
          downvotes: c.downs ?? null,
        },
        tags: ["comment"],
        rawRef,
      });
    }
    return { items, statusDetail: "ok" };
  } catch (err) {
    return softFail("reddit", err, rawRef);
  }
}

// ──────────────────────────────────────────────────────────────────────
// TikTok video comments + transcript
// ──────────────────────────────────────────────────────────────────────

interface RawTikTokComment {
  cid?: string;
  text?: string;
  user?: { unique_id?: string; nickname?: string };
  digg_count?: number;
  reply_comment_total?: number;
  create_time?: number;
  aweme_id?: string;
}

interface RawTikTokCommentResponse {
  comments?: RawTikTokComment[];
  has_more?: boolean | number;
  cursor?: number;
}

export async function tiktokVideoComments(
  client: ScrapeCreatorsClient,
  awemeId: string,
  options: { cursor?: number; count?: number } = {}
): Promise<WrapperResult> {
  const params = {
    aweme_id: awemeId,
    cursor: options.cursor ?? 0,
    count: options.count ?? 20,
  };
  const rawRef = rawRefOf("tiktok", "video/comments", hashParams(params));
  try {
    const raw = await client.request<RawTikTokCommentResponse>(
      "/v1/tiktok/video/comments",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const items: ResearchRawItem[] = [];
    for (const c of raw.comments ?? []) {
      if (!c.cid || !c.text) continue;
      const handle = c.user?.unique_id ?? null;
      const url = handle && awemeId
        ? `https://www.tiktok.com/@${handle}/video/${awemeId}?comment_id=${c.cid}`
        : `https://www.tiktok.com/video/${awemeId}`;
      items.push({
        platform: "tiktok",
        externalId: c.cid,
        url,
        title: null,
        excerpt: c.text.slice(0, 2000),
        author: c.user?.nickname ?? handle ?? null,
        createdAtMs: c.create_time ? c.create_time * 1000 : null,
        engagement: {
          likes: c.digg_count ?? null,
          comments: c.reply_comment_total ?? null,
          shares: null,
          views: null,
          upvotes: null,
          downvotes: null,
        },
        tags: ["comment"],
        rawRef,
      });
    }
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.has_more && raw.cursor ? String(raw.cursor) : undefined,
    };
  } catch (err) {
    return softFail("tiktok", err, rawRef);
  }
}

interface RawTikTokTranscript {
  transcript?: string;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
  language?: string;
}

export async function tiktokVideoTranscript(
  client: ScrapeCreatorsClient,
  awemeId: string
): Promise<WrapperResult> {
  const params = { aweme_id: awemeId };
  const rawRef = rawRefOf("tiktok", "video/transcript", hashParams(params));
  try {
    const raw = await client.request<RawTikTokTranscript>(
      "/v1/tiktok/video/transcript",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const text = raw.transcript ?? (raw.segments ?? []).map((s) => s.text ?? "").join(" ");
    if (!text.trim()) return { items: [], statusDetail: "empty_transcript" };
    return {
      items: [
        {
          platform: "tiktok",
          externalId: `${awemeId}:transcript`,
          url: `https://www.tiktok.com/video/${awemeId}`,
          title: raw.language ? `transcript (${raw.language})` : "transcript",
          excerpt: text.slice(0, 2000),
          author: null,
          createdAtMs: null,
          engagement: {
            likes: null,
            comments: null,
            shares: null,
            views: null,
            upvotes: null,
            downvotes: null,
          },
          tags: ["transcript"],
          rawRef,
        },
      ],
      statusDetail: "ok",
    };
  } catch (err) {
    return softFail("tiktok", err, rawRef);
  }
}

// ──────────────────────────────────────────────────────────────────────
// X / Twitter
// ──────────────────────────────────────────────────────────────────────

interface RawTwitterProfile {
  id?: string;
  handle?: string;
  name?: string;
  description?: string;
  followers?: number;
  following?: number;
  tweet_count?: number;
  created_at?: string | number;
  url?: string;
}

export async function twitterProfile(
  client: ScrapeCreatorsClient,
  handle: string
): Promise<WrapperResult> {
  const cleanHandle = handle.replace(/^@/, "").trim();
  const params = { handle: cleanHandle };
  const rawRef = rawRefOf("twitter", "profile", hashParams(params));
  try {
    const raw = await client.request<RawTwitterProfile>("/v1/twitter/profile", {
      query: params as Record<string, string | number | boolean | undefined>,
    });
    if (!raw?.handle && !raw?.id) {
      return { items: [], statusDetail: "profile_not_found" };
    }
    const createdAtMs =
      typeof raw.created_at === "number"
        ? raw.created_at * (raw.created_at > 1e12 ? 1 : 1000)
        : raw.created_at
          ? new Date(raw.created_at).getTime() || null
          : null;
    return {
      items: [
        {
          platform: "twitter",
          externalId: raw.id ?? raw.handle ?? cleanHandle,
          url: raw.url ?? `https://x.com/${raw.handle ?? cleanHandle}`,
          title: raw.name ?? raw.handle ?? cleanHandle,
          excerpt: raw.description ?? null,
          author: raw.handle ?? cleanHandle,
          createdAtMs,
          engagement: {
            likes: null,
            comments: null,
            shares: null,
            views: null,
            upvotes: null,
            downvotes: null,
          },
          tags: [
            `followers:${raw.followers ?? 0}`,
            `tweets:${raw.tweet_count ?? 0}`,
          ],
          rawRef,
        },
      ],
      statusDetail: "ok",
    };
  } catch (err) {
    return softFail("twitter", err, rawRef);
  }
}

interface RawTwitterTweet {
  id_str?: string;
  id?: string;
  text?: string;
  full_text?: string;
  user?: { screen_name?: string; name?: string };
  favorite_count?: number;
  reply_count?: number;
  retweet_count?: number;
  quote_count?: number;
  view_count?: number;
  created_at?: string | number;
  lang?: string;
}

interface RawTwitterUserTweets {
  tweets?: RawTwitterTweet[];
  next_cursor?: string;
}

function normalizeTweet(t: RawTwitterTweet, rawRef: string): ResearchRawItem | null {
  const id = t.id_str ?? t.id;
  if (!id) return null;
  const text = t.full_text ?? t.text ?? "";
  const handle = t.user?.screen_name ?? "i";
  const createdAtMs =
    typeof t.created_at === "number"
      ? t.created_at * (t.created_at > 1e12 ? 1 : 1000)
      : t.created_at
        ? new Date(t.created_at).getTime() || null
        : null;
  return {
    platform: "twitter",
    externalId: id,
    url: `https://x.com/${handle}/status/${id}`,
    title: null,
    excerpt: text.slice(0, 2000),
    author: t.user?.screen_name ?? null,
    createdAtMs,
    engagement: {
      likes: t.favorite_count ?? null,
      comments: t.reply_count ?? null,
      shares: t.retweet_count ?? null,
      views: t.view_count ?? null,
      upvotes: null,
      downvotes: null,
    },
    tags: t.lang ? [`lang:${t.lang}`] : [],
    rawRef,
  };
}

export async function twitterUserTweets(
  client: ScrapeCreatorsClient,
  handle: string,
  options: { cursor?: string } = {}
): Promise<WrapperResult> {
  const cleanHandle = handle.replace(/^@/, "").trim();
  const params = { handle: cleanHandle, cursor: options.cursor };
  const rawRef = rawRefOf("twitter", "user/tweets", hashParams(params));
  try {
    const raw = await client.request<RawTwitterUserTweets>(
      "/v1/twitter/user/tweets",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const items = (raw.tweets ?? [])
      .map((t) => normalizeTweet(t, rawRef))
      .filter((x): x is ResearchRawItem => x !== null);
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.next_cursor ?? undefined,
    };
  } catch (err) {
    return softFail("twitter", err, rawRef);
  }
}

export async function twitterTweet(
  client: ScrapeCreatorsClient,
  tweetUrl: string
): Promise<WrapperResult> {
  const params = { url: tweetUrl };
  const rawRef = rawRefOf("twitter", "tweet", hashParams(params));
  try {
    const raw = await client.request<RawTwitterTweet>("/v1/twitter/tweet", {
      query: params as Record<string, string | number | boolean | undefined>,
    });
    const item = normalizeTweet(raw, rawRef);
    if (!item) return { items: [], statusDetail: "tweet_not_found" };
    return { items: [item], statusDetail: "ok" };
  } catch (err) {
    return softFail("twitter", err, rawRef);
  }
}

export async function twitterSearch(
  client: ScrapeCreatorsClient,
  query: string,
  options: { cursor?: string; mode?: "latest" | "top" } = {}
): Promise<WrapperResult> {
  const params = {
    query,
    cursor: options.cursor,
    mode: options.mode ?? "latest",
  };
  const rawRef = rawRefOf("twitter", "search", hashParams(params));
  try {
    const raw = await client.request<RawTwitterUserTweets>(
      "/v1/twitter/search",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const items = (raw.tweets ?? [])
      .map((t) => normalizeTweet(t, rawRef))
      .filter((x): x is ResearchRawItem => x !== null);
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.next_cursor ?? undefined,
    };
  } catch (err) {
    return softFail("twitter", err, rawRef);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Instagram — Reels search
// ──────────────────────────────────────────────────────────────────────

interface RawInstagramReel {
  id?: string;
  shortcode?: string;
  caption?: string;
  owner?: { username?: string; full_name?: string };
  like_count?: number;
  comment_count?: number;
  play_count?: number;
  taken_at?: number;
  video_url?: string;
}

interface RawInstagramReelsResponse {
  reels?: RawInstagramReel[];
  next_page?: string;
}

export async function instagramSearchReels(
  client: ScrapeCreatorsClient,
  query: string,
  options: { page?: string } = {}
): Promise<WrapperResult> {
  const params = { query, page: options.page };
  const rawRef = rawRefOf("instagram", "reels/search", hashParams(params));
  try {
    const raw = await client.request<RawInstagramReelsResponse>(
      "/v2/instagram/reels/search",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const items: ResearchRawItem[] = [];
    for (const r of raw.reels ?? []) {
      const id = r.shortcode ?? r.id;
      if (!id) continue;
      items.push({
        platform: "instagram",
        externalId: id,
        url: r.shortcode
          ? `https://www.instagram.com/reel/${r.shortcode}/`
          : r.video_url ?? `https://www.instagram.com/`,
        title: null,
        excerpt: r.caption?.slice(0, 2000) ?? null,
        author: r.owner?.username ?? null,
        createdAtMs: r.taken_at ? r.taken_at * 1000 : null,
        engagement: {
          likes: r.like_count ?? null,
          comments: r.comment_count ?? null,
          shares: null,
          views: r.play_count ?? null,
          upvotes: null,
          downvotes: null,
        },
        tags: ["reel"],
        rawRef,
      });
    }
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.next_page ?? undefined,
    };
  } catch (err) {
    return softFail("instagram", err, rawRef);
  }
}

// Instagram post/reel comments — /v2/instagram/post/comments?url=...
// [shape-defensive] The live response field names aren't pinned in the Convex
// path (the agent-side tool is live-verified; this mirrors that endpoint). We
// accept several plausible shapes and soft-fail on anything else, so a shape
// surprise yields "no comments" (IG simply stays un-comment-grounded, exactly
// today's behavior) and never throws into the research pipeline.
interface RawInstagramComment {
  pk?: string;
  id?: string;
  text?: string;
  comment?: string;
  like_count?: number;
  comment_like_count?: number;
  created_at?: number;
  created_at_utc?: number;
  user?: { username?: string; full_name?: string };
  owner?: { username?: string };
  username?: string;
}

export async function instagramPostComments(
  client: ScrapeCreatorsClient,
  postUrl: string,
  options: { amount?: number } = {}
): Promise<WrapperResult> {
  const params = { url: postUrl, amount: options.amount ?? 30 };
  const rawRef = rawRefOf("instagram", "post/comments", hashParams(params));
  try {
    const raw = await client.request<Record<string, unknown>>(
      "/v2/instagram/post/comments",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    // Accept { comments: [...] } | { data: { comments } } | bare array.
    const list: RawInstagramComment[] = Array.isArray(raw)
      ? (raw as RawInstagramComment[])
      : Array.isArray((raw as { comments?: unknown }).comments)
        ? ((raw as { comments: RawInstagramComment[] }).comments)
        : Array.isArray(
              (raw as { data?: { comments?: unknown } }).data?.comments
            )
          ? ((raw as { data: { comments: RawInstagramComment[] } }).data.comments)
          : [];
    const items: ResearchRawItem[] = [];
    for (const c of list) {
      const text = c.text ?? c.comment;
      const id = c.pk ?? c.id;
      if (!text || !id) continue;
      const author =
        c.user?.username ?? c.owner?.username ?? c.username ?? null;
      const createdSec = c.created_at ?? c.created_at_utc;
      items.push({
        platform: "instagram",
        externalId: String(id),
        url: postUrl,
        title: null,
        excerpt: text.slice(0, 2000),
        author: author ?? c.user?.full_name ?? null,
        createdAtMs: createdSec ? createdSec * 1000 : null,
        engagement: {
          likes: c.like_count ?? c.comment_like_count ?? null,
          comments: null,
          shares: null,
          views: null,
          upvotes: null,
          downvotes: null,
        },
        tags: ["comment"],
        rawRef,
      });
    }
    return { items, statusDetail: "ok" };
  } catch (err) {
    return softFail("instagram", err, rawRef);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Google search (substitutes / pain probes)
// ──────────────────────────────────────────────────────────────────────

interface RawGoogleSearchResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
  source?: string;
}

interface RawGoogleSearchResponse {
  results?: RawGoogleSearchResult[];
  next_page?: string;
}

export async function googleSearch(
  client: ScrapeCreatorsClient,
  query: string,
  options: { gl?: string; num?: number } = {}
): Promise<WrapperResult> {
  const params = { query, gl: options.gl ?? "us", num: options.num ?? 10 };
  const rawRef = rawRefOf("google", "search", hashParams(params));
  try {
    const raw = await client.request<RawGoogleSearchResponse>(
      "/v1/google/search",
      { query: params as Record<string, string | number | boolean | undefined> }
    );
    const items: ResearchRawItem[] = [];
    for (const r of raw.results ?? []) {
      if (!r.link) continue;
      items.push({
        platform: "google",
        externalId: r.link,
        url: r.link,
        title: r.title ?? null,
        excerpt: r.snippet ?? null,
        author: r.source ?? null,
        createdAtMs: null,
        engagement: {
          likes: null,
          comments: null,
          shares: null,
          views: null,
          upvotes: null,
          downvotes: null,
        },
        tags: r.position ? [`pos:${r.position}`] : [],
        rawRef,
      });
    }
    return {
      items,
      statusDetail: "ok",
      nextCursor: raw.next_page ?? undefined,
    };
  } catch (err) {
    return softFail("google", err, rawRef);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Error handling — soft-fail wrapper
// ──────────────────────────────────────────────────────────────────────

function softFail(
  platform: GtmPlatform,
  err: unknown,
  rawRef: string
): WrapperResult {
  void rawRef;
  if (err instanceof ScrapeCreatorsHttpError) {
    return {
      items: [],
      statusDetail: `${platform}_http_${err.status}`,
    };
  }
  if (err instanceof ScrapeCreatorsRateLimitError) {
    return {
      items: [],
      statusDetail: `${platform}_rate_limited`,
    };
  }
  return {
    items: [],
    statusDetail: `${platform}_error:${(err as Error).message?.slice(0, 200) ?? "unknown"}`,
  };
}
