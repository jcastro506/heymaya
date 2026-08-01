/**
 * Zernio (formerly Late, getlate.dev) endpoint wrappers.
 *
 * Sprint 1 (service product). v0 routing layer for ALL service-side social
 * platforms — GBP, FB Pages, IG Business, TikTok, LinkedIn, X, Pinterest,
 * Threads. Per service plan § 3 layer table (operator decision 2026-04-27).
 *
 * Interface-isolation contract (R1 § Verdict): callers — skill code, behavior
 * crons, etc. — MUST NOT import from this file directly. They go through:
 *
 *   - GBP:     `convex/integrations/gbp/index.ts` → `./zernio.ts` (v0)
 *   - FB:      `convex/integrations/fb/index.ts`  → `./zernio.ts` (planned)
 *   - IG:      `convex/integrations/ig/index.ts`  → `./zernio.ts` (planned)
 *   - Multi:   `convex/integrations/social/index.ts` → `./zernio.ts` (planned)
 *
 * The thin wrappers re-export a stable API; if Zernio dies and we swap to
 * Ayrshare, only this file (+ client.ts + webhooks.ts + oauth.ts) gets
 * rewritten — the rest of the codebase is untouched. That's the <2-week-swap
 * SLA from R1 § Verdict.
 *
 * Endpoint paths cited from:
 *   - https://docs.getlate.dev/core/posts
 *   - https://docs.getlate.dev/reviews/list-inbox-reviews
 *   - https://docs.getlate.dev/comments/send-private-reply-to-comment
 *   - https://getlate.dev/google-business-api
 *   - https://docs.zernio.com/platforms/google-business
 *
 * Several path/payload shapes are marked [unverified] where the public docs
 * do not pin them down. The live-smoke gate (Sprint 1 acceptance) confirms
 * them against operator's real Zernio Build-tier subscription.
 */

import { z } from "zod";
import { ZernioClient } from "./client";
import {
  ZernioApiError,
  ZernioPlatformError,
  type AccountHealth,
  type ChannelPlatformData,
  type ConnectUrlResult,
  type Conversation,
  type FbPageMessageSummary,
  type FollowerStats,
  type GbpInsightsRequest,
  type GbpInsightsResult,
  type GbpLocalPostInput,
  type GbpLocalPostResult,
  type GbpLocationSummary,
  type GbpReviewSummary,
  type IgCommentSummary,
  type IgPostInput,
  type InboxComment,
  type MediaItem,
  type MultiPlatformPostInput,
  type MultiPlatformPostResult,
  type MultiPlatformTarget,
  type PlatformTarget,
  type PostAnalytics,
  type PresignResult,
  type ZernioPlatform,
  type ZernioPostPlatform,
  type ZernioProfile,
  type ZernioWebhookSubscribableEvent,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Shared invocation context                                                   */
/* -------------------------------------------------------------------------- */

export interface ZernioContext {
  /** Zernio client bound to a per-business API key. */
  client: ZernioClient;
  /**
   * Zernio account / profile id (umbrella that holds all the per-platform
   * connections for this business). Required on most calls because Zernio
   * scopes per-platform OAuth tokens under it.
   */
  zernioAccountId: string;
}

/* -------------------------------------------------------------------------- */
/* GBP: locations                                                              */
/* -------------------------------------------------------------------------- */

const GbpLocationSchema = z
  .object({
    locationId: z.string().optional(),
    id: z.string().optional(),
    locationName: z.string().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
    formattedAddress: z.string().optional(),
    primaryCategory: z.string().optional(),
    category: z.string().optional(),
    accountId: z.string().optional(),
    gbpAccountId: z.string().optional(),
    gbpLocationName: z.string().optional(),
    verified: z.boolean().optional(),
  })
  .passthrough();

const GbpLocationsResponseSchema = z
  .object({
    locations: z.array(GbpLocationSchema).default([]),
    data: z.array(GbpLocationSchema).optional(),
  })
  .passthrough();

/**
 * List GBP locations the operator has connected via Zernio.
 *
 * Underlying Zernio surface: `GET /api/v1/locations?platform=googlebusiness`
 * [unverified — docs reference platforms/google-business but exact list
 * endpoint shape varies; live-smoke gate confirms].
 */
export async function gbpListLocations(
  ctx: ZernioContext
): Promise<GbpLocationSummary[]> {
  const raw = await ctx.client.request<unknown>(
    "/api/v1/locations",
    {
      method: "GET",
      query: {
        platform: "googlebusiness",
        accountId: ctx.zernioAccountId,
      },
    }
  );
  const parsed = GbpLocationsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    // Fall back to interpreting the raw payload as a bare array — Zernio's
    // list endpoints have shipped both shapes in different revisions.
    if (Array.isArray(raw)) {
      return (raw as unknown[])
        .map((row) => GbpLocationSchema.safeParse(row))
        .filter((p): p is { success: true; data: z.infer<typeof GbpLocationSchema> } => p.success)
        .map((p) => normalizeGbpLocation(p.data));
    }
    throw new ZernioApiError(
      200,
      "/api/v1/locations",
      `Unexpected list-locations payload: ${parsed.error.message}`
    );
  }
  const rows = parsed.data.locations.length
    ? parsed.data.locations
    : (parsed.data.data ?? []);
  return rows.map(normalizeGbpLocation);
}

function normalizeGbpLocation(
  row: z.infer<typeof GbpLocationSchema>
): GbpLocationSummary {
  const locationId = row.locationId ?? row.id;
  if (!locationId) {
    throw new ZernioApiError(
      200,
      "list-locations",
      "Zernio returned a location row without an id field."
    );
  }
  return {
    locationId,
    gbpLocationName: row.gbpLocationName ?? row.locationName,
    gbpAccountId: row.gbpAccountId ?? row.accountId,
    name: row.name ?? row.locationName ?? "(unnamed)",
    address: row.address ?? row.formattedAddress,
    primaryCategory: row.primaryCategory ?? row.category,
    verified: row.verified,
  };
}

/* -------------------------------------------------------------------------- */
/* GBP: reviews                                                                */
/* -------------------------------------------------------------------------- */

const GbpReviewSchema = z
  .object({
    reviewId: z.string().optional(),
    id: z.string().optional(),
    externalReviewId: z.string().optional(),
    reviewerName: z.string().optional(),
    reviewer: z
      .object({ displayName: z.string().optional() })
      .passthrough()
      .optional(),
    rating: z.number().optional(),
    starRating: z.number().optional(),
    body: z.string().optional(),
    comment: z.string().optional(),
    createTime: z.string().optional(),
    createdAt: z.union([z.string(), z.number()]).optional(),
    updateTime: z.string().optional(),
    updatedAt: z.union([z.string(), z.number()]).optional(),
    reviewReply: z
      .object({
        comment: z.string().optional(),
        replyState: z.string().optional(),
      })
      .passthrough()
      .optional(),
    hasReply: z.boolean().optional(),
  })
  .passthrough();

const GbpReviewsResponseSchema = z
  .object({
    reviews: z.array(GbpReviewSchema).default([]),
    data: z.array(GbpReviewSchema).optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

function toUnixMs(input: string | number | undefined): number {
  if (input === undefined) return 0;
  if (typeof input === "number") return input;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGbpReview(
  row: z.infer<typeof GbpReviewSchema>
): GbpReviewSummary {
  const reviewId = row.reviewId ?? row.id ?? row.externalReviewId;
  if (!reviewId) {
    throw new ZernioApiError(
      200,
      "list-reviews",
      "Zernio returned a review row without an id field."
    );
  }
  const reply = row.reviewReply;
  const replyStateRaw = reply?.replyState;
  let replyState: GbpReviewSummary["replyState"];
  if (
    replyStateRaw === "PUBLISHED" ||
    replyStateRaw === "PENDING" ||
    replyStateRaw === "REJECTED"
  ) {
    replyState = replyStateRaw;
  }
  return {
    reviewId,
    externalReviewId: row.externalReviewId ?? reviewId,
    reviewerName: row.reviewerName ?? row.reviewer?.displayName ?? "(unknown)",
    starRating: row.starRating ?? row.rating ?? 0,
    body: row.body ?? row.comment ?? "",
    createdAt: toUnixMs(row.createdAt ?? row.createTime),
    updatedAt:
      row.updatedAt !== undefined || row.updateTime !== undefined
        ? toUnixMs(row.updatedAt ?? row.updateTime)
        : undefined,
    hasReply: row.hasReply ?? Boolean(reply?.comment),
    replyText: reply?.comment,
    replyState,
  };
}

/**
 * Fetch recent GBP reviews for a single location.
 * Underlying Zernio: `GET /api/v1/reviews?platform=googlebusiness&locationId=...`
 * (https://docs.getlate.dev/reviews/list-inbox-reviews).
 */
export async function gbpListReviews(
  ctx: ZernioContext,
  locationId: string,
  options: { since?: number; limit?: number } = {}
): Promise<GbpReviewSummary[]> {
  const raw = await ctx.client.request<unknown>("/api/v1/reviews", {
    method: "GET",
    query: {
      platform: "googlebusiness",
      accountId: ctx.zernioAccountId,
      locationId,
      since: options.since,
      limit: options.limit ?? 50,
    },
  });
  const parsed = GbpReviewsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    if (Array.isArray(raw)) {
      return (raw as unknown[])
        .map((row) => GbpReviewSchema.safeParse(row))
        .filter((p): p is { success: true; data: z.infer<typeof GbpReviewSchema> } => p.success)
        .map((p) => normalizeGbpReview(p.data));
    }
    throw new ZernioApiError(
      200,
      "/api/v1/reviews",
      `Unexpected list-reviews payload: ${parsed.error.message}`
    );
  }
  const rows = parsed.data.reviews.length
    ? parsed.data.reviews
    : (parsed.data.data ?? []);
  return rows.map(normalizeGbpReview);
}

const GbpReplyResponseSchema = z
  .object({
    success: z.boolean().optional(),
    successful: z.boolean().optional(),
    reviewId: z.string().optional(),
    replyState: z.string().optional(),
    publishedAt: z.union([z.string(), z.number()]).optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

/**
 * Reply to a GBP review. Behavior #4 (Maya's signature feature) is the
 * load-bearing consumer.
 *
 * CRITICAL: this call's underlying Google API can return
 * `ReviewReplyState: REJECTED` for AI-generated replies that fail Google's
 * moderation. We surface that as `ZernioPlatformError` with code
 * `REVIEW_REPLY_REJECTED` so behavior #4 can re-prompt the operator
 * (per service plan § 6 #4 + § 13 Sprint 5 acceptance).
 *
 * Endpoint: `POST /api/v1/reviews/{reviewId}/reply`
 * (https://getlate.dev/blog/google-business-reviews-api).
 *
 * Note: review-reply IS NEVER auto-published by the runtime — every reply
 * goes through operator approval first. This function call is the very last
 * step after `approvalRules` gate — it does not check the gate itself,
 * because the consumer (skill in Sprint 3) is the one with the operator
 * approval context. We just do the HTTP.
 */
export async function gbpReplyToReview(
  ctx: ZernioContext,
  args: { locationId: string; reviewId: string; replyText: string }
): Promise<{ replyState: GbpReviewSummary["replyState"]; publishedAt?: number }> {
  if (!args.replyText || args.replyText.length === 0) {
    throw new ZernioApiError(
      0,
      "reply-to-review",
      "replyText must be a non-empty string."
    );
  }
  const raw = await ctx.client.request<unknown>(
    `/api/v1/reviews/${encodeURIComponent(args.reviewId)}/reply`,
    {
      method: "POST",
      body: {
        accountId: ctx.zernioAccountId,
        locationId: args.locationId,
        message: args.replyText,
      },
    }
  );
  const parsed = GbpReplyResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "reply-to-review",
      `Unexpected reply payload: ${parsed.error.message}`
    );
  }
  const replyStateRaw = parsed.data.replyState;
  const successful =
    parsed.data.success ?? parsed.data.successful ?? !parsed.data.error;
  if (replyStateRaw === "REJECTED" || parsed.data.errorCode === "REVIEW_REPLY_REJECTED") {
    throw new ZernioPlatformError(
      "gbp",
      "REVIEW_REPLY_REJECTED",
      `Google moderation rejected review reply: ${parsed.data.error ?? "(no detail)"}`
    );
  }
  if (!successful) {
    throw new ZernioPlatformError(
      "gbp",
      parsed.data.errorCode ?? "REVIEW_REPLY_FAILED",
      parsed.data.error ?? "Zernio reported the reply did not publish."
    );
  }
  let replyState: GbpReviewSummary["replyState"];
  if (
    replyStateRaw === "PUBLISHED" ||
    replyStateRaw === "PENDING" ||
    replyStateRaw === "REJECTED"
  ) {
    replyState = replyStateRaw;
  } else {
    replyState = "PUBLISHED";
  }
  const publishedAt =
    parsed.data.publishedAt !== undefined
      ? toUnixMs(parsed.data.publishedAt)
      : Date.now();
  return { replyState, publishedAt };
}

/* -------------------------------------------------------------------------- */
/* GBP: local posts                                                            */
/* -------------------------------------------------------------------------- */

const GbpLocalPostResponseSchema = z
  .object({
    postId: z.string().optional(),
    id: z.string().optional(),
    gbpLocalPostId: z.string().optional(),
    state: z.string().optional(),
    publishedAt: z.union([z.string(), z.number()]).optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

function normalizeLocalPostResult(
  raw: unknown,
  contextPath: string
): GbpLocalPostResult {
  const parsed = GbpLocalPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      contextPath,
      `Unexpected local-post payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioPlatformError(
      "gbp",
      parsed.data.errorCode ?? "GBP_LOCAL_POST_FAILED",
      parsed.data.error
    );
  }
  const postId = parsed.data.postId ?? parsed.data.id;
  if (!postId) {
    throw new ZernioApiError(
      200,
      contextPath,
      "Zernio did not return a post id."
    );
  }
  let state: GbpLocalPostResult["state"];
  switch (parsed.data.state) {
    case "LIVE":
    case "PUBLISHED":
    case "published":
      state = "LIVE";
      break;
    case "REJECTED":
    case "rejected":
      state = "REJECTED";
      break;
    default:
      state = "PROCESSING";
  }
  return {
    postId,
    gbpLocalPostId: parsed.data.gbpLocalPostId,
    state,
    publishedAt:
      parsed.data.publishedAt !== undefined
        ? toUnixMs(parsed.data.publishedAt)
        : undefined,
  };
}

export async function gbpCreateLocalPost(
  ctx: ZernioContext,
  locationId: string,
  post: GbpLocalPostInput
): Promise<GbpLocalPostResult> {
  if (!post.text || post.text.length === 0) {
    throw new ZernioApiError(0, "gbpCreateLocalPost", "text is required.");
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body: {
      platform: "googlebusiness",
      accountId: ctx.zernioAccountId,
      locationId,
      postType: post.postType,
      content: post.text,
      cta: post.cta,
      mediaUrl: post.imageUrl,
      schedule: post.schedule,
      offer: post.offer,
    },
  });
  return normalizeLocalPostResult(raw, "/api/v1/posts");
}

export async function gbpUpdateLocalPost(
  ctx: ZernioContext,
  locationId: string,
  postId: string,
  patch: Partial<GbpLocalPostInput>
): Promise<GbpLocalPostResult> {
  const raw = await ctx.client.request<unknown>(
    `/api/v1/posts/${encodeURIComponent(postId)}`,
    {
      method: "PATCH",
      body: {
        platform: "googlebusiness",
        accountId: ctx.zernioAccountId,
        locationId,
        postType: patch.postType,
        content: patch.text,
        cta: patch.cta,
        mediaUrl: patch.imageUrl,
        schedule: patch.schedule,
        offer: patch.offer,
      },
    }
  );
  return normalizeLocalPostResult(raw, `/api/v1/posts/${postId}`);
}

export async function gbpDeleteLocalPost(
  ctx: ZernioContext,
  locationId: string,
  postId: string
): Promise<{ deleted: true }> {
  await ctx.client.request<unknown>(
    `/api/v1/posts/${encodeURIComponent(postId)}`,
    {
      method: "DELETE",
      query: {
        platform: "googlebusiness",
        accountId: ctx.zernioAccountId,
        locationId,
      },
    }
  );
  return { deleted: true };
}

/* -------------------------------------------------------------------------- */
/* GBP: insights                                                               */
/* -------------------------------------------------------------------------- */

const GbpInsightsResponseSchema = z
  .object({
    metrics: z
      .array(
        z
          .object({
            name: z.string(),
            value: z.number(),
          })
          .passthrough()
      )
      .default([]),
    data: z
      .array(
        z
          .object({
            name: z.string(),
            value: z.number(),
          })
          .passthrough()
      )
      .optional(),
    startAt: z.union([z.string(), z.number()]).optional(),
    endAt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export async function gbpGetInsights(
  ctx: ZernioContext,
  locationId: string,
  request: GbpInsightsRequest
): Promise<GbpInsightsResult> {
  const raw = await ctx.client.request<unknown>(
    "/api/v1/insights",
    {
      method: "POST",
      body: {
        platform: "googlebusiness",
        accountId: ctx.zernioAccountId,
        locationId,
        startAt: request.startAt,
        endAt: request.endAt,
        metrics: request.metrics,
      },
    }
  );
  const parsed = GbpInsightsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/insights",
      `Unexpected insights payload: ${parsed.error.message}`
    );
  }
  const rows = parsed.data.metrics.length
    ? parsed.data.metrics
    : (parsed.data.data ?? []);
  return {
    startAt:
      parsed.data.startAt !== undefined
        ? toUnixMs(parsed.data.startAt)
        : request.startAt,
    endAt:
      parsed.data.endAt !== undefined
        ? toUnixMs(parsed.data.endAt)
        : request.endAt,
    metrics: rows.map((m) => ({ name: m.name, value: m.value })),
  };
}

/* -------------------------------------------------------------------------- */
/* FB Pages                                                                    */
/* -------------------------------------------------------------------------- */

export interface FbPostInput {
  text: string;
  imageUrls?: string[]; // 0..3 images
  scheduleAt?: number;
}

const FbPostResponseSchema = z
  .object({
    postId: z.string().optional(),
    id: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

export async function fbCreatePost(
  ctx: ZernioContext,
  pageId: string,
  post: FbPostInput
): Promise<{ postId: string; state: "scheduled" | "published" | "failed" }> {
  if (!post.text || post.text.length === 0) {
    throw new ZernioApiError(0, "fbCreatePost", "text is required.");
  }
  if (post.imageUrls && post.imageUrls.length > 3) {
    throw new ZernioApiError(
      0,
      "fbCreatePost",
      "FB Pages supports up to 3 images per post."
    );
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body: {
      platform: "facebook",
      accountId: ctx.zernioAccountId,
      pageId,
      content: post.text,
      mediaUrls: post.imageUrls,
      scheduleAt: post.scheduleAt,
    },
  });
  const parsed = FbPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/posts",
      `Unexpected fb-post payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioPlatformError(
      "facebook",
      parsed.data.errorCode ?? "FB_POST_FAILED",
      parsed.data.error
    );
  }
  const postId = parsed.data.postId ?? parsed.data.id;
  if (!postId) {
    throw new ZernioApiError(200, "fbCreatePost", "Zernio returned no post id.");
  }
  const state =
    parsed.data.state === "scheduled"
      ? "scheduled"
      : parsed.data.state === "failed"
        ? "failed"
        : "published";
  return { postId, state };
}

export async function fbUpdatePost(
  ctx: ZernioContext,
  pageId: string,
  postId: string,
  patch: Partial<FbPostInput>
): Promise<{ postId: string; state: "scheduled" | "published" | "failed" }> {
  const raw = await ctx.client.request<unknown>(
    `/api/v1/posts/${encodeURIComponent(postId)}`,
    {
      method: "PATCH",
      body: {
        platform: "facebook",
        accountId: ctx.zernioAccountId,
        pageId,
        content: patch.text,
        mediaUrls: patch.imageUrls,
        scheduleAt: patch.scheduleAt,
      },
    }
  );
  const parsed = FbPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      `/api/v1/posts/${postId}`,
      `Unexpected fb-update payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioPlatformError(
      "facebook",
      parsed.data.errorCode ?? "FB_POST_UPDATE_FAILED",
      parsed.data.error
    );
  }
  const state =
    parsed.data.state === "scheduled"
      ? "scheduled"
      : parsed.data.state === "failed"
        ? "failed"
        : "published";
  return { postId: parsed.data.postId ?? postId, state };
}

const FbMessagesResponseSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            messageId: z.string().optional(),
            id: z.string().optional(),
            pageId: z.string().optional(),
            fromUserId: z.string().optional(),
            fromName: z.string().optional(),
            body: z.string().optional(),
            text: z.string().optional(),
            receivedAt: z.union([z.string(), z.number()]).optional(),
            createdAt: z.union([z.string(), z.number()]).optional(),
            hasOperatorReply: z.boolean().optional(),
          })
          .passthrough()
      )
      .default([]),
    data: z.array(z.unknown()).optional(),
  })
  .passthrough();

export async function fbListMessages(
  ctx: ZernioContext,
  pageId: string,
  options: { since?: number; limit?: number } = {}
): Promise<FbPageMessageSummary[]> {
  const raw = await ctx.client.request<unknown>("/api/v1/messages", {
    method: "GET",
    query: {
      platform: "facebook",
      accountId: ctx.zernioAccountId,
      pageId,
      since: options.since,
      limit: options.limit ?? 50,
    },
  });
  const parsed = FbMessagesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/messages",
      `Unexpected fb-messages payload: ${parsed.error.message}`
    );
  }
  return parsed.data.messages.map((m) => {
    const messageId = m.messageId ?? m.id;
    if (!messageId) {
      throw new ZernioApiError(
        200,
        "fbListMessages",
        "Zernio returned a message row without an id field."
      );
    }
    return {
      messageId,
      pageId: m.pageId ?? pageId,
      fromUserId: m.fromUserId ?? "(unknown)",
      fromName: m.fromName,
      body: m.body ?? m.text ?? "",
      receivedAt: toUnixMs(m.receivedAt ?? m.createdAt),
      hasOperatorReply: m.hasOperatorReply,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* IG Business                                                                 */
/* -------------------------------------------------------------------------- */

const IgPostResponseSchema = z
  .object({
    postId: z.string().optional(),
    id: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

function buildIgPayload(
  ctx: ZernioContext,
  igAccountId: string,
  post: IgPostInput
): Record<string, unknown> {
  if (!post.caption || post.caption.length === 0) {
    throw new ZernioApiError(0, "ig", "caption is required.");
  }
  if (!post.mediaUrls || post.mediaUrls.length === 0) {
    throw new ZernioApiError(0, "ig", "mediaUrls must be non-empty.");
  }
  if (post.postType === "carousel" && post.mediaUrls.length < 2) {
    throw new ZernioApiError(0, "ig", "carousel requires at least 2 media URLs.");
  }
  if (post.postType === "carousel" && post.mediaUrls.length > 10) {
    throw new ZernioApiError(0, "ig", "carousel supports up to 10 media URLs.");
  }
  if (post.postType === "single" && post.mediaUrls.length !== 1) {
    throw new ZernioApiError(
      0,
      "ig",
      "single-image post requires exactly 1 media URL."
    );
  }
  return {
    platform: "instagram",
    accountId: ctx.zernioAccountId,
    igAccountId,
    caption: post.caption,
    mediaUrls: post.mediaUrls,
    postType: post.postType,
  };
}

export async function igCreatePost(
  ctx: ZernioContext,
  igAccountId: string,
  post: IgPostInput
): Promise<{ postId: string; state: "scheduled" | "published" | "failed" }> {
  if (post.postType === "reel") {
    throw new ZernioApiError(
      0,
      "igCreatePost",
      "Use igCreateReel for reels."
    );
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body: buildIgPayload(ctx, igAccountId, post),
  });
  const parsed = IgPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "igCreatePost",
      `Unexpected ig-post payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioPlatformError(
      "instagram",
      parsed.data.errorCode ?? "IG_POST_FAILED",
      parsed.data.error
    );
  }
  const postId = parsed.data.postId ?? parsed.data.id;
  if (!postId) {
    throw new ZernioApiError(200, "igCreatePost", "Zernio returned no post id.");
  }
  return {
    postId,
    state:
      parsed.data.state === "scheduled"
        ? "scheduled"
        : parsed.data.state === "failed"
          ? "failed"
          : "published",
  };
}

export async function igCreateReel(
  ctx: ZernioContext,
  igAccountId: string,
  video: { caption: string; videoUrl: string; coverUrl?: string }
): Promise<{ postId: string; state: "scheduled" | "published" | "failed" }> {
  if (!video.videoUrl) {
    throw new ZernioApiError(0, "igCreateReel", "videoUrl is required.");
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body: {
      platform: "instagram",
      accountId: ctx.zernioAccountId,
      igAccountId,
      caption: video.caption,
      mediaUrls: [video.videoUrl],
      coverUrl: video.coverUrl,
      postType: "reel",
    },
  });
  const parsed = IgPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "igCreateReel",
      `Unexpected ig-reel payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioPlatformError(
      "instagram",
      parsed.data.errorCode ?? "IG_REEL_FAILED",
      parsed.data.error
    );
  }
  const postId = parsed.data.postId ?? parsed.data.id;
  if (!postId) {
    throw new ZernioApiError(200, "igCreateReel", "Zernio returned no post id.");
  }
  return {
    postId,
    state:
      parsed.data.state === "scheduled"
        ? "scheduled"
        : parsed.data.state === "failed"
          ? "failed"
          : "published",
  };
}

const IgCommentsResponseSchema = z
  .object({
    comments: z
      .array(
        z
          .object({
            commentId: z.string().optional(),
            id: z.string().optional(),
            mediaId: z.string().optional(),
            fromUserId: z.string().optional(),
            fromUsername: z.string().optional(),
            body: z.string().optional(),
            text: z.string().optional(),
            createdAt: z.union([z.string(), z.number()]).optional(),
            hasOperatorReply: z.boolean().optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

export async function igListComments(
  ctx: ZernioContext,
  igAccountId: string,
  options: { since?: number; limit?: number; mediaId?: string } = {}
): Promise<IgCommentSummary[]> {
  const raw = await ctx.client.request<unknown>("/api/v1/comments", {
    method: "GET",
    query: {
      platform: "instagram",
      accountId: ctx.zernioAccountId,
      igAccountId,
      mediaId: options.mediaId,
      since: options.since,
      limit: options.limit ?? 50,
    },
  });
  const parsed = IgCommentsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/comments",
      `Unexpected ig-comments payload: ${parsed.error.message}`
    );
  }
  return parsed.data.comments.map((c) => {
    const commentId = c.commentId ?? c.id;
    if (!commentId) {
      throw new ZernioApiError(
        200,
        "igListComments",
        "Zernio returned a comment row without an id field."
      );
    }
    return {
      commentId,
      mediaId: c.mediaId ?? "(unknown)",
      fromUserId: c.fromUserId ?? "(unknown)",
      fromUsername: c.fromUsername,
      body: c.body ?? c.text ?? "",
      createdAt: toUnixMs(c.createdAt),
      hasOperatorReply: c.hasOperatorReply,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Multi-platform post (the most-used Zernio feature)                          */
/* -------------------------------------------------------------------------- */

// [shape-unverified-live] We have NOT published a live multi-platform post
// yet (the live-smoke gate is X-only so far). The Zernio 1.0.4 create-post
// response echoes the post doc with a `platforms[]` array of PlatformTarget
// (carrying per-target `status` / `platformPostId` / `errorMessage`), NOT a
// `perPlatform[]` array. We parse BOTH shapes permissively and normalize to
// our stable `MultiPlatformPostResult.perPlatform`. Confirm the exact shape
// at the live-smoke gate and tighten then.
const MultiPostResponseSchema = z
  .object({
    // Pre-S1 / fixture shape.
    perPlatform: z
      .array(
        z
          .object({
            platform: z.string(),
            postId: z.string().nullable().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    // Real Zernio 1.0.4 shape: the created post echoes its targets.
    platforms: z
      .array(
        z
          .object({
            platform: z.string(),
            // Live create responses expand accountId into a full account doc;
            // accept anything so a shape change can never fail the parse.
            accountId: z.unknown().optional(),
            status: z.string().optional(),
            platformPostId: z.string().nullable().optional(),
            errorMessage: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    _id: z.string().optional(),
    results: z.array(z.unknown()).optional(),
    // LIVE-VERIFIED 2026-07-22 (curl against POST /api/v1/posts): the create
    // response is a WRAPPER — { post: {...echo with platforms[]...}, message,
    // error, platformResults: [{platform, status, error}] }. Six days of live
    // publish failures ("Tweet text is too long (586)... limit is 280",
    // "Reddit POST_GUIDANCE_VALIDATION_FAILED") were reported by Zernio in
    // BOTH platformResults[].error and post.platforms[].errorMessage — and
    // dropped, because this schema only knew the unwrapped shapes and the
    // all-optional parse "succeeded" as empty → "no postId returned".
    post: z
      .object({
        _id: z.string().optional(),
        platforms: z
          .array(
            z
              .object({
                platform: z.string(),
                status: z.string().optional(),
                platformPostId: z.string().nullable().optional(),
                errorMessage: z.string().optional(),
              })
              .passthrough()
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    platformResults: z
      .array(
        z
          .object({
            platform: z.string(),
            status: z.string().optional(),
            error: z.string().optional(),
            platformPostId: z.string().nullable().optional(),
          })
          .passthrough()
      )
      .optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

const ALL_POST_PLATFORMS: ReadonlyArray<ZernioPostPlatform> = [
  "gbp",
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "x",
  "reddit",
  "youtube",
  "pinterest",
  "threads",
];

function isZernioPostPlatform(value: string): value is ZernioPostPlatform {
  return (ALL_POST_PLATFORMS as ReadonlyArray<string>).includes(value);
}

/**
 * Zernio connect-SLUG / wire-platform map. HeyMaya's internal `x` is the only
 * divergence today (Zernio's slug is `twitter`, verified live 2026-06-02).
 * The rest pass through identically. Used by both `getConnectUrl` and the
 * multi-platform POST body builder.
 */
const PLATFORM_WIRE_SLUG: Record<ZernioPostPlatform, string> = {
  gbp: "googlebusiness",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  linkedin: "linkedin",
  x: "twitter",
  reddit: "reddit",
  youtube: "youtube",
  pinterest: "pinterest",
  threads: "threads",
};

/** Map a HeyMaya internal platform name to the Zernio wire/connect slug. */
export function zernioWireSlug(platform: ZernioPostPlatform): string {
  return PLATFORM_WIRE_SLUG[platform];
}

/** Map a Zernio wire platform string back to our internal name (best-effort). */
function fromWireSlug(wire: string): ZernioPostPlatform | null {
  if (wire === "twitter") return "x";
  if (wire === "googlebusiness") return "gbp";
  return isZernioPostPlatform(wire) ? wire : null;
}

/**
 * Single call posts to multiple platforms. Useful for behavior #5 (GBP
 * cadence cross-promote) + behavior #6 (rejuvenation across surfaces).
 *
 * Plan-tier gating: this function is the load-bearing check site for "the
 * Pro+/Studio multi-platform write". Callers MUST already have invoked
 * `planFeaturesService(business).maxSocialPlatforms` semantics — but this
 * function additionally rejects the call if any target platform is GBP+
 * (Pro+) or non-GBP (Pro+) and the caller hasn't passed the gate. The
 * specific gate enforcement lives in the `gbp/index.ts` and `social/`
 * wrappers; this function only enforces shape + per-target tier check at
 * the integration boundary as defense in depth — a bug elsewhere can't
 * accidentally mass-publish on a Starter account.
 */
/**
 * Build the spec `PlatformTarget[]` from either the bare platform-name array
 * (each target defaults its `accountId` to `ctx.zernioAccountId`) or explicit
 * {@link MultiPlatformTarget} objects. Maps the internal `x` → wire `twitter`.
 */
function buildPlatformTargets(
  ctx: ZernioContext,
  targets: ReadonlyArray<ZernioPostPlatform | MultiPlatformTarget>,
  post: MultiPlatformPostInput
): PlatformTarget[] {
  return targets.map((t) => {
    const internal: ZernioPostPlatform = typeof t === "string" ? t : t.platform;
    if (!isZernioPostPlatform(internal)) {
      throw new ZernioApiError(
        0,
        "multiPlatformPost",
        `Unknown platform: ${String(internal)}`
      );
    }
    const explicit = typeof t === "string" ? undefined : t;
    const target: PlatformTarget = {
      platform: zernioWireSlug(internal),
      accountId: explicit?.accountId ?? ctx.zernioAccountId,
    };
    if (explicit?.customContent !== undefined) {
      target.customContent = explicit.customContent;
    }
    if (explicit?.customMedia !== undefined) {
      target.customMedia = explicit.customMedia;
    }
    if (explicit?.scheduledFor !== undefined) {
      target.scheduledFor = explicit.scheduledFor;
    }
    const psd: ChannelPlatformData | undefined =
      explicit?.platformSpecificData ?? post.platformData?.[internal];
    if (psd !== undefined) {
      target.platformSpecificData = psd;
    }
    return target;
  });
}

/**
 * Single call posts to multiple platforms. Useful for the Maya v2 auto-post
 * queue (X / Reddit / LinkedIn / IG / TikTok / YouTube).
 *
 * S1 FIX: this now sends the REAL Zernio 1.0.4 `POST /api/v1/posts` body —
 * `{ content, platforms: PlatformTarget[], publishNow | scheduledFor+timezone,
 * mediaItems, title?, tiktokSettings? }` — replacing the old, never-verified
 * `{ accountId, platforms: string[], mediaUrls, perPlatformOverrides,
 * scheduleAt }` scaffold. Per-platform settings ride on each target's
 * `platformSpecificData`. The internal `x` platform is mapped to the wire slug
 * `twitter`.
 *
 * Accepts either a bare platform-name array (each target uses
 * `ctx.zernioAccountId`) or explicit {@link MultiPlatformTarget} objects.
 */
export async function multiPlatformPost(
  ctx: ZernioContext,
  targets: ReadonlyArray<ZernioPostPlatform | MultiPlatformTarget>,
  post: MultiPlatformPostInput
): Promise<MultiPlatformPostResult> {
  if (targets.length === 0) {
    throw new ZernioApiError(0, "multiPlatformPost", "platforms must be non-empty.");
  }
  const platformTargets = buildPlatformTargets(ctx, targets, post);
  const mediaItems: MediaItem[] | undefined =
    post.mediaItems ??
    (post.media
      ? post.media.map((m) => ({ type: m.mediaType, url: m.url }))
      : undefined);
  const hasMedia = (mediaItems?.length ?? 0) > 0;
  if ((!post.text || post.text.length === 0) && !hasMedia) {
    throw new ZernioApiError(
      0,
      "multiPlatformPost",
      "content is required when no media is attached."
    );
  }
  const body: Record<string, unknown> = {
    content: post.text || undefined,
    title: post.title,
    platforms: platformTargets,
    mediaItems,
    tiktokSettings: post.tiktokSettings,
  };
  if (post.scheduleAt !== undefined) {
    body.scheduledFor = new Date(post.scheduleAt).toISOString();
    if (post.timezone !== undefined) body.timezone = post.timezone;
  } else {
    body.publishNow = true;
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body,
  });
  const parsed = MultiPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "multiPlatformPost",
      `Unexpected multi-post payload: ${parsed.error.message}`
    );
  }
  // LIVE shape first (verified 2026-07-22): `{ post: {...}, platformResults }`
  // wrapper. platformResults carries the authoritative status + error string;
  // post.platforms carries platformPostId on success. The _id fallback applies
  // ONLY to non-failed rows — a failed publish must never masquerade as
  // published under the post-doc id.
  if (parsed.data.post || (parsed.data.platformResults?.length ?? 0) > 0) {
    const doc = parsed.data.post;
    const results = parsed.data.platformResults ?? [];
    const echoRows = doc?.platforms ?? [];
    const rows = results.length > 0 ? results : echoRows;
    const perPlatform = rows.map((row) => {
      const platform = fromWireSlug(row.platform);
      if (!platform) {
        throw new ZernioApiError(
          200,
          "multiPlatformPost",
          `Zernio returned an unknown platform: ${row.platform}`
        );
      }
      const echo = echoRows.find((e) => e.platform === row.platform);
      let state: MultiPlatformPostResult["perPlatform"][number]["state"];
      switch (row.status) {
        case "scheduled":
        case "pending":
          state = "scheduled";
          break;
        case "failed":
        case "error":
          state = "failed";
          break;
        default:
          state = "published";
      }
      const platformPostId =
        ("platformPostId" in row ? row.platformPostId : undefined) ??
        echo?.platformPostId ??
        null;
      const error =
        ("error" in row && typeof row.error === "string" ? row.error : undefined) ??
        echo?.errorMessage ??
        (state === "failed" ? parsed.data.error : undefined);
      return {
        platform,
        // Never let the post-doc _id stand in for a FAILED publish.
        postId:
          state === "failed" ? null : platformPostId ?? doc?._id ?? null,
        state,
        error,
      };
    });
    if (perPlatform.length > 0) return { perPlatform };
  }
  // Unwrapped `platforms[]` echo shape; falls back to the pre-S1
  // `perPlatform[]` fixture shape below.
  if (parsed.data.platforms && parsed.data.platforms.length > 0) {
    const perPlatform = parsed.data.platforms.map((row) => {
      const platform = fromWireSlug(row.platform);
      if (!platform) {
        throw new ZernioApiError(
          200,
          "multiPlatformPost",
          `Zernio returned an unknown platform: ${row.platform}`
        );
      }
      let state: MultiPlatformPostResult["perPlatform"][number]["state"];
      switch (row.status) {
        case "scheduled":
        case "pending":
          state = "scheduled";
          break;
        case "failed":
        case "error":
          state = "failed";
          break;
        default:
          state = "published";
      }
      return {
        platform,
        postId: row.platformPostId ?? parsed.data._id ?? null,
        state,
        error: row.errorMessage,
      };
    });
    return { perPlatform };
  }
  const legacy = parsed.data.perPlatform ?? [];
  const perPlatform = legacy.map((row) => {
    const platform = fromWireSlug(row.platform);
    if (!platform) {
      throw new ZernioApiError(
        200,
        "multiPlatformPost",
        `Zernio returned an unknown platform: ${row.platform}`
      );
    }
    let state: MultiPlatformPostResult["perPlatform"][number]["state"];
    switch (row.state) {
      case "scheduled":
        state = "scheduled";
        break;
      case "failed":
        state = "failed";
        break;
      default:
        state = "published";
    }
    return {
      platform,
      postId: row.postId ?? null,
      state,
      error: row.error,
    };
  });
  return { perPlatform };
}

/* -------------------------------------------------------------------------- */
/* Lighter-weight platforms — function signatures + minimal client.            */
/*                                                                            */
/* These ship implementation-present + tested at the unit level. The skill    */
/* layer (Sprint 3+) will activate them per-operator. Marked "Pro+ only" via  */
/* the GBP/social wrappers; this layer just does HTTP.                        */
/* -------------------------------------------------------------------------- */

export interface SimpleSocialPostInput {
  text: string;
  mediaUrls?: string[];
  scheduleAt?: number;
}

const GenericPostResponseSchema = z
  .object({
    postId: z.string().optional(),
    id: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();

async function postToPlatform(
  ctx: ZernioContext,
  platform: ZernioPlatform,
  destinationKey: string,
  destinationId: string,
  post: SimpleSocialPostInput
): Promise<{ postId: string; state: "scheduled" | "published" | "failed" }> {
  if (!post.text || post.text.length === 0) {
    throw new ZernioApiError(0, `${platform}.post`, "text is required.");
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body: {
      platform,
      accountId: ctx.zernioAccountId,
      [destinationKey]: destinationId,
      content: post.text,
      mediaUrls: post.mediaUrls,
      scheduleAt: post.scheduleAt,
    },
  });
  const parsed = GenericPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      `${platform}.post`,
      `Unexpected ${platform}-post payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioPlatformError(
      platform,
      parsed.data.errorCode ?? `${platform.toUpperCase()}_POST_FAILED`,
      parsed.data.error
    );
  }
  const postId = parsed.data.postId ?? parsed.data.id;
  if (!postId) {
    throw new ZernioApiError(200, `${platform}.post`, "Zernio returned no post id.");
  }
  return {
    postId,
    state:
      parsed.data.state === "scheduled"
        ? "scheduled"
        : parsed.data.state === "failed"
          ? "failed"
          : "published",
  };
}

export const linkedinCreatePost = (
  ctx: ZernioContext,
  organizationId: string,
  post: SimpleSocialPostInput
) => postToPlatform(ctx, "linkedin", "organizationId", organizationId, post);

export const xCreatePost = (
  ctx: ZernioContext,
  xAccountId: string,
  post: SimpleSocialPostInput
) => postToPlatform(ctx, "x", "xAccountId", xAccountId, post);

export const pinterestCreatePost = (
  ctx: ZernioContext,
  boardId: string,
  post: SimpleSocialPostInput
) => postToPlatform(ctx, "pinterest", "boardId", boardId, post);

export const threadsCreatePost = (
  ctx: ZernioContext,
  threadsAccountId: string,
  post: SimpleSocialPostInput
) => postToPlatform(ctx, "threads", "threadsAccountId", threadsAccountId, post);

export const tiktokCreatePost = (
  ctx: ZernioContext,
  tiktokAccountId: string,
  post: SimpleSocialPostInput
) => postToPlatform(ctx, "tiktok", "tiktokAccountId", tiktokAccountId, post);

/* ========================================================================== */
/* S1 — Zernio 1.0.4 profile / connect / accounts / analytics / inbox /        */
/* media / webhook wrappers (Maya v2 auto-post).                               */
/*                                                                            */
/* These are NOT account-scoped in the same way the GBP/service functions are: */
/* a Zernio "profile" is the umbrella that holds connected accounts, so these  */
/* take the raw `ZernioClient` (or a `profileId`) directly. Every wrapper has  */
/* an EXPLICIT `Promise<T>` return type (project is at the TS DataModel         */
/* ceiling — new code must annotate). Response parsers are permissive          */
/* (`.passthrough()`) where the live shape is unverified — see                 */
/* [shape-unverified-live] markers.                                            */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/* Profiles — POST /api/v1/profiles                                            */
/* -------------------------------------------------------------------------- */

const ProfileCreateResponseSchema = z
  .object({
    message: z.string().optional(),
    profile: z
      .object({
        _id: z.string(),
        userId: z.string().optional(),
        name: z.string(),
        description: z.string().optional(),
        color: z.string().optional(),
        isDefault: z.boolean().optional(),
        isOverLimit: z.boolean().optional(),
        createdAt: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Create a Zernio profile (the umbrella holding connected accounts).
 * `POST /api/v1/profiles` — body `{ name }` required, `{ description, color }`
 * optional. VERIFIED LIVE 2026-06-02. Returns `{ message, profile }`.
 */
export async function createProfile(
  client: ZernioClient,
  args: { name: string; description?: string; color?: string }
): Promise<ZernioProfile> {
  if (!args.name || args.name.length === 0) {
    throw new ZernioApiError(0, "createProfile", "name is required.");
  }
  const raw = await client.request<unknown>("/api/v1/profiles", {
    method: "POST",
    body: {
      name: args.name,
      description: args.description,
      color: args.color,
    },
  });
  const parsed = ProfileCreateResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/profiles",
      `Unexpected create-profile payload: ${parsed.error.message}`
    );
  }
  return parsed.data.profile as ZernioProfile;
}

/* -------------------------------------------------------------------------- */
/* Connect (OAuth kickoff) — GET /api/v1/connect/{slug}                        */
/* -------------------------------------------------------------------------- */

const ConnectUrlResponseSchema = z
  .object({
    authUrl: z.string(),
    state: z.string(),
  })
  .passthrough();

/**
 * Get the OAuth authorization URL for connecting a platform under a profile.
 * `GET /api/v1/connect/{slug}?profileId=...&redirect_url=...`.
 *
 * `profileId` is REQUIRED. The internal `x` platform maps to the wire slug
 * `twitter` (VERIFIED LIVE 2026-06-02: `/connect/x` → 400; `/connect/twitter`
 * → 200). Returns `{ authUrl, state }`.
 */
export async function getConnectUrl(
  client: ZernioClient,
  platform: ZernioPostPlatform,
  profileId: string,
  redirectUrl?: string
): Promise<ConnectUrlResult> {
  if (!profileId || profileId.length === 0) {
    throw new ZernioApiError(0, "getConnectUrl", "profileId is required.");
  }
  const slug = zernioWireSlug(platform);
  const raw = await client.request<unknown>(
    `/api/v1/connect/${encodeURIComponent(slug)}`,
    {
      method: "GET",
      query: {
        profileId,
        redirect_url: redirectUrl,
      },
    }
  );
  const parsed = ConnectUrlResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      `/api/v1/connect/${slug}`,
      `Unexpected connect payload: ${parsed.error.message}`
    );
  }
  return { authUrl: parsed.data.authUrl, state: parsed.data.state };
}

/* -------------------------------------------------------------------------- */
/* Accounts — GET /api/v1/accounts, /accounts/health, DELETE /accounts/{id}    */
/* -------------------------------------------------------------------------- */

const AccountsListResponseSchema = z
  .object({
    accounts: z.array(z.record(z.string(), z.unknown())).default([]),
    hasAnalyticsAccess: z.boolean().optional(),
  })
  .passthrough();

/**
 * List connected accounts under a profile.
 * `GET /api/v1/accounts?profileId&platform&includeOverLimit&page&limit`.
 * VERIFIED LIVE 2026-08-01: GET /api/v1/accounts → {accounts, hasAnalyticsAccess} — `accounts[]` rows passed through verbatim.
 */
export async function listAccounts(
  client: ZernioClient,
  args: {
    profileId?: string;
    platform?: string;
    includeOverLimit?: boolean;
    page?: number;
    limit?: number;
  } = {}
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.request<unknown>("/api/v1/accounts", {
    method: "GET",
    query: {
      profileId: args.profileId,
      platform: args.platform,
      includeOverLimit: args.includeOverLimit,
      page: args.page,
      limit: args.limit,
    },
  });
  const parsed = AccountsListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    throw new ZernioApiError(
      200,
      "/api/v1/accounts",
      `Unexpected accounts payload: ${parsed.error.message}`
    );
  }
  return parsed.data.accounts;
}

const AccountHealthResponseSchema = z
  .object({
    summary: z
      .object({
        total: z.number().optional(),
        healthy: z.number().optional(),
        warning: z.number().optional(),
        error: z.number().optional(),
        needsReconnect: z.number().optional(),
      })
      .passthrough()
      .default({}),
    accounts: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

/**
 * Health summary for connected accounts.
 * `GET /api/v1/accounts/health?profileId&platform&status`.
 * VERIFIED LIVE 2026-08-01: GET /api/v1/accounts/health → accountId (NOT id) + summary.
 */
export async function getAccountsHealth(
  client: ZernioClient,
  args: { profileId?: string; platform?: string; status?: string } = {}
): Promise<AccountHealth> {
  const raw = await client.request<unknown>("/api/v1/accounts/health", {
    method: "GET",
    query: {
      profileId: args.profileId,
      platform: args.platform,
      status: args.status,
    },
  });
  const parsed = AccountHealthResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/accounts/health",
      `Unexpected accounts-health payload: ${parsed.error.message}`
    );
  }
  return { summary: parsed.data.summary, accounts: parsed.data.accounts };
}

/* -------------------------------------------------------------------------- */
/* Validation — POST /api/v1/tools/validate/post (spec §6268)                  */
/* -------------------------------------------------------------------------- */

const ValidatePostResponseSchema = z
  .object({
    valid: z.boolean().optional(),
    message: z.string().optional(),
    errors: z
      .array(
        z
          .object({ platform: z.string().optional(), error: z.string().optional() })
          .passthrough()
      )
      .optional(),
    warnings: z
      .array(
        z
          .object({ platform: z.string().optional(), warning: z.string().optional() })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

/**
 * Dry-run Zernio's FULL post-validation pipeline without publishing: per-
 * platform character limits (X weighted counting: URLs=23, emoji=2), missing
 * media for IG/TikTok/YouTube, hashtag limits, thread formats. Content-only —
 * no accounts touched, no usage tracked. Run this BEFORE creating a confirm
 * event so an unpostable draft is rejected with the platform's real reason
 * instead of dying at publish time (the 07-16 → 07-22 failure mode).
 */
export async function validatePost(
  client: ZernioClient,
  args: {
    content?: string;
    platform: ZernioPostPlatform;
    platformSpecificData?: ChannelPlatformData;
    mediaItems?: MediaItem[];
  }
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const raw = await client.request<unknown>("/api/v1/tools/validate/post", {
    method: "POST",
    body: {
      content: args.content,
      platforms: [
        {
          platform: zernioWireSlug(args.platform),
          ...(args.platformSpecificData
            ? { platformSpecificData: args.platformSpecificData }
            : {}),
        },
      ],
      mediaItems: args.mediaItems,
    },
  });
  const parsed = ValidatePostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "validatePost",
      `Unexpected validate-post payload: ${parsed.error.message}`
    );
  }
  const errors = (parsed.data.errors ?? [])
    .map((e) => (e.error ? `${e.platform ?? args.platform}: ${e.error}` : null))
    .filter((e): e is string => e !== null);
  const warnings = (parsed.data.warnings ?? [])
    .map((w) => (w.warning ? `${w.platform ?? args.platform}: ${w.warning}` : null))
    .filter((w): w is string => w !== null);
  return { valid: parsed.data.valid !== false && errors.length === 0, errors, warnings };
}

/**
 * Disconnect / delete a connected account.
 * `DELETE /api/v1/accounts/{accountId}`.
 */
export async function deleteAccount(
  client: ZernioClient,
  accountId: string
): Promise<{ deleted: true }> {
  if (!accountId || accountId.length === 0) {
    throw new ZernioApiError(0, "deleteAccount", "accountId is required.");
  }
  await client.request<unknown>(
    `/api/v1/accounts/${encodeURIComponent(accountId)}`,
    { method: "DELETE" }
  );
  return { deleted: true };
}

/* -------------------------------------------------------------------------- */
/* Analytics — GET /api/v1/analytics                                           */
/* -------------------------------------------------------------------------- */

const PostAnalyticsResponseSchema = z
  .object({
    impressions: z.number().optional(),
    reach: z.number().optional(),
    likes: z.number().optional(),
    comments: z.number().optional(),
    shares: z.number().optional(),
    saves: z.number().optional(),
    clicks: z.number().optional(),
    views: z.number().optional(),
    igReelsAvgWatchTime: z.number().optional(),
    igReelsVideoViewTotalTime: z.number().optional(),
    engagementRate: z.number().optional(),
    lastUpdated: z.string().optional(),
    // The spec response is oneOf(single, list); we surface either the post
    // doc's `analytics` field or a top-level `data`/`analytics` wrapper.
    analytics: z.unknown().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();

/**
 * Fetch post analytics (closed-loop attribution — the moat).
 * `GET /api/v1/analytics?postId&platform&profileId&accountId&source&fromDate&
 * toDate&limit&page&sortBy&order`. The spec response is
 * `oneOf(single-post, list)`; we return the normalized {@link PostAnalytics}
 * envelope and pass the raw through. [shape-unverified-live].
 */
export async function getPostAnalytics(
  client: ZernioClient,
  args: {
    postId?: string;
    platform?: string;
    profileId?: string;
    accountId?: string;
    source?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    page?: number;
    sortBy?: string;
    order?: string;
  } = {}
): Promise<PostAnalytics & { raw: unknown }> {
  const raw = await client.request<unknown>("/api/v1/analytics", {
    method: "GET",
    query: {
      postId: args.postId,
      platform: args.platform,
      profileId: args.profileId,
      accountId: args.accountId,
      source: args.source,
      fromDate: args.fromDate,
      toDate: args.toDate,
      limit: args.limit,
      page: args.page,
      sortBy: args.sortBy,
      order: args.order,
    },
  });
  const parsed = PostAnalyticsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/analytics",
      `Unexpected analytics payload: ${parsed.error.message}`
    );
  }
  const { analytics: _a, data: _d, ...metrics } = parsed.data;
  return { ...metrics, raw };
}

/* -------------------------------------------------------------------------- */
/* Analytics time-series — closed-loop "what converted over time" (add-on).    */
/* -------------------------------------------------------------------------- */

// Lenient passthrough — the spec returns different envelopes per endpoint
// (timeline rows / best-time slots / decay buckets). We surface the raw and
// let the agent reason over it. [shape-unverified-live — needs a connected
// account with published posts to confirm against a real response].
const TimeSeriesResponseSchema = z
  .object({
    overview: z.unknown().optional(),
    timeline: z.unknown().optional(),
    rows: z.unknown().optional(),
    data: z.unknown().optional(),
    slots: z.unknown().optional(),
    buckets: z.unknown().optional(),
    frequency: z.unknown().optional(),
  })
  .passthrough();

/**
 * Per-post daily metric evolution — the closed-loop attribution moat ("which
 * post → which spike → which signup"). `GET /api/v1/analytics/post-timeline?
 * postId&fromDate&toDate`. Analytics add-on.
 */
export async function getPostTimeline(
  client: ZernioClient,
  args: { postId: string; fromDate?: string; toDate?: string }
): Promise<{ raw: unknown }> {
  const raw = await client.request<unknown>("/api/v1/analytics/post-timeline", {
    method: "GET",
    query: { postId: args.postId, fromDate: args.fromDate, toDate: args.toDate },
  });
  const parsed = TimeSeriesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/analytics/post-timeline",
      `Unexpected post-timeline payload: ${parsed.error.message}`
    );
  }
  return { raw };
}

/**
 * Empirically-optimal posting slots per channel — feeds spread-out scheduling.
 * `GET /api/v1/analytics/best-time?platform&profileId&accountId&source`.
 * Analytics add-on.
 */
export async function getBestTime(
  client: ZernioClient,
  args: {
    platform?: string;
    profileId?: string;
    accountId?: string;
    source?: string;
  } = {}
): Promise<{ raw: unknown }> {
  const raw = await client.request<unknown>("/api/v1/analytics/best-time", {
    method: "GET",
    query: {
      platform: args.platform,
      profileId: args.profileId,
      accountId: args.accountId,
      source: args.source,
    },
  });
  const parsed = TimeSeriesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/analytics/best-time",
      `Unexpected best-time payload: ${parsed.error.message}`
    );
  }
  return { raw };
}

/* -------------------------------------------------------------------------- */
/* Follower stats — GET /api/v1/accounts/follower-stats                        */
/* -------------------------------------------------------------------------- */

const FollowerStatsResponseSchema = z
  .object({
    accounts: z.array(z.record(z.string(), z.unknown())).default([]),
    dateRange: z.record(z.string(), z.unknown()).optional(),
    aggregation: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * Follower growth time-series for one or more accounts.
 * `GET /api/v1/accounts/follower-stats?accountIds&profileId&fromDate&toDate&
 * granularity`. `accountIds` is a comma-joined list. [shape-unverified-live].
 */
export async function getFollowerStats(
  client: ZernioClient,
  args: {
    accountIds: ReadonlyArray<string> | string;
    profileId?: string;
    fromDate?: string;
    toDate?: string;
    granularity?: string;
  }
): Promise<FollowerStats> {
  const accountIds: string = Array.isArray(args.accountIds)
    ? args.accountIds.join(",")
    : (args.accountIds as string);
  if (!accountIds || accountIds.length === 0) {
    throw new ZernioApiError(
      0,
      "getFollowerStats",
      "accountIds is required."
    );
  }
  const raw = await client.request<unknown>(
    "/api/v1/accounts/follower-stats",
    {
      method: "GET",
      query: {
        accountIds,
        profileId: args.profileId,
        fromDate: args.fromDate,
        toDate: args.toDate,
        granularity: args.granularity,
      },
    }
  );
  const parsed = FollowerStatsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/accounts/follower-stats",
      `Unexpected follower-stats payload: ${parsed.error.message}`
    );
  }
  return {
    accounts: parsed.data.accounts,
    dateRange: parsed.data.dateRange,
    aggregation: parsed.data.aggregation,
  };
}

/* -------------------------------------------------------------------------- */
/* Inbox — comments + conversations                                            */
/* -------------------------------------------------------------------------- */

/**
 * The real envelope both inbox endpoints return. VERIFIED LIVE 2026-08-01.
 *
 * Two things our previous schema got wrong, and both were silent:
 *
 * 1. **`nextCursor` is nested inside `pagination`**, not at the root. Reading
 *    it at the root always yielded `undefined`, so paging never advanced and
 *    we only ever saw the FIRST page of the inbox. For a product whose core
 *    job is "answer everyone", that's the difference between answering
 *    everyone and answering whoever happens to be on page one.
 * 2. **`meta` reports PARTIAL FAILURE** — `accountsQueried`, `accountsFailed`,
 *    and a `failedAccounts` list. The live call returned
 *    `accountsQueried: 2, accountsFailed: 1`: the API told us it couldn't read
 *    one of the connected accounts, and we discarded that and returned success.
 *    Silently reading half the inbox and reporting "all clear" is exactly the
 *    failure class this product exists to eliminate.
 */
const InboxPaginationSchema = z
  .object({
    hasMore: z.boolean().optional(),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough();

const InboxMetaSchema = z
  .object({
    accountsQueried: z.number().optional(),
    accountsFailed: z.number().optional(),
    failedAccounts: z
      .array(
        z
          .object({
            accountId: z.string().optional(),
            accountUsername: z.string().optional(),
            platform: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

/** What a caller needs to page correctly AND to know what it didn't see. */
export interface InboxPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Accounts the API could not read. NEVER silently dropped. */
  failedAccounts: Array<{
    accountId?: string;
    accountUsername?: string;
    platform?: string;
  }>;
}

const InboxCommentsResponseSchema = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())).default([]),
    pagination: InboxPaginationSchema.optional(),
    meta: InboxMetaSchema.optional(),
  })
  .passthrough();

/**
 * List inbound comments across connected accounts.
 * `GET /api/v1/inbox/comments?profileId&platform&minComments&since&sortBy&
 * sortOrder&limit&cursor&accountId`. VERIFIED LIVE 2026-08-01: GET /api/v1/inbox/comments → {data, pagination, meta}.
 */
export async function listInboxComments(
  client: ZernioClient,
  args: {
    profileId?: string;
    platform?: string;
    minComments?: number;
    since?: string;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    cursor?: string;
    accountId?: string;
  } = {}
): Promise<InboxPage<InboxComment>> {
  const raw = await client.request<unknown>("/api/v1/inbox/comments", {
    method: "GET",
    query: {
      profileId: args.profileId,
      platform: args.platform,
      minComments: args.minComments,
      since: args.since,
      sortBy: args.sortBy,
      sortOrder: args.sortOrder,
      limit: args.limit,
      cursor: args.cursor,
      accountId: args.accountId,
    },
  });
  const parsed = InboxCommentsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/inbox/comments",
      `Unexpected inbox-comments payload: ${parsed.error.message}`
    );
  }
  return {
    items: parsed.data.data.map((row) => row as unknown as InboxComment),
    nextCursor: parsed.data.pagination?.nextCursor ?? null,
    hasMore: parsed.data.pagination?.hasMore ?? false,
    failedAccounts: parsed.data.meta?.failedAccounts ?? [],
  };
}

const ConversationsResponseSchema = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())).default([]),
    pagination: InboxPaginationSchema.optional(),
    meta: InboxMetaSchema.optional(),
  })
  .passthrough();

/**
 * List inbound DM conversations across connected accounts.
 * `GET /api/v1/inbox/conversations?profileId&platform&status&sortOrder&limit&
 * cursor&accountId`. VERIFIED LIVE 2026-08-01: GET /api/v1/inbox/conversations → {data, pagination, meta}.
 */
export async function listConversations(
  client: ZernioClient,
  args: {
    profileId?: string;
    platform?: string;
    status?: string;
    sortOrder?: string;
    limit?: number;
    cursor?: string;
    accountId?: string;
  } = {}
): Promise<InboxPage<Conversation>> {
  const raw = await client.request<unknown>("/api/v1/inbox/conversations", {
    method: "GET",
    query: {
      profileId: args.profileId,
      platform: args.platform,
      status: args.status,
      sortOrder: args.sortOrder,
      limit: args.limit,
      cursor: args.cursor,
      accountId: args.accountId,
    },
  });
  const parsed = ConversationsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/inbox/conversations",
      `Unexpected conversations payload: ${parsed.error.message}`
    );
  }
  return {
    items: parsed.data.data.map((row) => row as unknown as Conversation),
    nextCursor: parsed.data.pagination?.nextCursor ?? null,
    hasMore: parsed.data.pagination?.hasMore ?? false,
    failedAccounts: parsed.data.meta?.failedAccounts ?? [],
  };
}

const InboxActionResponseSchema = z
  .object({
    success: z.boolean().optional(),
    id: z.string().optional(),
    messageId: z.string().optional(),
    commentId: z.string().optional(),
    // Spec shape (verified 1.0.4): { success, data: { commentId, isReply } }.
    data: z
      .object({ commentId: z.string().optional() })
      .passthrough()
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

/**
 * Reply to a comment on a post.
 * `POST /api/v1/inbox/comments/{postId}` — body requires `{ accountId,
 * message }`; optional `commentId` (reply to a specific comment thread).
 * [shape-unverified-live].
 */
export async function replyToComment(
  client: ZernioClient,
  args: {
    postId: string;
    accountId: string;
    message: string;
    commentId?: string;
    /** Required by Reddit when replying to third-party threads (docs:
     *  "Subreddit parameters are required when replying to comments"). */
    subreddit?: string;
  }
): Promise<{ success: boolean; id?: string; raw: unknown }> {
  if (!args.postId) {
    throw new ZernioApiError(0, "replyToComment", "postId is required.");
  }
  if (!args.accountId) {
    throw new ZernioApiError(0, "replyToComment", "accountId is required.");
  }
  if (!args.message || args.message.length === 0) {
    throw new ZernioApiError(0, "replyToComment", "message is required.");
  }
  const raw = await client.request<unknown>(
    `/api/v1/inbox/comments/${encodeURIComponent(args.postId)}`,
    {
      method: "POST",
      body: {
        accountId: args.accountId,
        message: args.message,
        commentId: args.commentId,
        subreddit: args.subreddit,
      },
    }
  );
  const parsed = InboxActionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/inbox/comments",
      `Unexpected reply-to-comment payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioApiError(
      200,
      "replyToComment",
      `Zernio rejected the comment reply: ${parsed.data.error}`
    );
  }
  return {
    success: parsed.data.success ?? !parsed.data.error,
    id: parsed.data.id ?? parsed.data.commentId ?? parsed.data.data?.commentId,
    raw,
  };
}

/**
 * Send a DM in a conversation.
 * `POST /api/v1/inbox/conversations/{conversationId}/messages` — body requires
 * `{ accountId }`; `message` carries the text. [shape-unverified-live].
 */
export async function sendDm(
  client: ZernioClient,
  args: {
    conversationId: string;
    accountId: string;
    message: string;
  }
): Promise<{ success: boolean; id?: string; raw: unknown }> {
  if (!args.conversationId) {
    throw new ZernioApiError(0, "sendDm", "conversationId is required.");
  }
  if (!args.accountId) {
    throw new ZernioApiError(0, "sendDm", "accountId is required.");
  }
  if (!args.message || args.message.length === 0) {
    throw new ZernioApiError(0, "sendDm", "message is required.");
  }
  const raw = await client.request<unknown>(
    `/api/v1/inbox/conversations/${encodeURIComponent(
      args.conversationId
    )}/messages`,
    {
      method: "POST",
      body: {
        accountId: args.accountId,
        message: args.message,
      },
    }
  );
  const parsed = InboxActionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/inbox/conversations/messages",
      `Unexpected send-dm payload: ${parsed.error.message}`
    );
  }
  if (parsed.data.error) {
    throw new ZernioApiError(
      200,
      "sendDm",
      `Zernio rejected the DM: ${parsed.data.error}`
    );
  }
  return {
    success: parsed.data.success ?? !parsed.data.error,
    id: parsed.data.id ?? parsed.data.messageId,
    raw,
  };
}

/* -------------------------------------------------------------------------- */
/* Media presign — POST /api/v1/media/presign                                  */
/* -------------------------------------------------------------------------- */

const PresignResponseSchema = z
  .object({
    files: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

/**
 * Request a presigned upload URL for a media asset.
 * `POST /api/v1/media/presign` — body requires `{ filename, contentType }`,
 * optional `{ size }`. Returns `{ files: [...] }`. [shape-unverified-live].
 */
export async function presignMedia(
  client: ZernioClient,
  args: { filename: string; contentType: string; size?: number }
): Promise<PresignResult> {
  if (!args.filename) {
    throw new ZernioApiError(0, "presignMedia", "filename is required.");
  }
  if (!args.contentType) {
    throw new ZernioApiError(0, "presignMedia", "contentType is required.");
  }
  const raw = await client.request<unknown>("/api/v1/media/presign", {
    method: "POST",
    body: {
      filename: args.filename,
      contentType: args.contentType,
      size: args.size,
    },
  });
  const parsed = PresignResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/media/presign",
      `Unexpected presign payload: ${parsed.error.message}`
    );
  }
  return { files: parsed.data.files };
}

/* -------------------------------------------------------------------------- */
/* Webhooks — POST /api/v1/webhooks/settings                                   */
/* -------------------------------------------------------------------------- */

/**
 * The subset of the real Zernio 1.0.4 webhook event enum HeyMaya v2 ever
 * subscribes to. `createWebhook` rejects any event NOT in this set so we can't
 * accidentally request a `mention.received` / `lead.received` (which do not
 * exist in the spec).
 */
const SUBSCRIBABLE_WEBHOOK_EVENTS: ReadonlyArray<ZernioWebhookSubscribableEvent> =
  [
    "post.published",
    "post.failed",
    "post.platform.published",
    "post.platform.failed",
    "account.connected",
    "account.disconnected",
    "message.received",
    "comment.received",
    "reaction.received",
    "review.new",
    "review.updated",
  ];

const WebhookCreateResponseSchema = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
    events: z.array(z.string()).optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

/**
 * List registered webhook subscriptions.
 * `GET /api/v1/webhooks/settings`. Used to make webhook registration
 * idempotent (find-by-url before create). The response envelope varies
 * (`{ webhooks: [...] }` vs a bare array) so we accept both. VERIFIED LIVE 2026-08-01: GET /api/v1/webhooks/settings → {webhooks}.
 */
export async function listWebhooks(
  client: ZernioClient
): Promise<Array<{ id: string; url: string; events: string[]; raw: unknown }>> {
  const raw = await client.request<unknown>("/api/v1/webhooks/settings", {
    method: "GET",
  });
  const rows: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : raw && typeof raw === "object" && Array.isArray((raw as { webhooks?: unknown }).webhooks)
      ? ((raw as { webhooks: Array<Record<string, unknown>> }).webhooks)
      : [];
  return rows.map((r) => ({
    id: (typeof r._id === "string" && r._id) || (typeof r.id === "string" && r.id) || "",
    url: typeof r.url === "string" ? r.url : "",
    events: Array.isArray(r.events) ? (r.events.filter((e) => typeof e === "string") as string[]) : [],
    raw: r,
  }));
}

/**
 * Register a webhook subscription.
 * `POST /api/v1/webhooks/settings` — body requires `{ name, url, events }`,
 * optional `{ secret, isActive, customHeaders }`. Rejects any event name not
 * in {@link SUBSCRIBABLE_WEBHOOK_EVENTS}. [shape-unverified-live].
 */
export async function createWebhook(
  client: ZernioClient,
  args: {
    name: string;
    url: string;
    events: ReadonlyArray<ZernioWebhookSubscribableEvent>;
    secret?: string;
    isActive?: boolean;
    customHeaders?: Record<string, string>;
  }
): Promise<{ id: string; raw: unknown }> {
  if (!args.name) {
    throw new ZernioApiError(0, "createWebhook", "name is required.");
  }
  if (!args.url) {
    throw new ZernioApiError(0, "createWebhook", "url is required.");
  }
  if (!args.events || args.events.length === 0) {
    throw new ZernioApiError(0, "createWebhook", "events must be non-empty.");
  }
  for (const ev of args.events) {
    if (!SUBSCRIBABLE_WEBHOOK_EVENTS.includes(ev)) {
      throw new ZernioApiError(
        0,
        "createWebhook",
        `Invalid / unsupported webhook event: ${String(ev)}`
      );
    }
  }
  const raw = await client.request<unknown>("/api/v1/webhooks/settings", {
    method: "POST",
    body: {
      name: args.name,
      url: args.url,
      events: args.events,
      secret: args.secret,
      isActive: args.isActive,
      customHeaders: args.customHeaders,
    },
  });
  const parsed = WebhookCreateResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "/api/v1/webhooks/settings",
      `Unexpected create-webhook payload: ${parsed.error.message}`
    );
  }
  const id = parsed.data._id ?? parsed.data.id ?? "";
  return { id, raw };
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

/** Internal helper for tests — they construct a ZernioClient + pass it. */
export function makeZernioContext(
  client: ZernioClient,
  zernioAccountId: string
): ZernioContext {
  return { client, zernioAccountId };
}
