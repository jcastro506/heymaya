/**
 * ⭐ A failure nobody reads is a failure nobody fixes.
 *
 * `maya/telegram.ts` has always written a named reason when a send fails —
 * *"Recorded, not swallowed."* But `deliveryError` had **zero readers** in the
 * entire codebase, so the reason went into a column and stopped there. §2.5's
 * rule is *"a named failure that reaches the user"*, and the last clause was
 * the one missing.
 *
 * The case that matters: a founder who never finished Telegram pairing gets a
 * card-failure warning written, failed, and marked — and nobody is told. They
 * find out when the service stops.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

async function seedCustomer(ctx: unknown, clerkUserId: string) {
  const db = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  const creatorId = await db.db.insert(
    "creators",
    await minimalRow(db, "creators", {
      clerkUserId,
      email: `${clerkUserId}@example.com`,
      accountType: "gtm-agent",
    }),
  );
  return await db.db.insert(
    "customers",
    await minimalRow(db, "customers", { accountId: creatorId }),
  );
}

describe("fleet-wide unreachable customers", () => {
  it("reports a customer whose messages failed, with the transport's reason", async () => {
    const t = convexTest(schema, modules);

    const customerId = await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx, "user_unreachable");

      // Two failures, oldest first — a card warning and a follow-up.
      await ctx.db.insert("messages", {
        customerId: customerId as never,
        direction: "out",
        surface: "telegram",
        body: "Your card didn't go through for this month.",
        proactive: true,
        deliveryError: "no Telegram chat paired for this account",
        ts: 1_000,
      });
      await ctx.db.insert("messages", {
        customerId: customerId as never,
        direction: "out",
        surface: "telegram",
        body: "Your card still isn't going through.",
        proactive: true,
        deliveryError: "no Telegram chat paired for this account",
        ts: 5_000,
      });

      return customerId;
    });

    const rows = await t.query(internal.maya.delivery.fleetUnreachable, {});

    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe(customerId);
    expect(rows[0].pending).toBe(2);
    // ⚠️ The OLDEST failure's timestamp — how long we have actually been mute,
    // not when we last tried.
    expect(rows[0].since).toBe(1_000);
    expect(rows[0].reason).toBe("no Telegram chat paired for this account");
    // The class that carries card failures.
    expect(rows[0].proactive).toBe(true);
  });

  it("does not report a message that is merely queued", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx, "user_queued");
      /**
       * ⚠️ The false-positive that would make this screen useless. An outbound
       * message with no `deliveredAt` and no error is about to send — counting
       * it would flag the whole fleet as unreachable every time the dashboard
       * loaded mid-flush, and an alert that fires constantly is one the
       * operator learns to scroll past.
       */
      await ctx.db.insert("messages", {
        customerId: customerId as never,
        direction: "out",
        surface: "telegram",
        body: "queued, not failed",
        ts: 1_000,
      });
    });

    expect(await t.query(internal.maya.delivery.fleetUnreachable, {})).toEqual(
      [],
    );
  });

  it("does not report messages that were delivered", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const customerId = await seedCustomer(ctx, "user_fine");
      await ctx.db.insert("messages", {
        customerId: customerId as never,
        direction: "out",
        surface: "telegram",
        body: "arrived",
        deliveredAt: 2_000,
        ts: 1_000,
      });
    });

    expect(await t.query(internal.maya.delivery.fleetUnreachable, {})).toEqual(
      [],
    );
  });

  it("ranks the longest-mute customer first", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const recent = await seedCustomer(ctx, "user_recent");
      const ancient = await seedCustomer(ctx, "user_ancient");

      await ctx.db.insert("messages", {
        customerId: recent as never,
        direction: "out",
        surface: "telegram",
        body: "x",
        deliveryError: "bot was blocked by the user",
        ts: 9_000,
      });
      await ctx.db.insert("messages", {
        customerId: ancient as never,
        direction: "out",
        surface: "telegram",
        body: "x",
        deliveryError: "no Telegram chat paired for this account",
        ts: 100,
      });
    });

    const rows = await t.query(internal.maya.delivery.fleetUnreachable, {});
    // The ranking the operator acts on — silent longest, first.
    expect(rows.map((r) => r.since)).toEqual([100, 9_000]);
  });
});
