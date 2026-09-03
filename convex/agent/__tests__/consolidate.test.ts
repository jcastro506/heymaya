/** §15.7 layer 3 (code half): notes expire unless confirmed; the reply hour is learned from six or more replies. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { preferredHour } from "../consolidate";

describe("consolidate", () => {
  it("preferredHour needs six replies and takes the median local hour", () => {
    expect(preferredHour([1, 2, 3], "UTC")).toBeUndefined();
    const at = (h: number) => Date.UTC(2026, 8, 2, h, 15);
    expect(preferredHour([at(9), at(10), at(21), at(21), at(22), at(22)], "UTC")).toBe(21);
    expect(preferredHour([at(16), at(16), at(16), at(16), at(16), at(16)], "America/Los_Angeles")).toBe(9); // 16:00 UTC = 09:00 PDT
  });

  it("tombstones expired, unconfirmed notes; keeps confirmed ones; learns the hour", async () => {
    const t = convexTest(schema, modules);
    /**
     * ⚠️ The same clock for the fixture and the run. This used to seed `expiresHint` from
     * the real `Date.now()` while running the job at a fixed simulated date, so the test
     * silently stopped testing anything the moment real time passed 2026-09-03 03:00 UTC,
     * which it did mid-session. A test whose meaning depends on today's date is a bomb.
     */
    const now = Date.UTC(2026, 8, 3, 3, 0);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", notes: [
      { id: "old", text: "trip in june", kind: "life", at: 1, expiresHint: now - 1 },
      { id: "kept", text: "sister runs the account", kind: "fact", at: 1, expiresHint: now - 1, confirmedAt: 2 },
      { id: "live", text: "marathon in october", kind: "life", at: 1, expiresHint: now + 86_400_000 },
    ] }));
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++) await ctx.db.insert("messages", { creatorId, direction: "in", surface: "telegram", body: "hey", ts: Date.UTC(2026, 8, 2, 19, 0) - i * 86_400_000 * 2, kind: "inbound" });
    });
    const r = await t.mutation(internal.agent.consolidate.nightly, { now: Date.UTC(2026, 8, 3, 3, 0) });
    expect(r.expiredNotes).toBe(1);
    expect(r.hoursLearned).toBe(1);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.notes.find((n) => n.id === "old")?.tombstonedAt).toBeTypeOf("number");
    expect(c?.notes.find((n) => n.id === "kept")?.tombstonedAt).toBeUndefined();
    expect(c?.notes.find((n) => n.id === "live")?.tombstonedAt).toBeUndefined();
    expect(c?.preferredSendHour).toBe(19);
  });
});
