/**
 * ⭐ The purge, executed — not just the list, checked.
 *
 * `accountDeletionCoverage.test.ts` proves the list names every customer-scoped
 * table. This proves running it actually empties them, which is a different
 * claim: `queryByIndex` takes its index name as a **string**, so a wrong one
 * typechecks cleanly and throws at runtime — on a path that runs once per
 * account, unattended, and never again for that account.
 *
 * ⚠️ Before today this path had no test of any kind, which is the reason it
 * spent an entire product cycle deleting the wrong product's tables.
 *
 * ⚠️ **This test cannot catch a missing table.** It seeds from
 * `MAYA_CUSTOMER_SCOPED` and asserts against the same list, so dropping an
 * entry removes it from both halves and everything still passes — verified by
 * deleting one and watching this stay green. That gap is exactly what the
 * schema-derived coverage test exists to close. Neither test is sufficient
 * alone: one proves the list is complete, this one proves running it works.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { modules } from "./_modules";
import { MAYA_CUSTOMER_SCOPED } from "../convex/accountDeletion";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

describe("purging an account removes the live product's data", () => {
  it("empties every customer-scoped table", async () => {
    const t = convexTest(schema, modules);

    const { creatorId, customerId, otherCustomerId, survivorCounts } =
      await t.run(async (ctx) => {
        const creatorId = await ctx.db.insert("creators", {
          ...(await minimalRow(ctx as unknown as InsertCtx, "creators", {
            clerkUserId: "user_purge_me",
            email: "purge@example.com",
            accountType: "gtm-agent",
          })),
        } as unknown as Parameters<typeof ctx.db.insert<"creators">>[1]);
        /**
         * ⭐ A SECOND account, with its own rows in the same tables. Cross-tenant
         * isolation is mandatory here in the least forgiving direction: a purge
         * that over-deletes destroys a paying customer's data, and unlike an
         * under-delete there is nothing to re-run to fix it.
         */
        const otherCreatorId = await ctx.db.insert("creators", {
          ...(await minimalRow(ctx as unknown as InsertCtx, "creators", {
            clerkUserId: "user_keep_me",
            email: "keep@example.com",
            accountType: "gtm-agent",
          })),
        } as unknown as Parameters<typeof ctx.db.insert<"creators">>[1]);

        const customerId = await ctx.db.insert("customers", {
          ...(await minimalRow(ctx as unknown as InsertCtx, "customers", {
            accountId: creatorId,
          })),
        } as unknown as Parameters<typeof ctx.db.insert<"customers">>[1]);
        const otherCustomerId = await ctx.db.insert("customers", {
          ...(await minimalRow(ctx as unknown as InsertCtx, "customers", {
            accountId: otherCreatorId,
          })),
        } as unknown as Parameters<typeof ctx.db.insert<"customers">>[1]);

        // One row in every listed table, for both customers.
        for (const { table } of MAYA_CUSTOMER_SCOPED) {
          for (const id of [customerId, otherCustomerId]) {
            await ctx.db.insert(
              table as "messages",
              (await minimalRow(ctx as unknown as InsertCtx, table, {
                customerId: id,
              })) as unknown as Parameters<typeof ctx.db.insert<"messages">>[1],
            );
          }
        }

        /**
         * Counted, not assumed: generating a required foreign key inserts an
         * extra row in the referenced table (`dayPlans.ideaId` → `ideas`), so
         * "one row each" is not true and asserting it would fail for a reason
         * that has nothing to do with deletion.
         */
        const survivorCounts: Record<string, number> = {};
        for (const { table } of MAYA_CUSTOMER_SCOPED) {
          const rows = await ctx.db.query(table as "messages").collect();
          survivorCounts[table] = rows.filter(
            (r) => r.customerId === otherCustomerId,
          ).length;
          expect(
            rows.some((r) => r.customerId === customerId),
            `${table} must be seeded for the account under test`,
          ).toBe(true);
        }

        return { creatorId, customerId, otherCustomerId, survivorCounts };
      });

    const result = await t.mutation(
      internal.accountDeletion.purgeGtmAccountByCreatorId,
      { creatorId, source: "web" },
    );
    expect(result.ok).toBe(true);
    // The early-return branches ("creator-not-found", "not-a-gtm-account")
    // carry no `done`, and reading through them would assert nothing at all.
    if (!result.deleted) throw new Error(`purge did not run: ${result.reason}`);
    // ⚠️ The purge is budgeted and resumable; a `done: false` here would mean
    // the assertions below are checking a half-finished job.
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      for (const { table } of MAYA_CUSTOMER_SCOPED) {
        const rows = await ctx.db.query(table as "messages").collect();

        expect(
          rows.filter((r) => r.customerId === customerId).length,
          `${table} still holds rows for the deleted account`,
        ).toBe(0);

        // ⭐ The other direction, which is the unrecoverable one: an
        // over-broad delete destroys a paying customer's data, and there is
        // no re-run that brings it back.
        expect(
          rows.filter((r) => r.customerId === otherCustomerId).length,
          `${table} lost rows belonging to a DIFFERENT account`,
        ).toBe(survivorCounts[table]);
      }

      // The customer row itself goes too — but last, so a partial purge stays
      // findable rather than orphaning everything beneath it.
      const customers = await ctx.db.query("customers").collect();
      expect(customers.map((c) => c._id)).toEqual([otherCustomerId]);

      expect(await ctx.db.get(creatorId)).toBeNull();
    });
  });
});
