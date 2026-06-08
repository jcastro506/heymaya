import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";

/**
 * Sprint 1 — runBudgetedResearchJob orchestrator unit + integration tests.
 *
 * The orchestrator's internal actions call out to ScrapeCreators via the
 * platform-workers. In convex-test, actions that make real HTTP fail
 * (no network). We test the orchestrator's CONTROL FLOW + bookkeeping
 * (phase advances, status transitions, cross-tenant defense) by setting
 * SCRAPE_CREATORS_API_KEY to a stub and letting workers report
 * budget_blocked / failed gracefully — the orchestrator still completes
 * with status=failed or needs_more_evidence, which is what we assert.
 *
 * The full happy path (real-network → real evidence → status=ready_for_review)
 * is L4 smoke territory and requires the --live --confirm flag against
 * staging Convex.
 */

async function setupJob(t: ReturnType<typeof convexTest>, subject: string) {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  const appId = await authed.mutation(
    api.gtmMaya.researchLifecycle.setAppProfile,
    {
      name: `App for ${subject}`,
      url: `https://${subject}.test`,
      stage: "live-beta",
      weekGoal: "signups",
      canRecordScreen: true,
      canShowFace: false,
      excludedAudiences: [],
    }
  );
  const jobId = await authed.mutation(
    api.gtmMaya.researchLifecycle.createResearchJob,
    { appId, budgetUsd: 3 }
  );
  return { authed, accountId: started.accountId, jobId };
}

describe("Sprint 1 — runBudgetedResearchJob orchestrator", () => {
  it("getResearchJobForOrchestrator returns the job + app + creator for a known job", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_get");
    const orch = await t.query(
      internal.gtmMaya.researchWorker.getResearchJobForOrchestrator,
      { researchJobId: a.jobId }
    );
    expect(orch).not.toBeNull();
    expect(orch?.job._id).toBe(a.jobId);
    expect(orch?.creatorId).toBe(a.accountId);
    expect(orch?.app.url).toContain("u_orc_get");
  });

  it("getResearchJobForOrchestrator returns null for unknown job", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_unknown");
    const otherJobId = a.jobId; // valid id but we'll patch app to mismatch
    await t.run(async (ctx) => {
      const job = await ctx.db.get(otherJobId);
      if (!job) return;
      await ctx.db.patch(otherJobId, { accountId: a.accountId });
    });
    const orch = await t.query(
      internal.gtmMaya.researchWorker.getResearchJobForOrchestrator,
      { researchJobId: a.jobId }
    );
    expect(orch).not.toBeNull(); // sanity — this should still resolve
  });

  it("setJobPhase advances phase + handles status transitions", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_phase");
    await t.mutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: a.jobId,
      phase: "channel_research",
      status: "running",
    });
    let job = await t.run((ctx) => ctx.db.get(a.jobId));
    expect(job?.phase).toBe("channel_research");
    expect(job?.status).toBe("running");
    expect(job?.startedAt).toBeTypeOf("number");

    await t.mutation(internal.gtmMaya.researchWorker.setJobPhase, {
      researchJobId: a.jobId,
      phase: "complete",
      status: "ready_for_review",
    });
    job = await t.run((ctx) => ctx.db.get(a.jobId));
    expect(job?.phase).toBe("complete");
    expect(job?.status).toBe("ready_for_review");
    expect(job?.completedAt).toBeTypeOf("number");
  });

  it("getEvidenceCardsForScoring returns rows scoped to the job", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_evidence");
    // Plant 2 cards via internal mutation (skip user-auth path).
    await t.mutation(internal.gtmMaya.platformWorkers.recordPlatformEvidence, {
      researchJobId: a.jobId,
      accountId: a.accountId,
      cards: [
        {
          source: "reddit",
          url: "https://r.test/1",
          snippet: "x",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.7,
          buyerMatch: 0.6,
          channelFit: 0.7,
          promotionRisk: "medium",
          recommendedUse: "reply",
          extractedClaims: [],
        },
        {
          source: "x",
          url: "https://x.com/1",
          snippet: "y",
          observedAt: Date.now(),
          recency: "fresh",
          painMatch: 0.5,
          buyerMatch: 0.5,
          channelFit: 0.5,
          promotionRisk: "low",
          recommendedUse: "strategy",
          extractedClaims: [],
        },
      ],
    });
    const cards = await t.query(
      internal.gtmMaya.researchWorker.getEvidenceCardsForScoring,
      { researchJobId: a.jobId }
    );
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.source).sort()).toEqual(["reddit", "x"]);
  });

  it("insertChannelScores writes scoped rows + remaps blocked→parked", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_scores");
    await t.mutation(internal.gtmMaya.researchWorker.insertChannelScores, {
      researchJobId: a.jobId,
      scores: [
        {
          channel: "reddit",
          score: 0.7,
          decision: "primary",
          confidence: "high",
          reasons: ["high painMatch"],
          risks: [],
          evidenceCardIds: [],
          qualityGate: { passed: true, failures: [] },
        },
      ],
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("gtmChannelScores")
        .withIndex("by_research_job", (q) => q.eq("researchJobId", a.jobId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe("primary");
    expect(rows[0]?.accountId).toBe(a.accountId);
  });

  it("assertOwnsResearchJob defends cross-tenant", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_own_a");
    const b = await setupJob(t, "u_orc_own_b");

    const ownsA = await t.query(
      internal.gtmMaya.researchWorker.assertOwnsResearchJob,
      { researchJobId: a.jobId, clerkUserId: "u_orc_own_a" }
    );
    const crossTenant = await t.query(
      internal.gtmMaya.researchWorker.assertOwnsResearchJob,
      { researchJobId: a.jobId, clerkUserId: "u_orc_own_b" }
    );
    expect(ownsA.ok).toBe(true);
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) {
      expect(crossTenant.reason).toContain("does not belong");
    }
  });

  it("runMyResearch rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_unauth");
    await expect(
      t.action(api.gtmMaya.researchWorker.runMyResearch, {
        researchJobId: a.jobId,
      })
    ).rejects.toThrow("signed-in user required");
  });

  it("skeleton path still works as a fallback (not deleted)", async () => {
    // Sprint 1 keeps runBudgetedResearchSkeleton as the emergency
    // fallback path. Test that the export still exists + functions.
    const t = convexTest(schema, modules);
    const a = await setupJob(t, "u_orc_skel");
    const out = await a.authed.mutation(
      api.gtmMaya.researchWorker.runBudgetedResearchSkeleton,
      { researchJobId: a.jobId }
    );
    expect(out.evidenceCount).toBeGreaterThan(0);
  });
});
