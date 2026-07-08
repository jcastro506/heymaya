import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { effectiveDailyCapUsd, evaluateSpendThrottle } from "../spendKill";

describe("effectiveDailyCapUsd — foundation grace", () => {
  const HOUR = 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  it("raises the 24h wall to the grace ceiling while foundation is incomplete", () => {
    // A fresh agent mid-foundation: default $6 wall would brick research
    // (observed 2026-07-06 — four agents throttled mid-research, never active).
    const cap = effectiveDailyCapUsd({
      createdAt: now - 2 * HOUR,
      now,
    });
    expect(cap).toBe(15);
  });

  it("keeps a per-agent cap when it already exceeds the grace ceiling", () => {
    const cap = effectiveDailyCapUsd({
      spendKillCapUsd: 25,
      createdAt: now - 2 * HOUR,
      now,
    });
    expect(cap).toBe(25);
  });

  it("drops back to the base cap once foundation completes", () => {
    const cap = effectiveDailyCapUsd({
      foundationCompletedAt: now - HOUR,
      createdAt: now - 5 * HOUR,
      now,
    });
    expect(cap).toBe(6);
  });

  it("expires the grace after 48h even if foundation never completed", () => {
    // A permanently stuck foundation must not hold the raised wall forever.
    const cap = effectiveDailyCapUsd({
      createdAt: now - 49 * HOUR,
      now,
    });
    expect(cap).toBe(6);
  });

  it("a tight per-agent test cap is still raised during grace, not below it", () => {
    // The 0.75 watched-test caps from 7/6 throttled agents during onboarding.
    const cap = effectiveDailyCapUsd({
      spendKillCapUsd: 0.75,
      createdAt: now - HOUR,
      now,
    });
    expect(cap).toBe(15);
  });
});

describe("evaluateSpendThrottle", () => {
  const caps = { hourlyCapUsd: 3, dailyCapUsd: 6 };

  it("does not throttle normal-use spend (under both ceilings)", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 0.4,
      daySpendUsd: 1.8,
      ...caps,
    });
    expect(v.shouldThrottle).toBe(false);
  });

  it("throttles on runaway velocity (hourly ceiling breached first)", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 4.3, // the observed $30/7h burn rate
      daySpendUsd: 4.3,
      ...caps,
    });
    expect(v.shouldThrottle).toBe(true);
    expect(v.reason).toContain("runaway velocity");
  });

  it("throttles on sustained 24h burn even when hourly is under", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 2.5, // under the $3/hr bar
      daySpendUsd: 7.0, // over the $6/24h bar
      ...caps,
    });
    expect(v.shouldThrottle).toBe(true);
    expect(v.reason).toContain("sustained burn");
  });

  it("allows spend exactly at a ceiling (strict-exceed semantics)", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 3.0,
      daySpendUsd: 6.0,
      ...caps,
    });
    expect(v.shouldThrottle).toBe(false);
  });

  it("respects a tighter per-agent daily override", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 0.5,
      daySpendUsd: 2.5,
      hourlyCapUsd: 3,
      dailyCapUsd: 2, // watched-test override below normal-day default
    });
    expect(v.shouldThrottle).toBe(true);
    expect(v.reason).toContain("sustained burn");
  });

  // THE $28 REGRESSION (2026-06-22): a 7-day agent burned $28 while the
  // operational sums read ~$0 (per-turn self-report is blind), so neither the
  // hourly nor the 24h operational check ever fired. The actual-total wall —
  // the OpenRouter poll's true total — must catch it even at operational $0.
  it("throttles on the actual-total wall even when operational spend reads $0 (the blind-ledger fix)", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 0, // blind — per-turn self-report never landed
      daySpendUsd: 0, // blind
      dayActualTotalUsd: 7.2, // the REAL OpenRouter spend, over the $6 cap
      ...caps,
    });
    expect(v.shouldThrottle).toBe(true);
    expect(v.reason).toContain("actual spend wall");
  });

  it("enforces a $1/day cap on real spend (the watched-test config)", () => {
    const under = evaluateSpendThrottle({
      hourSpendUsd: 0,
      daySpendUsd: 0,
      dayActualTotalUsd: 0.9,
      hourlyCapUsd: 3,
      dailyCapUsd: 1,
    });
    expect(under.shouldThrottle).toBe(false);
    const over = evaluateSpendThrottle({
      hourSpendUsd: 0,
      daySpendUsd: 0,
      dayActualTotalUsd: 1.05,
      hourlyCapUsd: 3,
      dailyCapUsd: 1,
    });
    expect(over.shouldThrottle).toBe(true);
    expect(over.reason).toContain("actual spend wall");
  });

  it("actual-total wall is strict-exceed (exactly at cap does not throttle)", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 0,
      daySpendUsd: 0,
      dayActualTotalUsd: 6.0,
      ...caps,
    });
    expect(v.shouldThrottle).toBe(false);
  });

  it("absent actual-total (no poll rows yet) falls back to operational checks only", () => {
    const v = evaluateSpendThrottle({
      hourSpendUsd: 0.4,
      daySpendUsd: 1.8,
      ...caps, // dayActualTotalUsd undefined → wall skipped, operational under
    });
    expect(v.shouldThrottle).toBe(false);
  });
});

describe("spend throttle — research spend is excluded", () => {
  it("a big research run does NOT count toward the throttle ceilings", async () => {
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
      internal.gtmMaya.spendKill.peekAgentSpendForThrottle,
      { agentId: started.agentId }
    );
    expect(snap).not.toBeNull();
    // Only the $0.40 operational row counts — the $12 research run is excluded.
    expect(snap!.hourSpendUsd).toBeCloseTo(0.4, 5);
    expect(snap!.daySpendUsd).toBeCloseTo(0.4, 5);
    expect(snap!.shouldThrottle).toBe(false);
  });
});

describe("spend throttle — degrades, never destroys", () => {
  it("stamps spendThrottledUntil and leaves the machine alive (no kill) when over the ceiling", async () => {
    const t = convexTest(schema, modules);
    const authed = t.withIdentity({
      subject: "founder-throttle",
      email: "founder-throttle@clawlaunch.test",
    });
    const started = await authed.mutation(
      api.gtmMaya.researchLifecycle.startGtmOnboarding,
      {}
    );

    // Seed a $4 operational turn — over the $3/hr velocity ceiling.
    await t.run(async (ctx) => {
      await ctx.db.insert("gtmCostLedger", {
        accountId: started.accountId,
        provider: "openrouter",
        operation: "turn_completion",
        reason: "over-budget turn",
        costUsd: 4,
        cacheStatus: "called",
        createdAt: Date.now(),
      });
    });

    await t.action(
      internal.gtmMaya.spendKill.enforceSpendThrottleForAgent,
      { agentId: started.agentId }
    );

    const agent = await t.run(async (ctx) => ctx.db.get(started.agentId));
    expect(agent).not.toBeNull();
    // Throttled (degrade) — NOT killed (machine stays alive).
    expect(agent!.spendThrottledUntil).toBeDefined();
    expect(agent!.spendThrottledUntil!).toBeGreaterThan(Date.now());
    expect(agent!.spendThrottleReason).toContain("runaway velocity");
    expect(agent!.killedAt).toBeUndefined();

    // The discovery gate now reports the agent as throttled.
    const throttled = await t.query(
      internal.gtmMaya.spendKill.isAgentSpendThrottled,
      { agentId: started.agentId }
    );
    expect(throttled).toBe(true);
  });
});
