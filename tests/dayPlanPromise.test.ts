/**
 * ⭐ The promise, written down — and the loop that closes it.
 *
 * The evening recap's own comment records the incident this exists for:
 *
 * > *"the recap that evening was perfectly accurate about the zero while
 * > silent about the promise. §12: honest silence beats fake activity — but
 * > silence about a broken promise is neither."*
 *
 * ⚠️ The machinery was built and never connected. `dayPlan.planPost` had no
 * caller, so `dayPlans` was never written — while TWO live consumers waited on
 * it: `publish` calls `markDoneByIdea` and marks nothing, and the recap reads
 * `planFor` and finds no promise to report against.
 *
 * Drafting is the moment an idea becomes a commitment, so that is where the
 * promise is recorded.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

const NOW = 1_786_500_000_000;

async function seed(ctx: unknown, who: string) {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  const creatorId = (await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId: who,
      email: `${who}@example.com`,
      accountType: "gtm-agent",
    }),
  )) as string;
  const customerId = (await c.db.insert(
    "customers",
    await minimalRow(c, "customers", {
      accountId: creatorId,
      timezone: "America/Los_Angeles",
    }),
  )) as string;
  const ideaId = (await c.db.insert(
    "ideas",
    await minimalRow(c, "ideas", { customerId }),
  )) as string;
  return { customerId, ideaId };
}

describe("today's promise", () => {
  it("⭐ is written when an idea becomes a draft", async () => {
    const t = convexTest(schema, modules);
    const { customerId, ideaId } = await t.run((ctx) => seed(ctx, "u_plan"));

    await t.mutation(internal.maya.dayPlan.planPost, {
      customerId: customerId as never,
      ideaId: ideaId as never,
      channel: "x",
      now: NOW,
    });

    const plan = await t.query(internal.maya.dayPlan.planFor, {
      customerId: customerId as never,
      now: NOW,
    });
    // The recap reads exactly this — an outstanding promise it can report.
    expect(plan.outstanding.length).toBe(1);
  });

  it("⚠️ a redraft updates one promise rather than making a second", async () => {
    /**
     * Idempotent per `{day, ideaId}`. Two plans for one idea would have the
     * recap report the same promise twice — and a founder counting broken
     * promises would see double.
     */
    const t = convexTest(schema, modules);
    const { customerId, ideaId } = await t.run((ctx) => seed(ctx, "u_redraft"));

    for (let i = 0; i < 3; i += 1) {
      await t.mutation(internal.maya.dayPlan.planPost, {
        customerId: customerId as never,
        ideaId: ideaId as never,
        channel: "x",
        now: NOW,
      });
    }

    await t.run(async (ctx) => {
      expect(await ctx.db.query("dayPlans").collect()).toHaveLength(1);
    });
  });

  it("⭐ publishing closes the promise, so the recap stops reporting it", async () => {
    /**
     * The other half of the loop. `publish` already called `markDoneByIdea` —
     * it just had nothing to mark, because no plan was ever written.
     */
    const t = convexTest(schema, modules);
    const { customerId, ideaId } = await t.run((ctx) => seed(ctx, "u_done"));

    await t.mutation(internal.maya.dayPlan.planPost, {
      customerId: customerId as never,
      ideaId: ideaId as never,
      channel: "x",
      now: NOW,
    });
    // The promise closes because something actually went live — §2.6, the
    // unit of work is a placement, so a plan cannot be "done" without one.
    const placementId = await t.run(async (ctx) => {
      const c = ctx as unknown as {
        db: { insert: (t: string, v: unknown) => Promise<string> };
      };
      return await c.db.insert("placements", {
        customerId,
        kind: "post",
        channel: "x",
        linkStatus: "live",
        url: "https://x.com/status/1",
        publishedAt: NOW,
        snapshotText: "shipped",
        idempotencyKey: "k_dayplan",
        ideaId,
      });
    });

    await t.mutation(internal.maya.dayPlan.markDoneByIdea, {
      customerId: customerId as never,
      ideaId: ideaId as never,
      placementId: placementId as never,
      now: NOW,
    });

    const plan = await t.query(internal.maya.dayPlan.planFor, {
      customerId: customerId as never,
      now: NOW,
    });
    // Kept, not deleted — but no longer outstanding.
    expect(plan.outstanding.length).toBe(0);
  });

  it("⚠️ will not plan against another account's idea", async () => {
    const t = convexTest(schema, modules);
    const { mine, theirIdea } = await t.run(async (ctx) => {
      const a = await seed(ctx, "u_mine");
      const b = await seed(ctx, "u_theirs");
      return { mine: a.customerId, theirIdea: b.ideaId };
    });

    const out = await t.mutation(internal.maya.dayPlan.planPost, {
      customerId: mine as never,
      ideaId: theirIdea as never,
      channel: "x",
      now: NOW,
    });

    // A promise made against a stranger's idea is a promise about nothing.
    expect(out.ok).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("dayPlans").collect()).toEqual([]);
    });
  });
});
