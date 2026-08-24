/**
 * `dashboardState` (§16.5) — the one row the home screen subscribes to.
 *
 * The interesting part isn't the caching. It's that a denormalized row can be
 * wrong in ways the founder cannot see, so what's asserted here is the honesty:
 * when it admits it doesn't know, and when it refuses to look busy.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { api } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import {
  livenessFrom,
  oldestMetricsAsOf,
  statusLineFrom,
} from "../dashboard";

describe("livenessFrom", () => {
  it("is healthy the moment something went out", () => {
    expect(
      livenessFrom({ placementsToday: 1, daysSinceLastPlacement: 0, hasOpenQuestion: false })
    ).toBe("healthy");
  });

  /**
   * ⭐ Waiting on a person is not a failure.
   *
   * She has done her part and the move is the founder's. Calling that
   * "breached" blames them for her silence.
   */
  it("is degraded, not breached, while a question is outstanding", () => {
    expect(
      livenessFrom({ placementsToday: 0, daysSinceLastPlacement: 3, hasOpenQuestion: true })
    ).toBe("degraded");
  });

  /**
   * ⚠️ Derived from PLACEMENTS, never from whether jobs ran. A machine that
   * woke, swept, drafted and published nothing had a breached day — and a
   * liveness signal based on activity would call that healthy, which is the
   * reassuring lie §16.6 exists to prevent.
   */
  it("is breached after two silent days with nothing blocking her", () => {
    expect(
      livenessFrom({ placementsToday: 0, daysSinceLastPlacement: 2, hasOpenQuestion: false })
    ).toBe("breached");
  });

  it("is degraded, not breached, on a brand-new account", () => {
    // Never posted is not the same as stopped posting.
    expect(
      livenessFrom({ placementsToday: 0, daysSinceLastPlacement: null, hasOpenQuestion: false })
    ).toBe("degraded");
  });
});

describe("statusLineFrom", () => {
  it("leads with the open item when there is one", () => {
    expect(
      statusLineFrom({
        liveness: "degraded",
        placementsToday: 0,
        needsYou: "Want this to go out?",
        daysSinceLastPlacement: 1,
      })
    ).toBe("Waiting on you.");
  });

  it("counts today's posts, and gets the singular right", () => {
    expect(
      statusLineFrom({ liveness: "healthy", placementsToday: 1, daysSinceLastPlacement: 0 })
    ).toBe("Posted once today.");
    expect(
      statusLineFrom({ liveness: "healthy", placementsToday: 3, daysSinceLastPlacement: 0 })
    ).toContain("3 times");
  });

  /**
   * ⭐ §12: honest silence beats fake activity — and a vague status line on a
   * broken week is fake activity by omission.
   */
  it("names the silence plainly when nothing has gone out for days", () => {
    const line = statusLineFrom({
      liveness: "breached",
      placementsToday: 0,
      daysSinceLastPlacement: 4,
    });
    expect(line).toContain("4 days");
    expect(line.toLowerCase()).not.toMatch(/working on|soon|shortly/);
  });

  it("never claims activity it doesn't have", () => {
    for (const line of [
      statusLineFrom({ liveness: "degraded", placementsToday: 0, daysSinceLastPlacement: 1 }),
      statusLineFrom({ liveness: "breached", placementsToday: 0, daysSinceLastPlacement: null }),
    ]) {
      expect(line.toLowerCase()).toMatch(/nothing posted/);
    }
  });
});

describe("oldestMetricsAsOf", () => {
  /**
   * ⭐ The OLDEST stamp, not the newest.
   *
   * A screen claiming freshness from its most recent number while showing five
   * stale ones is exactly the dishonesty §16.4 names — the founder reads one
   * timestamp and assumes it covers everything above it.
   */
  it("reports the oldest number on screen, not the freshest", () => {
    expect(
      oldestMetricsAsOf([{ metricsAsOf: 500 }, { metricsAsOf: 100 }, { metricsAsOf: 300 }])
    ).toBe(100);
  });

  it("is undefined when nothing has been measured", () => {
    // Absent, not zero — zero would render as 1970 and look like a bug.
    expect(oldestMetricsAsOf([])).toBeUndefined();
    expect(oldestMetricsAsOf([{}, {}])).toBeUndefined();
  });

  it("ignores unmeasured placements rather than treating them as fresh", () => {
    expect(oldestMetricsAsOf([{ metricsAsOf: 900 }, {}])).toBe(900);
  });
});

describe("⭐ AN IDEA WITH NO EVIDENCE IS A GUESS, AND THE FOUNDER COULD NOT TELL", () => {
  /**
   * §2.6. `myIdeaBank` returned `hasEvidence: boolean` and stopped, so the
   * answer to "why does she want to post this?" was one boolean wide. Measured
   * on a live account: 59 ideas, EVERY ONE carrying a verbatim quote and its
   * source URLs, none of it reachable.
   */
  async function seedIdea(
    t: ReturnType<typeof convexTest>,
    suffix: string,
    evidenceJson?: string,
  ) {
    return t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: `u_${suffix}`,
        email: `${suffix}@e.com`,
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "manager",
        createdAt: 1,
      } as never);
      const customerId = await ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("ideas", {
        customerId,
        angle: "carousels are a sales conversation",
        status: "bank",
        sourceKind: "observation",
        ...(evidenceJson ? { evidenceJson } : {}),
        createdAt: 2,
        updatedAt: 2,
      } as never);
      return customerId;
    });
  }

  it("hands back the quote and where it was said", async () => {
    const t = convexTest(schema, modules);
    await seedIdea(
      t,
      "ev",
      JSON.stringify({
        quote: "A carousel ad isn't a photo album. It's a sales conversation.",
        sourceUrls: ["https://www.tiktok.com/@x/video/1"],
      }),
    );
    const res = await t
      .withIdentity({ subject: "u_ev" })
      .query(api.maya.dashboard.myIdeaBank, {});
    expect(res.ideas[0].hasEvidence).toBe(true);
    expect(res.ideas[0].quote).toContain("sales conversation");
    expect(res.ideas[0].sourceUrls).toHaveLength(1);
  });

  it("⚠️ a malformed blob loses the evidence, never the idea", async () => {
    // These are model-written. A truncated write must not take out the page.
    const t = convexTest(schema, modules);
    await seedIdea(t, "bad", "{not json");
    const res = await t
      .withIdentity({ subject: "u_bad" })
      .query(api.maya.dashboard.myIdeaBank, {});
    expect(res.ideas).toHaveLength(1);
    expect(res.ideas[0].quote).toBe("");
    expect(res.ideas[0].sourceUrls).toEqual([]);
  });

  it("an idea with no evidence at all says so honestly", async () => {
    const t = convexTest(schema, modules);
    await seedIdea(t, "none");
    const res = await t
      .withIdentity({ subject: "u_none" })
      .query(api.maya.dashboard.myIdeaBank, {});
    expect(res.ideas[0].hasEvidence).toBe(false);
    expect(res.ideas[0].quote).toBe("");
  });

  it("⚠️ caps the source links, because provenance is not a link dump", async () => {
    const t = convexTest(schema, modules);
    await seedIdea(
      t,
      "many",
      JSON.stringify({
        quote: "q",
        sourceUrls: ["a", "b", "c", "d", "e", "f"].map((x) => `https://x/${x}`),
      }),
    );
    const res = await t
      .withIdentity({ subject: "u_many" })
      .query(api.maya.dashboard.myIdeaBank, {});
    expect(res.ideas[0].sourceUrls.length).toBeLessThanOrEqual(4);
  });
});
