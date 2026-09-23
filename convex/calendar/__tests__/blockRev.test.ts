/**
 * Revision guards on blocks (M4 core, carried into I1): a move or drop decided on a stale read is
 * refused with a named reason, never a clobber. Categories: fail-closed (stale → refused, nothing
 * written), sibling coherence (every writer of a block's time or existence bumps the revision),
 * cross-tenant (another creator's block is refused before any revision check).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { staleRev } from "../blocks";

describe("staleRev (pure)", () => {
  it("only an explicit, different revision is stale", () => {
    expect(staleRev(undefined, undefined)).toBe(false);
    expect(staleRev(3, undefined)).toBe(false);
    expect(staleRev(undefined, 0)).toBe(false);
    expect(staleRev(2, 2)).toBe(false);
    expect(staleRev(3, 2)).toBe(true);
  });
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", channel: { paired: true } });
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b", channel: { paired: true } });
    const start = Date.now() + 2 * 86_400_000;
    const block = await ctx.db.insert("calendarBlocks", { creatorId: a, kind: "film", start, end: start + 3_600_000, title: "film: humidity", status: "proposed", createdAt: Date.now() } as never);
    return { a, b, block, start };
  });
  return { t, ...ids };
}

describe("no clobber", () => {
  it("a move decided before someone else's move is refused; nothing changes", async () => {
    const s = await setup();
    // Maya read rev 0; then the creator moves it (rev → 1)
    await s.t.mutation(internal.calendar.blocks.setStatus, { blockId: s.block, status: "moved", start: s.start + 3_600_000, end: s.start + 7_200_000 });
    const r = await s.t.action(internal.calendar.blocks.move, { blockId: s.block, start: s.start + 86_400_000, end: s.start + 86_400_000 + 3_600_000, expectedRev: 0 });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/just changed/) });
    expect((await s.t.run((c) => c.db.get(s.block)))?.start).toBe(s.start + 3_600_000);
    expect((await s.t.action(internal.calendar.blocks.remove, { blockId: s.block, expectedRev: 0 })).ok).toBe(false);
    // with the current revision it goes through, and bumps again
    expect((await s.t.action(internal.calendar.blocks.move, { blockId: s.block, start: s.start, end: s.start + 3_600_000, expectedRev: 1 })).ok).toBe(true);
    expect((await s.t.run((c) => c.db.get(s.block)))?.rev).toBe(2);
  });

  it("the app's control refuses a stale revision and says it changed; another creator's block is refused first", async () => {
    const s = await setup();
    await s.t.mutation(internal.calendar.blocks.setStatus, { blockId: s.block, status: "moved", start: s.start, end: s.start + 3_600_000 });
    expect(await s.t.withIdentity({ subject: "user_a" }).mutation(api.ui.blockControl, { id: s.block, op: "delete", expectedRev: 0 })).toEqual({ ok: false, changed: true });
    expect(await s.t.withIdentity({ subject: "user_b" }).mutation(api.ui.blockControl, { id: s.block, op: "delete", expectedRev: 1 })).toEqual({ ok: false });
  });

  it("every writer of a block's time or existence bumps the revision (coherence)", () => {
    for (const [f, pattern] of [["calendar/sync.ts", /status: "moved", rev:/], ["calendar/sync.ts", /status: "deleted", rev:/], ["calendar/weekPlan.ts", /status: "deleted", rev:/], ["calendar/blocks.ts", /rev: \(b\?\.rev \?\? 0\) \+ 1/]] as const) {
      expect(readFileSync(join(__dirname, "../..", f), "utf8"), f).toMatch(pattern);
    }
  });
});

describe("through her tools", () => {
  it("week_plan → (they move it in the app) → block_move is refused with a reason she can say", async () => {
    const { runTool, DEFAULT_BUDGET } = await import("../../agent/tools");
    const s = await setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter over convex-test's typed callers for runTool's action ctx
    const any = s.t as any;
    const ctx = { runQuery: (f: unknown, x: unknown) => any.query(f, x), runMutation: (f: unknown, x: unknown) => any.mutation(f, x), runAction: (f: unknown, x: unknown) => any.action(f, x) } as never;
    const trace: Parameters<typeof runTool>[4] = [];
    expect(await runTool(ctx, s.a, { name: "week_plan", args: { why: "w" } }, DEFAULT_BUDGET(), trace)).toContain(String(s.block));
    await s.t.mutation(internal.calendar.blocks.setStatus, { blockId: s.block, status: "moved", start: s.start + 3_600_000, end: s.start + 7_200_000 });
    const out = await runTool(ctx, s.a, { name: "block_drop", args: { blockId: String(s.block), why: "they said skip it" } }, DEFAULT_BUDGET(), trace);
    expect(out).toMatch(/^refused: that block just changed/);
    expect((await s.t.run((c) => c.db.get(s.block)))?.status).toBe("moved");
  });
});
