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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Id } from "../../_generated/dataModel";
import {
  SWEEPS,
  WEEKLY_SWEEPS,
  sweepRefs,
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

/**
 * ⭐ MEASURED 2026-08-10 — the sweep exceeded Convex's action limit at N=1.
 *
 * `sweepDue` awaited every sweep for every due customer inside one action:
 * five daily plus three weekly, serially. With the weekly work included
 * (`watchFormats` reads up to 50 transcripts each with a model call;
 * `watchTopFormats` downloads video) a SINGLE customer ran 301 seconds and the
 * action was killed at Convex's 300s ceiling.
 *
 * Not a problem waiting at 200 customers — already broken at one, and broken
 * the way this codebase keeps breaking: the cron reported nothing, the claims
 * were already written, and the day looked clean.
 *
 * After fanning out: 301s → 1s, because the dispatcher now schedules and
 * returns instead of awaiting the work.
 */
describe("the sweep cannot exceed one action's budget", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "convex", "maya", "watchers.ts"),
    "utf8"
  );

  it("schedules each sweep instead of awaiting it", () => {
    // ⚠️ Structural, because the failure is a TIMEOUT — there is no assertion
    // about output that distinguishes "ran serially" from "ran fanned out".
    expect(SOURCE).toContain("ctx.scheduler.runAfter(0, internal.maya.watchers.sweepOne");
    // The old shape: awaiting the vendor action inside the dispatcher loop.
    expect(SOURCE).not.toContain("await ctx.runAction(refs[sweep]");
  });

  it("calls the count `scheduled`, not `ran`", () => {
    // `ran` would claim work finished that has only been queued — and the
    // dispatcher genuinely cannot know the outcome any more.
    expect(SOURCE).toContain("scheduled: number");
    expect(SOURCE).not.toMatch(/\bran: number\b/);
  });

  /**
   * ⭐ The compounding half of the bug.
   *
   * `claimSweep` writes the marker BEFORE the work runs — right for dedupe,
   * wrong for failure. A sweep that claimed and then died was recorded as done
   * and never retried, so a timeout became silent data loss: a clean-looking
   * day that collected nothing.
   */
  it("hands the claim back when a sweep fails", () => {
    expect(SOURCE).toContain("internal.maya.watchers.releaseSweep");
    /**
     * The release must be in the CATCH, not the happy path — otherwise a
     * successful sweep would hand its claim back and run again every tick.
     */
    const sweepOne = SOURCE.slice(SOURCE.indexOf("export const sweepOne"));
    const catchBlock = sweepOne.slice(sweepOne.indexOf("} catch (error) {"));
    expect(catchBlock).toContain("releaseSweep");
    // And NOT before it: nothing on the success path may release.
    const beforeCatch = sweepOne.slice(0, sweepOne.indexOf("} catch (error) {"));
    expect(beforeCatch).not.toContain("releaseSweep");
  });
});

/* -------------------------------------------------------------------------- */

describe("the media library has a producer", () => {
  /**
   * ⭐ `fillFromProductPage` was written, tested, and had NO CALLER — and
   * `extractFromUrl`/`classifyImages` beneath it were built for the §6.4.6
   * spike and never called in production either. Three finished functions
   * stacked on each other with nothing at the top.
   *
   * ⚠️ Measured 2026-08-17: `mediaAssets` was empty, and Instagram, TikTok and
   * YouTube cannot take a text-only post. All four channels were connected;
   * 14 of 16 placements went to X because it was the only one she could
   * physically reach.
   */
  it("⭐ the assets sweep is registered and runnable", () => {
    expect(Object.keys(sweepRefs())).toContain("assets");
    expect(sweepRefs().assets).toBeDefined();
  });

  it("runs weekly, not daily", () => {
    /**
     * A product page does not change overnight. `media.record` dedupes on
     * `storageKey`, so a daily re-run would pay for the scrape and write
     * nothing — the cost with none of the benefit.
     */
    expect(WEEKLY_SWEEPS).toContain("assets");
    expect(SWEEPS).not.toContain("assets");
  });

  it("⚠️ every scheduled sweep has a reference — none can be named and missing", () => {
    // The coherence check that matters: a sweep listed but unregistered is a
    // job that silently never runs, which is this codebase's signature defect.
    const refs = sweepRefs();
    for (const name of [...SWEEPS, ...WEEKLY_SWEEPS]) {
      expect(refs[name], `${name} has no ref`).toBeDefined();
    }
  });
});
