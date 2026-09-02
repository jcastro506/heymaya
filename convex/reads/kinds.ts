/**
 * The read registry (plan §3.2): every vendor read has a kind, a TTL, whether it is
 * shared across tenants, and the wrapper it calls. Nothing outside `read()` may call
 * a wrapper; an import-boundary test asserts it.
 */

import { tiktok, extractClipId } from "../integrations/scrapeCreators/platforms/tiktok";
import { instagram } from "../integrations/scrapeCreators/platforms/instagram";
import { cross } from "../integrations/scrapeCreators/platforms/cross";
import type { EndpointDeps } from "../integrations/scrapeCreators/deps";
import { normalizeHandle } from "./key";

const H = 60 * 60 * 1000;
const D = 24 * H;

export type Platform = "tiktok" | "instagram";

export interface KindSpec<P extends Record<string, unknown> = Record<string, unknown>> {
  ttlMs: number;
  /** Shared across creators (true) or private to one creator (false). Private kinds are still cached. */
  shared: boolean;
  /** Vendor path, for the credit table. */
  path: string;
  /** Normalize params so equivalent requests share a key. */
  normalize: (p: P) => P;
  call: (p: P, deps: EndpointDeps) => Promise<unknown>;
}

function spec<P extends Record<string, unknown>>(s: KindSpec<P>): KindSpec<P> {
  return s;
}

export const KINDS = {
  // ---- trend surfaces, fleet-wide
  "trending.tiktok": spec<{ region: string }>({
    ttlMs: 6 * H,
    shared: true,
    path: "/v1/tiktok/get-trending-feed",
    normalize: (p) => ({ region: p.region.toUpperCase() }),
    call: (p, deps) => tiktok.trendingFeed(p.region, { ...deps, trim: true }),
  }),
  "trending.reels": spec<{ batch: number }>({
    ttlMs: 6 * H,
    shared: true,
    path: "/v1/instagram/reels/trending",
    normalize: (p) => ({ batch: p.batch }), // batch index lets the sweep pull several overlapping batches a day
    call: (_p, deps) => instagram.reelsTrending(deps),
  }),

  // ---- lane searches, shared by keyword
  "search.keyword": spec<{ keyword: string; window: "yesterday" | "this-week" | "this-month"; sort: "most-liked" | "date-posted"; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/keyword",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), window: p.window, sort: p.sort, region: (p.region ?? "US").toUpperCase() }),
    call: (p, deps) => tiktok.searchKeyword(p.keyword, { ...deps, datePosted: p.window, sortBy: p.sort, region: p.region, trim: true }),
  }),
  "search.hashtag": spec<{ hashtag: string; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/hashtag",
    normalize: (p) => ({ hashtag: p.hashtag.replace(/^#/, "").toLowerCase(), region: (p.region ?? "US").toUpperCase() }),
    call: (p, deps) => tiktok.searchHashtag(p.hashtag, { ...deps, region: p.region, trim: true }),
  }),
  "search.top": spec<{ keyword: string; window: "yesterday" | "this-week" | "this-month"; sort: "most-liked" | "date-posted"; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/top",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), window: p.window, sort: p.sort, region: (p.region ?? "US").toUpperCase() }),
    call: (p, deps) => tiktok.searchTop(p.keyword, { ...deps, datePosted: p.window, sortBy: p.sort, region: p.region }),
  }),
  "search.reels": spec<{ keyword: string; window: "last-week" | "last-month"; page?: number }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v2/instagram/reels/search",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), window: p.window, page: p.page ?? 1 }),
    call: (p, deps) => instagram.reelsSearch(p.keyword, { ...deps, datePosted: p.window, page: p.page }),
  }),
  "search.hashtagPosts": spec<{ hashtag: string; window: "last-week" | "last-month" }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/instagram/search/hashtag",
    normalize: (p) => ({ hashtag: p.hashtag.replace(/^#/, "").toLowerCase(), window: p.window }),
    call: (p, deps) => instagram.searchHashtag(p.hashtag, { ...deps, datePosted: p.window, mediaType: "reels" }),
  }),
  "ig.popular": spec<{ topic: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/instagram/search/popular",
    normalize: (p) => ({ topic: p.topic.trim().toLowerCase() }),
    call: (p, deps) => instagram.searchPopular(p.topic, deps),
  }),
  "suggestions.tiktok": spec<{ keyword: string; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/suggestions",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), region: (p.region ?? "US").toUpperCase() }),
    call: (p, deps) => tiktok.searchSuggestions(p.keyword, { ...deps, region: p.region }),
  }),
  "suggestions.instagram": spec<{ keyword: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/instagram/search",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase() }),
    call: (p, deps) => instagram.search(p.keyword, deps),
  }),
  "reddit.search": spec<{ keyword: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/reddit/search",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase() }),
    call: (p, deps) => cross.redditSearch(p.keyword, { ...deps, filter: "posts", sort: "top", timeframe: "week" }),
  }),

  // ---- accounts, shared by handle
  "profile": spec<{ platform: Platform; handle: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/tiktok/profile",
    normalize: (p) => ({ platform: p.platform, handle: normalizeHandle(p.handle) }),
    call: (p, deps) => (p.platform === "tiktok" ? tiktok.profile(p.handle, deps) : instagram.profile(p.handle, deps)),
  }),
  "profile.region": spec<{ handle: string }>({
    ttlMs: 30 * D,
    shared: true,
    path: "/v1/tiktok/profile/region",
    normalize: (p) => ({ handle: normalizeHandle(p.handle) }),
    call: (p, deps) => tiktok.profileRegion(p.handle, deps),
  }),
  /** The tracked-account sampler and the own-catalogue read share this kind; TTL is decided by the caller's `slot`. */
  "account.posts": spec<{ platform: Platform; handle: string; sort: "latest" | "popular"; cursor?: string; slot: string }>({
    ttlMs: 6 * H,
    shared: true,
    path: "/v3/tiktok/profile/videos",
    normalize: (p) => ({ platform: p.platform, handle: normalizeHandle(p.handle), sort: p.sort, cursor: p.cursor, slot: p.slot }),
    call: async (p, deps) => {
      if (p.platform === "tiktok") {
        const posts = await tiktok.lastPosts(p.handle, 0, deps); // page one; cursor paging arrives with the sampler
        return posts.map((post) => ({ ...post, clipId: extractClipId(post.raw) }));
      }
      return instagram.userReels(p.handle, { ...deps, maxId: p.cursor, trim: true });
    },
  }),
  "account.following": spec<{ handle: string }>({
    ttlMs: 30 * D,
    shared: false,
    path: "/v1/tiktok/user/following",
    normalize: (p) => ({ handle: normalizeHandle(p.handle) }),
    call: (p, deps) => tiktok.following(p.handle, deps),
  }),
  "account.highlights": spec<{ handle: string }>({
    ttlMs: 30 * D,
    shared: false,
    path: "/v1/instagram/user/highlights",
    normalize: (p) => ({ handle: normalizeHandle(p.handle) }),
    call: (p, deps) => instagram.highlights(p.handle, deps),
  }),
  "account.collection": spec<{ url: string }>({
    ttlMs: 30 * D,
    shared: false,
    path: "/v1/tiktok/collection/videos",
    normalize: (p) => ({ url: p.url.trim() }),
    call: (p, deps) => tiktok.collectionVideos(p.url, deps),
  }),
  "discover.creators": spec<{ band: "10K-100K" | "100K-1M" | "1M-10M" | "10M+"; country: string; page?: number }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/tiktok/creators/popular",
    normalize: (p) => ({ band: p.band, country: p.country.toUpperCase(), page: p.page ?? 1 }),
    call: (p, deps) => tiktok.popularCreators({ ...deps, followerCount: p.band, creatorCountry: p.country, audienceCountry: p.country, sortBy: "engagement", page: p.page }),
  }),
  "discover.profiles": spec<{ keyword: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/instagram/search/profiles",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase() }),
    call: (p, deps) => instagram.searchProfiles(p.keyword, deps),
  }),
  "social.profiles": spec<{ platform: Platform; handle: string }>({
    ttlMs: 30 * D,
    shared: true,
    path: "/v1/find-social-profiles",
    normalize: (p) => ({ platform: p.platform, handle: normalizeHandle(p.handle) }),
    call: (p, deps) => cross.findSocialProfiles(p.platform, p.handle, deps),
  }),

  // ---- posts, shared by post id / url
  "post.info": spec<{ platform: Platform; url: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v2/tiktok/video",
    normalize: (p) => ({ platform: p.platform, url: p.url.trim() }),
    call: (p, deps) => {
      if (p.platform === "tiktok") {
        const m = p.url.match(/@([^/]+)\/video\/(\d+)/);
        if (!m) throw new Error(`not a TikTok video url: ${p.url}`);
        return tiktok.post(m[1], m[2], deps);
      }
      return instagram.post(p.url, deps);
    },
  }),
  "post.transcript": spec<{ platform: Platform; url: string }>({
    ttlMs: 365 * D, // transcripts do not change
    shared: true,
    path: "/v1/tiktok/video/transcript",
    normalize: (p) => ({ platform: p.platform, url: p.url.trim() }),
    call: (p, deps) => {
      if (p.platform === "tiktok") {
        const m = p.url.match(/@([^/]+)\/video\/(\d+)/);
        if (!m) throw new Error(`not a TikTok video url: ${p.url}`);
        return tiktok.transcript(m[1], m[2], deps);
      }
      return instagram.mediaTranscript(p.url, deps);
    },
  }),
  "post.comments": spec<{ platform: Platform; url: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/tiktok/video/comments",
    normalize: (p) => ({ platform: p.platform, url: p.url.trim() }),
    call: (p, deps) => {
      if (p.platform === "tiktok") {
        const m = p.url.match(/@([^/]+)\/video\/(\d+)/);
        if (!m) throw new Error(`not a TikTok video url: ${p.url}`);
        return tiktok.comments(m[1], m[2], deps);
      }
      return instagram.postComments(p.url, deps);
    },
  }),

  // ---- sounds
  "sound.tiktok": spec<{ clipId: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/song",
    normalize: (p) => ({ clipId: String(p.clipId) }),
    call: (p, deps) => tiktok.song(p.clipId, deps),
  }),
  "sound.tiktokVideos": spec<{ clipId: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/song/videos",
    normalize: (p) => ({ clipId: String(p.clipId) }),
    call: (p, deps) => tiktok.songVideos(p.clipId, deps),
  }),
  "sound.reels": spec<{ audioId: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/instagram/audio/reels",
    normalize: (p) => ({ audioId: String(p.audioId) }),
    call: (p, deps) => instagram.audioReels(p.audioId, deps),
  }),

  // ---- account, 0 credits
  "vendor.credits": spec<Record<string, never>>({
    ttlMs: 5 * 60 * 1000,
    shared: true,
    path: "/v1/credit-balance",
    normalize: () => ({}) as Record<string, never>,
    call: (_p, deps) => cross.creditBalance(deps),
  }),
} as const;

export type ReadKind = keyof typeof KINDS;
export type ParamsOf<K extends ReadKind> = (typeof KINDS)[K] extends KindSpec<infer P> ? P : never;

/** Per-platform vendor path when a kind spans both platforms (for the credit table). */
export function pathFor(kind: ReadKind, params: Record<string, unknown>): string {
  const platform = params.platform as Platform | undefined;
  switch (kind) {
    case "profile":
      return platform === "instagram" ? "/v1/instagram/profile" : "/v1/tiktok/profile";
    case "account.posts":
      return platform === "instagram" ? "/v1/instagram/user/reels" : "/v3/tiktok/profile/videos";
    case "post.info":
      return platform === "instagram" ? "/v1/instagram/post" : "/v2/tiktok/video";
    case "post.transcript":
      return platform === "instagram" ? "/v2/instagram/media/transcript" : "/v1/tiktok/video/transcript";
    case "post.comments":
      return platform === "instagram" ? "/v2/instagram/post/comments" : "/v1/tiktok/video/comments";
    default:
      return KINDS[kind].path;
  }
}
