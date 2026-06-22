import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { evaluateSpendKill } from "../spendKill";

describe("evaluateSpendKill", () => {
  const caps = { hourlyCapUsd: 3, dailyCapUsd: 6 };

  it("does not kill normal-use spend (under both ceilings)", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 0.4,
      daySpendUsd: 1.8,
      ...caps,
    });
    expect(v.shouldKill).toBe(false);
  });

  it("kills on runaway velocity (hourly ceiling breached first)", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 4.3, // the observed $30/7h burn rate
      daySpendUsd: 4.3,
      ...caps,
    });
    expect(v.shouldKill).toBe(true);
    expect(v.reason).toContain("runaway velocity");
  });

  it("kills on sustained 24h burn even when hourly is under", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 2.5, // under the $3/hr bar
      daySpendUsd: 7.0, // over the $6/24h bar
      ...caps,
    });
    expect(v.shouldKill).toBe(true);
    expect(v.reason).toContain("sustained burn");
  });

  it("allows spend exactly at a ceiling (strict-exceed semantics)", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 3.0,
      daySpendUsd: 6.0,
      ...caps,
    });
    expect(v.shouldKill).toBe(false);
  });

  it("respects a tighter per-agent daily override", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 0.5,
      daySpendUsd: 2.5,
      hourlyCapUsd: 3,
      dailyCapUsd: 2, // watched-test override below normal-day default
    });
    expect(v.shouldKill).toBe(true);
    expect(v.reason).toContain("sustained burn");
  });

  // THE $28 REGRESSION (2026-06-22): a 7-day agent burned $28 while the
  // operational sums read ~$0 (per-turn self-report is blind), so neither the
  // hourly nor the 24h operational check ever fired. The actual-total wall —
  // the OpenRouter poll's true total — must catch it even at operational $0.
  it("kills on the actual-total wall even when operational spend reads $0 (the blind-ledger fix)", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 0, // blind — per-turn self-report never landed
      daySpendUsd: 0, // blind
      dayActualTotalUsd: 7.2, // the REAL OpenRouter spend, over the $6 cap
      ...caps,
    });
    expect(v.shouldKill).toBe(true);
    expect(v.reason).toContain("actual spend wall");
  });

  it("enforces a $1/day cap on real spend (the watched-test config)", () => {
    const under = evaluateSpendKill({
      hourSpendUsd: 0,
      daySpendUsd: 0,
      dayActualTotalUsd: 0.9,
      hourlyCapUsd: 3,
      dailyCapUsd: 1,
    });
    expect(under.shouldKill).toBe(false);
    const over = evaluateSpendKill({
      hourSpendUsd: 0,
      daySpendUsd: 0,
      dayActualTotalUsd: 1.05,
      hourlyCapUsd: 3,
      dailyCapUsd: 1,
    });
    expect(over.shouldKill).toBe(true);
    expect(over.reason).toContain("actual spend wall");
  });

  it("actual-total wall is strict-exceed (exactly at cap does not kill)", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 0,
      daySpendUsd: 0,
      dayActualTotalUsd: 6.0,
      ...caps,
    });
    expect(v.shouldKill).toBe(false);
  });

  it("absent actual-total (no poll rows yet) falls back to operational checks only", () => {
    const v = evaluateSpendKill({
      hourSpendUsd: 0.4,
      daySpendUsd: 1.8,
      ...caps, // dayActualTotalUsd undefined → wall skipped, operational under
    });
    expect(v.shouldKill).toBe(false);
  });
});

describe("spend kill — research spend is excluded", () => {
  it("a big research run does NOT count toward the kill ceilings", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({
      subject: "founder-research",
      email: "founder-research@clawlaunch.test",
    });
    const started = await authed.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      {}
    );
    const appId = await authed.mutation(
      api.gtmMaya.researchLifecycle.setAppProfile,
      {
        name: "Research App",
        url: "https://research.test",
        stage: "live-beta",
        weekGoal: "signups",
        canRecordScreen: true,
        canShowFace: false,
        excludedAudiences: [],
      }
    );
    const jobId = await authed.mutation(
      api.gtmMaya.researchLifecycle.createResearchJob,
      { appId, budgetUsd: 20 }
    );

    // Seed: a large research-job spend ($12) + a small operational turn ($0.40).
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("gtmCostLedger", {
        accountId: started.accountId,
        researchJobId: jobId, // research — must be excluded
        provider: "openrouter",
        operation: "research.card_scorer",
        reason: "deep research run",
        costUsd: 12,
        cacheStatus: "called",
        createdAt: now,
      });
      await ctx.db.insert("gtmCostLedger", {
        accountId: started.accountId,
        // no researchJobId — operational loop spend, must be counted
        provider: "openrouter",
        operation: "turn_completion",
        reason: "maya conversation turn",
        costUsd: 0.4,
        cacheStatus: "called",
        createdAt: now,
      });
    });

    const snap = await t.query(
      internal.gtmMaya.spendKill.peekAgentSpendForKill,
      { agentId: started.agentId }
    );
    expect(snap).not.toBeNull();
    // Only the $0.40 operational row counts — the $12 research run is excluded.
    expect(snap!.hourSpendUsd).toBeCloseTo(0.4, 5);
    expect(snap!.daySpendUsd).toBeCloseTo(0.4, 5);
    expect(snap!.shouldKill).toBe(false);
  });
});
