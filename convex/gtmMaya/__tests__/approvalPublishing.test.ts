import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { parseApprovalMessage } from "../approvalPublishing";

function user(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setupDraft(t: ReturnType<typeof convexTest>) {
  const authed = user(t, "u_approval");
  await authed.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
  const appId = await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "BugBrief",
    url: "https://bugbrief.test",
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  const evidenceIds = await authed.mutation(
    api.gtmMaya.researchLifecycle.recordEvidenceCards,
    {
      researchJobId: jobId,
      cards: [
        {
          source: "reddit",
          url: "https://reddit.test/thread",
          snippet: "founders asking for first users",
          observedAt: 1_700_000_000_000,
          recency: "fresh",
          painMatch: 0.9,
          buyerMatch: 0.8,
          channelFit: 0.8,
          promotionRisk: "medium",
          recommendedUse: "reply",
          extractedClaims: ["first-user pain"],
        },
      ],
    }
  );
  const draftId = await authed.mutation(api.gtmMaya.approvalPublishing.createDraft, {
    researchJobId: jobId,
    platform: "x",
    body: "I built BugBrief because founders keep losing bug context.",
    evidenceCardIds: evidenceIds,
  });
  return { authed, draftId };
}

describe("GTM approval publishing", () => {
  it("parses approvals and user edits", () => {
    expect(parseApprovalMessage("approve")).toEqual({ approved: true });
    expect(parseApprovalMessage("approved: ship this edited body")).toEqual({
      approved: true,
      edit: "ship this edited body",
    });
    expect(parseApprovalMessage("no")).toEqual({ approved: false });
  });

  it("cannot mark a draft published before approval", async () => {
    const t = convexTest(schema, modules);
    const { authed, draftId } = await setupDraft(t);

    await expect(
      authed.mutation(api.gtmMaya.approvalPublishing.markPublished, {
        draftId,
        externalPostId: "post_1",
        publishedUrl: "https://x.test/post_1",
      })
    ).rejects.toThrow("cannot publish without approval");
  });

  it("publishes the exact approved or edited content", async () => {
    const t = convexTest(schema, modules);
    const { authed, draftId } = await setupDraft(t);

    const approved = await authed.mutation(
      api.gtmMaya.approvalPublishing.approveDraft,
      {
        draftId,
        message: "approve: edited final body",
        approvalMessageId: "msg_1",
      }
    );
    await authed.mutation(api.gtmMaya.approvalPublishing.markPublished, {
      draftId,
      externalPostId: "post_1",
      publishedUrl: "https://x.test/post_1",
    });

    const row = await t.run((ctx) => ctx.db.get(draftId));
    expect(approved).toEqual({ approved: true, finalBody: "edited final body" });
    expect(row?.status).toBe("published");
    expect(row?.finalBody).toBe("edited final body");
    expect(row?.publishedUrl).toBe("https://x.test/post_1");
  });

  it("enforces cross-tenant publish isolation", async () => {
    const t = convexTest(schema, modules);
    const { draftId } = await setupDraft(t);
    const intruder = user(t, "u_intruder");
    await intruder.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});

    await expect(
      intruder.mutation(api.gtmMaya.approvalPublishing.approveDraft, {
        draftId,
        message: "approve",
      })
    ).rejects.toThrow("draft does not belong to this account");
  });
});
