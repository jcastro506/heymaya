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

/** The one capability the generator needs, unbound from the schema's types. */
interface InsertCtx {
  db: { insert: (t: string, v: unknown) => Promise<unknown> };
}

/**
 * Build the smallest row a table will accept, from the table's own validator.
 *
 * ⚠️ Deliberately NOT a hand-written fixture per table. A fixture list is the
 * same artefact that caused this bug — it goes stale the first time someone
 * adds a required field, and the failure looks like a broken test rather than
 * missing coverage, so it gets skipped.
 */
async function minimalRow(
  ctx: InsertCtx,
  tableName: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const validator = (
    schema as unknown as {
      tables: Record<string, { validator: { fields: Record<string, Field> } }>;
    }
  ).tables[tableName].validator;

  const row: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(validator.fields)) {
    if (field.isOptional === "optional") continue;
    // A field the caller supplies is never sampled — that is how required
    // `v.id(...)` fields get a real row to point at instead of a fake string.
    if (name in overrides) continue;
    /**
     * A required foreign key gets a REAL row, inserted here. `dayPlans.ideaId`
     * is the only one today; doing it generally means the next one doesn't
     * turn this into a broken test somebody skips.
     */
    if (field.kind === "id") {
      const target = field.tableName as string;
      const inherited =
        "customerId" in overrides ? { customerId: overrides.customerId } : {};
      row[name] = await ctx.db.insert(
        target,
        await minimalRow(ctx as unknown as InsertCtx, target, inherited),
      );
      continue;
    }
    row[name] = sampleFor(field);
  }
  return { ...row, ...overrides };
}

interface Field {
  kind: string;
  tableName?: string;
  isOptional?: string;
  value?: unknown;
  member?: Field;
  members?: Field[];
  fields?: Record<string, Field>;
}

function sampleFor(field: Field): unknown {
  switch (field.kind) {
    case "string":
      return "x";
    case "float64":
    case "int64":
      return field.kind === "int64" ? BigInt(1) : 1;
    case "boolean":
      return false;
    case "literal":
      return field.value;
    case "array":
      return [];
    case "object":
      return Object.fromEntries(
        Object.entries(field.fields ?? {})
          .filter(([, f]) => f.isOptional !== "optional")
          .map(([k, f]) => [k, sampleFor(f)]),
      );
    case "union":
      return sampleFor((field.members ?? [])[0]);
    case "record":
      return {};
    case "null":
      return null;
    default:
      // `id` included: no valid foreign row exists here, and every id field on
      // these tables other than customerId is optional. If that stops being
      // true this throws loudly rather than inserting something bogus.
      throw new Error(`no sample for validator kind "${field.kind}"`);
  }
}

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
