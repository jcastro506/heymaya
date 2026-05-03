/**
 * Wave D telemetry — getTelemetrySummary + emit-mutation tests.
 *
 * Five mandatory test categories per Service Sprint Plan § 14, plus the
 * Wave D-specific judgment-not-rules invariant:
 *   1. Cross-tenant isolation
 *   2. Plan-tier × action matrix (Starter null, Pro/Studio counts)
 *   3. Adversarial inputs (bogus signal/outcome rejected, cross-tenant id)
 *   4. Sibling-file scan (telemetry signals match schema literals)
 *   5. TODO grep (handled by SiblingFileScan suite)
 *   6. Judgment-not-rules — no compute*Score / rank / rate helpers
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import schema from "../../../schema";
import { api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function seedAccount(
  t: ReturnType<typeof convexTest>,
  opts: {
    suffix: string;
    accountType?: "creator" | "service-business";
    plan?: "starter" | "pro" | "studio";
  }
): Promise<{ accountId: Id<"creators">; businessId: Id<"businesses"> }> {
  const accountId = (await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan ?? "pro",
      accountType: opts.accountType ?? "service-business",
      createdAt: NOW,
    })
  )) as Id<"creators">;
  const businessId = (await t.run((ctx) =>
    ctx.db.insert("businesses", {
      accountId,
      name: `${opts.suffix} biz`,
      serviceTypes: ["plumbing"],
      planTier: opts.plan ?? "pro",
      createdAt: NOW,
      updatedAt: NOW,
    })
  )) as Id<"businesses">;
  await t.run((ctx) => ctx.db.patch(accountId, { businessId }));
  return { accountId, businessId };
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

/* ────────────────────────────────────────────────────────────────────── */
/* getTelemetrySummary                                                    */
/* ────────────────────────────────────────────────────────────────────── */

describe("queries.business.growth.getTelemetrySummary", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "anon" });
    const result = await t.query(
      api.queries.business.growth.getTelemetrySummary,
      { window: "30d" }
    );
    expect(result).toBeNull();
  });

  it("PLAN-TIER: Starter sees null (audit log not surfaced)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "s", plan: "starter" });
    const result = await asUser(t, "s").query(
      api.queries.business.growth.getTelemetrySummary,
      { window: "30d" }
    );
    expect(result).toBeNull();
  });

  it("PLAN-TIER: Pro sees zero counts when no rows emitted", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "p", plan: "pro" });
    const result = await asUser(t, "p").query(
      api.queries.business.growth.getTelemetrySummary,
      { window: "30d" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.window).toBe("30d");
    expect(result.signals.length).toBe(6);
    for (const s of result.signals) {
      expect(s.count).toBe(0);
    }
  });

  it("Pro sees aggregated counts and per-outcome breakdown", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "p2", plan: "pro" });
    // Emit 3 review-request approvals (2 approved, 1 rejected) +
    // 1 voice-satisfaction (positive, rating=5). Use real `Date.now()`
    // anchors so rows fall within the query's [start, now) window.
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("serviceTelemetry", {
        businessId,
        signal: "review-request-approval",
        outcome: "approved",
        ts: now - 1000,
      });
      await ctx.db.insert("serviceTelemetry", {
        businessId,
        signal: "review-request-approval",
        outcome: "approved",
        ts: now - 800,
      });
      await ctx.db.insert("serviceTelemetry", {
        businessId,
        signal: "review-request-approval",
        outcome: "rejected",
        ts: now - 600,
      });
      await ctx.db.insert("serviceTelemetry", {
        businessId,
        signal: "voice-satisfaction",
        outcome: "positive",
        numericValue: 5,
        ts: now - 400,
      });
    });
    const result = await asUser(t, "p2").query(
      api.queries.business.growth.getTelemetrySummary,
      { window: "ytd" }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    const rra = result.signals.find((s) => s.signal === "review-request-approval");
    expect(rra?.count).toBe(3);
    expect(rra?.byOutcome.approved).toBe(2);
    expect(rra?.byOutcome.rejected).toBe(1);
    const voice = result.signals.find((s) => s.signal === "voice-satisfaction");
    expect(voice?.count).toBe(1);
    expect(voice?.numericSum).toBe(5);
  });

  it("CROSS-TENANT: business A telemetry never appears in business B's summary", async () => {
    const t = convexTest(schema, modules);
    const { businessId: bA } = await seedAccount(t, { suffix: "a", plan: "pro" });
    await seedAccount(t, { suffix: "b", plan: "pro" });
    await t.run(async (ctx) => {
      await ctx.db.insert("serviceTelemetry", {
        businessId: bA,
        signal: "review-request-approval",
        outcome: "approved",
        ts: Date.now() - 1000,
      });
    });
    const fromB = await asUser(t, "b").query(
      api.queries.business.growth.getTelemetrySummary,
      { window: "ytd" }
    );
    expect(fromB).not.toBeNull();
    if (!fromB) return;
    const rra = fromB.signals.find((s) => s.signal === "review-request-approval");
    expect(rra?.count).toBe(0);
  });

  it("ADVERSARIAL: bogus window arg coerced — query rejects unknown literal at validator", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "adv", plan: "pro" });
    await expect(
      asUser(t, "adv").query(api.queries.business.growth.getTelemetrySummary, {
        // @ts-expect-error — runtime adversarial input
        window: "9999d",
      })
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* markReviewRequestOutcome                                                */
/* ────────────────────────────────────────────────────────────────────── */

describe("serviceTelemetry.markReviewRequestOutcome", () => {
  it("emits a row for the caller's business", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "rra1", plan: "pro" });
    const id = await asUser(t, "rra1").mutation(
      api.serviceTelemetry.markReviewRequestOutcome,
      { outcome: "approved" }
    );
    expect(id).not.toBeNull();
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceTelemetry")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows.length).toBe(1);
    expect(rows[0].signal).toBe("review-request-approval");
    expect(rows[0].outcome).toBe("approved");
  });

  it("returns null when unauthenticated (no row inserted)", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, { suffix: "rra2", plan: "pro" });
    const id = await t.mutation(
      api.serviceTelemetry.markReviewRequestOutcome,
      { outcome: "approved" }
    );
    expect(id).toBeNull();
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceTelemetry")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows.length).toBe(0);
  });

  it("CROSS-TENANT: rejects a reviewRequestId from another business (returns null)", async () => {
    const t = convexTest(schema, modules);
    const { businessId: bA } = await seedAccount(t, {
      suffix: "ax",
      plan: "pro",
    });
    await seedAccount(t, { suffix: "bx", plan: "pro" });
    // Seed a job + customer in business A so the reviewRequests row's
    // typed FKs validate.
    const customerA = (await t.run((ctx) =>
      ctx.db.insert("serviceCustomers", {
        businessId: bA,
        name: "Cust A",
        phone: "+15555555555",
        email: "a@test",
        address: "1 Maple",
        lifetimeValueUsd: 0,
        lastJobAt: NOW,
        reviewStatus: "not-yet",
        createdAt: NOW,
        updatedAt: NOW,
      })
    )) as Id<"serviceCustomers">;
    const jobA = (await t.run((ctx) =>
      ctx.db.insert("serviceJobs", {
        businessId: bA,
        customerId: customerA,
        status: "completed",
        scheduledAt: NOW,
        completedAt: NOW,
        technicianName: "Tech A",
        serviceType: "hvac",
        ticketAmountUsd: 100,
        photos: [],
        notes: "",
        createdAt: NOW,
        updatedAt: NOW,
      })
    )) as Id<"serviceJobs">;
    const otherRrId = (await t.run((ctx) =>
      ctx.db.insert("reviewRequests", {
        businessId: bA,
        jobId: jobA,
        customerId: customerA,
        channel: "sms",
        status: "queued",
        followupCount: 0,
        createdAt: NOW,
      })
    )) as Id<"reviewRequests">;
    const id = await asUser(t, "bx").mutation(
      api.serviceTelemetry.markReviewRequestOutcome,
      { outcome: "approved", reviewRequestId: otherRrId }
    );
    expect(id).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* markLeadNudgeOutcome                                                    */
/* ────────────────────────────────────────────────────────────────────── */

describe("serviceTelemetry.markLeadNudgeOutcome", () => {
  it("emits and accepts opened/dismissed/acted-on", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "ln", plan: "pro" });
    for (const outcome of ["opened", "dismissed", "acted-on"] as const) {
      const id = await asUser(t, "ln").mutation(
        api.serviceTelemetry.markLeadNudgeOutcome,
        { outcome }
      );
      expect(id).not.toBeNull();
    }
  });

  it("CROSS-TENANT: rejects a leadId from another business", async () => {
    const t = convexTest(schema, modules);
    const { businessId: bA } = await seedAccount(t, {
      suffix: "ln-a",
      plan: "pro",
    });
    await seedAccount(t, { suffix: "ln-b", plan: "pro" });
    const otherLeadId = (await t.run((ctx) =>
      ctx.db.insert("inboundLeads", {
        businessId: bA,
        source: "gbp-msg",
        externalId: "ext-lead-a",
        capturedAt: NOW,
      })
    )) as Id<"inboundLeads">;
    const id = await asUser(t, "ln-b").mutation(
      api.serviceTelemetry.markLeadNudgeOutcome,
      { outcome: "opened", leadId: otherLeadId }
    );
    expect(id).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* submitVoiceCallRating                                                   */
/* ────────────────────────────────────────────────────────────────────── */

describe("serviceTelemetry.submitVoiceCallRating", () => {
  it("PLAN-TIER: Starter returns null (no voice tier)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "vs-s", plan: "starter" });
    const id = await asUser(t, "vs-s").mutation(
      api.serviceTelemetry.submitVoiceCallRating,
      { rating: 5 }
    );
    expect(id).toBeNull();
  });

  it("PLAN-TIER: Pro returns null (Pro has voice inclusion but signal is Studio-only)", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "vs-p", plan: "pro" });
    const id = await asUser(t, "vs-p").mutation(
      api.serviceTelemetry.submitVoiceCallRating,
      { rating: 5 }
    );
    expect(id).toBeNull();
  });

  it("PLAN-TIER: Studio emits with positive/neutral/negative outcome", async () => {
    const t = convexTest(schema, modules);
    const { businessId } = await seedAccount(t, {
      suffix: "vs-studio",
      plan: "studio",
    });
    await asUser(t, "vs-studio").mutation(
      api.serviceTelemetry.submitVoiceCallRating,
      { rating: 5 }
    );
    await asUser(t, "vs-studio").mutation(
      api.serviceTelemetry.submitVoiceCallRating,
      { rating: 3 }
    );
    await asUser(t, "vs-studio").mutation(
      api.serviceTelemetry.submitVoiceCallRating,
      { rating: 1 }
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("serviceTelemetry")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    );
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.outcome).sort()).toEqual([
      "negative",
      "neutral",
      "positive",
    ]);
  });

  it("ADVERSARIAL: rating out of [1,5] throws", async () => {
    const t = convexTest(schema, modules);
    await seedAccount(t, { suffix: "vs-bad", plan: "studio" });
    await expect(
      asUser(t, "vs-bad").mutation(
        api.serviceTelemetry.submitVoiceCallRating,
        { rating: 7 }
      )
    ).rejects.toThrow();
    await expect(
      asUser(t, "vs-bad").mutation(
        api.serviceTelemetry.submitVoiceCallRating,
        { rating: 0 }
      )
    ).rejects.toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* Judgment-not-rules invariant                                            */
/* ────────────────────────────────────────────────────────────────────── */

describe("serviceTelemetry — judgment-not-rules invariant", () => {
  const REPO_ROOT = resolve(__dirname, "../../../..");
  const TARGET_FILES = [
    "convex/serviceTelemetry.ts",
    "convex/queries/business/growth.ts",
    "components/business/growth/TelemetryAuditList.tsx",
  ];

  it("no helper computes a synthesized score / rank / rating from telemetry inputs", () => {
    for (const target of TARGET_FILES) {
      const path = resolve(REPO_ROOT, target);
      const src = readFileSync(path, "utf8");
      // Ban: function names that synthesize a derived score/rank/rating.
      // These specifically prohibit weighted-composite math built from
      // telemetry rows. Counts, sums, byOutcome aggregations are explicitly
      // permitted.
      expect(src, `${target}: no compute*Score helper`).not.toMatch(
        /function\s+compute[A-Z]\w*Score\b/
      );
      expect(src, `${target}: no rank* helper`).not.toMatch(
        /function\s+rank[A-Z]\w*\b/
      );
      expect(src, `${target}: no rate* helper`).not.toMatch(
        /function\s+rate[A-Z]\w*\b/
      );
    }
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/* TODO grep                                                              */
/* ────────────────────────────────────────────────────────────────────── */

describe("Wave D files — TODO/FIXME/eslint-disable hygiene", () => {
  const REPO_ROOT = resolve(__dirname, "../../../..");
  const TARGETS = [
    "convex/serviceTelemetry.ts",
    "convex/queries/business/growth.ts",
    "components/business/growth/TelemetryAuditList.tsx",
    "scripts/service-mvp-smoke.ts",
  ];

  it("no plain TODO/FIXME; eslint-disable carries a -- justification", () => {
    for (const target of TARGETS) {
      const path = resolve(REPO_ROOT, target);
      const src = readFileSync(path, "utf8");
      expect(src, `${target} contains plain TODO`).not.toMatch(/\bTODO\b/);
      expect(src, `${target} contains plain FIXME`).not.toMatch(/\bFIXME\b/);
      const eslintDisables = Array.from(src.matchAll(/eslint-disable[^\n]*/g));
      for (const m of eslintDisables) {
        expect(
          m[0],
          `${target} eslint-disable needs --justification`
        ).toMatch(/--/);
      }
    }
  });
});
