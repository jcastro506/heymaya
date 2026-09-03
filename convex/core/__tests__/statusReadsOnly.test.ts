/**
 * She may only say "i couldn't see tiktok" when READS failed.
 *
 * The check used to take the newest scrapecreators health row of any kind, so a nightly
 * cost-reconciliation mismatch made her apologise to a live creator for an outage that
 * never happened.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const NOW = Date.UTC(2026, 8, 3, 12, 0);

async function withHealth(check: string, ok: boolean) {
  const t = convexTest(schema, modules);
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true } }));
  await t.run((ctx) => ctx.db.insert("vendorHealth", { vendor: "scrapecreators", check, ok, detail: "x", at: NOW - 3_600_000 } as never));
  return { t, creatorId };
}

describe("creator-facing status", () => {
  it("a cost reconciliation mismatch is NOT an outage she reports", async () => {
    const { t } = await withHealth("reconcile", false);
    const due = await t.query(internal.core.status.dueStatus, { now: NOW });
    expect(due.filter((d) => d.kind === "cannot_see")).toHaveLength(0);
  });

  it("a failed read check still is", async () => {
    const { t } = await withHealth("credit-balance", false);
    const due = await t.query(internal.core.status.dueStatus, { now: NOW });
    expect(due.filter((d) => d.kind === "cannot_see")).toHaveLength(1);
  });

  it("a healthy read check says nothing", async () => {
    const { t } = await withHealth("credit-balance", true);
    const due = await t.query(internal.core.status.dueStatus, { now: NOW });
    expect(due.filter((d) => d.kind === "cannot_see")).toHaveLength(0);
  });
});
