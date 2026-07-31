/**
 * 2026-07-22 — publish routing + error honesty, pinned after the live Zernio
 * deep-dive that ended six days of silent publish failures:
 *
 *   - EVERY live X attempt (07-16 → 07-22) failed "Tweet text is too long
 *     (400-600 chars vs 280)" and EVERY Reddit attempt failed subreddit
 *     post-guidance — because "replies" were submitted as TOP-LEVEL posts and
 *     the create-response wrapper shape hid Zernio's error strings.
 *
 * Contract pinned here:
 *   1. X overlong drafts fail FAST with the exact count, before any gate,
 *      confirm event, or Zernio call.
 *   2. X replies thread via platformSpecificData.replyToTweetId.
 *   3. Reddit replies go through POST /api/v1/inbox/comments/{threadId}
 *      (third-party commenting), never the top-level posts endpoint.
 *   4. The live `{ post, platformResults }` wrapper response parses, and a
 *      failed row surfaces Zernio's real error string — never a bare
 *      "no postId returned", and never the post-doc _id masquerading as a
 *      platform postId on a failed publish.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { xEffectiveLength, X_CHAR_LIMIT } from "../publishEngine";

/**
 * Fake timers so convex-test's scheduler never fires. These tests assert that
 * work was SCHEDULED (they query `_scheduled_functions`), never that it ran —
 * so letting a real timer fire it after teardown only produced
 * "Write outside of transaction" as an UNHANDLED rejection, which vitest
 * counts as a suite error and exits 1 even with every test green.
 */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string,
  platform: "x" | "reddit" | "linkedin"
): Promise<{ accountId: Id<"creators">; agentId: Id<"gtmAgents"> }> {
  const authed = t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    { channelPreference: "telegram", timezone: "America/New_York" }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, {
      connectedAccountsJson: JSON.stringify([
        { accountId: `acct_${platform}`, platform },
      ]),
      gtmPlanJson: JSON.stringify({ status: "active", tier: "starter" }),
    });
  });
  return { accountId: started.accountId, agentId: started.agentId };
}

describe("X char-limit preflight", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("xEffectiveLength counts URLs as 23 chars", () => {
    expect(xEffectiveLength("hello")).toBe(5);
    expect(
      xEffectiveLength(
        "check this https://example.com/a-very-long-path-that-goes-on-forever-and-ever out"
      )
    ).toBe("check this ".length + 23 + " out".length);
  });

  it("an overlong X draft fails fast with the exact count — no Zernio call, no confirm event", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_xlong", "x");
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const longDraft = "a".repeat(586);
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "x",
        zernioAccountId: "acct_x",
        content: longDraft,
        founderConfirmed: true,
      }
    )) as { action: string; reasons: string[] };
    expect(r.action).toBe("failed");
    expect(r.reasons[0]).toContain("x_char_limit");
    expect(r.reasons[0]).toContain("586");
    expect(r.reasons[0]).toContain(String(X_CHAR_LIMIT));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reply routing", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("an X reply threads via replyToTweetId on the posts endpoint", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_xreply", "x");
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: { body?: string }) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
        return jsonResponse(200, {
          post: {
            _id: "zp_doc",
            platforms: [
              { platform: "twitter", status: "published", platformPostId: "tw_99" },
            ],
          },
          platformResults: [{ platform: "twitter", status: "published" }],
        });
      })
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "x",
        zernioAccountId: "acct_x",
        content: "short sharp reply under the limit",
        targetExternalId: "2073066320581759297",
        founderConfirmed: true,
      }
    )) as { action: string; zernioPostId?: string };
    expect(r.action).toBe("auto");
    expect(r.zernioPostId).toBe("tw_99");
    const postCall = calls.find((c) => c.url.includes("/api/v1/posts"));
    expect(postCall).toBeTruthy();
    const body = postCall!.body as {
      platforms: Array<{ platformSpecificData?: { replyToTweetId?: string } }>;
    };
    expect(body.platforms[0].platformSpecificData?.replyToTweetId).toBe(
      "2073066320581759297"
    );
  });

  it("a Reddit reply goes through the inbox comments API, not the posts endpoint", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_rreply", "reddit");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return jsonResponse(200, { success: true, data: { commentId: "rc_42" } });
      })
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "reddit",
        zernioAccountId: "acct_reddit",
        content: "a genuinely helpful comment on the thread",
        targetExternalId: "1uq1t59",
        founderConfirmed: true,
      }
    )) as { action: string; zernioPostId?: string };
    expect(r.action).toBe("auto");
    expect(r.zernioPostId).toBe("rc_42");
    expect(calls.some((u) => u.includes("/api/v1/inbox/comments/1uq1t59"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/v1/posts"))).toBe(false);
  });
});

describe("live wrapper response shape — errors surface verbatim", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a failed platformResults row surfaces Zernio's real error, not 'no postId returned'", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_wrap", "linkedin");
    const liveError =
      "LinkedIn rejected the share: token lacks w_member_social scope.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          post: {
            _id: "zp_doc_fail",
            platforms: [
              { platform: "linkedin", status: "failed", errorMessage: liveError },
            ],
          },
          message: "Post created but publishing failed",
          error: "All platforms failed",
          platformResults: [
            { platform: "linkedin", status: "failed", error: liveError },
          ],
        })
      )
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "linkedin",
        zernioAccountId: "acct_linkedin",
        content: "a linkedin post",
        founderConfirmed: true,
      }
    )) as { action: string; reasons: string[] };
    expect(r.action).toBe("failed");
    expect(r.reasons[0]).toBe(liveError);
  });

  it("a failed row never inherits the post-doc _id as its postId", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_wrapid", "linkedin");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          post: { _id: "zp_doc_x", platforms: [{ platform: "linkedin", status: "failed" }] },
          platformResults: [{ platform: "linkedin", status: "failed" }],
        })
      )
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "linkedin",
        zernioAccountId: "acct_linkedin",
        content: "another linkedin post",
        founderConfirmed: true,
      }
    )) as { action: string; zernioPostId?: string };
    expect(r.action).toBe("failed");
    expect(r.zernioPostId).toBeUndefined();
  });
});

describe("Zernio-native preflight (validate/post)", () => {
  beforeEach(() => vi.stubEnv("ZERNIO_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a preflight rejection fails with the platform's real error and never hits the posts endpoint", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_preflight", "linkedin");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        calls.push(u);
        if (u.includes("/tools/validate/post")) {
          return jsonResponse(200, {
            valid: false,
            errors: [
              { platform: "linkedin", error: "Text exceeds LinkedIn's 3000 character limit" },
            ],
          });
        }
        return jsonResponse(200, {});
      })
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "linkedin",
        zernioAccountId: "acct_linkedin",
        content: "pretend this is 4000 chars",
        founderConfirmed: true,
      }
    )) as { action: string; reasons: string[] };
    expect(r.action).toBe("failed");
    expect(r.reasons[0]).toContain("3000 character limit");
    expect(calls.some((u) => u.endsWith("/api/v1/posts"))).toBe(false);
  });

  it("preflight API failure is advisory — the publish proceeds and reports its own truth", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_prefadvise", "linkedin");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/tools/validate/post")) {
          return new Response("boom", { status: 500 });
        }
        return jsonResponse(200, {
          post: {
            _id: "zp_ok2",
            platforms: [
              { platform: "linkedin", status: "published", platformPostId: "li_1" },
            ],
          },
          platformResults: [{ platform: "linkedin", status: "published" }],
        });
      })
    );
    // ZernioClient retries the failing preflight with a real setTimeout
    // backoff. Under this file's fake timers that never resolves on its own,
    // so drive the clock while the action is in flight rather than dropping
    // back to real timers (which would let the scheduler fire post-teardown).
    const pending = t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "linkedin",
        zernioAccountId: "acct_linkedin",
        content: "a fine post",
        founderConfirmed: true,
      }
    );
    // Let the backoff elapse on the fake clock, then take the result.
    await vi.advanceTimersByTimeAsync(30_000);
    const r = (await pending) as { action: string; zernioPostId?: string };
    expect(r.action).toBe("auto");
    expect(r.zernioPostId).toBe("li_1");
  });

  it("a Reddit reply carries the subreddit resolved from the saved target thread", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "c_rsub", "reddit");
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmTargetThreads", {
        accountId: a.accountId,
        agentId: a.agentId,
        platform: "reddit",
        externalId: "1uq1t59",
        subredditOrCommunity: "indiehackers",
        currentMetrics: {},
        lastSeenMetricsAtMs: Date.now(),
        whyItFits: "exact ICP thread",
        title: "distribution thread",
        url: "https://reddit.com/r/indiehackers/comments/1uq1t59/x/",
        excerpt: "solo dev distribution",
        status: "queued",
        priorityScore: 0.9,
        recommendedAction: "reply",
        grounded: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: { body?: string }) => {
        if (String(url).includes("/api/v1/inbox/comments/")) {
          bodies.push(init?.body ? JSON.parse(init.body) : {});
          return jsonResponse(200, { success: true, data: { commentId: "rc_sub" } });
        }
        return jsonResponse(200, {});
      })
    );
    const r = (await t.action(
      internal.gtmMaya.publishEngine.publishContentDirect,
      {
        agentId: a.agentId,
        channel: "reddit",
        zernioAccountId: "acct_reddit",
        content: "helpful comment",
        targetExternalId: "1uq1t59",
        founderConfirmed: true,
      }
    )) as { action: string };
    expect(r.action).toBe("auto");
    expect(bodies[0]?.subreddit).toBe("indiehackers");
  });
});
