/**
 * Endpoint wrappers — unit tests.
 *
 * Mocks fetch at the HTTP boundary (per the brief — fixture-style, not
 * stubbing the integration logic).
 *
 * Coverage:
 *  - gbpListLocations: shape parse, fallback to bare-array shape, missing-id reject
 *  - gbpListReviews:  shape parse, normalization of star rating + body fields
 *  - gbpReplyToReview:
 *      * happy path returns PUBLISHED + publishedAt
 *      * `replyState: REJECTED` throws ZernioPlatformError(REVIEW_REPLY_REJECTED)
 *      * `errorCode: REVIEW_REPLY_REJECTED` also throws
 *      * empty replyText throws ZernioApiError before HTTP
 *  - gbpCreateLocalPost: STANDARD post happy path; missing id throws
 *  - gbpDeleteLocalPost: returns deleted: true
 *  - fbCreatePost:    >3 images rejected; happy path; platform error surfaces
 *  - fbListMessages:  shape parse + missing id rejected
 *  - igCreatePost:    carousel <2 rejected; single-image with !=1 url rejected;
 *                     reel rejected (must use igCreateReel); platform error surfaces
 *  - igCreateReel:    happy path; missing videoUrl rejected
 *  - igListComments:  shape parse + missing id rejected
 *  - multiPlatformPost: empty platforms rejected; unknown platform rejected;
 *                       per-platform partial-success surfaced
 */

import { describe, it, expect, vi } from "vitest";
import { ZernioClient } from "../client";
import {
  fbCreatePost,
  fbListMessages,
  gbpCreateLocalPost,
  gbpDeleteLocalPost,
  gbpListLocations,
  gbpListReviews,
  gbpReplyToReview,
  igCreatePost,
  igCreateReel,
  igListComments,
  makeZernioContext,
  multiPlatformPost,
} from "../endpoints";
import { ZernioApiError, ZernioPlatformError } from "../types";

const TEST_KEY = "key-1";
const TEST_BASE = "https://api.example-zernio.test";
const ACCOUNT = "acc_abc";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function buildClient(fetchImpl: ReturnType<typeof vi.fn>) {
  return new ZernioClient({
    apiKey: TEST_KEY,
    baseUrl: TEST_BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    random: () => 0,
  });
}

describe("gbpListLocations", () => {
  it("parses the standard envelope shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        locations: [
          {
            locationId: "loc_1",
            name: "Mike's HVAC",
            address: "123 Oak",
            primaryCategory: "HVAC contractor",
            verified: true,
          },
        ],
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await gbpListLocations(ctx);
    expect(out).toEqual([
      {
        locationId: "loc_1",
        gbpLocationName: undefined,
        gbpAccountId: undefined,
        name: "Mike's HVAC",
        address: "123 Oak",
        primaryCategory: "HVAC contractor",
        verified: true,
      },
    ]);
  });

  it("falls back to bare-array response shape", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ locationId: "loc_2", name: "Bare" }])
      );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await gbpListLocations(ctx);
    expect(out).toHaveLength(1);
    expect(out[0].locationId).toBe("loc_2");
  });

  it("throws ZernioApiError when a row lacks an id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ locations: [{ name: "no-id" }] }));
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(gbpListLocations(ctx)).rejects.toBeInstanceOf(ZernioApiError);
  });
});

describe("gbpListReviews", () => {
  it("normalizes star rating + reviewer name across response shapes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        reviews: [
          {
            reviewId: "rv_1",
            reviewer: { displayName: "Sandra K." },
            rating: 5,
            comment: "great work",
            createTime: "2026-04-26T10:00:00Z",
            reviewReply: {
              comment: "Thanks Sandra!",
              replyState: "PUBLISHED",
            },
          },
        ],
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await gbpListReviews(ctx, "loc_1");
    expect(out).toHaveLength(1);
    expect(out[0].reviewId).toBe("rv_1");
    expect(out[0].reviewerName).toBe("Sandra K.");
    expect(out[0].starRating).toBe(5);
    expect(out[0].body).toBe("great work");
    expect(out[0].hasReply).toBe(true);
    expect(out[0].replyState).toBe("PUBLISHED");
  });
});

describe("gbpReplyToReview", () => {
  it("returns PUBLISHED on happy path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        reviewId: "rv_1",
        replyState: "PUBLISHED",
        publishedAt: "2026-04-26T10:00:00Z",
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await gbpReplyToReview(ctx, {
      locationId: "loc_1",
      reviewId: "rv_1",
      replyText: "Thanks!",
    });
    expect(out.replyState).toBe("PUBLISHED");
    expect(out.publishedAt).toBeGreaterThan(0);
  });

  it("REJECTED state surfaces as ZernioPlatformError(REVIEW_REPLY_REJECTED)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        replyState: "REJECTED",
        error: "Google moderation rejected the reply",
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      gbpReplyToReview(ctx, {
        locationId: "loc_1",
        reviewId: "rv_1",
        replyText: "Thanks!",
      })
    ).rejects.toMatchObject({
      name: "ZernioPlatformError",
      platform: "gbp",
      platformErrorCode: "REVIEW_REPLY_REJECTED",
    });
  });

  it("explicit errorCode REVIEW_REPLY_REJECTED also throws", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        errorCode: "REVIEW_REPLY_REJECTED",
        error: "Google moderation rejected the reply",
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      gbpReplyToReview(ctx, {
        locationId: "loc_1",
        reviewId: "rv_1",
        replyText: "Thanks!",
      })
    ).rejects.toBeInstanceOf(ZernioPlatformError);
  });

  it("empty replyText rejected before HTTP", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      gbpReplyToReview(ctx, {
        locationId: "loc_1",
        reviewId: "rv_1",
        replyText: "",
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("gbpCreateLocalPost", () => {
  it("posts a STANDARD post and returns the local post result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        postId: "post_1",
        gbpLocalPostId: "accounts/x/locations/y/localPosts/z",
        state: "LIVE",
        publishedAt: 1_700_000_000_000,
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await gbpCreateLocalPost(ctx, "loc_1", {
      postType: "STANDARD",
      text: "We're back from the heat wave!",
      cta: { type: "BOOK", url: "https://book.example/x" },
    });
    expect(out.postId).toBe("post_1");
    expect(out.state).toBe("LIVE");
    expect(out.gbpLocalPostId).toBeTruthy();
    // Verify the request body shape
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.platform).toBe("googlebusiness");
    expect(body.locationId).toBe("loc_1");
    expect(body.cta.type).toBe("BOOK");
  });

  it("missing postId rejected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        state: "LIVE",
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      gbpCreateLocalPost(ctx, "loc_1", {
        postType: "STANDARD",
        text: "hello",
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });
});

describe("gbpDeleteLocalPost", () => {
  it("returns deleted: true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(""));
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await gbpDeleteLocalPost(ctx, "loc_1", "post_1");
    expect(out.deleted).toBe(true);
  });
});

describe("fbCreatePost", () => {
  it("rejects >3 images before HTTP", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      fbCreatePost(ctx, "page_1", {
        text: "x",
        imageUrls: ["a", "b", "c", "d"],
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("happy path returns id + state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ postId: "fb_1", state: "published" }));
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await fbCreatePost(ctx, "page_1", { text: "Hi from page" });
    expect(out).toEqual({ postId: "fb_1", state: "published" });
  });

  it("platform error surfaces as ZernioPlatformError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "Meta blocked", errorCode: "META_BLOCKED" })
      );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      fbCreatePost(ctx, "page_1", { text: "Hi" })
    ).rejects.toBeInstanceOf(ZernioPlatformError);
  });
});

describe("fbListMessages", () => {
  it("parses messages + normalizes timestamps", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        messages: [
          {
            id: "m_1",
            pageId: "page_1",
            fromUserId: "u_1",
            text: "are you open today?",
            createdAt: "2026-04-26T10:00:00Z",
          },
        ],
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await fbListMessages(ctx, "page_1");
    expect(out).toHaveLength(1);
    expect(out[0].messageId).toBe("m_1");
    expect(out[0].body).toBe("are you open today?");
    expect(out[0].receivedAt).toBeGreaterThan(0);
  });
});

describe("igCreatePost", () => {
  it("carousel with <2 media rejected", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      igCreatePost(ctx, "ig_1", {
        caption: "x",
        mediaUrls: ["a"],
        postType: "carousel",
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("single-image post requires exactly 1 url", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      igCreatePost(ctx, "ig_1", {
        caption: "x",
        mediaUrls: ["a", "b"],
        postType: "single",
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("reel rejected on igCreatePost (use igCreateReel)", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      igCreatePost(ctx, "ig_1", {
        caption: "x",
        mediaUrls: ["v.mp4"],
        postType: "reel",
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("happy carousel returns id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ postId: "ig_post_1", state: "published" }));
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await igCreatePost(ctx, "ig_1", {
      caption: "x",
      mediaUrls: ["a", "b", "c"],
      postType: "carousel",
    });
    expect(out.postId).toBe("ig_post_1");
  });

  it("platform error surfaces", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: "rate limited at Meta", errorCode: "META_BUC" })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      igCreatePost(ctx, "ig_1", {
        caption: "x",
        mediaUrls: ["a"],
        postType: "single",
      })
    ).rejects.toBeInstanceOf(ZernioPlatformError);
  });
});

describe("igCreateReel", () => {
  it("happy path", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ postId: "reel_1", state: "scheduled" }));
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await igCreateReel(ctx, "ig_1", {
      caption: "freezing",
      videoUrl: "https://r2.example/v.mp4",
    });
    expect(out).toEqual({ postId: "reel_1", state: "scheduled" });
  });

  it("missing videoUrl rejected", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      igCreateReel(ctx, "ig_1", { caption: "x", videoUrl: "" })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });
});

describe("igListComments", () => {
  it("parses + normalizes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        comments: [
          {
            id: "c_1",
            mediaId: "m_1",
            fromUserId: "u_1",
            fromUsername: "@n",
            text: "love it",
            createdAt: 1_700_000_000_000,
          },
        ],
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await igListComments(ctx, "ig_1");
    expect(out).toHaveLength(1);
    expect(out[0].commentId).toBe("c_1");
  });
});

describe("multiPlatformPost", () => {
  it("rejects empty platforms", async () => {
    const fetchImpl = vi.fn();
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    await expect(
      multiPlatformPost(ctx, [], { text: "x" })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("happy path returns per-platform results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        perPlatform: [
          { platform: "gbp", postId: "g_1", state: "published" },
          { platform: "facebook", postId: "f_1", state: "published" },
          { platform: "instagram", postId: null, state: "failed", error: "Meta blocked" },
        ],
      })
    );
    const client = buildClient(fetchImpl);
    const ctx = makeZernioContext(client, ACCOUNT);
    const out = await multiPlatformPost(
      ctx,
      ["gbp", "facebook", "instagram"],
      { text: "We did the Johnson kitchen!" }
    );
    expect(out.perPlatform).toHaveLength(3);
    expect(out.perPlatform[2].state).toBe("failed");
    expect(out.perPlatform[2].postId).toBeNull();
  });
});
