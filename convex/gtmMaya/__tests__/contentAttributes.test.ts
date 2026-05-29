/**
 * Sprint C3 — content-attribute tags persist through /lc_gtm/drafted_content
 * so the weekly review can correlate attributes → outcomes.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

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
    name: `App ${subject}`,
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const hookToken = "fake-hook-" + Math.random().toString(36).slice(2);
  await t.run(async (ctx) => {
    await ctx.db.patch(started.agentId, { hookToken });
  });
  return { agentId: started.agentId, hookToken };
}

describe("Sprint C3 — content-attribute tags", () => {
  it("persists attributes on a drafted_content row", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_attr_tags");

    const res = await t.fetch("/lc_gtm/drafted_content", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "d1",
        kind: "post",
        platform: "x",
        draftText: "build-in-public update on the bug-context problem",
        attributes: {
          hookType: "punchy-question",
          format: "build-in-public",
          tone: "casual",
          lengthBucket: "short",
          hasFace: false,
          captionStyle: "lowercase",
          postingWindow: "tue-am",
        },
      }),
    });
    expect(res.status).toBe(200);

    const drafts = await t.run(async (ctx) =>
      ctx.db
        .query("gtmDraftedContent")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0].attributes?.hookType).toBe("punchy-question");
    expect(drafts[0].attributes?.format).toBe("build-in-public");
    expect(drafts[0].attributes?.hasFace).toBe(false);
    expect(drafts[0].attributes?.postingWindow).toBe("tue-am");
  });

  it("a draft without attributes still works (back-compat)", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_attr_none");
    const res = await t.fetch("/lc_gtm/drafted_content", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "d2",
        kind: "post",
        platform: "reddit",
        draftText: "no attributes here",
      }),
    });
    expect(res.status).toBe(200);
    const drafts = await t.run(async (ctx) =>
      ctx.db
        .query("gtmDraftedContent")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(drafts[0].attributes).toBeUndefined();
  });

  // Sprint H — youtube is a first-class platform (schema enum round-trip).
  it("accepts a youtube drafted_content row", async () => {
    const t = convexTest(schema, modules);
    const { agentId, hookToken } = await setupAgent(t, "u_attr_yt");
    const res = await t.fetch("/lc_gtm/drafted_content", {
      method: "POST",
      headers: {
        authorization: `Bearer ${hookToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "yt1",
        kind: "post",
        platform: "youtube",
        draftText: "Short: the bug-context problem in 30s",
      }),
    });
    expect(res.status).toBe(200);
    const drafts = await t.run(async (ctx) =>
      ctx.db
        .query("gtmDraftedContent")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect()
    );
    expect(drafts[0].platform).toBe("youtube");
  });
});
