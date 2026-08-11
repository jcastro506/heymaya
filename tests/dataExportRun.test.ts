/**
 * ⭐ The export, executed.
 *
 * `dataExportRedaction.test.ts` proves the classification is complete and that
 * `redactRow` honours it. This proves the assembled file is what a founder
 * actually receives: their rows, none of anyone else's, and no credentials.
 *
 * ⚠️ The redaction unit test operates on a hand-built object. That is not the
 * same claim as "the file we hand over is clean" — between them sits an action
 * that reads real documents, serialises them, and stores a blob. This asserts
 * on the **bytes of the stored file**, which is the artefact that leaves the
 * building.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { modules } from "./_modules";
import { MAYA_CUSTOMER_SCOPED } from "../convex/accountDeletion";
import { minimalRow, type InsertCtx } from "./lib/minimalRow";

const GATEWAY_SECRET = "gw_live_do_not_export_me";

describe("data export", () => {
  it("hands over this account's rows, and no credentials", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const creatorId = await ctx.db.insert("creators", {
        ...(await minimalRow(ctx as unknown as InsertCtx, "creators", {
          clerkUserId: "user_exporter",
          email: "exporter@example.com",
          accountType: "gtm-agent",
        })),
      } as unknown as Parameters<typeof ctx.db.insert<"creators">>[1]);

      // A second account whose rows must not appear in the first one's export.
      const otherCreatorId = await ctx.db.insert("creators", {
        ...(await minimalRow(ctx as unknown as InsertCtx, "creators", {
          clerkUserId: "user_stranger",
          email: "stranger@example.com",
          accountType: "gtm-agent",
        })),
      } as unknown as Parameters<typeof ctx.db.insert<"creators">>[1]);

      const customerId = await ctx.db.insert("customers", {
        ...(await minimalRow(ctx as unknown as InsertCtx, "customers", {
          accountId: creatorId,
          // ⚠️ The plaintext credential, present on the row being exported.
          gatewayToken: GATEWAY_SECRET,
        })),
      } as unknown as Parameters<typeof ctx.db.insert<"customers">>[1]);

      const otherCustomerId = await ctx.db.insert("customers", {
        ...(await minimalRow(ctx as unknown as InsertCtx, "customers", {
          accountId: otherCreatorId,
        })),
      } as unknown as Parameters<typeof ctx.db.insert<"customers">>[1]);

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
    });

    const asUser = t.withIdentity({ subject: "user_exporter" });
    const result = await asUser.action(
      api.maya.dataExport.requestMyDataExport,
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.url).toBeTruthy();

    // Every exported table produced rows — an export that silently returns
    // nothing is the failure mode most likely to ship unnoticed.
    for (const { table } of MAYA_CUSTOMER_SCOPED) {
      expect(result.tables[table], `${table} exported nothing`).toBeGreaterThan(
        0,
      );
    }
    expect(result.truncated).toEqual([]);

    /**
     * ⭐ Read back the stored file and assert on its actual bytes. Everything
     * above is a summary the action chose to return; this is the thing the
     * founder opens.
     */
    const text = await t.run(async (ctx) => {
      const [file] = await ctx.db.system.query("_storage").collect();
      const blob = await ctx.storage.get(file._id);
      return await blob!.text();
    });

    expect(text).not.toContain(GATEWAY_SECRET);
    expect(text).not.toContain("gatewayToken");

    const parsed = JSON.parse(text);
    expect(parsed.account.email).toBe("exporter@example.com");
    // ⚠️ Exactly one account's data. `customers` is queried by `accountId`, and
    // a mistake there would quietly hand a stranger's history to whoever asked.
    expect(parsed.accounts).toHaveLength(1);
    expect(parsed.notes[0]).toMatch(/Credentials/i);

    for (const { table } of MAYA_CUSTOMER_SCOPED) {
      expect(parsed.accounts[0].data[table].length, table).toBeGreaterThan(0);
    }
  });

  it("refuses when nobody is signed in", async () => {
    const t = convexTest(schema, modules);
    // Anonymous export would be the worst possible bug in this file.
    await expect(
      t.action(api.maya.dataExport.requestMyDataExport, {}),
    ).rejects.toThrow(/Authentication required/);
  });
});
