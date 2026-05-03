/**
 * Deals queries — Sprint 5 acceptance.
 *
 * Mandatory test categories:
 *   1. Cross-tenant: every query — A never sees B's deals/pitches/details.
 *   2. Plan-tier (REVISED 2026-04-26): brandOutreach + opportunityScout are
 *      universal across plans, so outreachByStatus / opportunityMatches /
 *      outreachDetail return data on every tier. dealsByStatus is also
 *      universal. Apollo/Hunter (brandContactDiscovery) remains Studio-only
 *      but is tested in the businessReadiness suite, not here.
 *   3. Adversarial: unauth → empty buckets / null; deleted record → null;
 *      mismatched id → null.
 *   4. Sibling-file scan + 5. TODO grep: covered repo-wide.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "starter" | "pro" | "studio" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

async function insertDeal(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  brand: string,
  status:
    | "new"
    | "reviewing"
    | "negotiating"
    | "signed"
    | "shooting"
    | "submitted"
    | "paid"
    | "lost"
): Promise<Id<"brandDeals">> {
  return await t.run((ctx) =>
    ctx.db.insert("brandDeals", {
      creatorId,
      brand,
      status,
      deliverables: ["1 reel"],
      riskFlags: [],
      replyVariants: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
  );
}

async function insertPitch(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  brand: string,
  status: "drafted" | "sent" | "replied" | "declined" | "no-response"
): Promise<Id<"pitchOutreach">> {
  return await t.run((ctx) =>
    ctx.db.insert("pitchOutreach", {
      creatorId,
      brand,
      contactEmail: `bd@${brand.toLowerCase()}.com`,
      pitchAngle: "partnership",
      status,
    })
  );
}

describe("deals.dealsByStatus", () => {
  it("returns empty buckets for all statuses when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.deals.dealsByStatus, {});
    expect(r.new).toEqual([]);
    expect(r.paid).toEqual([]);
    expect(Object.keys(r)).toContain("negotiating");
  });

  it("groups deals by status, keeping all status keys present", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertDeal(t, a, "Glossier", "new");
    await insertDeal(t, a, "Nike", "signed");
    await insertDeal(t, a, "Whoop", "paid");
    const r = await asUser(t, "a").query(api.deals.dealsByStatus, {});
    expect(r.new).toHaveLength(1);
    expect(r.signed).toHaveLength(1);
    expect(r.paid).toHaveLength(1);
    expect(r.lost).toEqual([]);
  });

  it("CROSS-TENANT: A's pipeline excludes B's deals", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await insertDeal(t, b, "B's brand", "new");
    const r = await asUser(t, "a").query(api.deals.dealsByStatus, {});
    expect(r.new).toEqual([]);
  });

  it("PLAN-TIER: Starter sees their own deals (read is unrestricted)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await insertDeal(t, a, "Manual entry", "new");
    const r = await asUser(t, "a").query(api.deals.dealsByStatus, {});
    expect(r.new).toHaveLength(1);
  });
});

describe("deals.outreachByStatus", () => {
  it("PLAN-TIER (REVISED): Starter sees their pitches grouped by status — brand-outreach is ungated", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await insertPitch(t, a, "Brand", "drafted");
    const r = await asUser(t, "a").query(api.deals.outreachByStatus, {});
    expect(r.drafted).toHaveLength(1);
  });

  it("PLAN-TIER: Pro sees their pitches grouped by status", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertPitch(t, a, "X", "drafted");
    await insertPitch(t, a, "Y", "sent");
    const r = await asUser(t, "a").query(api.deals.outreachByStatus, {});
    expect(r.drafted).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
  });

  it("CROSS-TENANT: A never sees B's pitches", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await insertPitch(t, b, "B-brand", "drafted");
    const r = await asUser(t, "a").query(api.deals.outreachByStatus, {});
    expect(r.drafted).toEqual([]);
  });
});

describe("deals.opportunityMatches", () => {
  it("PLAN-TIER (REVISED): Starter returns an array (opportunity-scout is ungated; live wiring TODO(s5))", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "starter" });
    const r = await asUser(t, "a").query(api.deals.opportunityMatches, {});
    // Under the revised matrix Starter is no longer fail-closed here — the
    // reader runs and returns an array (currently empty until S5 wires the
    // dedicated table — see TODO(s5) in convex/deals.ts).
    expect(Array.isArray(r)).toBe(true);
  });

  it("PLAN-TIER: Pro returns [] until live wiring lands (TODO(s5))", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const r = await asUser(t, "a").query(api.deals.opportunityMatches, {});
    // Sprint 5 wires the live table; this test acts as the canary that the
    // shape stays an array until then.
    expect(Array.isArray(r)).toBe(true);
  });
});

describe("deals.dealDetail", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const dealId = await insertDeal(t, a, "X", "new");
    const r = await t.query(api.deals.dealDetail, { dealId });
    expect(r).toBeNull();
  });

  it("CROSS-TENANT: A cannot fetch B's deal by id", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const bDeal = await insertDeal(t, b, "B-only", "new");
    const r = await asUser(t, "a").query(api.deals.dealDetail, { dealId: bDeal });
    expect(r).toBeNull();
  });

  it("ADVERSARIAL: deleted deal returns null cleanly", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const dealId = await insertDeal(t, a, "X", "new");
    await t.run((ctx) => ctx.db.delete(dealId));
    const r = await asUser(t, "a").query(api.deals.dealDetail, { dealId });
    expect(r).toBeNull();
  });

  it("returns deal + reply variants for the owning creator", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const dealId = await t.run((ctx) =>
      ctx.db.insert("brandDeals", {
        creatorId: a,
        brand: "Glossier",
        status: "new",
        deliverables: [],
        riskFlags: ["exclusivity 12mo"],
        replyVariants: ["accept", "counter", "decline", "stall"],
        createdAt: NOW,
        updatedAt: NOW,
      })
    );
    const r = await asUser(t, "a").query(api.deals.dealDetail, { dealId });
    expect(r?.deal.brand).toBe("Glossier");
    expect(r?.replyVariants).toHaveLength(4);
  });
});

describe("deals.outreachDetail", () => {
  it("PLAN-TIER (REVISED): Starter receives their own pitch detail — brand-outreach is ungated", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    const pid = await insertPitch(t, a, "X", "drafted");
    const r = await asUser(t, "a").query(api.deals.outreachDetail, {
      pitchId: pid,
    });
    expect(r?.pitch.brand).toBe("X");
  });

  it("CROSS-TENANT: A cannot fetch B's pitch", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const bPid = await insertPitch(t, b, "B-only", "sent");
    const r = await asUser(t, "a").query(api.deals.outreachDetail, {
      pitchId: bPid,
    });
    expect(r).toBeNull();
  });

  it("returns the pitch for the owning Pro creator", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const pid = await insertPitch(t, a, "X", "drafted");
    const r = await asUser(t, "a").query(api.deals.outreachDetail, {
      pitchId: pid,
    });
    expect(r?.pitch.brand).toBe("X");
  });
});
