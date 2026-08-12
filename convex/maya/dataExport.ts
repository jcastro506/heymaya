/**
 * ⭐ Data export (§18 Sprint 10's operational essentials).
 *
 * > *"kept for the life of the account · read-only for 30 days after
 * > cancellation, then purged — **and the export in Sprint 10 is exactly
 * > this** — their history, theirs to take."* (§16.8.5)
 *
 * ## One list, two promises
 *
 * The set of tables exported is `MAYA_CUSTOMER_SCOPED`, imported from
 * `accountDeletion.ts` — **the same list the purge deletes.** That is deliberate
 * and it is the whole design:
 *
 * - Everything we delete when they leave is everything we hand over when they
 *   ask. The two can't disagree, because there is only one list.
 * - `accountDeletionCoverage.test.ts` derives that list from `schema.ts`, so a
 *   new table joins both the export and the purge or fails the build. One test
 *   now guards both promises.
 *
 * ⚠️ The alternative — an export list maintained beside a deletion list — is the
 * exact shape of the bug this file was written next to: two hand-maintained
 * lists that fall behind the schema independently and silently.
 *
 * ## ⚠️ What must never leave
 *
 * `customers` carries live credentials, and `gatewayToken` is stored in
 * **plaintext** by design (we present it *to* her machine, so we need the value
 * itself). An export is a file the founder may email to themselves, drop in a
 * shared folder, or hand to a lawyer. Shipping a working credential inside it
 * is a breach we performed on their behalf.
 *
 * So every secret-shaped field is classified below, and
 * `dataExportRedaction.test.ts` fails on any new one that isn't.
 */

import { v } from "convex/values";
import { action, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAYA_CUSTOMER_SCOPED } from "../accountDeletion";

/**
 * ⚠️ Fields that must NEVER appear in an export, as `table.field`.
 *
 * `gatewayToken` is the dangerous one: plaintext, and it reaches her running
 * session. The two hashes and the pairing token are less severe but are still
 * credentials, and a hash in a file is an offline cracking target rather than a
 * useful record of anything the founder cares about.
 */
export const EXPORT_REDACTED = new Set<string>([
  "customers.gatewayToken",
  "customers.agentTokenHash",
  "customers.openRouterKeyHash",
  "customers.pairingToken",
]);

/**
 * Fields whose NAME looks like a secret but isn't one.
 *
 * Listed explicitly rather than tuned into the regex, because a looser pattern
 * silently stops flagging the real thing. Being wrong here should cost a test
 * failure, not a leak.
 */
export const EXPORT_NOT_SECRET = new Set<string>([
  // Idempotency keys — ours, meaningless to anyone else, and part of the
  // record of what was sent when.
  "messages.dedupeKey",
  "placements.idempotencyKey",
  "targets.dedupeKey",
  // A Convex storage id. Useless without an authenticated URL, and it is the
  // link between an exported row and its exported media.
  "mediaAssets.storageKey",
  // Token COUNTS, not tokens. Cost history is theirs to see.
  "costEvents.promptTokens",
  "costEvents.completionTokens",
]);

/** Also stripped: Convex internals that mean nothing outside our database. */
const INTERNAL_FIELDS = new Set(["_creationTime"]);

/**
 * ⚠️ Per table, per pass. Convex caps documents read in one query, and an
 * export that throws on the biggest accounts is an export that only works for
 * people who don't need it.
 *
 * Truncation is REPORTED, never silent (§2.5) — both in the returned summary
 * and inside the file itself, so a founder reading it a year later knows.
 */
const ROWS_PER_TABLE = 2_000;

export function redactRow(
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (INTERNAL_FIELDS.has(key)) continue;
    if (EXPORT_REDACTED.has(`${table}.${key}`)) continue;
    out[key] = value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */

/**
 * Collect one table's rows for one customer.
 *
 * A query per table rather than one query for everything: the read cap applies
 * per function call, so this is what lets a large account export at all.
 */
export const exportTable = internalQuery({
  args: {
    customerId: v.id("customers"),
    table: v.string(),
    index: v.string(),
  },
  handler: async (ctx, args) => {
    type UntypedDb = {
      query: (t: string) => {
        withIndex: (
          name: string,
          builder: (q: { eq: (f: string, val: unknown) => unknown }) => unknown,
        ) => { take: (n: number) => Promise<Record<string, unknown>[]> };
      };
    };

    const rows = await (ctx.db as unknown as UntypedDb)
      .query(args.table)
      .withIndex(args.index, (q) => q.eq("customerId", args.customerId))
      .take(ROWS_PER_TABLE + 1);

    // One extra row read is how we know there were more, without counting them.
    const truncated = rows.length > ROWS_PER_TABLE;
    return {
      rows: rows.slice(0, ROWS_PER_TABLE).map((r) => redactRow(args.table, r)),
      truncated,
    };
  },
});

/** The account row itself — redacted, and it is where the credentials live. */
export const exportProfile = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    return redactRow(
      "customers",
      customer as unknown as Record<string, unknown>,
    );
  },
});

/**
 * Resolve the signed-in account and its customers in one query.
 *
 * ⚠️ An action has `ctx.auth` but no `ctx.db`, so the identity check has to
 * happen inside a query. Doing the lookup and the scoping together means the
 * action never gets to choose which account it exports — there is no
 * `customerId` argument to get wrong or to forge.
 */
export const myExportScope = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required.");

    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator) throw new Error("Account not found.");

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .collect();

    return { email: creator.email, customerIds: customers.map((r) => r._id) };
  },
});

/* -------------------------------------------------------------------------- */

/**
 * ⭐ "Give me everything you have on me."
 *
 * Returns a URL to a JSON file. An action, not a mutation, because it stores a
 * file — and because assembling it needs more reads than one transaction may do.
 */
export const requestMyDataExport = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    ok: boolean;
    url: string | null;
    tables: Record<string, number>;
    truncated: string[];
  }> => {
    const scope = await ctx.runQuery(
      internal.maya.dataExport.myExportScope,
      {},
    );
    const customerIds = scope.customerIds;

    const counts: Record<string, number> = {};
    const truncated: string[] = [];
    const accounts: unknown[] = [];

    for (const customerId of customerIds) {
      const profile = await ctx.runQuery(
        internal.maya.dataExport.exportProfile,
        { customerId },
      );

      const data: Record<string, unknown[]> = {};
      for (const { table, index } of MAYA_CUSTOMER_SCOPED) {
        const chunk = await ctx.runQuery(internal.maya.dataExport.exportTable, {
          customerId,
          table,
          index,
        });
        data[table] = chunk.rows;
        counts[table] = (counts[table] ?? 0) + chunk.rows.length;
        if (chunk.truncated && !truncated.includes(table))
          truncated.push(table);
      }

      accounts.push({ profile, data });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      account: { email: scope.email },
      /**
       * ⚠️ Stated in the file, not only in the API response. Whoever opens this
       * a year from now is not the person who saw the response.
       */
      notes: [
        "Credentials and access tokens are deliberately excluded.",
        ...(truncated.length > 0
          ? [
              `These sections were capped at ${ROWS_PER_TABLE} rows and are incomplete: ${truncated.join(", ")}. Ask support for the full history.`,
            ]
          : []),
      ],
      accounts,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);

    return { ok: true, url, tables: counts, truncated };
  },
});
