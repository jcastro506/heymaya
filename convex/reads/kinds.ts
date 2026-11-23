/**
 * The read registry (plan §3.2): every vendor read has a kind, a TTL, whether it is
 * shared across tenants, and the wrapper it calls. Nothing outside `read()` may call
 * a wrapper; an import-boundary test asserts it.
 */

import { tiktok, extractClipId, soundFacts, postSound } from "../integrations/scrapeCreators/platforms/tiktok";
import { profilesResult, tiktokFollowingProfiles, tiktokPopularProfiles } from "./profiles";
import { cross } from "../integrations/scrapeCreators/platforms/cross";
import { commerce } from "../integrations/scrapeCreators/platforms/commerce";
import type { EndpointDeps } from "../integrations/scrapeCreators/deps";
import { normalizeHandle } from "./key";

const H = 60 * 60 * 1000;
const D = 24 * H;

/** Rows still carry "instagram" (schema); a read only ever runs for TikTok. */
export type Platform = "tiktok" | "instagram";

/** TikTok only: anything else never reaches the vendor. */
function tiktokOnly(platform: Platform): void {
  if (platform !== "tiktok") throw new Error(`TikTok only: ${platform}`);
}

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

/** Each post keeps its sound outside `raw` (the cache slims `raw`): `clipId` for the sound signals, `sound` for trends. */
function withSounds<R extends { posts: Array<{ raw?: unknown }> }>(r: R): R {
  return { ...r, posts: r.posts.map((post) => { const sound = postSound(post.raw); return { ...post, clipId: sound?.clipId ?? null, sound }; }) };
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

  // ---- lane searches, shared by keyword
  "search.keyword": spec<{ keyword: string; window: "yesterday" | "this-week" | "this-month"; sort: "most-liked" | "date-posted" | "relevance"; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/keyword",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), window: p.window, sort: p.sort, region: (p.region ?? "US").toUpperCase() }),
    // Untrimmed: a trimmed post has no sound, and the sound is the trend (2026-10-13). Same credit; the cache slims it.
    call: async (p, deps) => withSounds(await tiktok.searchKeyword(p.keyword, { ...deps, datePosted: p.window, sortBy: p.sort, region: p.region })),
  }),
  "search.hashtag": spec<{ hashtag: string; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/hashtag",
    normalize: (p) => ({ hashtag: p.hashtag.replace(/^#/, "").toLowerCase(), region: (p.region ?? "US").toUpperCase() }),
    call: async (p, deps) => withSounds(await tiktok.searchHashtag(p.hashtag, { ...deps, region: p.region })),
  }),
  "search.top": spec<{ keyword: string; window: "yesterday" | "this-week" | "this-month"; sort: "most-liked" | "date-posted"; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/top",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), window: p.window, sort: p.sort, region: (p.region ?? "US").toUpperCase() }),
    call: (p, deps) => tiktok.searchTop(p.keyword, { ...deps, datePosted: p.window, sortBy: p.sort, region: p.region }),
  }),
  "suggestions.tiktok": spec<{ keyword: string; region?: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/search/suggestions",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase(), region: (p.region ?? "US").toUpperCase() }),
    call: (p, deps) => tiktok.searchSuggestions(p.keyword, { ...deps, region: p.region }),
  }),
  "reddit.search": spec<{ keyword: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/reddit/search",
    normalize: (p) => ({ keyword: p.keyword.trim().toLowerCase() }),
    call: (p, deps) => cross.redditSearch(p.keyword, { ...deps, filter: "posts", sort: "top", timeframe: "week" }),
  }),

  // ---- where the money is (deals, 2026-10-12): shared by keyword, a few days fresh
  "shop.search": spec<{ query: string }>({
    ttlMs: 3 * D,
    shared: true,
    path: "/v1/tiktok/shop/search",
    normalize: (p) => ({ query: p.query.trim().toLowerCase() }),
    call: (p, deps) => commerce.shopSearch(p.query, deps),
  }),
  "ads.tiktok": spec<{ query: string }>({
    ttlMs: 3 * D,
    shared: true,
    path: "/v1/tiktok/ad-library/search",
    normalize: (p) => ({ query: p.query.trim().toLowerCase() }),
    call: (p, deps) => commerce.tiktokAdLibrary(p.query, deps),
  }),
  "ads.meta": spec<{ query: string }>({
    ttlMs: 3 * D,
    shared: true,
    path: "/v1/facebook/adLibrary/search/ads",
    normalize: (p) => ({ query: p.query.trim().toLowerCase() }),
    call: (p, deps) => commerce.metaAdLibrary(p.query, deps),
  }),

  // ---- accounts, shared by handle
  "profile": spec<{ platform: Platform; handle: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/tiktok/profile",
    normalize: (p) => ({ platform: p.platform, handle: normalizeHandle(p.handle) }),
    call: (p, deps) => { tiktokOnly(p.platform); return tiktok.profile(p.handle, deps); },
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
      tiktokOnly(p.platform);
      const posts = await tiktok.lastPosts(p.handle, 0, deps); // page one; cursor paging arrives with the sampler
      return posts.map((post) => ({ ...post, clipId: extractClipId(post.raw) }));
    },
  }),
  "account.following": spec<{ handle: string }>({
    ttlMs: 30 * D,
    shared: false,
    path: "/v1/tiktok/user/following",
    normalize: (p) => ({ handle: normalizeHandle(p.handle) }),
    // §27: profiles from the vendor payload (follower counts, avatars), keeping the client's `users` for any older reader.
    call: async (p, deps) => {
      const r = await tiktok.following(p.handle, deps);
      const fromUsers = () => r.users.filter((u) => u.handle).map((u) => ({ platform: "tiktok" as const, handle: u.handle!.toLowerCase(), displayName: u.nickname, followerCount: null, avatarUrl: null, bio: null, isPrivate: false }));
      const out = profilesResult({ source: "tiktok_user_following", raw: r.raw }, (raw) => { const full = tiktokFollowingProfiles(raw); return full.length ? full : fromUsers(); });
      return { ...out, users: r.users, count: r.count, total: r.total };
    },
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
    call: async (p, deps) => profilesResult(await tiktok.popularCreators({ ...deps, followerCount: p.band, creatorCountry: p.country, audienceCountry: p.country, sortBy: "engagement", page: p.page }), tiktokPopularProfiles),
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
      tiktokOnly(p.platform);
      const m = p.url.match(/@([^/]+)\/video\/(\d+)/);
      if (!m) throw new Error(`not a TikTok video url: ${p.url}`);
      return tiktok.post(m[1], m[2], deps);
    },
  }),
  "post.transcript": spec<{ platform: Platform; url: string }>({
    ttlMs: 365 * D, // transcripts do not change
    shared: true,
    path: "/v1/tiktok/video/transcript",
    normalize: (p) => ({ platform: p.platform, url: p.url.trim() }),
    call: (p, deps) => {
      tiktokOnly(p.platform);
      const m = p.url.match(/@([^/]+)\/video\/(\d+)/);
      if (!m) throw new Error(`not a TikTok video url: ${p.url}`);
      return tiktok.transcript(m[1], m[2], deps);
    },
  }),
  "post.comments": spec<{ platform: Platform; url: string }>({
    ttlMs: 7 * D,
    shared: true,
    path: "/v1/tiktok/video/comments",
    normalize: (p) => ({ platform: p.platform, url: p.url.trim() }),
    call: (p, deps) => {
      tiktokOnly(p.platform);
      const m = p.url.match(/@([^/]+)\/video\/(\d+)/);
      if (!m) throw new Error(`not a TikTok video url: ${p.url}`);
      return tiktok.comments(m[1], m[2], deps);
    },
  }),

  // ---- sounds
  "sound.tiktok": spec<{ clipId: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/song",
    normalize: (p) => ({ clipId: String(p.clipId) }),
    // The facts ride outside `raw`: the cache drops `raw`, and every repeat lookup used to come back empty.
    call: async (p, deps) => {
      const r = await tiktok.song(p.clipId, deps);
      return { ...r, sound: soundFacts(r.raw) };
    },
  }),
  "sound.tiktokVideos": spec<{ clipId: string }>({
    ttlMs: 24 * H,
    shared: true,
    path: "/v1/tiktok/song/videos",
    normalize: (p) => ({ clipId: String(p.clipId) }),
    call: async (p, deps) => withSounds(await tiktok.songVideos(p.clipId, deps)),
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

/** Vendor path for the credit table. */
export function pathFor(kind: ReadKind, _params: Record<string, unknown>): string {
  return KINDS[kind].path;
}
