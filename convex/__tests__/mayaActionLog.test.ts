/**
 * mayaActionLog — schema row-shape acceptance.
 *
 * Sprint 3 Slice 2: heartbeat ticks log one row per fired check, including
 * cooldown skips. The row carries `tickKind`, `pushed`, and `engagedAt`
 * so the operator dashboard can answer:
 *   - Which check fired this tick? (entryId)
 *   - Did Maya push a creator-facing message? (pushed)
 *   - Was the action acted on by the creator? (engagedAt)
 *   - What kind of trigger fired the action? (tickKind)
 *
 * The fields are additive + optional so pre-Sprint-3 rows still validate.
 * That dual reality is what these tests cover.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../../tests/_modules";

const NOW = 1_700_000_000_000;

async function seedCreator(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: "user_hb",
      email: "hb@test.io",
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: "manager",
      createdAt: NOW,
    })
  );
}

describe("mayaActionLog — Sprint 3 Slice 2 tick-decision telemetry", () => {
  it("accepts a heartbeat-tick row with all the new fields populated", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seedCreator(t);

    const id = await t.run(async (ctx) => {
      return ctx.db.insert("mayaActionLog", {
        creatorId,
        entryId: "post_outlier_scan",
        outcome: "ran",
        detail: "outlier ping on postId=k_post_xyz (>2× baseline)",
        durationMs: 312,
        ts: NOW,
        tickKind: "heartbeat",
        pushed: true,
      });
    });

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toBeTruthy();
    expect(row!.tickKind).toBe("heartbeat");
    expect(row!.pushed).toBe(true);
    expect(row!.outcome).toBe("ran");
  });

  it("accepts a cooldown-skip row (skipped_cooldown is a new outcome literal)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seedCreator(t);

    const id = await t.run((ctx) =>
      ctx.db.insert("mayaActionLog", {
        creatorId,
        entryId: "niche_trend_scan",
        outcome: "skipped_cooldown",
        detail: "last ran 3h ago; window is 6h",
        ts: NOW,
        tickKind: "heartbeat",
        pushed: false,
      })
    );

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.outcome).toBe("skipped_cooldown");
    expect(row!.pushed).toBe(false);
    expect(row!.tickKind).toBe("heartbeat");
  });

  it("backfills engagedAt on a row that originally had no creator engagement", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seedCreator(t);

    const id = await t.run((ctx) =>
      ctx.db.insert("mayaActionLog", {
        creatorId,
        entryId: "brand_email_triage",
        outcome: "ran",
        detail: "drafted reply variants",
        ts: NOW,
        tickKind: "heartbeat",
        pushed: true,
      })
    );

    // Creator picks variant 30 minutes later — backfill engagedAt.
    await t.run((ctx) => ctx.db.patch(id, { engagedAt: NOW + 30 * 60 * 1000 }));

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.engagedAt).toBe(NOW + 30 * 60 * 1000);
  });

  it("legacy rows without the new optional fields still validate (additive migration)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seedCreator(t);

    const id = await t.run((ctx) =>
      ctx.db.insert("mayaActionLog", {
        creatorId,
        entryId: "morning_brief",
        outcome: "ran",
        detail: "sent 9-line brief",
        durationMs: 1850,
        ts: NOW,
        // No tickKind / pushed / engagedAt — pre-Sprint-3 row shape.
      })
    );

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toBeTruthy();
    expect(row!.tickKind).toBeUndefined();
    expect(row!.pushed).toBeUndefined();
    expect(row!.engagedAt).toBeUndefined();
  });

  it("supports each tickKind literal (cron / event / heartbeat / on-demand)", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await seedCreator(t);

    const kinds: Array<"cron" | "event" | "heartbeat" | "on-demand"> = [
      "cron",
      "event",
      "heartbeat",
      "on-demand",
    ];
    for (const kind of kinds) {
      await t.run((ctx) =>
        ctx.db.insert("mayaActionLog", {
          creatorId,
          entryId: `entry_${kind}`,
          outcome: "ran",
          ts: NOW,
          tickKind: kind,
          pushed: kind === "cron",
        })
      );
    }

    const all = await t.run((ctx) =>
      ctx.db
        .query("mayaActionLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect()
    );
    expect(all.map((r) => r.tickKind).sort()).toEqual([
      "cron",
      "event",
      "heartbeat",
      "on-demand",
    ]);
  });
});
