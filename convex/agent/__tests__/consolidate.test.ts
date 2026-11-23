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
    // The nightly fans out one mutation per creator (S0 #1); the counts come from that one.
    expect(await t.mutation(internal.agent.consolidate.nightly, { now })).toEqual({ creators: 1 });
    const r = await t.mutation(internal.agent.consolidate.consolidateOne, { creatorId, now });
    expect(r.expiredNotes).toBe(1);
    expect(r.hoursLearned).toBe(1);
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    expect(c?.notes.find((n) => n.id === "old")?.tombstonedAt).toBeTypeOf("number");
    expect(c?.notes.find((n) => n.id === "kept")?.tombstonedAt).toBeUndefined();
    expect(c?.notes.find((n) => n.id === "live")?.tombstonedAt).toBeUndefined();
    expect(c?.preferredSendHour).toBe(19);
  });

  it("a time-bound note leaves what stays true when it expires (horizon sim: the move)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.UTC(2026, 8, 3, 3, 0);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", notes: [
      { id: "move", text: "moving to Denver on Jan 8", kind: "life", at: 1, expiresHint: now - 1, after: "lives in Denver now" },
      { id: "trip", text: "trip in june", kind: "life", at: 1, expiresHint: now - 1 },
    ] }));
    await t.mutation(internal.agent.consolidate.consolidateOne, { creatorId, now });
    await t.mutation(internal.agent.consolidate.consolidateOne, { creatorId, now: now + 1 });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    const live = c!.notes.filter((n) => !n.tombstonedAt);
    // The move leaves what they said stays true; the trip, with no "after", is kept as something that happened.
    expect(live.map((n) => [n.text, n.kind])).toEqual([["lives in Denver now", "fact"], ["Happened (by 2026-09-03): trip in june", "fact"]]);
    expect(live.every((n) => n.expiresHint === undefined)).toBe(true);
  });

  it("a race with no \"after\" isn't forgotten on race day (horizon sim: the goal lost the week after)", async () => {
    const t = convexTest(schema, modules);
    const race = Date.UTC(2026, 9, 11, 12, 0);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", notes: [
      { id: "race", text: "running the chicago marathon on oct 11", kind: "life", at: 1, expiresHint: race },
      { id: "joke", text: "the burnt toast bit", kind: "bit", at: 1, expiresHint: race },
      { id: "f", text: "sister films for them", kind: "fact", at: 1, expiresHint: race },
    ] }));
    await t.mutation(internal.agent.consolidate.consolidateOne, { creatorId, now: race + 7 * 86_400_000 });
    const c = await t.run((ctx) => ctx.db.get(creatorId));
    const live = c!.notes.filter((n) => !n.tombstonedAt).map((n) => n.text);
    expect(live).toContain("Happened (by 2026-10-11): running the chicago marathon on oct 11");
    expect(live).toContain("the burnt toast bit"); // a bit never expires
    expect(live.some((x) => x.includes("sister films"))).toBe(false); // only a plan becomes a past one
    expect(c!.notes.find((n) => n.text.startsWith("Happened"))?.id).toBe("race_after"); // so the idea brief carries it for six weeks
  });
});
