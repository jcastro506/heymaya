/**
 * ⭐ The on-ramp — §18.9.25 ①②③.
 *
 * Two properties carry this file, and I got the first one wrong while writing
 * the module it tests.
 *
 * 1. ⚠️ **`agentVersion: "v2"`.** It is what routes an account to
 *    `convex/maya` rather than the frozen v1 agent. My first draft of the
 *    insert omitted it — which would have made the on-ramp *for the new
 *    product* quietly provision the old one. The typechecker caught it only
 *    because two unrelated fields were also missing; had `agentVersion` been
 *    optional, it would have shipped.
 *
 * 2. ⭐ **The correction becomes a directive**, verbatim. §18.9.25 ②: *"the
 *    very first thing the founder types is already permanent."* It is stored
 *    unedited and surfaces on House Rules forever — that is the product's whole
 *    promise, executed on the first screen.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

const READ = {
  name: "HeyMaya",
  whatItIs: "a social media manager you employ",
  whoItsFor: "solo founders who built something good and can't get customers",
  whatsDifferent: "she does the homework before she writes",
};

async function seedCreator(ctx: unknown, clerkUserId: string): Promise<void> {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId,
      email: `${clerkUserId}@example.com`,
      accountType: "gtm-agent",
    }),
  );
}

describe("on-ramp", () => {
  it("⭐ provisions a v2 customer, not the frozen agent", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_new"));

    const res = await t
      .withIdentity({ subject: "user_new" })
      .mutation(api.maya.onramp.startFromRead, {
        url: "https://hey-maya.ai",
        read: READ,
        timezone: "America/Los_Angeles",
      });

    expect(res.ok).toBe(true);

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("customers").collect();
      expect(rows).toHaveLength(1);
      /**
       * ⚠️ The assertion that would have caught my own bug. Without this the
       * on-ramp for the NEW product hands the account to the OLD one, and
       * nothing else in the flow looks wrong — the customer exists, the
       * machine deploys, and she answers with the wrong runtime.
       */
      expect(rows[0].agentVersion).toBe("v2");
      expect(rows[0].timezone).toBe("America/Los_Angeles");
    });
  });

  it("stores the read the founder confirmed, with its provenance", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_read"));

    await t
      .withIdentity({ subject: "user_read" })
      .mutation(api.maya.onramp.startFromRead, {
        url: "https://hey-maya.ai",
        read: READ,
        timezone: "UTC",
      });

    await t.run(async (ctx) => {
      const [customer] = await ctx.db.query("customers").collect();
      const truth = JSON.parse(customer.productTruthJson!);
      expect(truth.whatItIs).toBe(READ.whatItIs);
      expect(truth.whoItsFor).toBe(READ.whoItsFor);
      expect(truth.whatsDifferent).toBe(READ.whatsDifferent);
      // §2.7 — six months on, "where did she get this?" must be answerable,
      // and "the founder confirmed it on day one" is its own fact.
      expect(truth.source).toBe("onboarding_read");
      expect(truth.confirmedAt).toBeGreaterThan(0);
    });
  });

  it("⭐ turns a correction into a permanent, verbatim rule", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_correcting"));

    // Their actual words, sloppy and unedited — the shape a real one has.
    const correction = "not really for agencies — it's for solo founders only";

    const asUser = t.withIdentity({ subject: "user_correcting" });
    const res = await asUser.mutation(api.maya.onramp.startFromRead, {
      url: "https://hey-maya.ai",
      read: READ,
      correction,
      timezone: "UTC",
    });

    expect(res.directiveId).toBeTruthy();

    /**
     * ⭐ Asserted through the House Rules screen's own query, not by reading
     * the table. "The very first thing the founder types is already permanent"
     * is a claim about what they can SEE, and a row nobody surfaces would
     * satisfy a table-level assertion while failing the promise.
     */
    const rules = await asUser.query(api.maya.directives.myHouseRules, {});
    expect(rules.rules?.map((r) => r.verbatim)).toEqual([correction]);
  });

  it("writes no rule when they simply agree", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_agrees"));

    const asUser = t.withIdentity({ subject: "user_agrees" });
    await asUser.mutation(api.maya.onramp.startFromRead, {
      url: "https://hey-maya.ai",
      read: READ,
      // Whitespace, not absence — a "yes" tap that sent an empty box must not
      // create a blank rule that then renders as an empty line forever.
      correction: "   ",
      timezone: "UTC",
    });

    const rules = await asUser.query(api.maya.directives.myHouseRules, {});
    expect(rules.rules).toEqual([]);
  });

  it("is idempotent — a refresh does not mint a second agent", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_refresher"));

    const asUser = t.withIdentity({ subject: "user_refresher" });
    const first = await asUser.mutation(api.maya.onramp.startFromRead, {
      url: "https://hey-maya.ai",
      read: READ,
      timezone: "UTC",
    });
    const second = await asUser.mutation(api.maya.onramp.startFromRead, {
      url: "https://hey-maya.ai",
      read: { ...READ, whatItIs: "a corrected description" },
      timezone: "UTC",
    });

    // ⚠️ Two agents means two heartbeats, two cron sets, and doubled spend.
    expect(second.customerId).toBe(first.customerId);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("customers").collect()).toHaveLength(1);
    });
  });

  it("rejects a URL she could never fetch", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_badurl"));

    const res = await t
      .withIdentity({ subject: "user_badurl" })
      .mutation(api.maya.onramp.startFromRead, {
        url: "my startup",
        read: READ,
        timezone: "UTC",
      });

    // Every claim she makes traces back to this URL. Grounded or silent (§2.7).
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/URL/i);
  });

  it("caps browser-supplied text", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => seedCreator(ctx, "user_huge"));

    await t
      .withIdentity({ subject: "user_huge" })
      .mutation(api.maya.onramp.startFromRead, {
        url: "https://hey-maya.ai",
        read: { ...READ, whatItIs: "x".repeat(50_000) },
        timezone: "UTC",
      });

    await t.run(async (ctx) => {
      const [customer] = await ctx.db.query("customers").collect();
      const truth = JSON.parse(customer.productTruthJson!);
      /**
       * ⚠️ `productTruthJson` reaches the model on every turn. Uncapped, a
       * crafted read field is an unbounded prompt injected into every future
       * generation — and billed to us on each one.
       */
      expect(truth.whatItIs.length).toBe(2_000);
    });
  });

  it("refuses when nobody is signed in", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(api.maya.onramp.startFromRead, {
      url: "https://hey-maya.ai",
      read: READ,
      timezone: "UTC",
    });
    expect(res.ok).toBe(false);
  });
});
