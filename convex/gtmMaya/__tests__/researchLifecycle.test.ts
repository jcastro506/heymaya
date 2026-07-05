import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

function authedGtm(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
}

describe("GTM Maya research lifecycle", () => {
  it("creates the missing agent row when Clerk webhook already created the creator", async () => {
    const t = convexTest(schema, modules);
    const user = authedGtm(t, "u_gtm_webhook_only");

    const creatorId = await t.run((ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_gtm_webhook_only",
        email: "u_gtm_webhook_only@clawlaunch.test",
        channelPreference: "web",
        timezone: "America/Los_Angeles",
        status: "onboarding",
        plan: "coach",
        accountType: "gtm-agent",
        createdAt: 1,
      })
    );

    const appId = await user.mutation(
      api.gtmMaya.researchLifecycle.setAppProfile,
      {
        name: "Maya",
        url: "https://hey-maya.ai",
        appType: "web",
        conversionKind: "signup",
        signupUrl: "https://hey-maya.ai",
        differentiator:
          "AI growth marketer that finds buyers and proves which posts drove signups.",
        stage: "live-beta",
        entryMode: "manager",
        weekGoal: "signups",
        userCountBand: "none",
        canRecordScreen: false,
        canShowFace: false,
        canRecordVoice: false,
        canProvideScreenshots: false,
        canPostTikTokManually: false,
        canPostInstagramManually: false,
        existingTikTokUrl: "",
        existingInstagramUrl: "",
        existingYoutubeUrl: "",
        existingLinkedinUrl: "",
        existingXUrl: "",
        tiktokWarmupState: "unknown",
        tiktokAccountStatusChecked: false,
        openToUgcCreators: false,
        maxWeeklyVisualPosts: 3,
        excludedAudiences: [],
      }
    );

    const rows = await t.run(async (ctx) => {
      const agent = await ctx.db
        .query("gtmAgents")
        .withIndex("by_account", (q) => q.eq("accountId", creatorId))
        .first();
      const app = await ctx.db.get(appId);
      return { agent, app };
    });

    expect(rows.agent?.accountId).toStrictEqual(creatorId);
    expect(rows.agent?.appId).toStrictEqual(appId);
    expect(rows.agent?.channelPreference).toBe("web");
    expect(rows.agent?.timezone).toBe("America/Los_Angeles");
    expect(rows.app?.accountId).toStrictEqual(creatorId);
    expect(rows.app?.name).toBe("Maya");
  });

  it("creates an account, app, research job, evidence, scores, and cost ledger", async () => {
    const t = convexTest(schema, modules);
    const user = authedGtm(t, "u_gtm_lifecycle");

    const start = await user.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      {
        channelPreference: "whatsapp",
        timezone: "America/New_York",
      }
    );
    const appId = await user.mutation(
      api.gtmMaya.researchLifecycle.setAppProfile,
      {
        name: "ClawLaunch Demo",
        url: "https://clawlaunch-demo.test",
        founderWhy: "I built it because indie builders hate marketing.",
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        canRecordVoice: true,
        canProvideScreenshots: true,
        canPostTikTokManually: true,
        canPostInstagramManually: false,
        existingTikTokUrl: "https://www.tiktok.com/@clawlaunchdemo",
        existingInstagramUrl: "",
        tiktokWarmupState: "warming",
        tiktokAccountAgeDays: 3,
        tiktokAccountStatusChecked: false,
        openToUgcCreators: true,
        creatorBudgetMonthlyUsd: 300,
        maxWeeklyVisualPosts: 4,
        excludedAudiences: [],
      }
    );
    const jobId = await user.mutation(
      api.gtmMaya.researchLifecycle.createResearchJob,
      {
        appId,
        budgetUsd: 3,
      }
    );

    await user.mutation(api.gtmMaya.researchLifecycle.updateResearchJob, {
      researchJobId: jobId,
      status: "running",
      phase: "channel_research",
    });
    const evidenceIds = await user.mutation(
      api.gtmMaya.researchLifecycle.recordEvidenceCards,
      {
        researchJobId: jobId,
        cards: [
          {
            source: "reddit",
            url: "https://reddit.test/r/sideproject/first-users",
            title: "Where do I get my first users?",
            snippet: "A builder asks where to get first users for a new SaaS.",
            authorOrCommunity: "r/sideproject",
            observedAt: 1_700_000_000_000,
            recency: "fresh",
            engagement: { likes: 20, comments: 41 },
            painMatch: 0.93,
            buyerMatch: 0.82,
            channelFit: 0.86,
            promotionRisk: "medium",
            recommendedUse: "reply",
            extractedClaims: ["first users are hard", "Reddit has live demand"],
          },
        ],
      }
    );
    await user.mutation(api.gtmMaya.researchLifecycle.recordChannelScores, {
      researchJobId: jobId,
      scores: [
        {
          channel: "reddit",
          score: 0.74,
          decision: "primary",
          confidence: "medium",
          reasons: ["Reddit has fresh demand"],
          risks: ["promotion risk requires reply-first behavior"],
          evidenceCardIds: evidenceIds,
          firstWeekTest: "Reply to 10 qualified threads.",
          qualityGate: { passed: true, failures: [] },
        },
      ],
    });
    await user.mutation(api.gtmMaya.researchLifecycle.recordCost, {
      researchJobId: jobId,
      provider: "scrapecreators",
      operation: "reddit.search",
      reason: "initial channel research",
      costUsd: 0.03,
      units: 1,
      cacheStatus: "called",
    });
    await user.mutation(api.gtmMaya.researchLifecycle.updateResearchJob, {
      researchJobId: jobId,
      status: "ready_for_review",
      phase: "complete",
    });

    const snapshot = await user.query(
      api.gtmMaya.researchLifecycle.getMyGtmSnapshot,
      {}
    );

    expect(start.created).toBe(true);
    expect(snapshot?.creator.accountType).toBe("gtm-agent");
    expect(snapshot?.agent.channelPreference).toBe("whatsapp");
    expect(snapshot?.app?._id).toStrictEqual(appId);
    expect(snapshot?.latestJob?._id).toStrictEqual(jobId);
    expect(snapshot?.latestJob?.status).toBe("ready_for_review");
    expect(snapshot?.latestJob?.spentUsd).toBe(0.03);
    expect(snapshot?.evidenceCount).toBe(1);
    expect(snapshot?.channelScores[0].decision).toBe("primary");
    expect(snapshot?.costTotalUsd).toBe(0.03);
    expect(snapshot?.app?.canRecordVoice).toBe(true);
    expect(snapshot?.app?.canProvideScreenshots).toBe(true);
    expect(snapshot?.app?.canPostTikTokManually).toBe(true);
    expect(snapshot?.app?.canPostInstagramManually).toBe(false);
    expect(snapshot?.app?.existingTikTokUrl).toContain("@clawlaunchdemo");
    expect(snapshot?.app?.existingInstagramUrl).toBeUndefined();
    expect(snapshot?.app?.tiktokWarmupState).toBe("warming");
    expect(snapshot?.app?.tiktokAccountAgeDays).toBe(3);
    expect(snapshot?.app?.tiktokAccountStatusChecked).toBe(false);
    expect(snapshot?.app?.openToUgcCreators).toBe(true);
    expect(snapshot?.app?.creatorBudgetMonthlyUsd).toBe(300);
    expect(snapshot?.app?.maxWeeklyVisualPosts).toBe(4);
  });

  it("prevents one account from writing evidence or costs to another account's research job", async () => {
    const t = convexTest(schema, modules);
    const owner = authedGtm(t, "u_gtm_owner");
    const intruder = authedGtm(t, "u_gtm_intruder");

    await owner.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});
    const ownerAppId = await owner.mutation(
      api.gtmMaya.researchLifecycle.setAppProfile,
      {
        url: "https://owner.test",
        stage: "live-beta",
        weekGoal: "feedback",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
      }
    );
    const ownerJobId = await owner.mutation(
      api.gtmMaya.researchLifecycle.createResearchJob,
      {
        appId: ownerAppId,
        budgetUsd: 2,
      }
    );

    await intruder.mutation(api.gtmMaya.researchLifecycle.startGtmOnboarding, {});

    await expect(
      intruder.mutation(api.gtmMaya.researchLifecycle.recordCost, {
        researchJobId: ownerJobId,
        provider: "gemini",
        operation: "strategy.finalize",
        reason: "should not be allowed",
        costUsd: 0.01,
        cacheStatus: "called",
      })
    ).rejects.toThrow("Research job does not belong to this account");
  });
});
