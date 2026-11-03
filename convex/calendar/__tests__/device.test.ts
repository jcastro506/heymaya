/**
 * The iPhone's own calendar: the server says which booked sessions belong on it and which come off; the
 * app reports back event ids and busy times (start and end only). Only their own blocks; nothing before
 * they said yes; a no is respected.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { cleanBusy, DEVICE } from "../device";
import { changesLine } from "../sync";
import { blockedNoGoogle, bookedNoGoogle } from "../../agent/converse";
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
  it("one block's 'block it' with no Google says it's booked, never 'couldn't write' or 'reconnect'", () => {
    expect(blockedNoGoogle("Tue Nov 4, 5:00 PM", "granted")).toMatch(/^blocked Tue Nov 4, 5:00 PM\. it goes on your calendar from the app/);
    expect(blockedNoGoogle("Tue Nov 4, 5:00 PM", "denied")).toBe("blocked Tue Nov 4, 5:00 PM, and i'll remind you before.");
    expect(blockedNoGoogle("Tue Nov 4, 5:00 PM", null, "https://staging.hey-maya.ai")).toMatch(/tap here: https:\/\/staging\.hey-maya\.ai\/app\/calendar$/);
    for (const d of ["granted", "denied", null] as const) expect(blockedNoGoogle("x", d)).not.toMatch(/couldn't|reconnect|Settings|not connected/);
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

describe("asking first: quiet hours and their own plans", () => {
  it("a session inside quiet hours or over their own event is a question first; their yes books it", async () => {
    const t = convexTest(schema, modules);
    const { c } = await world(t, "ask1");
    const day = new Date(Date.now() + 2 * 24 * H).toISOString().slice(0, 10);
    const add = (whenLocal: string, extra: Record<string, unknown> = {}) => t.action(internal.calendar.tools.write, { creatorId: c, op: "block_add", args: { kind: "film", whenLocal, minutes: 45, title: "x", ...extra } });
    const late = await add(`${day}T23:00`);
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/inside their quiet hours \(22:00–07:00\); ask/);
    expect((await add(`${day}T23:00`, { quietOk: true })).ok, "they said yes").toBe(true);
    // Their dinner, on their calendar.
    await t.run((ctx) => ctx.db.insert("calendarEvents", { creatorId: c, calendarId: "primary", externalId: "dinner", title: "Dinner with Sam", start: Date.parse(`${day}T18:00:00Z`), end: Date.parse(`${day}T20:00:00Z`), allDay: false, recurring: false, class: "filmable", classifiedBy: "code", status: "active", updatedAt: Date.now(), createdAt: Date.now() }));
    const clash = await add(`${day}T18:30`);
    expect(clash.reason).toMatch(/overlaps Dinner with Sam .*ask before double-booking/);
    expect((await add(`${day}T18:30`, { overlapOk: true })).ok).toBe(true);
    // A private event clashes too, unnamed.
    await t.run((ctx) => ctx.db.insert("calendarEvents", { creatorId: c, calendarId: "primary", externalId: "p", title: "", start: Date.parse(`${day}T09:00:00Z`), end: Date.parse(`${day}T10:00:00Z`), allDay: false, recurring: false, class: "private", classifiedBy: "code", status: "active", updatedAt: Date.now(), createdAt: Date.now() }));
    expect((await add(`${day}T09:15`)).reason).toMatch(/overlaps something private on their calendar/);
  });

  it("a rewrite never replaces an honest draft with an action no tool took", () => {
    const src = readFileSync(new URL("../../agent/converse.ts", import.meta.url), "utf8");
    expect(src).toMatch(/claimsUnsupportedAction\(rewritten, inv\.trace\) && !unsupportedAction/);
    expect(src).toMatch(/Never say you changed, booked, moved or removed anything your tools didn't actually change/);
  });
});

describe("they changed a session in their phone's Calendar app", () => {
  const followUps = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("followMoves")).map((f) => f.args[0] as { moved: Array<{ to: number }>; dropped: unknown[] }));

  it("a drag in Calendar moves the session here, and she follows up (reminders, one line)", async () => {
    const t = convexTest(schema, modules);
    const { as, block, now } = await world(t, "m1");
    const s = now + 24 * H;
    const b = await block({ status: "confirmed", consentAt: now, deviceEventId: "EV-1" });
    const r = await as.mutation(api.calendar.device.changed, { moved: [{ id: String(b), s: s + 2 * H, e: s + 3 * H, seen: s }], gone: [] });
    expect(r).toEqual({ ok: true, moved: 1, gone: 0 });
    expect(await t.run((ctx) => ctx.db.get(b))).toMatchObject({ start: s + 2 * H, end: s + 3 * H, status: "moved" });
    const f = await followUps(t);
    expect(f).toHaveLength(1);
    expect(f[0].moved[0].to).toBe(s + 2 * H);
    // The phone's next plan carries the new time, so the app writes nothing back over their drag.
    expect((await as.query(api.calendar.device.plan, {}))!.write[0]).toMatchObject({ id: String(b), start: s + 2 * H });
  });

  it("end to end: she says what she saw, once, in plain words, and the reminders move", async () => {
    const t = convexTest(schema, modules);
    const { c, as, block, now } = await world(t, "m6");
    const s = now + 24 * H;
    const moved = await block({ status: "confirmed", consentAt: now, deviceEventId: "EV-1", title: "film: night pan" });
    const gone = await block({ status: "confirmed", consentAt: now, deviceEventId: "EV-2", title: "film: closet tour", start: s + 30 * H, end: s + 31 * H });
    await as.mutation(api.calendar.device.changed, { moved: [{ id: String(moved), s: s + 2 * H, e: s + 3 * H, seen: s }], gone: [String(gone)] });
    await t.finishAllScheduledFunctions(() => undefined);
    const out = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.creatorId === c && m.direction === "out" && m.kind === "calendar"));
    const bodies = out.map((m) => m.body);
    expect(bodies, "one text for one sync's changes").toHaveLength(1);
    expect(bodies[0]).toMatch(/^saw you moved filming night pan to .+ and took filming closet tour off on your calendar/i);
    expect(bodies.every((b) => !/EV-|calendarBlocks|device/.test(b)), "no plumbing").toBe(true);
    // The same report again says nothing new.
    await as.mutation(api.calendar.device.changed, { moved: [{ id: String(moved), s: s + 2 * H, e: s + 3 * H, seen: s + 2 * H }], gone: [String(gone)] });
    await t.finishAllScheduledFunctions(() => undefined);
    const again = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.creatorId === c && m.direction === "out" && m.kind === "calendar"));
    expect(again).toHaveLength(out.length);
  });

  it("one sync's changes are one line, each said plainly", () => {
    const when = () => "friday 5 pm";
    expect(changesLine([{ title: "film: a", to: 0 }], [], when)).toBe("saw you moved filming a to friday 5 pm on your calendar. i'll follow; the check-in moves with it.");
    expect(changesLine([], [{ title: "film: b" }], when)).toMatch(/^you took filming b off your calendar/);
    expect(changesLine([{ title: "film: a", to: 0 }, { title: "post: a", to: 0 }], [{ title: "edit: c" }], when)).toBe("saw you moved filming a to friday 5 pm, moved posting a to friday 5 pm, and took editing c off on your calendar. the plan here follows, and the check-ins move with it.");
    expect(changesLine([], [], when)).toBeNull();
  });

  it("a stale phone copy never drags back a session she moved by text a moment ago", async () => {
    const t = convexTest(schema, modules);
    const { as, block, now } = await world(t, "m2");
    const s = now + 24 * H;
    const b = await block({ status: "moved", consentAt: now, deviceEventId: "EV-1", start: s + 5 * H, end: s + 6 * H });
    expect(await as.mutation(api.calendar.device.changed, { moved: [{ id: String(b), s: s + 2 * H, e: s + 3 * H, seen: s }], gone: [] })).toMatchObject({ moved: 0 });
    expect(await t.run((ctx) => ctx.db.get(b))).toMatchObject({ start: s + 5 * H });
    expect(await followUps(t)).toEqual([]);
  });

  it("deleted in Calendar: off the plan here too, once", async () => {
    const t = convexTest(schema, modules);
    const { as, block, now } = await world(t, "m3");
    const b = await block({ status: "confirmed", consentAt: now, deviceEventId: "EV-1" });
    expect(await as.mutation(api.calendar.device.changed, { moved: [], gone: [String(b)] })).toMatchObject({ gone: 1 });
    const row = await t.run((ctx) => ctx.db.get(b));
    expect(row).toMatchObject({ status: "deleted" });
    expect(row!.deviceEventId).toBeUndefined();
    expect(await as.mutation(api.calendar.device.changed, { moved: [], gone: [String(b)] }), "a second report changes nothing").toMatchObject({ gone: 0 });
    expect((await as.query(api.calendar.device.plan, {}))!.write).toEqual([]);
  });

  it("fail-closed: someone else's session, one never booked, one not on the phone, or a nonsense time is ignored", async () => {
    const t = convexTest(schema, modules);
    const a = await world(t, "m4");
    const b = await world(t, "m5");
    const s = a.now + 24 * H;
    const theirs = await b.block({ status: "confirmed", consentAt: b.now, deviceEventId: "EV-9" });
    const proposed = await a.block({ status: "proposed", deviceEventId: "EV-2" });
    const notOnPhone = await a.block({ status: "confirmed", consentAt: a.now });
    const mine = await a.block({ status: "confirmed", consentAt: a.now, deviceEventId: "EV-3" });
    const r = await a.as.mutation(api.calendar.device.changed, {
      moved: [
        { id: String(theirs), s: s + H, e: s + 2 * H, seen: s },
        { id: String(proposed), s: s + H, e: s + 2 * H, seen: s },
        { id: String(notOnPhone), s: s + H, e: s + 2 * H, seen: s },
        { id: String(mine), s: s + 2 * H, e: s + H, seen: s },
        { id: String(mine), s: s + 400 * 24 * H, e: s + 400 * 24 * H + H, seen: s },
        { id: "not-an-id", s: s + H, e: s + 2 * H, seen: s },
      ],
      gone: [String(theirs), String(proposed), String(notOnPhone), "not-an-id"],
    });
    expect(r).toEqual({ ok: true, moved: 0, gone: 0 });
    expect(await t.run((ctx) => ctx.db.get(theirs))).toMatchObject({ status: "confirmed", start: b.now + 24 * H });
    expect(await t.mutation(api.calendar.device.changed, { moved: [], gone: [String(mine)] }), "no sign-in").toMatchObject({ ok: false });
  });
});
