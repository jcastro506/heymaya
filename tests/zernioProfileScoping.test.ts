/**
 * ⭐ The vendor-side tenant boundary.
 *
 * ## The bug
 *
 * One Zernio API key covers the entire fleet. `syncChannels` called
 * `GET /api/v1/accounts` with **no `profileId`**, so the vendor returned every
 * customer's accounts — and the loop attached all of them to whichever
 * customer happened to be syncing.
 *
 * With one customer that is invisible, which is why it survived. With two:
 * customer B's Instagram becomes a row on customer A, and she posts to a
 * stranger's account under a stranger's name. There is no worse failure in
 * this product.
 *
 * ⚠️ It is also the mandated cross-tenant-isolation category (CLAUDE.md),
 * missed because the isolation was correct in Convex and broken at the vendor.
 * Every row was scoped by `customerId`; the data filling those rows was not.
 */

import { describe, expect, it, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

async function seedCustomer(
  ctx: unknown,
  clerkUserId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const c = ctx as InsertCtx & {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  };
  const creatorId = (await c.db.insert(
    "creators",
    await minimalRow(c, "creators", {
      clerkUserId,
      email: `${clerkUserId}@example.com`,
      accountType: "gtm-agent",
    }),
  )) as string;
  return (await c.db.insert(
    "customers",
    await minimalRow(c, "customers", { accountId: creatorId, ...extra }),
  )) as string;
}

const ORIGINAL_KEY = process.env.ZERNIO_API_KEY;
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ZERNIO_API_KEY;
  else process.env.ZERNIO_API_KEY = ORIGINAL_KEY;
});

describe("zernio profile scoping", () => {
  it("⭐ fails CLOSED — no profile means no channels, and no vendor call", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) =>
      seedCustomer(ctx, "user_noprofile"),
    );

    /**
     * A key that would fail loudly if used. The assertion is as much about
     * what does NOT happen: with no profile there is nothing safe to ask the
     * vendor, so the correct behaviour is to ask nothing.
     *
     * ⚠️ Reaching the network here would mean the old behaviour is back —
     * listing the fleet's accounts and attaching them to this customer.
     */
    process.env.ZERNIO_API_KEY = "test-key-must-not-be-used";

    const res = await t.action(internal.maya.channels.syncChannels, {
      customerId: customerId as never,
    });

    expect(res.ok).toBe(true);
    expect(res.channels).toEqual([]);

    // And nothing was written — an empty list is not "disconnect everything".
    await t.run(async (ctx) => {
      expect(await ctx.db.query("channels").collect()).toEqual([]);
    });
  });

  it("records a profile once and never reassigns it", async () => {
    const t = convexTest(schema, modules);
    const customerId = await t.run((ctx) => seedCustomer(ctx, "user_profile"));

    await t.mutation(internal.maya.channels.setProfileId, {
      customerId: customerId as never,
      zernioProfileId: "prof_first",
    });
    /**
     * ⚠️ A second write must not win. Reassigning orphans every channel row
     * pointing at the old profile: the next sync finds nothing while the
     * founder's accounts still exist at the vendor, which reads as "she
     * disconnected everything".
     */
    await t.mutation(internal.maya.channels.setProfileId, {
      customerId: customerId as never,
      zernioProfileId: "prof_second",
    });

    const profileId = await t.query(internal.maya.channels.profileIdFor, {
      customerId: customerId as never,
    });
    expect(profileId).toBe("prof_first");
  });

  it("⭐ two customers never share a profile id", async () => {
    const t = convexTest(schema, modules);

    const { a, b } = await t.run(async (ctx) => {
      const a = await seedCustomer(ctx, "user_a", {
        zernioProfileId: "prof_a",
      });
      const b = await seedCustomer(ctx, "user_b", {
        zernioProfileId: "prof_b",
      });
      return { a, b };
    });

    const [pa, pb] = await Promise.all([
      t.query(internal.maya.channels.profileIdFor, { customerId: a as never }),
      t.query(internal.maya.channels.profileIdFor, { customerId: b as never }),
    ]);

    expect(pa).toBe("prof_a");
    expect(pb).toBe("prof_b");
    // The whole point: the id each customer sends to the vendor is its own.
    expect(pa).not.toBe(pb);
  });

  it("scopes the account list by profile, not by API key", () => {
    /**
     * ⚠️ Asserted on the source, because the alternative is mocking the vendor
     * and the thing worth protecting is one argument on one call. A future
     * edit that drops `profileId` restores a bug whose symptom is posting to
     * the wrong founder's account — and it would look like a simplification.
     */
    const source = require("node:fs").readFileSync(
      require("node:path").join(
        __dirname,
        "..",
        "convex",
        "maya",
        "channels.ts",
      ),
      "utf8",
    );
    // The account list must carry the profile.
    expect(source).toMatch(
      /"\/api\/v1\/accounts",\s*\{ method: "GET", query: \{ profileId \} \}/,
    );
    // And the unscoped form — no query at all — is gone for good.
    expect(source).not.toMatch(
      /request<unknown>\(\s*"\/api\/v1\/accounts",?\s*\)/,
    );
  });
});
