/**
 * ⭐ "Delete my account" must actually delete the account.
 *
 * ## Why this test exists
 *
 * The purge list has now fallen behind the schema **twice**, for the same
 * reason both times: it is maintained by hand, and nothing fails when a new
 * table isn't added to it.
 *
 * - **2026-07-15** — five account-scoped tables were missing. Fixed by adding
 *   them, plus a retro-sweep (`sweepOrphanedAccountRows`) for the rows already
 *   orphaned. No test was added, so:
 * - **2026-08-11** — every table on the list belonged to the *deleted* product.
 *   The live module's fifteen tables — the founder's messages, posts, ideas,
 *   media, and Maya's memory of them — were not purged at all.
 *
 * ⚠️ And when I wrote the replacement list by hand, I missed two of the fifteen
 * (`inboxItems`, `memorySnapshots`). This test caught them on its first run.
 * That is the argument for deriving the list from the schema rather than
 * trusting anyone, including the person who just fixed the bug, to keep it
 * current.
 *
 * This is the project's dominant defect class stated exactly: **a documented
 * contract is not an enforced one until something fails when it's broken.**
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAYA_CUSTOMER_SCOPED } from "../convex/accountDeletion";

const schema = readFileSync(
  path.join(__dirname, "..", "convex", "schema.ts"),
  "utf8",
);

/** Split `schema.ts` into one body per `defineTable`. */
function tableBodies(): Map<string, string> {
  const parts = schema.split(/\n {2}(\w+): defineTable\(/);
  const out = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 2) out.set(parts[i], parts[i + 1]);
  return out;
}

/**
 * A table belongs to the live product's per-customer data if it keys on
 * `customerId`. That is the same definition the purge uses, which is what makes
 * the two impossible to drift apart.
 */
function customerScopedTables(): string[] {
  const found: string[] = [];
  for (const [name, body] of tableBodies()) {
    if (/customerId: v\.id\("customers"\)/.test(body)) found.push(name);
  }
  return found.sort();
}

describe("account deletion covers every customer-scoped table", () => {
  it("finds the live product's tables at all", () => {
    // Guards the parser, not the product: a regex that silently matches
    // nothing would make every assertion below vacuously pass.
    expect(customerScopedTables().length).toBeGreaterThan(10);
  });

  it("purges every table that keys on customerId", () => {
    const listed = new Set(MAYA_CUSTOMER_SCOPED.map((t) => t.table));
    const missing = customerScopedTables().filter((t) => !listed.has(t));

    expect(
      missing,
      `These tables hold data belonging to a customer and are NOT deleted when ` +
        `that customer's account is deleted:\n  ${missing.join("\n  ")}\n\n` +
        `Add each to MAYA_CUSTOMER_SCOPED in convex/accountDeletion.ts, with ` +
        `the index whose FIRST field is customerId.`,
    ).toEqual([]);
  });

  it("names no table the schema doesn't have", () => {
    const known = new Set(tableBodies().keys());
    const bogus = MAYA_CUSTOMER_SCOPED.filter((t) => !known.has(t.table));
    // A renamed table would otherwise leave a dead entry deleting nothing,
    // which reads exactly like coverage.
    expect(bogus.map((t) => t.table)).toEqual([]);
  });

  it("uses an index whose first field is customerId", () => {
    /**
     * ⚠️ `queryByIndex` takes the index name as a string, so a wrong one
     * typechecks and throws at runtime — on a path that runs once per account,
     * usually unattended, and never again.
     */
    const bodies = tableBodies();
    const broken: string[] = [];

    for (const { table, index } of MAYA_CUSTOMER_SCOPED) {
      const body = bodies.get(table);
      if (!body) continue; // covered by the test above
      const match = body.match(
        new RegExp(`\\.index\\("${index}", \\[\\s*"(\\w+)"`),
      );
      if (!match) broken.push(`${table}: no index named "${index}"`);
      else if (match[1] !== "customerId") {
        broken.push(
          `${table}: "${index}" starts with ${match[1]}, not customerId`,
        );
      }
    }

    expect(broken).toEqual([]);
  });

  it("deletes the stored file behind a media asset, not just the row", () => {
    /**
     * ⚠️ The one table where deleting the row isn't enough. A `mediaAssets` row
     * points at a blob in Convex storage — the founder's screenshots and
     * recordings. Dropping the row alone leaves the files sitting there after
     * someone asked us to delete everything, which is the part of the promise
     * that actually matters.
     */
    const source = readFileSync(
      path.join(__dirname, "..", "convex", "accountDeletion.ts"),
      "utf8",
    );
    expect(source).toMatch(/ctx\.storage\.delete\(/);
  });
});
