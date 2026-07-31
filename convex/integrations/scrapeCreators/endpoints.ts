/**
 * Typed wrappers around the ScrapeCreators endpoints we use in v0.
 *
 * We intentionally model ONLY the fields Maya consumes downstream. ScrapeCreators frequently
 * adds upstream platform fields and returns deeply-nested raw payloads — pinning to a narrow,
 * Zod-validated subset means schema drift fails loud (in tests + at runtime) instead of
 * silently corrupting the creator picture.
 *
 * Endpoint paths are based on https://docs.scrapecreators.com (sprint 1 docs read).
 * Where the upstream wraps results in `{ data: ... }` or `{ success, ... }`, we use Zod
 * `passthrough()` + extract the canonical shape.
 *
 * If an endpoint changes shape upstream, the Zod parser throws — caller catches in
 * `runFullScrapePull` and degrades gracefully (Sprint 7 failure-mode work).
 */

export * from "./schemas";
export * from "./deps";
export { tiktok, tiktokVideoUrl } from "./platforms/tiktok";
export type {
  TikTokDatePosted,
  TikTokSortBy,
  TikTokSearchKeywordOptions,
  TikTokSearchHashtagOptions,
} from "./platforms/tiktok";
export { instagram } from "./platforms/instagram";
export { youtube } from "./platforms/youtube";
export { linkedin } from "./platforms/linkedin";
export { x } from "./platforms/x";

import type {
  EndpointDeps,
} from "./deps";
import type {
  NormalizedPost,
  NormalizedProfile,
  Platform,
} from "./schemas";
import { tiktok } from "./platforms/tiktok";
import { instagram } from "./platforms/instagram";
import { youtube } from "./platforms/youtube";
import { linkedin } from "./platforms/linkedin";
import { x } from "./platforms/x";

/* Platform dispatch — used by `runFullScrapePull`                            */
/* -------------------------------------------------------------------------- */

export interface PlatformReader {
  profile(handle: string, deps?: EndpointDeps): Promise<NormalizedProfile>;
  lastPosts(
    handle: string,
    limit: number,
    deps?: EndpointDeps
  ): Promise<NormalizedPost[]>;
}

export const PLATFORM_READERS: Record<Platform, PlatformReader> = {
  tiktok: {
    profile: tiktok.profile,
    lastPosts: tiktok.lastPosts,
  },
  instagram: {
    profile: instagram.profile,
    lastPosts: instagram.lastPosts,
  },
  youtube: {
    profile: youtube.channel,
    lastPosts: youtube.recentVideos,
  },
  linkedin: {
    profile: linkedin.profile,
    lastPosts: linkedin.recentPosts,
  },
  x: {
    profile: x.profile,
    lastPosts: x.recentPosts,
  },
};
