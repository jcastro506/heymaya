/**
 * ⭐ The watchers layer (§3.1) — collection that does not depend on her.
 *
 * *"She is NOT the thing polling APIs."* Every sweep was reachable only through
 * `hooks.ts` until 2026-08-08, so the niche was watched only when she
 * remembered to call the tool. That morning her brief turn produced nothing;
 * had it been the scroll turn instead, the day's perception would have been
 * silently empty.
 *
 * These tests cover the scheduling decision — the part most likely to be subtly
 * wrong and hardest to observe in production.
 */
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import type { Id } from "../../_generated/dataModel";
import {
  SWEEPS,
  SWEEP_HOUR_LOCAL,
  TICK_MINUTES,
  isDue,
  jitterMinute,
  localHourMinute,
} from "../watchers";

const NY = "America/New_York";
/** 2026-08-08, 07:00 in New York. */
const SEVEN_AM_NY = Date.UTC(2026, 7, 8, 11, 0);

async function seed(t: ReturnType<typeof convexTest>): Promise<Id<"customers">> {
  return await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("creators", {
      clerkUserId: "u_watch",
      email: "watch@example.com",
      channelPreference: "telegram",
      timezone: NY,
      status: "active",
      plan: "manager",
      createdAt: SEVEN_AM_NY,
    });
    return await ctx.db.insert("customers", {
      accountId,
      agentVersion: "v2",
      plan: "mvp",
      state: "active",
      timezone: NY,
      createdAt: SEVEN_AM_NY,
      updatedAt: SEVEN_AM_NY,
    });
  });
}

describe("⭐ JITTER IS DERIVED, NEVER RANDOM", () => {
  it("the same customer always gets the same slot", () => {
    // A random offset would make "did today's sweep run?" unanswerable — you
    // could never tell late from missing, which is the question this whole
    // layer exists to answer.
    const id = "m57zjvtw15hm10he2rz4epp1kx8btwj1";
    expect(jitterMinute(id)).toBe(jitterMinute(id));
  });

  it("different customers land in different slots", () => {
    // 200 customers firing in the same second rate-limits the vendor and the
    // retries land together too — it looks like an outage and is self-inflicted.
    const slots = new Set(
      ["cust_aaa", "cust_bbb", "cust_ccc", "cust_ddd", "cust_eee"].map(jitterMinute)
    );
    expect(slots.size).toBeGreaterThan(1);
  });

  it("every slot falls inside the hour", () => {
    for (const id of ["a", "bb", "ccc", "dddd", "eeeee", "ffffff"]) {
      expect(jitterMinute(id)).toBeGreaterThanOrEqual(0);
      expect(jitterMinute(id)).toBeLessThan(60);
    }
  });
});

describe("due only in the founder's own 7am", () => {
  it("reads the hour where the FOUNDER is, not UTC", () => {
    // 11:00 UTC is 07:00 in New York. A UTC check would sweep at 3am for them.
    expect(localHourMinute(SEVEN_AM_NY, NY).hour).toBe(SEVEN_AM_NY ? 7 : 7);
    expect(localHourMinute(SEVEN_AM_NY, "UTC").hour).toBe(11);
  });

  it("is due at their slot and not before it", () => {
    const customerId = "cust_slot";
    const slot = jitterMinute(customerId);
    const at = (minute: number) =>
      isDue({ now: SEVEN_AM_NY + minute * 60_000, timezone: NY, customerId });

    expect(at(slot)).toBe(true);
    if (slot > 0) expect(at(slot - 1)).toBe(false);
  });

  it("stays due for one tick, then stops", () => {
    const customerId = "cust_slot";
    const slot = jitterMinute(customerId);
    const at = (minute: number) =>
      isDue({ now: SEVEN_AM_NY + minute * 60_000, timezone: NY, customerId });

    expect(at(slot + TICK_MINUTES - 1)).toBe(true);
    // Past the window it's the next tick's problem — and the claim below is
    // what stops that becoming a second sweep.
    expect(at(slot + TICK_MINUTES)).toBe(false);
  });

  it("is never due outside the sweep hour", () => {
    for (const hourOffset of [-2, -1, 1, 5, 12]) {
      const now = SEVEN_AM_NY + hourOffset * 3_600_000;
      expect(
        isDue({ now, timezone: NY, customerId: "cust_slot" }),
        `hour ${SWEEP_HOUR_LOCAL + hourOffset} should not be due`
      ).toBe(false);
    }
  });

  it("a Tokyo founder sweeps at THEIR 7am, not New York's", () => {
    // 22:00 UTC is 07:00 next day in Tokyo.
    const tokyoSeven = Date.UTC(2026, 7, 7, 22, 0);
    expect(localHourMinute(tokyoSeven, "Asia/Tokyo").hour).toBe(7);
    expect(localHourMinute(tokyoSeven, NY).hour).not.toBe(7);
  });
});

describe("⚠️ ONCE PER FOUNDER-DAY, however many ticks pass", () => {
  it("the second claim on the same day is refused", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);

    const first = await t.mutation(internal.maya.watchers.claimSweep, {
      customerId,
      sweep: "scroll",
      day: "2026-08-08",
    });
    const second = await t.mutation(internal.maya.watchers.claimSweep, {
      customerId,
      sweep: "scroll",
      day: "2026-08-08",
    });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
  });

  it("tomorrow is a new claim", async () => {
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.mutation(internal.maya.watchers.claimSweep, {
      customerId,
      sweep: "scroll",
      day: "2026-08-08",
    });
    const tomorrow = await t.mutation(internal.maya.watchers.claimSweep, {
      customerId,
      sweep: "scroll",
      day: "2026-08-09",
    });
    expect(tomorrow.claimed).toBe(true);
  });

  it("each sweep is claimed independently", async () => {
    // One dead sweep must not consume the other four's turn.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    for (const sweep of SWEEPS) {
      const res = await t.mutation(internal.maya.watchers.claimSweep, {
        customerId,
        sweep,
        day: "2026-08-08",
      });
      expect(res.claimed, `${sweep} should claim independently`).toBe(true);
    }
    const swept = await t.query(internal.maya.watchers.sweptFor, { customerId });
    expect(Object.keys(swept).sort()).toEqual([...SWEEPS].sort());
  });

  it("a corrupt marker re-claims rather than throwing", async () => {
    // A watcher that dies on bad JSON stops watching entirely, which is worse
    // than sweeping twice.
    const t = convexTest(schema, modules);
    const customerId = await seed(t);
    await t.run((ctx) => ctx.db.patch(customerId, { sweptJson: "{not json" }));
    const res = await t.mutation(internal.maya.watchers.claimSweep, {
      customerId,
      sweep: "scroll",
      day: "2026-08-08",
    });
    expect(res.claimed).toBe(true);
  });
});
