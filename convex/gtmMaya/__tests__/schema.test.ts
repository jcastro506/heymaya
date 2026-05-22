import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

const NOW = 1_700_000_000_000;

async function setupTwoGtmAccounts(t: ReturnType<typeof convexTest>) {
  const accountA = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: "gtm_a",
      email: "a@clawlaunch.test",
      channelPreference: "web",
      timezone: "America/New_York",
      status: "onboarding",
      plan: "coach",
      accountType: "gtm-agent",
      createdAt: NOW,
    })
  );
  const accountB = await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: "gtm_b",
      email: "b@clawlaunch.test",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "onboarding",
      plan: "coach",
      accountType: "gtm-agent",
      createdAt: NOW,
    })
  );

  const appA = await t.run((ctx) =>
    ctx.db.insert("gtmApps", {
      accountId: accountA,
      name: "LaunchPad",
      url: "https://launchpad.test",
      founderWhy: "I built a tiny tool for indie builders to find users.",
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
  const appB = await t.run((ctx) =>
    ctx.db.insert("gtmApps", {
      accountId: accountB,
      name: "OpsNote",
      url: "https://opsnote.test",
      stage: "paid",
      weekGoal: "demos",
      canRecordScreen: false,
      canShowFace: false,
      excludedAudiences: ["enterprise buyers"],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );

  const jobA = await t.run((ctx) =>
    ctx.db.insert("gtmResearchJobs", {
      accountId: accountA,
      appId: appA,
      status: "running",
      phase: "channel_research",
      budgetUsd: 3,
      spentUsd: 0.42,
      startedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
  const jobB = await t.run((ctx) =>
    ctx.db.insert("gtmResearchJobs", {
      accountId: accountB,
      appId: appB,
      status: "queued",
      phase: "app_inspection",
      budgetUsd: 3,
      spentUsd: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );

  return { accountA, accountB, appA, appB, jobA, jobB };
}

describe("GTM Maya schema", () => {
  it("stores GTM accounts separately from creator and service account types", async () => {
    const t = convexTest(schema, modules);
    const { accountA } = await setupTwoGtmAccounts(t);

    const account = await t.run((ctx) => ctx.db.get(accountA));

    expect(account?.accountType).toBe("gtm-agent");
    expect(account?.email).toBe("a@clawlaunch.test");
  });

  it("isolates apps, research jobs, evidence, and costs by account", async () => {
    const t = convexTest(schema, modules);
    const { accountA, accountB, jobA, jobB } = await setupTwoGtmAccounts(t);

    const evidenceA = await t.run((ctx) =>
      ctx.db.insert("gtmEvidenceCards", {
        accountId: accountA,
        researchJobId: jobA,
        source: "reddit",
        url: "https://reddit.test/r/sideproject/1",
        title: "How do I get first users?",
        snippet: "Indie builders are asking where to find first users.",
        authorOrCommunity: "r/sideproject",
        observedAt: NOW,
        recency: "fresh",
        engagement: { likes: 14, comments: 23 },
        painMatch: 0.92,
        buyerMatch: 0.84,
        channelFit: 0.8,
        promotionRisk: "medium",
        recommendedUse: "reply",
        extractedClaims: ["first users are hard", "founders want concrete tactics"],
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gtmEvidenceCards", {
        accountId: accountB,
        researchJobId: jobB,
        source: "linkedin",
        url: "https://linkedin.test/posts/ops",
        snippet: "Ops teams want better handoff notes.",
        observedAt: NOW,
        recency: "recent",
        painMatch: 0.72,
        buyerMatch: 0.88,
        channelFit: 0.7,
        promotionRisk: "low",
        recommendedUse: "strategy",
        extractedClaims: ["handoffs are painful"],
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gtmChannelScores", {
        accountId: accountA,
        researchJobId: jobA,
        channel: "reddit",
        score: 0.74,
        decision: "primary",
        confidence: "medium",
        reasons: ["3 useful Reddit signals"],
        risks: ["must avoid drive-by promotion"],
        evidenceCardIds: [evidenceA],
        firstWeekTest: "Reply to ten qualified threads.",
        qualityGate: { passed: true, failures: [] },
        createdAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gtmCostLedger", {
        accountId: accountA,
        researchJobId: jobA,
        provider: "scrapecreators",
        operation: "reddit.search",
        reason: "initial channel research",
        costUsd: 0.03,
        units: 1,
        cacheStatus: "called",
        createdAt: NOW,
      })
    );

    const aEvidence = await t.run((ctx) =>
      ctx.db
        .query("gtmEvidenceCards")
        .withIndex("by_account", (q) => q.eq("accountId", accountA))
        .collect()
    );
    const bEvidence = await t.run((ctx) =>
      ctx.db
        .query("gtmEvidenceCards")
        .withIndex("by_account", (q) => q.eq("accountId", accountB))
        .collect()
    );
    const aCosts = await t.run((ctx) =>
      ctx.db
        .query("gtmCostLedger")
        .withIndex("by_account_and_provider", (q) =>
          q.eq("accountId", accountA).eq("provider", "scrapecreators")
        )
        .collect()
    );

    expect(aEvidence).toHaveLength(1);
    expect(aEvidence[0].snippet).toContain("first users");
    expect(bEvidence).toHaveLength(1);
    expect(bEvidence[0].source).toBe("linkedin");
    expect(aCosts).toHaveLength(1);
    expect(aCosts[0].costUsd).toBe(0.03);
  });

  it("indexes agent deployment state by account, app, and Fly app id", async () => {
    const t = convexTest(schema, modules);
    const { accountA, appA } = await setupTwoGtmAccounts(t);

    await t.run((ctx) =>
      ctx.db.insert("gtmAgents", {
        accountId: accountA,
        appId: appA,
        onboardingStep: "researching",
        channelPreference: "whatsapp",
        timezone: "America/New_York",
        openClawFlyAppId: "clawlaunch-agent-a",
        deployedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );

    const byFly = await t.run((ctx) =>
      ctx.db
        .query("gtmAgents")
        .withIndex("by_fly_app", (q) =>
          q.eq("openClawFlyAppId", "clawlaunch-agent-a")
        )
        .unique()
    );

    expect(byFly?.accountId).toStrictEqual(accountA);
    expect(byFly?.appId).toStrictEqual(appA);
    expect(byFly?.channelPreference).toBe("whatsapp");
  });

  it("stores distribution motions, format experiments, content bank items, and UGC readiness", async () => {
    const t = convexTest(schema, modules);
    const { accountA, jobA } = await setupTwoGtmAccounts(t);

    const evidenceA = await t.run((ctx) =>
      ctx.db.insert("gtmEvidenceCards", {
        accountId: accountA,
        researchJobId: jobA,
        source: "tiktok",
        url: "https://tiktok.test/demo-format",
        title: "Demo format",
        snippet: "A faceless app demo creates qualified comments.",
        observedAt: NOW,
        recency: "fresh",
        engagement: { views: 32000, comments: 42 },
        painMatch: 0.86,
        buyerMatch: 0.78,
        channelFit: 0.9,
        promotionRisk: "low",
        recommendedUse: "content_format",
        extractedClaims: ["faceless demos can work"],
        createdAt: NOW,
      })
    );
    const motionId = await t.run((ctx) =>
      ctx.db.insert("gtmDistributionMotions", {
        accountId: accountA,
        researchJobId: jobA,
        motion: "tiktok_faceless_demo",
        status: "test_now",
        rationale: ["app has visual demo proof"],
        risks: ["views need app-action tracking"],
        evidenceCardIds: [evidenceA],
        minimumCadence: "3 clips per week",
        stopCriteria: "high views with no signups",
        doubleDownCriteria: "5 signups from one format cluster",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const experimentId = await t.run((ctx) =>
      ctx.db.insert("gtmFormatExperiments", {
        accountId: accountA,
        researchJobId: jobA,
        motionId,
        motion: "tiktok_faceless_demo",
        hypothesis: "Faceless demos can create first installs.",
        variants: [
          {
            hook: "I built this because the manual version is painful.",
            demoMoment: "before screen then one-click result",
            cta: "comment beta",
            formatSkeleton: "pain -> demo -> result -> CTA",
          },
        ],
        successMetric: "installs",
        scaleDecision: "keep_testing",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gtmContentBankItems", {
        accountId: accountA,
        experimentId,
        platform: "tiktok",
        motion: "tiktok_faceless_demo",
        formatSkeleton: "pain -> demo -> result -> CTA",
        hook: "I built this because the manual version is painful.",
        cta: "comment beta",
        demoMoment: "before screen then one-click result",
        outcome: "winner",
        evidence: ["2 trials and 4 installs"],
        promotedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gtmUgcReadinessReports", {
        accountId: accountA,
        researchJobId: jobA,
        readiness: "ready",
        reasons: ["short-form motion won"],
        requiredProof: [],
        creatorProfile: "Micro creator who can explain a workflow clearly.",
        briefTemplate: "Use the proven hook and show the exact app moment.",
        trainingOutline: ["App overview", "Winning skeleton", "Submission checklist"],
        managementCadence: "weekly batch review",
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("gtmToolCallLog", {
        accountId: accountA,
        researchJobId: jobA,
        toolName: "scrapecreators.tiktok.search",
        provider: "scrapecreators",
        purpose: "find proven TikTok slideshow formats",
        status: "succeeded",
        estimatedCostUsd: 0.018,
        scrapeCredits: 2,
        metadata: {
          inputSummary: "query=beauty app before after slideshow",
          outputSummary: "2 evidence cards promoted into motion planning",
          externalRequestId: "sc_req_123",
          latencyMs: 1420,
        },
        createdAt: NOW,
      })
    );

    const motions = await t.run((ctx) =>
      ctx.db
        .query("gtmDistributionMotions")
        .withIndex("by_account_and_motion", (q) =>
          q.eq("accountId", accountA).eq("motion", "tiktok_faceless_demo")
        )
        .collect()
    );
    const winners = await t.run((ctx) =>
      ctx.db
        .query("gtmContentBankItems")
        .withIndex("by_account_and_outcome", (q) =>
          q.eq("accountId", accountA).eq("outcome", "winner")
        )
        .collect()
    );
    const reports = await t.run((ctx) =>
      ctx.db
        .query("gtmUgcReadinessReports")
        .withIndex("by_account_and_readiness", (q) =>
          q.eq("accountId", accountA).eq("readiness", "ready")
        )
        .collect()
    );
    const toolCalls = await t.run((ctx) =>
      ctx.db
        .query("gtmToolCallLog")
        .withIndex("by_account_and_tool", (q) =>
          q
            .eq("accountId", accountA)
            .eq("toolName", "scrapecreators.tiktok.search")
        )
        .collect()
    );

    expect(motions).toHaveLength(1);
    expect(motions[0].minimumCadence).toContain("clips");
    expect(winners).toHaveLength(1);
    expect(winners[0].experimentId).toStrictEqual(experimentId);
    expect(reports).toHaveLength(1);
    expect(reports[0].trainingOutline).toContain("Winning skeleton");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].estimatedCostUsd).toBeGreaterThan(0);
  });
});
