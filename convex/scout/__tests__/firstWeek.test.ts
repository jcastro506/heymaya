/** §1 the first week: a schedule row, not the gate. Day 4 invitation once; steps idempotent. */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";

const DAY = 86_400_000;

describe("first week", () => {
  it("the invitation is due on day 4–10, at a civil hour, once", async () => {
    const t = convexTest(schema, modules);
    const start = Date.UTC(2026, 8, 1, 12, 0);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC", channel: { paired: true, pairedAt: start }, dossier: { persona: {} }, firstWeek: { startedAt: start, stepsDone: ["first_read"] } }));
    await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b", handles: { tiktok: "tt_b" }, timezone: "UTC", channel: { paired: true, pairedAt: start }, dossier: { persona: {} }, firstWeek: { startedAt: start, stepsDone: ["first_read", "invite_draft"] } }));
    expect(await t.query(internal.scout.firstWeek.dueForInvite, { now: start + 2 * DAY })).toEqual([]); // day 3
    expect(await t.query(internal.scout.firstWeek.dueForInvite, { now: start + 3 * DAY + 2 * 3600_000 })).toEqual([a]); // day 4, 14:00
    expect(await t.query(internal.scout.firstWeek.dueForInvite, { now: start + 3 * DAY + 10 * 3600_000 })).toEqual([]); // day 4, 22:00: too late
    await t.mutation(internal.scout.firstWeek.markStep, { creatorId: a, step: "invite_draft" });
    await t.mutation(internal.scout.firstWeek.markStep, { creatorId: a, step: "invite_draft" });
    expect(await t.query(internal.scout.firstWeek.dueForInvite, { now: start + 3 * DAY + 2 * 3600_000 })).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(a)))?.firstWeek?.stepsDone).toEqual(["first_read", "invite_draft"]);
  });
});
