/**
 * Phase 2 ④ — watermark / delta-read mechanism.
 *
 * Two test layers, mirroring the module:
 *   1. Pure helpers (`filterNewItems`, `nextWatermarkFrom`) — no DB.
 *   2. Convex internal mutations/queries over `gtmChannelWatermarks` and
 *      `gtmWatchLaneState` via convex-test (upsert idempotency, monotonic
 *      non-regression, dry-run counter, pickNextDueLane rotation, and
 *      cross-tenant isolation A ≠ B).
 *
 * Accounts/agents are minted through `startGtmOnboarding` like sibling tests,
 * giving real {accountId, agentId} pairs.
 */

import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { modules } from "../../../tests/_modules";
import { filterNewItems, nextWatermarkFrom } from "../watermarks";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = btoa("\0".repeat(32));
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  ts?: number;
}
const getTs = (i: Item) => i.ts;
const getId = (i: Item) => i.id;

// Newest-first page.
const page = (): Item[] => [
  { id: "d", ts: 400 },
  { id: "c", ts: 300 },
  { id: "b", ts: 200 },
  { id: "a", ts: 100 },
];

describe("filterNewItems", () => {
  it("empty / absent watermark returns ALL items unchanged", () => {
    const items = page();
    expect(filterNewItems(items, undefined, getTs, getId)).toEqual(items);
    expect(filterNewItems(items, null, getTs, getId)).toEqual(items);
    expect(filterNewItems(items, {}, getTs, getId)).toEqual(items);
  });

  it("drops items at/before the watermark, keeps only strictly-newer", () => {
    const out = filterNewItems(
      page(),
      { lastObservedAtMs: 200, lastSeenId: "b" },
      getTs,
      getId
    );
    expect(out.map((i) => i.id)).toEqual(["d", "c"]);
  });

  it("preserves newest-first ordering of the survivors", () => {
    const out = filterNewItems(
      page(),
      { lastObservedAtMs: 100, lastSeenId: "a" },
      getTs,
      getId
    );
    expect(out.map((i) => i.id)).toEqual(["d", "c", "b"]);
  });

  it("a tie at lastSeenId: the watermark row itself is dropped (seen)", () => {
    // Two items share ts=200; "b" is the watermark id → dropped. The sibling
    // "b2" at the same ts is also dropped (fail-closed: can't prove it's new).
    const items: Item[] = [
      { id: "c", ts: 300 },
      { id: "b2", ts: 200 },
      { id: "b", ts: 200 },
      { id: "a", ts: 100 },
    ];
    const out = filterNewItems(
      items,
      { lastObservedAtMs: 200, lastSeenId: "b" },
      getTs,
      getId
    );
    expect(out.map((i) => i.id)).toEqual(["c"]);
  });

  it("drops undated items when a dated watermark exists (fail-closed)", () => {
    const items: Item[] = [
      { id: "new", ts: 500 },
      { id: "undated" },
    ];
    const out = filterNewItems(
      items,
      { lastObservedAtMs: 200, lastSeenId: "b" },
      getTs,
      getId
    );
    expect(out.map((i) => i.id)).toEqual(["new"]);
  });

  it("empty input → empty output", () => {
    expect(filterNewItems([], { lastObservedAtMs: 1 }, getTs, getId)).toEqual([]);
  });
});

describe("nextWatermarkFrom", () => {
  it("advances to the page's newest item", () => {
    const wm = nextWatermarkFrom(page(), undefined, getTs, getId);
    expect(wm).toEqual({ lastObservedAtMs: 400, lastSeenId: "d" });
  });

  it("advances forward from a lower current watermark", () => {
    const wm = nextWatermarkFrom(
      page(),
      { lastObservedAtMs: 250, lastSeenId: "older" },
      getTs,
      getId
    );
    expect(wm).toEqual({ lastObservedAtMs: 400, lastSeenId: "d" });
  });

  it("NEVER regresses: a stale page keeps the current watermark", () => {
    const current = { lastObservedAtMs: 999, lastSeenId: "z" };
    const wm = nextWatermarkFrom(page(), current, getTs, getId);
    expect(wm).toEqual(current);
  });

  it("equal newest does not move (monotonic, strict)", () => {
    const current = { lastObservedAtMs: 400, lastSeenId: "d" };
    const wm = nextWatermarkFrom(page(), current, getTs, getId);
    expect(wm).toEqual(current);
  });

  it("empty page keeps the current watermark", () => {
    const current = { lastObservedAtMs: 5, lastSeenId: "x" };
    expect(nextWatermarkFrom([], current, getTs, getId)).toEqual(current);
    expect(nextWatermarkFrom([], undefined, getTs, getId)).toEqual({});
  });

  it("undated page cannot advance, keeps current", () => {
    const items: Item[] = [{ id: "a" }, { id: "b" }];
    const current = { lastObservedAtMs: 10, lastSeenId: "old" };
    expect(nextWatermarkFrom(items, current, getTs, getId)).toEqual(current);
  });
});

// ---------------------------------------------------------------------------
// Convex DB layer
// ---------------------------------------------------------------------------

async function setupAgent(
  t: ReturnType<typeof convexTest>,
  subject: string
): Promise<{ agentId: Id<"gtmAgents">; accountId: Id<"creators"> }> {
  const authed = t.withIdentity({
    subject,
    email: `${subject}@clawlaunch.test`,
  });
  const started = await authed.mutation(
    api.gtmMaya.researchLifecycle.startGtmOnboarding,
    {}
  );
  return { agentId: started.agentId, accountId: started.accountId };
}

describe("gtmChannelWatermarks — advance / get", () => {
  it("inserts on first advance, then patches (upsert idempotency on account+channel)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "wm_a1");

    await t.mutation(internal.gtmMaya.watermarks.advanceChannelWatermark, {
      accountId: a.accountId,
      agentId: a.agentId,
      channel: "reddit",
      lastObservedAtMs: 100,
      lastSeenId: "p100",
      cursor: "cur1",
    });
    await t.mutation(internal.gtmMaya.watermarks.advanceChannelWatermark, {
      accountId: a.accountId,
      agentId: a.agentId,
      channel: "reddit",
      lastObservedAtMs: 200,
      lastSeenId: "p200",
      cursor: "cur2",
    });

    const row = await t.query(
      internal.gtmMaya.watermarks.getChannelWatermark,
      { accountId: a.accountId, channel: "reddit" }
    );
    expect(row).not.toBeNull();
    expect(row!.lastObservedAtMs).toBe(200);
    expect(row!.lastSeenId).toBe("p200");
    expect(row!.cursor).toBe("cur2");

    // Exactly one row for (account, channel) — it patched, not duplicated.
    const all = await t.run(async (ctx) =>
      ctx.db
        .query("gtmChannelWatermarks")
        .withIndex("by_account_and_channel", (q) =>
          q.eq("accountId", a.accountId).eq("channel", "reddit")
        )
        .collect()
    );
    expect(all).toHaveLength(1);
  });

  it("is MONOTONIC: a regressing timestamp does not move the position", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "wm_mono");

    await t.mutation(internal.gtmMaya.watermarks.advanceChannelWatermark, {
      accountId: a.accountId,
      agentId: a.agentId,
      channel: "x",
      lastObservedAtMs: 500,
      lastSeenId: "p500",
    });
    // Stale page tries to set it backward.
    await t.mutation(internal.gtmMaya.watermarks.advanceChannelWatermark, {
      accountId: a.accountId,
      agentId: a.agentId,
      channel: "x",
      lastObservedAtMs: 100,
      lastSeenId: "p100",
      cursor: "resume",
    });

    const row = await t.query(
      internal.gtmMaya.watermarks.getChannelWatermark,
      { accountId: a.accountId, channel: "x" }
    );
    expect(row!.lastObservedAtMs).toBe(500);
    expect(row!.lastSeenId).toBe("p500");
    // Cursor still persists even on a non-advancing (dry/resume) call.
    expect(row!.cursor).toBe("resume");
  });

  it("getChannelWatermark returns null for an unseen channel", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "wm_null");
    const row = await t.query(
      internal.gtmMaya.watermarks.getChannelWatermark,
      { accountId: a.accountId, channel: "tiktok" }
    );
    expect(row).toBeNull();
  });

  it("CROSS-TENANT: account A's watermark is invisible to account B", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "wm_iso_a");
    const b = await setupAgent(t, "wm_iso_b");

    await t.mutation(internal.gtmMaya.watermarks.advanceChannelWatermark, {
      accountId: a.accountId,
      agentId: a.agentId,
      channel: "reddit",
      lastObservedAtMs: 777,
      lastSeenId: "a_only",
    });

    const bRow = await t.query(
      internal.gtmMaya.watermarks.getChannelWatermark,
      { accountId: b.accountId, channel: "reddit" }
    );
    expect(bRow).toBeNull();

    const aRow = await t.query(
      internal.gtmMaya.watermarks.getChannelWatermark,
      { accountId: a.accountId, channel: "reddit" }
    );
    expect(aRow!.lastSeenId).toBe("a_only");
  });
});

describe("gtmWatchLaneState — touch / pickNextDueLane", () => {
  it("dry-run counter increments on dry, resets on non-dry", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "lane_dry");

    const touch = (dry: boolean, nextDueAtMs: number) =>
      t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
        accountId: a.accountId,
        agentId: a.agentId,
        lane: "reddit",
        nextDueAtMs,
        dry,
      });

    await touch(true, 1000); // streak 1
    await touch(true, 2000); // streak 2
    let rows = await t.query(internal.gtmMaya.watermarks.getWatchLaneState, {
      accountId: a.accountId,
    });
    expect(rows[0].consecutiveDryRuns).toBe(2);
    expect(rows[0].nextDueAtMs).toBe(2000);

    await touch(false, 3000); // reset to 0
    rows = await t.query(internal.gtmMaya.watermarks.getWatchLaneState, {
      accountId: a.accountId,
    });
    expect(rows[0].consecutiveDryRuns).toBe(0);
    expect(rows).toHaveLength(1); // upsert, not duplicated
  });

  it("pickNextDueLane: an UNSEEN lane wins first (in caller order)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "lane_unseen");

    // Run "reddit" once; "x" and "ig" are still unseen.
    await t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
      accountId: a.accountId,
      agentId: a.agentId,
      lane: "reddit",
      nextDueAtMs: 10,
    });

    const pick = await t.query(internal.gtmMaya.watermarks.pickNextDueLane, {
      accountId: a.accountId,
      lanes: ["reddit", "x", "ig"],
      nowMs: 100,
    });
    expect(pick).toBe("x"); // first unseen in caller order
  });

  it("pickNextDueLane: among seen lanes, the earliest nextDueAtMs wins (rotation)", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "lane_rotate");

    const lanes = ["reddit", "x", "ig"];
    // Seed all three so none is unseen; stagger their next-due times.
    await t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
      accountId: a.accountId, agentId: a.agentId, lane: "reddit", nextDueAtMs: 5000,
    });
    await t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
      accountId: a.accountId, agentId: a.agentId, lane: "x", nextDueAtMs: 1000,
    });
    await t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
      accountId: a.accountId, agentId: a.agentId, lane: "ig", nextDueAtMs: 3000,
    });

    const first = await t.query(internal.gtmMaya.watermarks.pickNextDueLane, {
      accountId: a.accountId, lanes, nowMs: 9999,
    });
    expect(first).toBe("x"); // earliest next-due

    // Rotate: x just ran, push it far out → next pick is "ig".
    await t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
      accountId: a.accountId, agentId: a.agentId, lane: "x", nextDueAtMs: 8000,
    });
    const second = await t.query(internal.gtmMaya.watermarks.pickNextDueLane, {
      accountId: a.accountId, lanes, nowMs: 9999,
    });
    expect(second).toBe("ig");
  });

  it("pickNextDueLane: returns null for an empty lane set", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "lane_empty");
    const pick = await t.query(internal.gtmMaya.watermarks.pickNextDueLane, {
      accountId: a.accountId,
      lanes: [],
      nowMs: 1,
    });
    expect(pick).toBeNull();
  });

  it("CROSS-TENANT: account B's lane rotation ignores account A's lanes", async () => {
    const t = convexTest(schema, modules);
    const a = await setupAgent(t, "lane_iso_a");
    const b = await setupAgent(t, "lane_iso_b");

    // A has run all lanes; B has run none.
    for (const lane of ["reddit", "x", "ig"]) {
      await t.mutation(internal.gtmMaya.watermarks.touchWatchLane, {
        accountId: a.accountId, agentId: a.agentId, lane, nextDueAtMs: 1,
      });
    }

    // B sees every lane as UNSEEN → picks the first.
    const bPick = await t.query(internal.gtmMaya.watermarks.pickNextDueLane, {
      accountId: b.accountId,
      lanes: ["reddit", "x", "ig"],
      nowMs: 100,
    });
    expect(bPick).toBe("reddit");

    // B's lane state is empty regardless of A's rows.
    const bRows = await t.query(internal.gtmMaya.watermarks.getWatchLaneState, {
      accountId: b.accountId,
    });
    expect(bRows).toHaveLength(0);
  });
});
