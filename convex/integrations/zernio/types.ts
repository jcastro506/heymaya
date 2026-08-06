/**
 * Zernio (formerly Late, getlate.dev) — internal type surface.
 *
 * Sprint 1 (service product). These types are HEYMAYA's, not Zernio's raw
 * SDK types. The interface-isolation contract from service plan § 3 (R1
 * Verdict) requires:
 *
 *   - Skill code (Sprint 3+) imports from `convex/integrations/gbp/`,
 *     `convex/integrations/fb/`, `convex/integrations/ig/`, etc. — NEVER
 *     `convex/integrations/zernio/` directly.
 *   - The thin GBP wrapper at `convex/integrations/gbp/zernio.ts` re-exports
 *     a stable GBP-shaped API on top of these endpoints.
 *   - If we have to swap to Ayrshare in <2 weeks (R1 § Verdict), we replace
 *     the implementation behind `convex/integrations/zernio/endpoints.ts`
 *     and the rest of the codebase is untouched.
 *
 * Citations for the API surface assumed here:
 *   - https://docs.getlate.dev/core/posts (post create / multi-platform)
 *   - https://docs.getlate.dev/reviews/list-inbox-reviews (GBP review list)
 *   - https://docs.getlate.dev/comments/send-private-reply-to-comment
 *   - https://docs.getlate.dev/core/webhooks (X-Late-Signature HMAC-SHA256)
 *   - https://getlate.dev/google-business-api (GBP local-post + reply)
 *
 * Several fields are marked [unverified] where the public docs do not pin
 * down the exact shape — the live-smoke test against operator's real Zernio
 * Build-tier subscription is the gate that confirms them.
 */

/* -------------------------------------------------------------------------- */
/* Platforms                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The platforms HeyMaya posts to via Zernio. v0 surface drives behaviors #4
 * (review reply), #5 (GBP cadence), #6 (rejuvenation), #7 (engagement).
 */
/**
 * NOTE on `x`: HeyMaya keeps `x` as the INTERNAL platform name everywhere
 * (schema, plugin, skill prompts). The Zernio connect SLUG for X/Twitter is
 * `twitter` (verified live 2026-06-02: `/connect/x` → 400 "Platform not
 * supported"; `/connect/twitter` → 200). The slug mapping lives in
 * `endpoints.ts` (`PLATFORM_WIRE_SLUG`). For the multi-platform POST body,
 * Zernio accepts the `twitter` platform string on `PlatformTarget.platform`;
 * we send `twitter` there and keep `x` as our own enum value.
 *
 * This 8-member union is the SCHEMA-BOUND surface: it must stay exactly in
 * sync with the `connectedPlatforms[].platform` validator in `oauth.ts` and
 * the `ZERNIO_PLATFORM_VALIDATOR` in `webhooks.ts` (both hand-rolled
 * `v.union(v.literal(...))` lists). Widening THIS union breaks those
 * validator-derived arg types. The auto-post channels `reddit` + `youtube`
 * (S1, Maya v2) therefore live on the wider {@link ZernioPostPlatform} below,
 * which the new posting wrappers (`multiPlatformPost`, `getConnectUrl`) accept.
 */
export type ZernioPlatform =
  | "gbp"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "x"
  | "pinterest"
  | "threads";

/**
 * The full set of platforms HeyMaya can POST to / CONNECT via Zernio's
 * 1.0.4 API. Superset of {@link ZernioPlatform} with the two S1 auto-post
 * channels that are not (yet) in the schema-bound connection enum:
 * `reddit` + `youtube`. Maya v2 offers 6 channels: X / Reddit / LinkedIn /
 * IG / TikTok / YouTube. (gbp / facebook / pinterest / threads ride along as
 * harmless carry-overs from the abandoned service product.)
 *
 * The S1 posting wrappers in `endpoints.ts` are typed against THIS union so
 * `reddit`/`youtube` are first-class for posting + OAuth-connect without
 * widening the narrow schema validators.
 */
export type ZernioPostPlatform = ZernioPlatform | "reddit" | "youtube";

/* -------------------------------------------------------------------------- */
/* Common error class hierarchy                                                */
/* -------------------------------------------------------------------------- */

/**
 * Auth failures: missing API key, expired key, scope revoked, wrong key for
 * the requested platform. Maps to Zernio HTTP 401 / 403.
 */
export class ZernioAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ZernioAuthError";
  }
}

/** Maps to HTTP 429. Surfaces Retry-After (in seconds) when present. */
export class ZernioRateLimitError extends Error {
  constructor(
    public readonly url: string,
    public readonly retryAfterSec: number | null
  ) {
    super(
      `Zernio rate limit for ${url}${
        retryAfterSec !== null ? ` (retry-after: ${retryAfterSec}s)` : ""
      }`
    );
    this.name = "ZernioRateLimitError";
  }
}

/**
 * The underlying social platform rejected the call. Behavior #4 is the
 * load-bearing consumer: Google `ReviewReplyState: REJECTED` MUST surface as
 * a `ZernioPlatformError` with `platformErrorCode: "REVIEW_REPLY_REJECTED"`
 * so the skill re-prompts the operator instead of silently ack-ing.
 *
 * Other examples: Meta blocked a post, GBP image-format rejection, IG
 * rate-limited at the upstream Meta layer (separate from Zernio's own 429),
 * TikTok unaudited-client (post-as-private-only).
 */
export class ZernioPlatformError extends Error {
  constructor(
    public readonly platform: ZernioPlatform,
    public readonly platformErrorCode: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ZernioPlatformError";
  }
}

/**
 * Generic Zernio HTTP error — anything else 4xx/5xx that doesn't fit the
 * narrow auth / rate-limit / platform-rejected buckets above. Includes the
 * URL + status + body snippet for forensics.
 */
export class ZernioApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
    public readonly cause?: unknown
  ) {
    super(`Zernio HTTP ${status} for ${url}: ${body.slice(0, 500)}`);
    this.name = "ZernioApiError";
  }
}

/** Network / timeout failures, distinct from API errors. */
export class ZernioTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Zernio request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "ZernioTimeoutError";
  }
}

/* -------------------------------------------------------------------------- */
/* GBP types                                                                   */
/* -------------------------------------------------------------------------- */

export interface GbpLocationSummary {
  /** Zernio's normalized location id — what we pass back into GBP endpoints. */
  locationId: string;
  /** GBP's own opaque location resource name (e.g. `accounts/.../locations/...`). */
  gbpLocationName?: string;
  /** GBP account id (parent of the location). */
  gbpAccountId?: string;
  name: string;
  address?: string;
  primaryCategory?: string;
  verified?: boolean;
}

export interface GbpReviewSummary {
  reviewId: string;
  /** Zernio's stable id for de-duplication; falls back to `reviewId` when absent. */
  externalReviewId: string;
  reviewerName: string;
  /** 1..5 — Zernio normalizes Google's `STAR_*` enum. */
  starRating: number;
  body: string;
  createdAt: number;
  updatedAt?: number;
  hasReply: boolean;
  replyText?: string;
  /**
   * Google `ReviewReplyState` — observable only after a reply is attempted.
   * Surfaced for the operator approval flow in behavior #4.
   * [unverified] — Zernio docs do not currently pin down whether this field
   * is exposed verbatim or normalized. Verified at live-smoke time.
   */
  replyState?: "PUBLISHED" | "PENDING" | "REJECTED";
}

export type GbpLocalPostType = "STANDARD" | "EVENT" | "OFFER";

export interface GbpLocalPostInput {
  postType: GbpLocalPostType;
  text: string;
  /**
   * GBP supports a small fixed set of CTA types (Learn More / Book / Order /
   * Shop / Sign Up / Call). Zernio normalizes these.
   */
  cta?: {
    type: "LEARN_MORE" | "BOOK" | "ORDER" | "SHOP" | "SIGN_UP" | "CALL";
    url?: string;
  };
  imageUrl?: string;
  /** EVENT / OFFER posts require a schedule window. */
  schedule?: { startAt: number; endAt?: number };
  /** OFFER-only fields. */
  offer?: {
    couponCode?: string;
    redeemOnlineUrl?: string;
    termsConditions?: string;
  };
}

export interface GbpLocalPostResult {
  /** Zernio's id for the local post. */
  postId: string;
  /** Google's resource name once published, e.g. `accounts/.../localPosts/...`. */
  gbpLocalPostId?: string;
  state: "LIVE" | "REJECTED" | "PROCESSING";
  publishedAt?: number;
}

export interface GbpInsightsRequest {
  startAt: number;
  endAt: number;
  /**
   * Zernio's normalized metric set; v0 only consumes a stable subset.
   * [unverified] — the exact metric names are confirmed at live-smoke.
   */
  metrics?: ReadonlyArray<
    | "VIEWS_SEARCH"
    | "VIEWS_MAPS"
    | "ACTIONS_WEBSITE"
    | "ACTIONS_PHONE"
    | "ACTIONS_DRIVING_DIRECTIONS"
    | "PHOTOS_VIEWS"
  >;
}

export interface GbpInsightsResult {
  startAt: number;
  endAt: number;
  metrics: Array<{
    name: string;
    value: number;
  }>;
}

/* -------------------------------------------------------------------------- */
/* Multi-platform / generic post types                                         */
/* -------------------------------------------------------------------------- */

export interface MultiPlatformPostInput {
  /**
   * Body text / caption applied across platforms. Maps to the spec's
   * top-level `content`. Optional at the spec level when media is attached or
   * every target carries `customContent`, but the HeyMaya wrapper still
   * requires it (text-first product) unless `mediaItems` is non-empty.
   */
  text: string;
  /**
   * Spec `title` (used by long-form platforms / titled posts).
   */
  title?: string;
  /**
   * Legacy media refs (pre-S1). The wrapper lifts these into `mediaItems` if
   * `mediaItems` isn't supplied directly. URLs must be reachable by Zernio.
   */
  media?: Array<{ url: string; mediaType: "image" | "video" }>;
  /**
   * Spec `MediaItem[]` — the real attachment shape. Preferred over `media`.
   */
  mediaItems?: MediaItem[];
  /**
   * Per-target settings, keyed by our internal platform name. Lifted onto the
   * matching `PlatformTarget.platformSpecificData` at send time.
   */
  platformData?: Partial<Record<ZernioPostPlatform, ChannelPlatformData>>;
  /**
   * Spec top-level `tiktokSettings`. Applies TikTok options at the post level
   * (in addition to / instead of per-target `platformSpecificData`).
   */
  tiktokSettings?: TikTokPlatformData;
  /**
   * Schedule for non-immediate post (unix-ms). When absent the wrapper sends
   * `publishNow: true`; when present it sends `scheduledFor` (ISO) + `timezone`.
   */
  scheduleAt?: number;
  /** IANA timezone for `scheduledFor` (e.g. "America/New_York"). */
  timezone?: string;
}

/**
 * One target for {@link MultiPlatformPostInput}: which connected account on
 * which platform, optionally with per-target content/media overrides. The
 * wrapper turns this into a spec `PlatformTarget`. `platform` is HeyMaya's
 * internal name (e.g. `x`); the wrapper maps `x` → `twitter` on the wire.
 */
export interface MultiPlatformTarget {
  platform: ZernioPostPlatform;
  accountId: string;
  customContent?: string;
  customMedia?: MediaItem[];
  scheduledFor?: string;
  platformSpecificData?: ChannelPlatformData;
}

export interface MultiPlatformPostResult {
  /** Per-platform results; partial-success returned with `failed: true` rows. */
  perPlatform: Array<{
    platform: ZernioPostPlatform;
    /** Zernio post id (or null if the call failed before id assignment). */
    postId: string | null;
    state: "scheduled" | "published" | "failed";
    error?: string;
  }>;
}

/* -------------------------------------------------------------------------- */
/* FB Pages types                                                              */
/* -------------------------------------------------------------------------- */

export interface FbPageMessageSummary {
  messageId: string;
  pageId: string;
  fromUserId: string;
  fromName?: string;
  body: string;
  receivedAt: number;
  /** Whether the operator has already replied (Zernio aggregates). */
  hasOperatorReply?: boolean;
}

/* -------------------------------------------------------------------------- */
/* IG Business types                                                           */
/* -------------------------------------------------------------------------- */

export interface IgPostInput {
  caption: string;
  /** Single image, multi-image carousel (2-10 images), or video. */
  mediaUrls: string[];
  /** Carousel implies 2+ media URLs. Single-image post = 1. Reel = 1 video. */
  postType: "single" | "carousel" | "reel";
}

export interface IgCommentSummary {
  commentId: string;
  mediaId: string;
  fromUserId: string;
  fromUsername?: string;
  body: string;
  createdAt: number;
  hasOperatorReply?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Zernio API 1.0.4 — spec-matching request/response shapes                    */
/*                                                                            */
/* These mirror the OpenAPI 3.1 components in `docs/zernio_openapi_1.0.4.yaml` */
/* verbatim (camelCase field names, optional unless the spec marks required).  */
/* The auto-post call (`POST /api/v1/posts`) consumes `MediaItem[]` +          */
/* `PlatformTarget[]`; per-platform settings ride on                          */
/* `PlatformTarget.platformSpecificData` (NOT a separate overrides object).    */
/* -------------------------------------------------------------------------- */

/** `components.schemas.MediaItem`. */
export interface MediaItem {
  type: "image" | "video" | "gif" | "document";
  url: string;
  title?: string;
  altText?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  thumbnail?: string;
  instagramThumbnail?: string;
  tiktokProcessed?: boolean;
}

/** `components.schemas.TwitterPlatformData`. */
export interface TwitterPlatformData {
  replyToTweetId?: string;
  quoteTweetId?: string;
  replySettings?: "following" | "mentionedUsers" | "subscribers" | "verified";
  threadItems?: Array<Record<string, unknown>>;
  poll?: Record<string, unknown>;
  longVideo?: boolean;
  geoRestriction?: Record<string, unknown>;
}

/** `components.schemas.RedditPlatformData`. */
export interface RedditPlatformData {
  subreddit?: string;
  title?: string;
  url?: string;
  forceSelf?: boolean;
  flairId?: string;
  nativeVideo?: boolean;
  videogif?: boolean;
  videoPosterUrl?: string;
}

/** `components.schemas.LinkedInPlatformData`. */
export interface LinkedInPlatformData {
  documentTitle?: string;
  organizationUrn?: string;
  firstComment?: string;
  disableLinkPreview?: boolean;
  geoRestriction?: Record<string, unknown>;
}

/**
 * `components.schemas.TikTokPlatformData`. NOTE camelCase
 * (`contentPreviewConfirmed`, NOT snake_case `content_preview_confirmed`).
 * `draft: true` routes to the TikTok Creator Inbox — the safe manual-finish
 * path that avoids the unaudited-client auto-publish restriction.
 */
export interface TikTokPlatformData {
  draft?: boolean;
  privacyLevel?: string;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  commercialContentType?: "none" | "brand_organic" | "brand_content";
  brandPartnerPromote?: boolean;
  isBrandOrganicPost?: boolean;
  contentPreviewConfirmed?: boolean;
  expressConsentGiven?: boolean;
  mediaType?: "video" | "photo";
  videoCoverTimestampMs?: number;
  videoCoverImageUrl?: string;
  photoCoverIndex?: number;
  autoAddMusic?: boolean;
  videoMadeWithAi?: boolean;
  description?: string;
}

/** `components.schemas.InstagramPlatformData`. */
export interface InstagramPlatformData {
  contentType?: "story";
  shareToFeed?: boolean;
  collaborators?: string[];
  firstComment?: string;
  trialParams?: Record<string, unknown>;
  userTags?: Array<Record<string, unknown>>;
  audioName?: string;
  thumbOffset?: number;
  instagramThumbnail?: string;
  reelCover?: string;
}

/** `components.schemas.YouTubePlatformData`. */
export interface YouTubePlatformData {
  title?: string;
  visibility?: "public" | "private" | "unlisted";
  madeForKids?: boolean;
  firstComment?: string;
  containsSyntheticMedia?: boolean;
  categoryId?: string;
  playlistId?: string;
}

/** Union of every per-channel settings shape that rides on a target. */
export type ChannelPlatformData =
  | TwitterPlatformData
  | RedditPlatformData
  | LinkedInPlatformData
  | TikTokPlatformData
  | InstagramPlatformData
  | YouTubePlatformData
  | Record<string, unknown>;

/**
 * `components.schemas.PlatformTarget` — one entry per destination account in
 * the `POST /api/v1/posts` `platforms[]` array. `platform` is the Zernio
 * platform string (e.g. `twitter`, `reddit`, `linkedin`, `instagram`,
 * `tiktok`, `youtube`); `accountId` is the connected social-account id under
 * the profile. The response-side fields (status / platformPostId / ...) are
 * echoed back on read; they're optional on the request.
 */
export interface PlatformTarget {
  platform: string;
  accountId: string;
  customContent?: string;
  customMedia?: MediaItem[];
  scheduledFor?: string;
  platformSpecificData?: ChannelPlatformData;
  // Response-side echo fields (present on GET /posts, absent on create).
  status?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  publishedAt?: string;
  errorMessage?: string;
  errorCategory?: string;
  errorSource?: "user" | "platform" | "system";
}

/**
 * `components.schemas.PostAnalytics`. Per-post normalized engagement metrics.
 * [shape-unverified-live] — modeled from the spec; live shape confirmed at
 * the live-smoke gate.
 */
export interface PostAnalytics {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  views?: number;
  igReelsAvgWatchTime?: number;
  igReelsVideoViewTotalTime?: number;
  engagementRate?: number;
  lastUpdated?: string;
}

/**
 * Result of `GET /api/v1/accounts/follower-stats`. We keep this permissive —
 * the spec returns `{ accounts, dateRange, aggregation }` with deeply nested
 * per-account daily series. [shape-unverified-live].
 */
export interface FollowerStats {
  accounts: Array<Record<string, unknown>>;
  dateRange?: Record<string, unknown>;
  aggregation?: Record<string, unknown>;
}

/**
 * Result of `GET /api/v1/accounts/health`. Spec returns
 * `{ summary: { total, healthy, warning, error, needsReconnect }, accounts }`.
 * [shape-unverified-live].
 */
export interface AccountHealth {
  summary: {
    total?: number;
    healthy?: number;
    warning?: number;
    error?: number;
    needsReconnect?: number;
  };
  accounts: Array<Record<string, unknown>>;
}

/**
 * One row from `GET /api/v1/inbox/comments`. Spec field names are `id` /
 * `content` / `createdTime` etc. [shape-unverified-live].
 */
export interface InboxComment {
  id: string;
  platform?: string;
  accountId?: string;
  accountUsername?: string;
  content?: string;
  permalink?: string | null;
  createdTime?: string;
  commentCount?: number;
  likeCount?: number;
  cid?: string;
}

/**
 * One row from `GET /api/v1/inbox/conversations`. [shape-unverified-live].
 */
export interface Conversation {
  id: string;
  platform?: string;
  accountId?: string;
  accountUsername?: string;
  participantId?: string;
  participantName?: string;
  status?: string;
  lastMessageAt?: string;
}

/**
 * Result of `POST /api/v1/media/presign`. VERIFIED LIVE 2026-08-05.
 *
 * ⭐ **Zernio hosts our media**, which means publishing needs no R2 of our
 * own. That matters: R2 is unconfigured, so the library cannot store anything
 * — and this path publishes anyway.
 */
export interface PresignResult {
  /** Presigned R2 PUT. Valid ~1 hour — upload immediately. */
  uploadUrl: string;
  /** Permanent `media.zernio.com/...` address. This is what a post carries. */
  publicUrl: string;
  key?: string;
}

/**
 * `components.schemas.Profile` (the `profile` field of `ProfileCreateResponse`).
 * A Zernio profile is the umbrella that holds connected accounts.
 */
export interface ZernioProfile {
  _id: string;
  userId?: string;
  name: string;
  description?: string;
  color?: string;
  isDefault?: boolean;
  isOverLimit?: boolean;
  createdAt?: string;
}

/** Result of `GET /api/v1/connect/{slug}` — the OAuth kickoff. */
export interface ConnectUrlResult {
  authUrl: string;
  state: string;
}

/* -------------------------------------------------------------------------- */
/* Webhook event types                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The REAL Zernio 1.0.4 webhook event enum that HeyMaya v2 SUBSCRIBES to via
 * `POST /api/v1/webhooks/settings` `events[]`: post lifecycle + per-platform
 * results + account connect/disconnect + inbox (message / comment / reaction)
 * + GBP reviews.
 *
 * NOTE: there is NO `mention.received` and NO `lead.received` in the spec — do
 * not reference them. `createWebhook` rejects any event NOT in this set.
 *
 * This is SEPARATE from {@link ZernioWebhookEventType} below (the
 * dispatcher/envelope enum) because the latter is the schema-bound surface:
 * `webhooks.ts` validates inbound `type` against a hand-rolled narrow
 * `v.union(v.literal(...))` whose members must stay exactly in sync — widening
 * THAT type breaks the validator-derived arg types. The subscribe-side and
 * dispatch-side enums overlap but aren't identical (e.g. the spec subscribe
 * name is `review.new`, while the legacy dispatcher matches `review.created`).
 */
export type ZernioWebhookSubscribableEvent =
  | "post.published"
  | "post.failed"
  | "post.platform.published"
  | "post.platform.failed"
  | "account.connected"
  | "account.disconnected"
  | "message.received"
  | "comment.received"
  | "reaction.received"
  | "review.new"
  | "review.updated";

/**
 * The webhook event names the inbound `webhooks.ts` dispatcher recognizes.
 * Kept in lock-step with `ZERNIO_EVENT_TYPE_VALIDATOR` in `webhooks.ts`
 * (sibling-file coherence — do not widen without updating that validator).
 */
export type ZernioWebhookEventType =
  | "review.created"
  | "review.updated"
  | "post.scheduled"
  | "post.published"
  | "post.failed"
  | "post.partial"
  | "engagement.received"
  | "account.disconnected"
  // [DEPRECATED 2026-04-27 — never fires]
  // GBP Q&A API was deprecated by Google ("replaced by AI-powered 'Ask
  // Maps'" per Zernio's docs verbatim). The Q&A draft variant of
  // `maya-service-review-reply-drafter` was removed in Path D. These
  // webhook event types stay in the union for additive-schema safety
  // and as defensive handling if Zernio ever delivers stale events,
  // but the dispatcher's normalize function is now a no-op for these
  // — the resulting mayaTaskQueue rows are inert (no skill claims them).
  // See `docs/spikes/zernio-capability-audit.md` and the SKILL.md
  // strikethrough section in maya-service-review-reply-drafter.
  | "question.created"
  | "question.updated"
  | "webhook.test";

/**
 * Normalized webhook envelope — what our `webhooks.ts` parser produces from
 * Zernio's raw delivery. The raw delivery shape varies by event; we narrow
 * to a small stable surface here so consumers don't have to re-parse Zernio
 * field names.
 */
export interface ZernioWebhookEnvelope {
  /** Zernio's `id` field on the webhook delivery — used for idempotency. */
  externalEventId: string;
  type: ZernioWebhookEventType;
  /** ISO timestamp from Zernio, normalized to unix-ms. */
  occurredAt: number;
  /** Platform context (when relevant). */
  platform?: ZernioPlatform;
  /** Account context — Zernio account id this event belongs to. */
  zernioAccountId?: string;
  /** Free-shape event payload (consumer parses with a per-kind Zod schema). */
  data: Record<string, unknown>;
  /** Original raw body, preserved for forensics. */
  raw: unknown;
}
