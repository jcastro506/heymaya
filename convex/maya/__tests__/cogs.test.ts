/**
 * ⭐ What a customer costs, and what they're on track to cost.
 *
 * Operator, 2026-08-06: *"COGS are gonna amortize and blend over many users,
 * but each user can't just blow out… we just got to make sure we're watching,
 * if this specific machine was a user, how much money has it used so far, and
 * how much is it projected to use for the month?"*
 *
 * These tests hold that framing in place:
 *
 *  - measurement, never enforcement — nothing here can hold a post or a reply
 *  - blended across the fleet, with outliers NAMED rather than clipped
 *  - honest about not knowing, instead of extrapolating from six hours
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import { MIN_DAYS_TO_PROJECT, project } from "../cogs";
import { ALWAYS_ALLOWED_KINDS, allowsKind } from "../spendCeiling";

/** 2026-08-15 12:00 UTC — mid-month, so projections have room both ways. */
const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

async function seed(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  createdAt = Date.UTC(2026, 6, 1)
): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: `u_${suffix}`,
      email: `${suffix}@example.com`,
      channelPreference: "telegram",
      timezone: "UTC",
      status: "active",
      plan: "manager",
      createdAt,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: "UTC",
      createdAt,
      updatedAt: createdAt,
    });
  });
}

describe("THE CEILING NEVER SILENCES HER", () => {
  /**
   * The operator was explicit: *"We're not gonna cap any one user, like
   * heymaya is just gonna stop talking to them."* A cap that stops the
   * conversation is indistinguishable from an outage.
   */
  it("talking, answering and publishing continue at any spend", () => {
    for (const kind of [
      "deliver_message",
      "answer_comment",
      "answer_dm",
      "answer_mention",
      "publish_placement",
    ]) {
      expect(ALWAYS_ALLOWED_KINDS).toContain(kind);
      expect(allowsKind("throttled", kind), `${kind} was blocked`).toBe(true);
    }
  });

  it("only speculative work pauses", () => {
    // Nobody is waiting in a conversation on a research sweep.
    expect(allowsKind("throttled", "research_sweep")).toBe(false);
    expect(allowsKind("throttled", "render_video")).toBe(false);
  });
});

describe("projection — honest about what it can't know yet", () => {
  it("refuses to project from too little data", () => {
    // Six hours scaled to a month multiplies by 120: one expensive sweep would
    // read as a $400 customer.
    const p = project({ monthToDateUsd: 3, daysObserved: 1, daysInMonth: 31 });
    expect(p.projectedMonthUsd).toBeNull();
    expect(p.detail).toMatch(/too early/);
  });

  it("projects once there is enough of the month to extrapolate", () => {
    const p = project({
      monthToDateUsd: 6,
      daysObserved: MIN_DAYS_TO_PROJECT,
      daysInMonth: 30,
    });
    expect(p.projectedMonthUsd).toBeCloseTo(60, 5);
    expect(p.detail).toMatch(/\$60\.00/);
  });

  it("a mid-month signup is measured from THEIR start, not the 1st", () => {
    // Dividing $10 by 28 days instead of the 4 they've existed reports $10.71
    // a month instead of $75 — which would make every new customer look cheap
    // in exactly the month you'd want to catch them.
    const theirs = project({ monthToDateUsd: 10, daysObserved: 4, daysInMonth: 30 });
    const wrong = project({ monthToDateUsd: 10, daysObserved: 28, daysInMonth: 30 });
    expect(theirs.projectedMonthUsd).toBeCloseTo(75, 5);
    expect(wrong.projectedMonthUsd!).toBeLessThan(15);
  });

  it("says the money in dollars a person reads, not floats", () => {
    const p = project({ monthToDateUsd: 25.920356, daysObserved: 5, daysInMonth: 30 });
    expect(p.detail).toContain("$25.92");
    expect(p.detail).not.toMatch(/\d\.\d{3}/);
  });
});

describe("the ledger records what the VENDOR said", () => {
  it("a call with no reported cost is refused, never stored as zero", async () => {
    // An unknown cost written as 0 reads as free, and this product already
    // shipped a ledger reporting $0.025 against a $22 bill.
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "nocost");
    const res = await t.mutation(internal.maya.cogs.record, {
      customerId,
      vendor: "openrouter",
      purpose: "idea_scoring",
      now: NOW,
    });
    expect(res.recorded).toBe(false);
    const rows = await t.run((ctx) => ctx.db.query("costEvents").collect());
    expect(rows).toHaveLength(0);
  });

  it("sums a customer's month and breaks it down by what it was FOR", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "month");
    for (const [purpose, costUsd] of [
      ["idea_scoring", 1],
      ["idea_scoring", 2],
      ["safety_critic", 4],
    ] as const) {
      await t.mutation(internal.maya.cogs.record, {
        customerId,
        vendor: "openrouter",
        purpose,
        costUsd,
        now: NOW,
      });
    }

    const report = await t.query(internal.maya.cogs.forCustomer, {
      customerId,
      now: NOW,
    });
    expect(report?.monthToDateUsd).toBe(7);
    // Ranked, because the point is to explain an expensive customer.
    expect(report?.byPurpose[0]).toEqual({ purpose: "safety_critic", usd: 4 });
    expect(report?.byPurpose[1]).toEqual({ purpose: "idea_scoring", usd: 3 });
  });

  it("last month's spend is not this month's", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t, "prevmonth");
    await t.mutation(internal.maya.cogs.record, {
      customerId,
      vendor: "openrouter",
      purpose: "idea_scoring",
      costUsd: 99,
      now: Date.UTC(2026, 6, 20), // July
    });
    const report = await t.query(internal.maya.cogs.forCustomer, {
      customerId,
      now: NOW, // August
    });
    expect(report?.monthToDateUsd).toBe(0);
  });

  it("CROSS-TENANT: one customer's spend never lands on another's bill", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "cogs_a");
    const b = await seed(t, "cogs_b");
    await t.mutation(internal.maya.cogs.record, {
      customerId: a,
      vendor: "openrouter",
      purpose: "idea_scoring",
      costUsd: 12,
      now: NOW,
    });
    const forB = await t.query(internal.maya.cogs.forCustomer, {
      customerId: b,
      now: NOW,
    });
    expect(forB?.monthToDateUsd).toBe(0);
  });
});

describe("the fleet number is the one that decides whether the price works", () => {
  it("blends across customers and names the outliers rather than clipping them", async () => {
    const t = convexTest(schema, modules);
    const cheap = await Promise.all(
      [1, 2, 3].map((i) => seed(t, `cheap_${i}`))
    );
    const expensive = await seed(t, "expensive");

    for (const c of cheap) {
      await t.mutation(internal.maya.cogs.record, {
        customerId: c,
        vendor: "openrouter",
        purpose: "idea_scoring",
        costUsd: 4,
        now: NOW,
      });
    }
    await t.mutation(internal.maya.cogs.record, {
      customerId: expensive,
      vendor: "openrouter",
      purpose: "research_sweep",
      costUsd: 40,
      now: NOW,
    });

    const fleet = await t.query(internal.maya.cogs.fleet, { now: NOW });
    expect(fleet.customers).toBe(4);
    expect(fleet.totalUsd).toBe(52);
    expect(fleet.averageUsd).toBe(13);
    // $40 beside three $4s is a fine month at $149 — the outlier is reported,
    // not capped.
    expect(fleet.outliers).toHaveLength(1);
    expect(fleet.outliers[0].customerId).toBe(expensive);
    expect(fleet.outliers[0].timesAverage).toBeCloseTo(40 / 13, 5);
  });

  it("an empty fleet reports zero rather than dividing by it", async () => {
    const t = convexTest(schema, modules);
    const fleet = await t.query(internal.maya.cogs.fleet, { now: NOW });
    expect(fleet.customers).toBe(0);
    expect(fleet.averageUsd).toBe(0);
    expect(Number.isNaN(fleet.averageUsd)).toBe(false);
  });
});
