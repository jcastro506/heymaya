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
import { hasFacts } from "../dashboard";
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

describe("⭐ WHAT SHE BELIEVES, AND WHETHER SHE IS ACTUALLY LEARNING", () => {
  async function seedTruth(
    t: ReturnType<typeof convexTest>,
    suffix: string,
    over: { truth?: unknown; snapshots?: string[] } = {},
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
        productTruthJson: JSON.stringify(
          over.truth ?? {
            name: "Acme",
            whatItIs: "a thing",
            whoItsFor: "",
            whatsDifferent: "",
            gaps: ["no stated audience", "no pricing"],
            founderSays: ["we sell to agencies, not solo founders"],
          },
        ),
      });
      for (const [i, md] of (over.snapshots ?? []).entries()) {
        await ctx.db.insert("memorySnapshots", {
          customerId,
          capturedAt: 1000 + i,
          markdown: md,
          bytes: md.length,
        });
      }
      return customerId;
    });
  }

  const read = (t: ReturnType<typeof convexTest>, suffix: string) =>
    t.withIdentity({ subject: `u_${suffix}` }).query(api.maya.dashboard.myMemory, {});

  it("⭐ shows the GAPS, because they are the half a founder can fix", () => {
    // §2.7 grounded or silent. Showing only what she knows makes a thin read
    // look like a complete one.
    return (async () => {
      const t = convexTest(schema, modules);
      await seedTruth(t, "gaps");
      const res = await read(t, "gaps");
      expect(res.gaps).toContain("no stated audience");
      expect(res.founderSays[0]).toContain("agencies");
    })();
  });

  it("⚠️ A MEMORY THAT IS ONLY ITS OWN HEADER IS EMPTY, NOT HEALTHY", async () => {
    /**
     * Measured live: three nightly snapshots, all 196 bytes, all the bare
     * `MEMORY.md` header — she had learned nothing durable in four days.
     * Counting snapshots would have reported a healthy backup of an empty file,
     * which is the same defect as a write with no reader pointed the other way.
     */
    // The real seed, verbatim — header prose plus its own empty marker.
    const header =
      "# MEMORY.md\n\nDurable facts, preferences, and standing decisions — distilled from daily notes\nand from dreaming. **This file is mine.** Nothing rewrites it but me.\n\n_(empty — nothing learned yet)_\n";
    const t = convexTest(schema, modules);
    await seedTruth(t, "hollow", { snapshots: [header, header, header] });
    const res = await read(t, "hollow");
    expect(res.memory?.days).toBe(3);
    expect(res.memory?.empty).toBe(true);
  });

  it("and a memory with real facts is not empty", async () => {
    const t = convexTest(schema, modules);
    await seedTruth(t, "real", {
      snapshots: ["# MEMORY.md\n\n- They sell to agencies, never solo founders.\n"],
    });
    const res = await read(t, "real");
    expect(res.memory?.empty).toBe(false);
    expect(res.memory?.markdown).toContain("agencies");
  });

  it("no snapshots at all is null, not a crash", async () => {
    const t = convexTest(schema, modules);
    await seedTruth(t, "none2");
    const res = await read(t, "none2");
    expect(res.memory).toBeNull();
    expect(res.ok).toBe(true);
  });

  it("⚠️ a corrupt truth record shows as nothing known, never a crash", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("creators", {
        clerkUserId: "u_bad2",
        email: "b@e.com",
        channelPreference: "web",
        timezone: "UTC",
        status: "active",
        plan: "manager",
        createdAt: 1,
      } as never);
      await ctx.db.insert("customers", {
        accountId,
        agentVersion: "v2",
        plan: "mvp",
        state: "active",
        timezone: "UTC",
        createdAt: 1,
        updatedAt: 1,
        productTruthJson: "{not json",
      });
    });
    const res = await read(t, "bad2");
    expect(res.ok).toBe(true);
    expect(res.believes.whatItIs).toBe("");
  });
});

describe("⚠️ 'HAS CONTENT' AND 'HAS LEARNED SOMETHING' ARE DIFFERENT QUESTIONS", () => {
  /**
   * The seeded `MEMORY.md` is ~196 bytes of header explaining what the file is,
   * ending in `_(empty — nothing learned yet)_`. Measured live: three nightly
   * snapshots, all exactly that. A byte count or a prose check would have
   * reported a healthy backup of an empty file.
   */
  const SEED =
    "# MEMORY.md\n\nDurable facts, preferences, and standing decisions — distilled from daily notes\nand from dreaming. **This file is mine.** Nothing rewrites it but me.\n\n_(empty — nothing learned yet)_\n";

  it("the untouched seed has learned nothing", () => {
    expect(hasFacts(SEED)).toBe(false);
  });

  it("one durable line is enough to count", () => {
    expect(hasFacts(`${SEED}\n- They sell to agencies, never solo founders.`)).toBe(
      true
    );
  });

  it("accepts the bullet styles she actually writes", () => {
    expect(hasFacts("- a fact")).toBe(true);
    expect(hasFacts("* a fact")).toBe(true);
    expect(hasFacts("1. a fact")).toBe(true);
  });

  it("⚠️ a bullet with nothing after it does not count", () => {
    // An empty list item is a formatting artefact, not something learned.
    expect(hasFacts("-\n-  \n")).toBe(false);
  });

  it("prose alone never counts, however much of it there is", () => {
    // Filtering by length or wording would be a guess about her writing style.
    expect(hasFacts("Some long explanatory paragraph. ".repeat(20))).toBe(false);
  });
});
