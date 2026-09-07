/**
 * Plan §17.9 edge-case scripts: the world changes under her, and her rows and her words
 * follow. On the fake model where judgment is not the point.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { atLocalHour } from "../postTime";
import { offerText } from "../secure";

const TZ = "America/New_York";
const THU_6PM = atLocalHour(Date.UTC(2026, 8, 10, 12, 0), 18, TZ);

async function bookedBlockOnEvent(t: ReturnType<typeof convexTest>) {
  const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: TZ, channel: { paired: true }, plan: { status: "active", founding: true } }));
  const now = Date.now();
  await t.run((ctx) => ctx.db.insert("calendarEvents", { creatorId, calendarId: "primary", externalId: "ev1", title: "film: running clip", start: THU_6PM, end: THU_6PM + 45 * 60_000, allDay: false, recurring: false, class: "routine", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now }));
  const blockId = await t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId, kind: "film", start: THU_6PM, end: THU_6PM + 45 * 60_000, title: "film: running clip", status: "confirmed", consentAt: now, externalEventId: "ev1", calendarId: "primary", createdAt: now }));
  return { creatorId, blockId };
}

describe("script 1: the calendar moves under her", () => {
  it("an event moved an hour later moves the block, keeps its length, and she says so once", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, blockId } = await bookedBlockOnEvent(t);
    const r = await t.mutation(internal.calendar.sync.upsertEvents, { creatorId, rows: [{ calendarId: "primary", externalId: "ev1", title: "film: running clip", start: THU_6PM + 3_600_000, end: THU_6PM + 3_600_000 + 45 * 60_000, allDay: false, recurring: false, cancelled: false }] });
    expect(r.moved.length).toBe(1);
    expect(r.moved[0].blockId).toBe(blockId);
    const b = await t.run((ctx) => ctx.db.get(blockId));
    expect(b?.start).toBe(THU_6PM + 3_600_000);
    expect(b!.end - b!.start).toBe(45 * 60_000);
    expect(b?.status).toBe("moved");
    await t.action(internal.calendar.sync.followMoves, { creatorId, moved: r.moved, dropped: r.dropped });
    await t.action(internal.calendar.sync.followMoves, { creatorId, moved: r.moved, dropped: r.dropped });
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out.length, "once, not twice").toBe(1);
    expect(out[0].body).toMatch(/saw you moved filming running clip to thursday 7 pm/);
    expect(out[0].body).toMatch(/check-in moves with it/);
    // An unchanged sync says nothing.
    const again = await t.mutation(internal.calendar.sync.upsertEvents, { creatorId, rows: [{ calendarId: "primary", externalId: "ev1", title: "film: running clip", start: THU_6PM + 3_600_000, end: THU_6PM + 3_600_000 + 45 * 60_000, allDay: false, recurring: false, cancelled: false }] });
    expect(again.moved.length).toBe(0);
  });

  it("an event removed drops the block and she says so, without a question", async () => {
    const t = convexTest(schema, modules);
    const { creatorId, blockId } = await bookedBlockOnEvent(t);
    const r = await t.mutation(internal.calendar.sync.upsertEvents, { creatorId, rows: [{ calendarId: "primary", externalId: "ev1", title: "film: running clip", start: THU_6PM, end: THU_6PM + 45 * 60_000, allDay: false, recurring: false, cancelled: true }] });
    expect(r.dropped.length).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(blockId)))?.status).toBe("deleted");
    await t.action(internal.calendar.sync.followMoves, { creatorId, moved: r.moved, dropped: r.dropped });
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out[0].body).toMatch(/off your calendar, so it's off the plan here too/);
    expect(out[0].body.trim().endsWith("?")).toBe(false);
  });
});

describe("urgency picks the window and the offer says why", () => {
  it("a stale-in-days idea leads with it; an evergreen one does not", () => {
    const now = atLocalHour(Date.UTC(2026, 8, 7, 12, 0), 10, TZ);
    const today5 = atLocalHour(now, 17, TZ);
    expect(offerText(today5, TZ, "the tier list", { urgency: "now", why: "the default filming hour until they name theirs", now })).toBe('this one goes stale in a few days, so today 5 pm is free for "the tier list" (the default filming hour until they name theirs). block it and i\'ll remind you before?');
    expect(offerText(today5 + 3 * 86_400_000, TZ, "the tier list", { urgency: "any", now })).toMatch(/^thursday 5 pm is free/);
  });
});
