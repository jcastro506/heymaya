/**
 * Zernio 1.0.4 CONTRACT tests — request-builder fidelity.
 *
 * S1 ("fix every [unverified] divergence"). These tests do NOT hit the
 * network: they install a fake `fetchImpl` on `ZernioClient` (the same test
 * seam the existing `client.test.ts` uses), capture the outgoing `url` + JSON
 * `body`, and assert our request BUILDERS produce spec-correct requests
 * against the OpenAPI 3.1 contract in `docs/zernio_openapi_1.0.4.yaml`.
 *
 * Verified contract facts (some live):
 *   - host `https://zernio.com`, paths `/api/v1/...`  → `https://zernio.com/api/v1/...`
 *   - X/Twitter connect+platform slug is `twitter`, NOT `x` (LIVE)
 *   - POST /posts body = { content, platforms: PlatformTarget[], publishNow |
 *     scheduledFor+timezone, mediaItems, title?, tiktokSettings? }
 *   - PlatformTarget carries per-target settings on `platformSpecificData`
 *   - webhook `events[]` enum has NO `mention.received` / `lead.received`
 */

import { describe, it, expect, vi } from "vitest";
import { ZernioClient } from "../client";
import {
  createProfile,
  createWebhook,
  deleteAccount,
  getAccountsHealth,
  getConnectUrl,
  getBestTime,
  getFollowerStats,
  getPostAnalytics,
  getPostTimeline,
  listAccounts,
  listConversations,
  listInboxComments,
  makeZernioContext,
  multiPlatformPost,
  presignMedia,
  replyToComment,
  sendDm,
  zernioWireSlug,
} from "../endpoints";
import { ZernioApiError } from "../types";

const TEST_KEY = "key-contract";
const TEST_BASE = "https://zernio.com";
const ACCOUNT = "acc_main";
const PROFILE = "prof_123";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/**
 * Build a client whose fake fetch records every call and returns `body` for
 * each. Returns the client plus the recorded-call accessors.
 */
function recordingClient(responseBody: unknown = {}) {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(responseBody));
  const client = new ZernioClient({
    apiKey: TEST_KEY,
    baseUrl: TEST_BASE,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    random: () => 0,
  });
  return {
    client,
    fetchImpl,
    lastUrl(): string {
      return String(fetchImpl.mock.calls.at(-1)![0]);
    },
    lastBody(): Record<string, unknown> {
      const init = fetchImpl.mock.calls.at(-1)![1] as RequestInit;
      return init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    },
    lastMethod(): string {
      const init = fetchImpl.mock.calls.at(-1)![1] as RequestInit;
      return (init.method as string) ?? "GET";
    },
  };
}

/* -------------------------------------------------------------------------- */
/* multiPlatformPost — the auto-post body                                      */
/* -------------------------------------------------------------------------- */

describe("multiPlatformPost — spec POST /api/v1/posts body", () => {
  it("X target sends platforms:[{platform:'twitter',accountId}] + content + publishNow", async () => {
    const rec = recordingClient({ platforms: [{ platform: "twitter", status: "published", platformPostId: "tw_1" }] });
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    const out = await multiPlatformPost(ctx, ["x"], { text: "ship day" });

    expect(rec.lastUrl()).toBe("https://zernio.com/api/v1/posts");
    expect(rec.lastMethod()).toBe("POST");
    const body = rec.lastBody();
    expect(body.content).toBe("ship day");
    expect(body.publishNow).toBe(true);
    expect(body.scheduledFor).toBeUndefined();
    // NOT the old shape:
    expect(body.accountId).toBeUndefined();
    expect(body.mediaUrls).toBeUndefined();
    expect(body.perPlatformOverrides).toBeUndefined();
    expect(body.scheduleAt).toBeUndefined();
    // PlatformTarget[] with the wire slug:
    const platforms = body.platforms as Array<Record<string, unknown>>;
    expect(platforms).toHaveLength(1);
    expect(platforms[0].platform).toBe("twitter");
    expect(platforms[0].accountId).toBe(ACCOUNT);
    // Response mapped back to internal name + published state:
    expect(out.perPlatform[0].platform).toBe("x");
    expect(out.perPlatform[0].state).toBe("published");
    expect(out.perPlatform[0].postId).toBe("tw_1");
  });

  it("LinkedIn first-comment link-drop: URL rides platformSpecificData.firstComment, never the caption (recovers the reach penalty)", async () => {
    const rec = recordingClient({
      platforms: [{ platform: "linkedin", status: "scheduled", platformPostId: "li_1" }],
    });
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    await multiPlatformPost(ctx, ["linkedin"], {
      text: "what I learned shipping in public",
      platformData: { linkedin: { firstComment: "https://hey-maya.ai" } },
    });
    const body = rec.lastBody();
    // The link is OUT of the caption:
    expect(body.content).toBe("what I learned shipping in public");
    expect(String(body.content)).not.toContain("hey-maya.ai");
    // ...and rides the target's platformSpecificData.firstComment instead:
    const platforms = body.platforms as Array<Record<string, unknown>>;
    const psd = platforms[0].platformSpecificData as Record<string, unknown>;
    expect(psd.firstComment).toBe("https://hey-maya.ai");
  });

  it("explicit per-target accountId + platformSpecificData attaches on the target (NOT a top-level overrides object)", async () => {
    const rec = recordingClient({ platforms: [{ platform: "reddit", status: "published" }] });
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    await multiPlatformPost(
      ctx,
      [
        {
          platform: "reddit",
          accountId: "rdt_acc",
          platformSpecificData: { subreddit: "SideProject", title: "I built X" },
        },
      ],
      { text: "body text" }
    );
    const platforms = rec.lastBody().platforms as Array<Record<string, unknown>>;
    expect(platforms[0].platform).toBe("reddit");
    expect(platforms[0].accountId).toBe("rdt_acc");
    expect(platforms[0].platformSpecificData).toEqual({
      subreddit: "SideProject",
      title: "I built X",
    });
  });

  it("scheduleAt sends scheduledFor (ISO) + timezone, no publishNow", async () => {
    const rec = recordingClient({ platforms: [{ platform: "twitter", status: "scheduled" }] });
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    const when = Date.UTC(2026, 5, 10, 15, 0, 0);
    const out = await multiPlatformPost(ctx, ["x"], {
      text: "later",
      scheduleAt: when,
      timezone: "America/New_York",
    });
    const body = rec.lastBody();
    expect(body.publishNow).toBeUndefined();
    expect(body.scheduledFor).toBe(new Date(when).toISOString());
    expect(body.timezone).toBe("America/New_York");
    expect(out.perPlatform[0].state).toBe("scheduled");
  });

  it("lifts legacy `media` into mediaItems and allows empty content when media present", async () => {
    const rec = recordingClient({ platforms: [{ platform: "instagram", status: "published" }] });
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    await multiPlatformPost(ctx, ["instagram"], {
      text: "",
      media: [{ url: "https://cdn/x.jpg", mediaType: "image" }],
    });
    const body = rec.lastBody();
    expect(body.content).toBeUndefined(); // empty content omitted
    expect(body.mediaItems).toEqual([{ type: "image", url: "https://cdn/x.jpg" }]);
  });

  it("top-level tiktokSettings is forwarded (camelCase contentPreviewConfirmed)", async () => {
    const rec = recordingClient({ platforms: [{ platform: "tiktok", status: "published" }] });
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    await multiPlatformPost(ctx, ["tiktok"], {
      text: "clip",
      tiktokSettings: { draft: true, contentPreviewConfirmed: true, privacyLevel: "SELF_ONLY" },
    });
    expect(rec.lastBody().tiktokSettings).toEqual({
      draft: true,
      contentPreviewConfirmed: true,
      privacyLevel: "SELF_ONLY",
    });
  });

  it("rejects empty targets", async () => {
    const rec = recordingClient();
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    await expect(multiPlatformPost(ctx, [], { text: "x" })).rejects.toBeInstanceOf(
      ZernioApiError
    );
  });

  it("rejects empty content with no media", async () => {
    const rec = recordingClient();
    const ctx = makeZernioContext(rec.client, ACCOUNT);
    await expect(
      multiPlatformPost(ctx, ["x"], { text: "" })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("parses the real `platforms[]` echo shape AND the legacy `perPlatform[]` shape", async () => {
    // legacy fixture shape still works
    const legacy = recordingClient({
      perPlatform: [{ platform: "twitter", postId: "p1", state: "published" }],
    });
    const ctxL = makeZernioContext(legacy.client, ACCOUNT);
    const outL = await multiPlatformPost(ctxL, ["x"], { text: "a" });
    expect(outL.perPlatform[0].platform).toBe("x");
    expect(outL.perPlatform[0].postId).toBe("p1");
  });
});

/* -------------------------------------------------------------------------- */
/* getConnectUrl — x→twitter slug map                                          */
/* -------------------------------------------------------------------------- */

describe("getConnectUrl — connect slug + profileId query", () => {
  it("maps x→twitter and requires profileId in the query", async () => {
    const rec = recordingClient({ authUrl: "https://twitter.com/oauth", state: "st_1" });
    const out = await getConnectUrl(rec.client, "x", PROFILE, "https://app/cb");
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/connect/twitter");
    expect(url.searchParams.get("profileId")).toBe(PROFILE);
    expect(url.searchParams.get("redirect_url")).toBe("https://app/cb");
    expect(out.authUrl).toBe("https://twitter.com/oauth");
    expect(out.state).toBe("st_1");
  });

  it("passes reddit / youtube / linkedin slugs through unchanged", async () => {
    for (const [internal, slug] of [
      ["reddit", "reddit"],
      ["youtube", "youtube"],
      ["linkedin", "linkedin"],
      ["instagram", "instagram"],
      ["gbp", "googlebusiness"],
    ] as const) {
      const rec = recordingClient({ authUrl: "u", state: "s" });
      await getConnectUrl(rec.client, internal, PROFILE);
      expect(new URL(rec.lastUrl()).pathname).toBe(`/api/v1/connect/${slug}`);
    }
  });

  it("rejects missing profileId", async () => {
    const rec = recordingClient();
    await expect(getConnectUrl(rec.client, "x", "")).rejects.toBeInstanceOf(
      ZernioApiError
    );
  });

  it("zernioWireSlug helper maps x→twitter", () => {
    expect(zernioWireSlug("x")).toBe("twitter");
    expect(zernioWireSlug("gbp")).toBe("googlebusiness");
    expect(zernioWireSlug("reddit")).toBe("reddit");
  });
});

/* -------------------------------------------------------------------------- */
/* createProfile                                                               */
/* -------------------------------------------------------------------------- */

describe("createProfile — POST /api/v1/profiles", () => {
  it("sends {name, description, color} and returns the profile", async () => {
    const rec = recordingClient({
      message: "created",
      profile: { _id: "prof_new", name: "Acme" },
    });
    const out = await createProfile(rec.client, {
      name: "Acme",
      description: "the app",
      color: "#fff",
    });
    expect(rec.lastUrl()).toBe("https://zernio.com/api/v1/profiles");
    expect(rec.lastMethod()).toBe("POST");
    expect(rec.lastBody()).toEqual({
      name: "Acme",
      description: "the app",
      color: "#fff",
    });
    expect(out._id).toBe("prof_new");
  });

  it("rejects empty name", async () => {
    const rec = recordingClient();
    await expect(createProfile(rec.client, { name: "" })).rejects.toBeInstanceOf(
      ZernioApiError
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Read endpoints — path + query param fidelity                                */
/* -------------------------------------------------------------------------- */

describe("read wrappers hit the right paths with the right query params", () => {
  it("listAccounts → GET /api/v1/accounts", async () => {
    const rec = recordingClient({ accounts: [{ _id: "a1" }], hasAnalyticsAccess: true });
    const out = await listAccounts(rec.client, {
      profileId: PROFILE,
      platform: "twitter",
      includeOverLimit: true,
      page: 2,
      limit: 50,
    });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/accounts");
    expect(url.searchParams.get("profileId")).toBe(PROFILE);
    expect(url.searchParams.get("platform")).toBe("twitter");
    expect(url.searchParams.get("includeOverLimit")).toBe("true");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(out).toHaveLength(1);
  });

  it("getAccountsHealth → GET /api/v1/accounts/health", async () => {
    const rec = recordingClient({ summary: { total: 3, healthy: 2 }, accounts: [] });
    const out = await getAccountsHealth(rec.client, { profileId: PROFILE, status: "warning" });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/accounts/health");
    expect(url.searchParams.get("profileId")).toBe(PROFILE);
    expect(url.searchParams.get("status")).toBe("warning");
    expect(out.summary.total).toBe(3);
  });

  it("deleteAccount → DELETE /api/v1/accounts/{accountId}", async () => {
    const rec = recordingClient({});
    const out = await deleteAccount(rec.client, "acc/with space");
    expect(rec.lastMethod()).toBe("DELETE");
    expect(new URL(rec.lastUrl()).pathname).toBe("/api/v1/accounts/acc%2Fwith%20space");
    expect(out.deleted).toBe(true);
  });

  it("getPostAnalytics → GET /api/v1/analytics with full query", async () => {
    const rec = recordingClient({ impressions: 100, likes: 5 });
    const out = await getPostAnalytics(rec.client, {
      postId: "post_1",
      platform: "twitter",
      profileId: PROFILE,
      accountId: "acc_1",
      source: "platform",
      fromDate: "2026-06-01",
      toDate: "2026-06-02",
      sortBy: "impressions",
      order: "desc",
    });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/analytics");
    expect(url.searchParams.get("postId")).toBe("post_1");
    expect(url.searchParams.get("source")).toBe("platform");
    expect(url.searchParams.get("fromDate")).toBe("2026-06-01");
    expect(url.searchParams.get("sortBy")).toBe("impressions");
    expect(out.impressions).toBe(100);
  });

  it("getFollowerStats → GET /api/v1/accounts/follower-stats, comma-joins accountIds", async () => {
    const rec = recordingClient({ accounts: [], dateRange: {}, aggregation: {} });
    await getFollowerStats(rec.client, {
      accountIds: ["a1", "a2"],
      profileId: PROFILE,
      granularity: "day",
    });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/accounts/follower-stats");
    expect(url.searchParams.get("accountIds")).toBe("a1,a2");
    expect(url.searchParams.get("granularity")).toBe("day");
  });

  it("getPostTimeline → GET /api/v1/analytics/post-timeline (closed-loop moat)", async () => {
    const rec = recordingClient({ timeline: [{ date: "2026-06-01", impressions: 40 }] });
    const out = await getPostTimeline(rec.client, {
      postId: "post_9",
      fromDate: "2026-06-01",
      toDate: "2026-06-07",
    });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/analytics/post-timeline");
    expect(url.searchParams.get("postId")).toBe("post_9");
    expect(url.searchParams.get("fromDate")).toBe("2026-06-01");
    // lenient passthrough surfaces the raw envelope:
    expect((out.raw as { timeline: unknown[] }).timeline).toHaveLength(1);
  });

  it("getBestTime → GET /api/v1/analytics/best-time", async () => {
    const rec = recordingClient({ slots: [{ day_of_week: 1, hour: 9, avg_engagement: 0.04 }] });
    const out = await getBestTime(rec.client, { platform: "linkedin", profileId: PROFILE });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/analytics/best-time");
    expect(url.searchParams.get("platform")).toBe("linkedin");
    expect(url.searchParams.get("profileId")).toBe(PROFILE);
    expect((out.raw as { slots: unknown[] }).slots).toHaveLength(1);
  });

  it("listInboxComments → GET /api/v1/inbox/comments", async () => {
    const rec = recordingClient({ data: [{ id: "c1", content: "nice" }] });
    const out = await listInboxComments(rec.client, {
      profileId: PROFILE,
      platform: "instagram",
      since: "2026-06-01T00:00:00Z",
      limit: 25,
      cursor: "cur_1",
    });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/inbox/comments");
    expect(url.searchParams.get("platform")).toBe("instagram");
    expect(url.searchParams.get("cursor")).toBe("cur_1");
    expect(out[0].id).toBe("c1");
  });

  it("listConversations → GET /api/v1/inbox/conversations", async () => {
    const rec = recordingClient({ data: [{ id: "conv_1" }] });
    const out = await listConversations(rec.client, { profileId: PROFILE, status: "open" });
    const url = new URL(rec.lastUrl());
    expect(url.pathname).toBe("/api/v1/inbox/conversations");
    expect(url.searchParams.get("status")).toBe("open");
    expect(out[0].id).toBe("conv_1");
  });
});

/* -------------------------------------------------------------------------- */
/* Inbox write endpoints                                                       */
/* -------------------------------------------------------------------------- */

describe("inbox write wrappers — templated POST paths + required body", () => {
  it("replyToComment → POST /api/v1/inbox/comments/{postId} body {accountId, message}", async () => {
    const rec = recordingClient({ success: true, id: "c_reply" });
    const out = await replyToComment(rec.client, {
      postId: "post_9",
      accountId: "acc_1",
      message: "thanks!",
      commentId: "c_parent",
    });
    expect(rec.lastMethod()).toBe("POST");
    expect(new URL(rec.lastUrl()).pathname).toBe("/api/v1/inbox/comments/post_9");
    expect(rec.lastBody()).toEqual({
      accountId: "acc_1",
      message: "thanks!",
      commentId: "c_parent",
    });
    expect(out.success).toBe(true);
  });

  it("replyToComment rejects missing message", async () => {
    const rec = recordingClient();
    await expect(
      replyToComment(rec.client, { postId: "p", accountId: "a", message: "" })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });

  it("sendDm → POST /api/v1/inbox/conversations/{id}/messages body {accountId, message}", async () => {
    const rec = recordingClient({ success: true, messageId: "m_1" });
    const out = await sendDm(rec.client, {
      conversationId: "conv_5",
      accountId: "acc_1",
      message: "hi",
    });
    expect(new URL(rec.lastUrl()).pathname).toBe(
      "/api/v1/inbox/conversations/conv_5/messages"
    );
    expect(rec.lastBody()).toEqual({ accountId: "acc_1", message: "hi" });
    expect(out.id).toBe("m_1");
  });
});

/* -------------------------------------------------------------------------- */
/* presignMedia + createWebhook                                                */
/* -------------------------------------------------------------------------- */

describe("presignMedia — POST /api/v1/media/presign", () => {
  it("sends {filename, contentType, size}", async () => {
    const rec = recordingClient({ files: [{ uploadUrl: "u", url: "https://cdn/x.jpg" }] });
    const out = await presignMedia(rec.client, {
      filename: "x.jpg",
      contentType: "image/jpeg",
      size: 1234,
    });
    expect(new URL(rec.lastUrl()).pathname).toBe("/api/v1/media/presign");
    expect(rec.lastBody()).toEqual({
      filename: "x.jpg",
      contentType: "image/jpeg",
      size: 1234,
    });
    expect(out.files).toHaveLength(1);
  });

  it("rejects missing filename / contentType", async () => {
    const rec = recordingClient();
    await expect(
      presignMedia(rec.client, { filename: "", contentType: "image/jpeg" })
    ).rejects.toBeInstanceOf(ZernioApiError);
    await expect(
      presignMedia(rec.client, { filename: "x.jpg", contentType: "" })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });
});

describe("createWebhook — POST /api/v1/webhooks/settings + event-name guard", () => {
  it("sends only valid event names", async () => {
    const rec = recordingClient({ _id: "wh_1" });
    const out = await createWebhook(rec.client, {
      name: "maya",
      url: "https://app/webhook",
      events: ["post.published", "post.failed", "review.new"],
      secret: "s3cr3t",
    });
    expect(new URL(rec.lastUrl()).pathname).toBe("/api/v1/webhooks/settings");
    const body = rec.lastBody();
    expect(body.events).toEqual(["post.published", "post.failed", "review.new"]);
    expect(body.secret).toBe("s3cr3t");
    expect(out.id).toBe("wh_1");
  });

  it("rejects an event name not in the spec (e.g. mention.received / lead.received)", async () => {
    const rec = recordingClient({ _id: "wh_1" });
    await expect(
      createWebhook(rec.client, {
        name: "maya",
        url: "https://app/webhook",
        // cast through unknown — these names are NOT in ZernioWebhookSubscribableEvent
        events: ["mention.received"] as unknown as Array<"post.published">,
      })
    ).rejects.toBeInstanceOf(ZernioApiError);
    // never reached the network
    expect(rec.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects empty events", async () => {
    const rec = recordingClient();
    await expect(
      createWebhook(rec.client, { name: "n", url: "u", events: [] })
    ).rejects.toBeInstanceOf(ZernioApiError);
  });
});
