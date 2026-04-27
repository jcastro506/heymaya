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
  type FbPageMessageSummary,
  type GbpInsightsRequest,
  type GbpInsightsResult,
  type GbpLocalPostInput,
  type GbpLocalPostResult,
  type GbpLocationSummary,
  type GbpReviewSummary,
  type IgCommentSummary,
  type IgPostInput,
  type MultiPlatformPostInput,
  type MultiPlatformPostResult,
  type ZernioPlatform,
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

const MultiPostResponseSchema = z
  .object({
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
      .default([]),
    results: z.array(z.unknown()).optional(),
  })
  .passthrough();

const ALL_PLATFORMS: ReadonlyArray<ZernioPlatform> = [
  "gbp",
  "facebook",
  "instagram",
  "tiktok",
  "linkedin",
  "x",
  "pinterest",
  "threads",
];

function isZernioPlatform(value: string): value is ZernioPlatform {
  return (ALL_PLATFORMS as ReadonlyArray<string>).includes(value);
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
export async function multiPlatformPost(
  ctx: ZernioContext,
  platforms: ReadonlyArray<ZernioPlatform>,
  post: MultiPlatformPostInput
): Promise<MultiPlatformPostResult> {
  if (platforms.length === 0) {
    throw new ZernioApiError(0, "multiPlatformPost", "platforms must be non-empty.");
  }
  for (const p of platforms) {
    if (!isZernioPlatform(p)) {
      throw new ZernioApiError(
        0,
        "multiPlatformPost",
        `Unknown platform: ${String(p)}`
      );
    }
  }
  if (!post.text || post.text.length === 0) {
    throw new ZernioApiError(0, "multiPlatformPost", "text is required.");
  }
  const raw = await ctx.client.request<unknown>("/api/v1/posts", {
    method: "POST",
    body: {
      accountId: ctx.zernioAccountId,
      platforms,
      content: post.text,
      mediaUrls: post.media?.map((m) => m.url),
      perPlatformOverrides: post.perPlatformOverrides,
      scheduleAt: post.scheduleAt,
    },
  });
  const parsed = MultiPostResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ZernioApiError(
      200,
      "multiPlatformPost",
      `Unexpected multi-post payload: ${parsed.error.message}`
    );
  }
  const perPlatform = parsed.data.perPlatform.map((row) => {
    const platform = isZernioPlatform(row.platform) ? row.platform : null;
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
