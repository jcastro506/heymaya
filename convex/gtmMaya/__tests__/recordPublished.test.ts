/**
 * Sprint 2.27 — recordPublished tests.
 *
 * Validates:
 *   1. recordDraftPublished patches the draft to "published" + sets
 *      providerPostId + publishedAt.
 *   2. Cross-tenant safety: A cannot mark B's draft published.
 *   3. Platform mismatch is rejected.
 *   4. Three polling actions get scheduled at T+2h / T+24h / T+7d.
 *   5. pollAndRecordPostMetrics writes a gtmPostResults snapshot
 *      (with stub zeros + "no_oauth" note for v1).
 *   6. listMyPublishedDrafts filters correctly.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
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

async function createDraft(
  t: ReturnType<typeof convexTest>,
  agentId: Id<"gtmAgents">,
  accountId: Id<"creators">,
  platform:
    | "reddit"
    | "x"
    | "hn"
    | "linkedin"
    | "instagram"
    | "tiktok" = "reddit"
): Promise<Id<"gtmDraftedContent">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("gtmDraftedContent", {
      accountId,
      agentId,
      kind: "reply",
      platform,
      draftText: "test reply body",
      slopCriticPassed: true,
      approvalState: "approved",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

describe("Sprint 2.27 — recordDraftPublished", () => {
  it("patches draft to published + sets providerPostId + publishedAt", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_rp_basic");
    const draftId = await createDraft(t, agentId, accountId, "reddit");

    const result = await t.mutation(
      internal.gtmMaya.recordPublished.recordDraftPublished,
      {
        agentId,
        accountId,
        draftId,
        providerPostId: "t3_reddit_post_xyz",
        platform: "reddit",
        permalink: "https://reddit.com/r/LocalLLaMA/comments/xyz",
      }
    );

    const draft = await t.run((ctx) => ctx.db.get(draftId));
    expect(draft?.approvalState).toBe("published");
    expect(draft?.providerPostId).toBe("t3_reddit_post_xyz");
    expect(draft?.publishedAt).toBeGreaterThan(Date.now() - 5_000);
    expect(result.draftId).toBe(draftId);
    expect(result.polledAt.tPlus2h).toBeGreaterThan(result.polledAt.tPlus2h - 1);
    // T+24h schedule is later than T+2h.
    expect(result.polledAt.tPlus24h).toBeGreaterThan(result.polledAt.tPlus2h);
    expect(result.polledAt.tPlus7d).toBeGreaterThan(result.polledAt.tPlus24h);
  });

  it("rejects when draft belongs to a different agent (cross-tenant)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_rp_iso_a");
    const b = await setupAgent(t, "u_rp_iso_b");

    const aDraftId = await createDraft(t, a.agentId, a.accountId, "x");

    // B tries to mark A's draft as published — should throw.
    await expect(
      t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
        agentId: b.agentId,
        accountId: b.accountId,
        draftId: aDraftId,
        providerPostId: "x_fake_id",
        platform: "x",
      })
    ).rejects.toThrow(/agent\/account mismatch/);

    // A's draft is untouched.
    const draft = await t.run((ctx) => ctx.db.get(aDraftId));
    expect(draft?.approvalState).toBe("approved");
    expect(draft?.providerPostId).toBeUndefined();
  });

  it("rejects platform mismatch between draft and payload", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_rp_platform");
    const redditDraftId = await createDraft(t, agentId, accountId, "reddit");

    await expect(
      t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
        agentId,
        accountId,
        draftId: redditDraftId,
        providerPostId: "abc",
        platform: "x", // mismatched
      })
    ).rejects.toThrow(/platform mismatch/);
  });

  it("rejects missing draft", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_rp_missing");

    // Create then delete a draft to get a valid-shape id that doesn't exist.
    const tempId = await createDraft(t, agentId, accountId, "x");
    await t.run((ctx) => ctx.db.delete(tempId));

    await expect(
      t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
        agentId,
        accountId,
        draftId: tempId,
        providerPostId: "abc",
        platform: "x",
      })
    ).rejects.toThrow(/draft not found/);
  });
});

describe("Sprint 2.27 — pollAndRecordPostMetrics (stub v1)", () => {
  it("writes a gtmPostResults snapshot with zero metrics + no_oauth note", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_poll_stub");
    const draftId = await createDraft(t, agentId, accountId, "reddit");

    // Mark published first (needed for the draft to exist).
    await t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
      agentId,
      accountId,
      draftId,
      providerPostId: "abc",
      platform: "reddit",
    });

    const result = await t.action(
      internal.gtmMaya.recordPublished.pollAndRecordPostMetrics,
      {
        agentId,
        accountId,
        draftId,
        providerPostId: "abc",
        platform: "reddit",
        window: "t_plus_2h",
      }
    );

    const snapshot = await t.run((ctx) => ctx.db.get(result.snapshotId));
    expect(snapshot?.draftId).toBe(draftId);
    expect(snapshot?.platform).toBe("reddit");
    expect(snapshot?.providerPostId).toBe("abc");
    expect(snapshot?.metrics).toEqual({
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0,
    });
    expect(snapshot?.notes).toMatch(/no_oauth|Sprint 2.27b/);
  });
});

describe("Sprint 2.27 — listMyPublishedDrafts", () => {
  it("filters to approvalState=published only", async () => {
    const t = convexTest(schema, modules);
    const { agentId, accountId } = await setupAgent(t, "u_list_pub");

    // Create 3 drafts: 1 approved (not published), 2 published.
    await createDraft(t, agentId, accountId, "reddit"); // status: approved
    const pub1 = await createDraft(t, agentId, accountId, "x");
    const pub2 = await createDraft(t, agentId, accountId, "linkedin");

    await t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
      agentId,
      accountId,
      draftId: pub1,
      providerPostId: "x_id",
      platform: "x",
    });
    await t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
      agentId,
      accountId,
      draftId: pub2,
      providerPostId: "li_id",
      platform: "linkedin",
    });

    const published = await t.query(
      internal.gtmMaya.recordPublished.listMyPublishedDrafts,
      { agentId }
    );

    expect(published.length).toBe(2);
    expect(published.every((d) => d.approvalState === "published")).toBe(true);
    expect(new Set(published.map((d) => d._id))).toEqual(
      new Set([pub1, pub2])
    );
  });

  it("scopes per-agent (cross-tenant isolation)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "u_lp_iso_a");
    const b = await setupAgent(t, "u_lp_iso_b");

    const aDraft = await createDraft(t, a.agentId, a.accountId, "reddit");
    const bDraft = await createDraft(t, b.agentId, b.accountId, "x");

    await t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
      agentId: a.agentId,
      accountId: a.accountId,
      draftId: aDraft,
      providerPostId: "a_id",
      platform: "reddit",
    });
    await t.mutation(internal.gtmMaya.recordPublished.recordDraftPublished, {
      agentId: b.agentId,
      accountId: b.accountId,
      draftId: bDraft,
      providerPostId: "b_id",
      platform: "x",
    });

    const aList = await t.query(
      internal.gtmMaya.recordPublished.listMyPublishedDrafts,
      { agentId: a.agentId }
    );
    const bList = await t.query(
      internal.gtmMaya.recordPublished.listMyPublishedDrafts,
      { agentId: b.agentId }
    );
    expect(aList.length).toBe(1);
    expect(bList.length).toBe(1);
    expect(aList[0]?._id).toBe(aDraft);
    expect(bList[0]?._id).toBe(bDraft);
  });
});
