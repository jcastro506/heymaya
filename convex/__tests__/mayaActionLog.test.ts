/**
 * mayaActionLog — Sprint 9 review-tooling tests.
 *
 * Coverage (5 mandatory categories):
 *   1. Cross-tenant isolation — query for creator A returns only A's rows.
 *   2. Plan-tier × action — read-only review surface; no plan-gate to test.
 *   3. Adversarial — bogus creatorId returns empty rows (not throw).
 *   4. Sibling-file scan — summarizer counts cover ALL six outcomes.
 *   5. TODO grep — none introduced.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import {
  summarizeTickDecisions,
} from "../mayaActionLog";
import type { Doc, Id } from "../_generated/dataModel";

const NOW = Date.UTC(2026, 4, 6, 12, 0, 0);
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("mayaActionLog.tickDecisionsLast7Days — query", () => {
  it("returns the last-7-days slice for a creator (excludes older rows)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_1"))
    );
    await seedActionLog(t, creatorId, [
      { entryId: "morning_brief", outcome: "ran", ts: NOW - 3 * ONE_DAY_MS },
      { entryId: "evening_recap", outcome: "ran", ts: NOW - 1 * ONE_DAY_MS },
      // outside window — must be excluded
      { entryId: "weekly_review", outcome: "ran", ts: NOW - 8 * ONE_DAY_MS },
    ]);

    const result = await t.query(api.mayaActionLog.tickDecisionsLast7Days, {
      creatorId,
      nowMs: NOW,
    });
    expect(result.rows.length).toBe(2);
    expect(result.rows.map((r) => r.entryId).sort()).toEqual([
      "evening_recap",
      "morning_brief",
    ]);
    expect(result.windowEndMs).toBe(NOW);
    expect(result.windowStartMs).toBe(NOW - 7 * ONE_DAY_MS);
  });

  it("cross-tenant: creator B's rows never appear in creator A's query", async () => {
    const t = convexTest(schema, modules);
    const idA = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_A"))
    );
    const idB = await t.run(async (ctx) =>
      ctx.db.insert("creators", baseCreatorRow("user_B"))
    );
    await seedActionLog(t, idA, [
      { entryId: "morning_brief", outcome: "ran", ts: NOW - ONE_HOUR_MS },
    ]);
    await seedActionLog(t, idB, [
      { entryId: "evening_recap", outcome: "ran", ts: NOW - ONE_HOUR_MS },
      { entryId: "weekly_review", outcome: "failed", ts: NOW - ONE_HOUR_MS },
    ]);

    const a = await t.query(api.mayaActionLog.tickDecisionsLast7Days, {
      creatorId: idA,
      nowMs: NOW,
    });
    expect(a.rows.length).toBe(1);
    expect(a.rows[0].entryId).toBe("morning_brief");

    const b = await t.query(api.mayaActionLog.tickDecisionsLast7Days, {
      creatorId: idB,
      nowMs: NOW,
    });
    expect(b.rows.length).toBe(2);
  });

  it("returns empty rows for a deleted creator id (not throw)", async () => {
    const t = convexTest(schema, modules);
    const ghostId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("creators", baseCreatorRow("ghost"));
      await ctx.db.delete(id);
      return id;
    });
    const result = await t.query(api.mayaActionLog.tickDecisionsLast7Days, {
      creatorId: ghostId,
      nowMs: NOW,
    });
    expect(result.rows.length).toBe(0);
  });
});

describe("summarizeTickDecisions — pure summarizer", () => {
  it("counts each outcome bucket independently", () => {
    const rows: Array<Pick<Doc<"mayaActionLog">, "creatorId" | "entryId" | "outcome" | "ts">> = [
      mkRow("morning_brief", "ran"),
      mkRow("morning_brief", "ran"),
      mkRow("evening_recap", "skipped_condition_unmet"),
      mkRow("weekly_review", "skipped_plan_disabled"),
      mkRow("brand_email_triage", "skipped_dependency_missing"),
      mkRow("morning_brief", "retried"),
      mkRow("morning_brief", "failed"),
    ];
    const s = summarizeTickDecisions(rows as Doc<"mayaActionLog">[]);
    expect(s.totalTicks).toBe(7);
    expect(s.distinctEntries).toBe(4);
    expect(s.byOutcome).toEqual({
      ran: 2,
      skipped_plan_disabled: 1,
      skipped_condition_unmet: 1,
      skipped_dependency_missing: 1,
      retried: 1,
      failed: 1,
    });
    expect(s.byEntry.morning_brief).toEqual({
      ran: 2,
      skipped: 0,
      retried: 1,
      failed: 1,
    });
    expect(s.byEntry.evening_recap.skipped).toBe(1);
  });

  it("empty rows summarizes to all zeros", () => {
    const s = summarizeTickDecisions([]);
    expect(s.totalTicks).toBe(0);
    expect(s.distinctEntries).toBe(0);
    expect(Object.values(s.byOutcome).every((v) => v === 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function seedActionLog(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  rows: ReadonlyArray<{
    entryId: string;
    outcome: Doc<"mayaActionLog">["outcome"];
    ts: number;
  }>
): Promise<void> {
  await t.run(async (ctx) => {
    for (const r of rows) {
      await ctx.db.insert("mayaActionLog", {
        creatorId,
        entryId: r.entryId,
        outcome: r.outcome,
        ts: r.ts,
      });
    }
  });
}

function mkRow(
  entryId: string,
  outcome: Doc<"mayaActionLog">["outcome"]
): Pick<Doc<"mayaActionLog">, "creatorId" | "entryId" | "outcome" | "ts"> {
  return {
    // The summarizer doesn't read creatorId; cast the placeholder.
    creatorId: "fake" as unknown as Id<"creators">,
    entryId,
    outcome,
    ts: NOW,
  };
}

function baseCreatorRow(suffix: string): {
  clerkUserId: string;
  email: string;
  channelPreference: "imessage";
  timezone: string;
  status: "active";
  plan: "coach";
  createdAt: number;
} {
  return {
    clerkUserId: `clerk_${suffix}`,
    email: `${suffix}@example.com`,
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "coach",
    createdAt: Date.UTC(2026, 4, 1),
  };
}
