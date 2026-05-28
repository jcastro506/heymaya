/**
 * Sprint 2.27b — real metric fetch for Reddit + HN (no OAuth required).
 *
 * Validates:
 *   1. fetchRedditMetrics parses ups + num_comments from listing JSON
 *   2. fetchRedditMetrics handles single-thread URL response shape
 *   3. fetchRedditMetrics returns null on HTTP error / timeout / bad JSON
 *   4. fetchHnMetrics returns points + recursive comment count
 *   5. fetchHnMetrics returns null on failure
 *   6. pollAndRecordPostMetrics writes real metrics for reddit when fetch succeeds
 *   7. pollAndRecordPostMetrics writes zeros with "needs_oauth" note for x platform
 *   8. pollAndRecordPostMetrics writes zeros with "fetch failed" note when reddit JSON is bad
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import {
  fetchRedditMetrics,
  fetchHnMetrics,
} from "../recordPublished";
import type { Id } from "../../_generated/dataModel";

async function setupAgent(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: `App for ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  return { authed, accountId: started.accountId, agentId: started.agentId };
}

async function createPublishedDraft(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">,
  accountId: Id<"creators">,
  platform: "reddit" | "x" | "hn",
  providerPostId: string
): Promise<Id<"gtmDraftedContent">> {
  const draftId = await t.run((ctx) =>
    ctx.db.insert("gtmDraftedContent", {
      accountId,
      agentId,
      kind: "reply",
      platform,
      draftText: "body",
      slopCriticPassed: true,
      approvalState: "approved",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  await t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
    agentId,
    accountId,
    draftId,
    providerPostId,
    platform,
  });
  return draftId;
}

describe("Sprint 2.27b — fetchRedditMetrics", () => {
  it("parses ups + num_comments from listing response (t3_id route)", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            children: [
              { data: { ups: 142, num_comments: 28, view_count: 1500 } },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    const result = await fetchRedditMetrics("t3_abc123", fakeFetch);
    expect(result).toEqual({ likes: 142, comments: 28, views: 1500 });
  });

  it("parses single-thread URL response shape ([postListing, commentsListing])", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify([
          {
            data: {
              children: [{ data: { ups: 50, num_comments: 12 } }],
            },
          },
          { data: { children: [] } },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;
    const result = await fetchRedditMetrics(
      "https://reddit.com/r/test/comments/xyz/title",
      fakeFetch
    );
    expect(result?.likes).toBe(50);
    expect(result?.comments).toBe(12);
    expect(result?.views).toBe(0); // not provided
  });

  it("returns null on HTTP 404 (deleted post)", async () => {
    const fakeFetch = (async () => new Response("Not Found", { status: 404 })) as typeof fetch;
    const result = await fetchRedditMetrics("t3_dead", fakeFetch);
    expect(result).toBeNull();
  });

  it("returns null on fetch throw (timeout / network error)", async () => {
    const fakeFetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const result = await fetchRedditMetrics("t3_x", fakeFetch);
    expect(result).toBeNull();
  });

  it("returns null on unexpected shape (no children)", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ data: { children: [] } }), {
        status: 200,
      })) as typeof fetch;
    const result = await fetchRedditMetrics("t3_empty", fakeFetch);
    expect(result).toBeNull();
  });
});

describe("Sprint 2.27b — fetchHnMetrics", () => {
  it("returns points + recursive comment count", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          points: 87,
          children: [
            {
              id: 1,
              children: [
                { id: 2, children: [] },
                { id: 3, children: [{ id: 4, children: [] }] },
              ],
            },
            { id: 5, children: [] },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    const result = await fetchHnMetrics("123456", fakeFetch);
    expect(result?.likes).toBe(87);
    // 5 descendants total: ids 1,2,3,4,5
    expect(result?.comments).toBe(5);
    expect(result?.views).toBe(0);
  });

  it("returns null on HTTP error", async () => {
    const fakeFetch = (async () =>
      new Response("err", { status: 500 })) as typeof fetch;
    const result = await fetchHnMetrics("404", fakeFetch);
    expect(result).toBeNull();
  });

  it("handles HN item with no children (no comments)", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ points: 3 }), { status: 200 })) as typeof fetch;
    const result = await fetchHnMetrics("1", fakeFetch);
    expect(result?.likes).toBe(3);
    expect(result?.comments).toBe(0);
  });
});

describe("Sprint 2.27b — pollAndRecordPostMetrics dispatcher", () => {
  it("writes real reddit metrics when public JSON succeeds", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_poll_reddit_real");

    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            children: [{ data: { ups: 200, num_comments: 41 } }],
          },
        }),
        { status: 200 }
      )) as typeof fetch;

    try {
      const draftId = await createPublishedDraft(
        t,
        agentId,
        accountId,
        "reddit",
        "t3_real"
      );

      const result = await t.action(
        internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
        {
          agentId,
          accountId,
          draftId,
          providerPostId: "t3_real",
          platform: "reddit",
          window: "t_plus_2h",
        }
      );

      const snapshot = await t.run((ctx) => ctx.db.get(result.snapshotId));
      expect(snapshot?.metrics.likes).toBe(200);
      expect(snapshot?.metrics.comments).toBe(41);
      expect(snapshot?.notes).toMatch(/reddit_public_json/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("writes zeros + needs_oauth note for x platform", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_poll_x_oauth");
    const draftId = await createPublishedDraft(
      t,
      agentId,
      accountId,
      "x",
      "x_post_123"
    );

    const result = await t.action(
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId,
        accountId,
        draftId,
        providerPostId: "x_post_123",
        platform: "x",
        window: "t_plus_2h",
      }
    );

    const snapshot = await t.run((ctx) => ctx.db.get(result.snapshotId));
    expect(snapshot?.metrics).toEqual({
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
    });
    expect(snapshot?.notes).toMatch(/needs_oauth/);
  });

  it("writes zeros + fetch_failed note when reddit JSON is broken", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_poll_reddit_fail");

    const originalFetch = global.fetch;
    global.fetch = (async () => new Response("oops", { status: 503 })) as typeof fetch;

    try {
      const draftId = await createPublishedDraft(
        t,
        agentId,
        accountId,
        "reddit",
        "t3_broken"
      );

      const result = await t.action(
        internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
        {
          agentId,
          accountId,
          draftId,
          providerPostId: "t3_broken",
          platform: "reddit",
          window: "t_plus_24h",
        }
      );

      const snapshot = await t.run((ctx) => ctx.db.get(result.snapshotId));
      expect(snapshot?.metrics.likes).toBe(0);
      expect(snapshot?.notes).toMatch(/reddit fetch failed/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
