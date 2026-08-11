/**
 * ⭐ An export must not hand the founder a working credential.
 *
 * `customers.gatewayToken` is stored in **plaintext**, deliberately — we present
 * it *to* her machine, so we need the value, not a hash of it. An export is a
 * file someone emails to themselves, drops in Drive, or forwards to a lawyer.
 * Putting a live token inside it is a breach we performed on their behalf, with
 * their consent, for a request that was entirely reasonable.
 *
 * ## Why a test rather than care
 *
 * The export builds itself from the schema, which is what makes it complete —
 * and is exactly why a new credential field would be included automatically. The
 * property that keeps it safe has to be enforced in the same direction:
 *
 * **every secret-shaped field is classified as redacted or explicitly not a
 * secret, and an unclassified one fails the build.**
 *
 * ⚠️ Note which way this fails. The default for anything unrecognised is a test
 * failure, not "include it" — a new `refreshToken` column added months from now
 * breaks CI rather than quietly shipping in the next export.
 */

import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { MAYA_CUSTOMER_SCOPED } from "../convex/accountDeletion";
import {
  EXPORT_REDACTED,
  EXPORT_NOT_SECRET,
  redactRow,
} from "../convex/maya/dataExport";

/**
 * Deliberately broad. A pattern tuned to match only today's fields is a pattern
 * that stops catching things — false positives cost one line in
 * `EXPORT_NOT_SECRET`, a false negative costs a leaked credential.
 */
const SECRET_SHAPED = /token|secret|hash|credential|apikey|password|key$/i;

function fieldsOf(table: string): string[] {
  const tables = (
    schema as unknown as {
      tables: Record<
        string,
        { validator: { fields: Record<string, unknown> } }
      >;
    }
  ).tables;
  return Object.keys(tables[table].validator.fields);
}

/** Every table an export touches: the shared purge list, plus the profile. */
const EXPORTED_TABLES = [
  ...MAYA_CUSTOMER_SCOPED.map((t) => t.table),
  "customers",
];

describe("data export redaction", () => {
  it("classifies every secret-shaped field", () => {
    const unclassified: string[] = [];

    for (const table of EXPORTED_TABLES) {
      for (const field of fieldsOf(table)) {
        if (!SECRET_SHAPED.test(field)) continue;
        const key = `${table}.${field}`;
        if (EXPORT_REDACTED.has(key) || EXPORT_NOT_SECRET.has(key)) continue;
        unclassified.push(key);
      }
    }

    expect(
      unclassified,
      `These fields look like credentials and would be INCLUDED in a data ` +
        `export:\n  ${unclassified.join("\n  ")}\n\n` +
        `Add each to EXPORT_REDACTED (if it is a secret) or ` +
        `EXPORT_NOT_SECRET (if the name only looks like one) in ` +
        `convex/maya/dataExport.ts.`,
    ).toEqual([]);
  });

  it("actually strips the redacted fields", () => {
    // Classification means nothing if `redactRow` doesn't act on it.
    const row = {
      accountId: "acc_1",
      timezone: "America/New_York",
      gatewayToken: "gw_live_secret",
      agentTokenHash: "abc123",
      openRouterKeyHash: "def456",
      pairingToken: "pair_789",
      _creationTime: 1,
    };

    const out = redactRow("customers", row);

    for (const secret of [
      "gatewayToken",
      "agentTokenHash",
      "openRouterKeyHash",
      "pairingToken",
    ]) {
      expect(out, `${secret} survived redaction`).not.toHaveProperty(secret);
    }
    // ⚠️ And the value, not just the key — a redaction that renamed the field
    // while keeping the token would pass a key-only check.
    expect(JSON.stringify(out)).not.toContain("gw_live_secret");

    // Their actual data is untouched. An export that redacts everything is
    // safe and useless.
    expect(out.timezone).toBe("America/New_York");
    expect(out.accountId).toBe("acc_1");
  });

  it("names no field the schema doesn't have", () => {
    // A renamed column would leave a dead entry that redacts nothing while
    // reading exactly like protection.
    const stale: string[] = [];
    for (const key of [...EXPORT_REDACTED, ...EXPORT_NOT_SECRET]) {
      const [table, field] = key.split(".");
      if (!EXPORTED_TABLES.includes(table)) {
        stale.push(`${key} (table not exported)`);
        continue;
      }
      if (!fieldsOf(table).includes(field))
        stale.push(`${key} (no such field)`);
    }
    expect(stale).toEqual([]);
  });

  it("exports the same tables the purge deletes", () => {
    /**
     * ⭐ The load-bearing property of the whole design: one list serves both
     * "give me my data" and "delete my data". They cannot disagree, because
     * `dataExport.ts` imports the purge's list rather than keeping its own.
     *
     * If someone ever gives the export its own list, this fails.
     */
    const source = require("node:fs").readFileSync(
      require("node:path").join(
        __dirname,
        "..",
        "convex",
        "maya",
        "dataExport.ts",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /import \{ MAYA_CUSTOMER_SCOPED \} from "\.\.\/accountDeletion"/,
    );
  });
});
