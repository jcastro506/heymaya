/**
 * The iPhone's own calendar: the server says which booked sessions belong on it and which come off; the
 * app reports back event ids and busy times (start and end only). Only their own blocks; nothing before
 * they said yes; a no is respected.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { cleanBusy, DEVICE } from "../device";
import { bookedNoGoogle } from "../../agent/converse";
import type { Id } from "../../_generated/dataModel";

const H = 3_600_000;
async function world(t: ReturnType<typeof convexTest>, suffix: string) {
  const c = await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC" }));
  const as = t.withIdentity({ subject: (await t.run((ctx) => ctx.db.get(c)))!.clerkUserId });
  const now = Date.now();
  const block = (over: Record<string, unknown>) => t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId: c, kind: "film", start: now + 24 * H, end: now + 25 * H, title: "film: night pan", status: "proposed", createdAt: now, ...over } as never));
  return { c, as, block, now };
}

describe("what goes on their phone's calendar", () => {
  it("booked sessions ahead go on; proposed ones don't; a dropped one with an event comes off", async () => {
    const t = convexTest(schema, modules);
    const { as, block, now } = await world(t, "d1");
    const booked = await block({ status: "confirmed", consentAt: now });
    await block({ status: "proposed" });
    const dropped = await block({ status: "deleted", consentAt: now, deviceEventId: "EV-OLD" });
    const p = (await as.query(api.calendar.device.plan, {}))!;
    expect(p.status).toBeNull();
    expect(p.write.map((w) => w.id)).toEqual([String(booked)]);
    expect(p.write[0].title).toMatch(/night pan/);
    expect(p.remove).toEqual([{ id: String(dropped), eventId: "EV-OLD" }]);
  });

  it("the app reports what it wrote; another creator's block can't be touched", async () => {
    const t = convexTest(schema, modules);
    const a = await world(t, "d2");
    const b = await world(t, "d3");
    const mine = await a.block({ status: "confirmed", consentAt: a.now });
    const theirs = await b.block({ status: "confirmed", consentAt: b.now });
    expect(await a.as.mutation(api.calendar.device.synced, { written: [{ id: String(mine), eventId: "EV1" }, { id: String(theirs), eventId: "EVX" }], removed: [] })).toEqual({ ok: true, updated: 1 });
    expect((await t.run((ctx) => ctx.db.get(mine as Id<"calendarBlocks">)))!.deviceEventId).toBe("EV1");
    expect((await t.run((ctx) => ctx.db.get(theirs as Id<"calendarBlocks">)))!.deviceEventId).toBeUndefined();
    expect((await a.as.query(api.calendar.device.plan, {}))!.write[0].eventId).toBe("EV1");
    expect(await t.query(api.calendar.device.plan, {}), "signed out").toBeNull();
  });
});

describe("busy times", () => {
  it("only after they said yes; kept sane; the planner plans around them; a no clears them", async () => {
    const t = convexTest(schema, modules);
    const { c, as, now } = await world(t, "d4");
    const meeting = { s: now + 26 * H, e: now + 27 * H };
    expect((await as.mutation(api.calendar.device.busy, { windows: [meeting] })).ok, "not asked yet").toBe(false);
    await as.mutation(api.calendar.device.setStatus, { status: "granted" });
    expect(await as.mutation(api.calendar.device.busy, { windows: [meeting, { s: now, e: now - 1 }, { s: now, e: now + 20 * H }] })).toEqual({ ok: true, kept: 1 });
    const inp = await t.query(internal.calendar.weekPlan.inputsFor, { creatorId: c, now });
    expect(inp!.busy).toContainEqual({ start: meeting.s, end: meeting.e });
    await as.mutation(api.calendar.device.setStatus, { status: "denied" });
    expect((await t.query(internal.calendar.weekPlan.inputsFor, { creatorId: c, now }))!.busy).not.toContainEqual({ start: meeting.s, end: meeting.e });
  });

  it("cleaning (pure): drops backwards, all-day-long and far-off windows; sorted and bounded", () => {
    const now = Date.UTC(2026, 9, 1, 15);
    expect(cleanBusy([{ s: now + 5 * H, e: now + 6 * H }, { s: now + H, e: now + 2 * H }, { s: now, e: now - H }, { s: now, e: now + 15 * H }, { s: now + 40 * 86_400_000, e: now + 40 * 86_400_000 + H }], now)).toEqual([{ s: now + H, e: now + 2 * H }, { s: now + 5 * H, e: now + 6 * H }]);
    expect(cleanBusy(Array.from({ length: 400 }, (_, i) => ({ s: now + i * 60_000, e: now + i * 60_000 + 30_000 })), now)).toHaveLength(DEVICE.maxBusy);
  });
});

describe("after 'book it'", () => {
  it("asks once with a link to the app, then respects the answer", () => {
    expect(bookedNoGoogle(null, "https://staging.hey-maya.ai")).toBe("booked, and i'll remind you before each one. want them on your calendar too? tap here: https://staging.hey-maya.ai/app/calendar");
    expect(bookedNoGoogle("granted")).toMatch(/go on your calendar from the app/);
    expect(bookedNoGoogle("denied")).toBe("booked, and i'll remind you before each one.");
    expect(bookedNoGoogle(null)).not.toMatch(/Settings/);
  });
});

describe("posting times are waking hours", () => {
  it("a 5am best hour is never suggested; with nothing awake, the default", async () => {
    const { nextPostTime } = await import("../postTime");
    const after = Date.UTC(2026, 9, 1, 12, 0);
    expect(nextPostTime({ hours: [{ hour: 5 } as never, { hour: 19 } as never], confidence: "some", defaultHour: 18 } as never, after, "UTC").hour).toBe(19);
    expect(nextPostTime({ hours: [{ hour: 4 } as never], confidence: "some", defaultHour: 18 } as never, after, "UTC")).toMatchObject({ hour: 18, fromHistory: false });
  });
});

describe("their iPhone's events, titles included", () => {
  it("go through the same pipeline as Google: private titles never stored, a gone event cancelled, nobody else's", async () => {
    const t = convexTest(schema, modules);
    const { c, as, now } = await world(t, "d5");
    const other = await world(t, "d6");
    const ev = (id: string, title: string, inH: number, over: Record<string, unknown> = {}) => ({ id, title, s: now + inH * H, e: now + (inH + 1) * H, allDay: false, recurring: false, ...over });
    expect((await as.mutation(api.calendar.device.events, { events: [ev("a", "x", 1)] })).ok, "not asked yet").toBe(false);
    await as.mutation(api.calendar.device.setStatus, { status: "granted" });
    expect((await as.mutation(api.calendar.device.events, { events: [ev("a", "dentist appointment", 24), ev("b", "therapy", 30), ev("c", "Half marathon", 72, { allDay: true }), ev("d", "team standup", 26, { recurring: true })] })).ok).toBe(true);
    // The ingest is scheduled; run it the way the scheduler would.
    const rows = (q: typeof c) => t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).filter((r) => r.creatorId === q));
    await t.finishAllScheduledFunctions(() => undefined);
    const mine = await rows(c);
    expect(mine.map((r) => r.externalId).sort()).toEqual(["device:a", "device:b", "device:c", "device:d"]);
    expect(mine.find((r) => r.externalId === "device:b")).toMatchObject({ class: "private", title: "" });
    expect(mine.find((r) => r.externalId === "device:d")).toMatchObject({ class: "routine", title: "team standup" });
    expect(mine.find((r) => r.externalId === "device:c")!.title).toBe("Half marathon");
    expect(await rows(other.c)).toHaveLength(0);
    // Busy times come from the same list (not the all-day race).
    const inp = await t.query(internal.calendar.weekPlan.inputsFor, { creatorId: c, now });
    expect(inp!.busy).toContainEqual({ start: now + 24 * H, end: now + 25 * H });
    // The therapy session was deleted on the phone: it's cancelled here.
    await as.mutation(api.calendar.device.events, { events: [ev("a", "dentist appointment", 24), ev("c", "Half marathon", 72, { allDay: true }), ev("d", "team standup", 26, { recurring: true })] });
    await t.finishAllScheduledFunctions(() => undefined);
    expect((await rows(c)).find((r) => r.externalId === "device:b")!.status).toBe("cancelled");
  });
});

describe("the week's name", () => {
  it("is from when the sessions fall: tomorrow is this week, not next", async () => {
    const { weekLabel } = await import("../weekPlan");
    const thu = Date.UTC(2026, 9, 1, 16); // Thursday
    const slot = (start: number) => ({ day: 0, film: { start, end: start + H }, edit: null, post: { at: start + 2 * H, hour: 18, fromHistory: false }, ideaId: null, hook: "h", experiment: false });
    expect(weekLabel([slot(thu + 24 * H)], thu, "UTC", false)).toBe("this week");
    expect(weekLabel([slot(thu + 5 * 24 * H)], thu, "UTC", false)).toBe("next week");
    expect(weekLabel([slot(thu + 24 * H)], thu, "UTC", true)).toBe("the rest of this week");
  });
});
