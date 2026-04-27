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
export type ZernioPlatform =
  | "gbp"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "x"
  | "pinterest"
  | "threads";

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
  /** Body text / caption applied across platforms; per-platform overrides supported. */
  text: string;
  /** Media refs (URLs reachable by Zernio's fetcher). */
  media?: Array<{ url: string; mediaType: "image" | "video" }>;
  /** Optional per-platform overrides (e.g. shorter caption on X). */
  perPlatformOverrides?: Partial<
    Record<ZernioPlatform, { text?: string; cta?: GbpLocalPostInput["cta"] }>
  >;
  /** Schedule for non-immediate post; if absent, post immediately. */
  scheduleAt?: number;
}

export interface MultiPlatformPostResult {
  /** Per-platform results; partial-success returned with `failed: true` rows. */
  perPlatform: Array<{
    platform: ZernioPlatform;
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
/* Webhook event types                                                         */
/* -------------------------------------------------------------------------- */

export type ZernioWebhookEventType =
  | "review.created"
  | "review.updated"
  | "post.scheduled"
  | "post.published"
  | "post.failed"
  | "post.partial"
  | "engagement.received"
  | "account.disconnected"
  // Wave C.6 — GBP Q&A inbound. Maps to Zernio's `question.created` /
  // `question.updated` events for `platform=googlebusiness`. The webhook
  // dispatcher enqueues a `mayaTaskQueue.kind="question.created"` row;
  // Maya's heartbeat picks it up and invokes the Q&A draft variant of
  // `maya-service-review-reply-drafter`.
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
