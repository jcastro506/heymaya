import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

const ADMIN_TOKEN = "private-beta-admin";

function user(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, email: `${subject}@clawlaunch.test` });
}

async function setupBetaUser(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = user(t, subject);
  const start = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(api.gtmMaya.researchLifecycle.setAppProfile, {
    name: "BetaApp",
    url: `https://${subject}.test`,
    stage: "live-beta",
    weekGoal: "signups",
    canRecordScreen: true,
    canShowFace: false,
    excludedAudiences: [],
  });
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 5 }
  );
  const evidenceIds = await authed.mutation(
    api.gtmMaya.researchLifecycle.recordEvidenceCards,
    {
      researchJobId: jobId,
      cards: [
        {
          source: "reddit",
          url: "https://reddit.test/beta",
          title: "First user thread",
          snippet: "Founders ask for beta users.",
          observedAt: 1_700_000_000_000,
          recency: "fresh",
          painMatch: 0.9,
          buyerMatch: 0.8,
          channelFit: 0.8,
          promotionRisk: "medium",
          recommendedUse: "reply",
          extractedClaims: ["beta user pain"],
        },
      ],
    }
  );
  await authed.mutation(api.gtmMaya.researchLifecycle.updateResearchJob, {
    researchJobId: jobId,
    status: "ready_for_review",
    phase: "complete",
  });
  return { authed, accountId: start.accountId, jobId, evidenceIds };
}

describe("GTM private beta instrumentation", () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("tracks beta cohort metrics from existing GTM state", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId, jobId, evidenceIds } = await setupBetaUser(
      t,
      "u_private_beta"
    );

    await t.mutation(api.gtmMaya.privateBeta.adminEnrollBetaUser, {
      token: ADMIN_TOKEN,
      accountId,
      cohortName: "alpha-5",
      requiredAppUrlLive: true,
      days: 14,
    });
    await authed.mutation(api.gtmMaya.researchLifecycle.recordCost, {
      researchJobId: jobId,
      provider: "gemini",
      operation: "strategy.final",
      reason: "beta first plan",
      costUsd: 0.12,
      cacheStatus: "called",
    });

    for (const platform of ["reddit", "x", "linkedin"] as const) {
      const draftId = await authed.mutation(
        api.gtmMaya.approvalPublishing.createDraft,
        {
          researchJobId: jobId,
          platform,
          body: `${platform} draft`,
          evidenceCardIds: evidenceIds,
        }
      );
      await authed.mutation(api.gtmMaya.approvalPublishing.approveDraft, {
        draftId,
        message: "approve",
      });
      await authed.mutation(api.gtmMaya.approvalPublishing.markPublished, {
        draftId,
        externalPostId: `${platform}_1`,
        publishedUrl: `https://${platform}.test/post/1`,
      });
    }

    await t.mutation(api.gtmMaya.privateBeta.recordHumanPlanReview, {
      token: ADMIN_TOKEN,
      accountId,
      researchJobId: jobId,
      reviewer: "operator",
      specificityScore: 5,
      usefulnessScore: 4,
      notes: "Specific enough for beta.",
    });
    await authed.mutation(api.gtmMaya.privateBeta.recordUserReportedSignal, {
      kind: "retention",
      message: "I would keep using this next week.",
      retentionIntent: "high",
    });

    const status = await authed.query(
      api.gtmMaya.privateBeta.getMyPrivateBetaStatus,
      {}
    );

    expect(status?.metrics.postsShipped).toBe(3);
    expect(status?.metrics.approvalRate).toBe(1);
    expect(status?.metrics.executedWeekOneActions).toBe(3);
    expect(status?.metrics.costUsd).toBe(0.12);
    expect(status?.metrics.retentionIntent).toBe("high");
    expect(status?.metrics.humanReviewAverage).toBe(4.5);
    expect(status?.successCriteria.executedThreeWeekOneActions).toBe(true);
    expect(status?.successCriteria.noUnauthorizedPublishing).toBe(true);
  });

  it("admin cohort summary aggregates success criteria", async () => {
    const t = convexTest(schema, modules);
    const { authed, accountId } = await setupBetaUser(t, "u_private_summary");

    await t.mutation(api.gtmMaya.privateBeta.adminEnrollBetaUser, {
      token: ADMIN_TOKEN,
      accountId,
      cohortName: "alpha-summary",
      requiredAppUrlLive: true,
    });
    await authed.mutation(api.gtmMaya.privateBeta.recordUserReportedSignal, {
      kind: "feedback",
      message: "Got one useful reply.",
    });

    const summary = await t.query(api.gtmMaya.privateBeta.adminGetCohortSummary, {
      token: ADMIN_TOKEN,
      cohortName: "alpha-summary",
    });

    expect(summary.users).toHaveLength(1);
    expect(summary.success.users).toBe(1);
    expect(summary.success.noUnauthorizedPublishing).toBe(true);
  });

  it("detects unauthorized published drafts in beta metrics", async () => {
    const t = convexTest(schema, modules);
    const { authed, evidenceIds } = await setupBetaUser(t, "u_private_unsafe");
    const draftId = await authed.mutation(
      api.gtmMaya.approvalPublishing.createDraft,
      {
        platform: "x",
        body: "unsafe draft",
        evidenceCardIds: evidenceIds,
      }
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(draftId, {
        status: "published",
        publishedUrl: "https://x.test/unsafe",
        publishedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const status = await authed.query(
      api.gtmMaya.privateBeta.getMyPrivateBetaStatus,
      {}
    );

    expect(status?.metrics.noUnauthorizedPublishing).toBe(false);
    expect(status?.successCriteria.noUnauthorizedPublishing).toBe(false);
  });
});
