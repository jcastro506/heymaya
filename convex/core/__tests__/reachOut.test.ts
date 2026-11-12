/**
 * When she texts first (docs/CREATOR_REACH_OUT.md, 2026-10-09). The first tester said "stop" after two
 * filler texts the morning after a great first night. Every proactive text now has a lane and a budget,
 * held inside messages.send; what they asked for always goes.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { laneFor, reachOutHold, REACH_OUT } from "../reachOut";
import { hourInQuiet, isDue, describe as describeRoutine } from "../routines";

const H = 3_600_000, D = 24 * H;
// A Tuesday, 09:00 UTC (their clock: UTC).
const T0 = Date.UTC(2026, 9, 13, 9, 0);
const PAIRED_LONG_AGO = T0 - 30 * D;

beforeEach(() => { vi.stubEnv("MODEL_FAKE", "1"); vi.stubEnv("OPENROUTER_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("lanes (pure)", () => {
  it("what they asked for, setup, their day, her finds", () => {
    for (const k of ["routine", "reminder", "plan", "review"]) expect(laneFor(k, 10 * D), k).toBe("asked");
    expect(laneFor("hello", 10 * D)).toBe("setup");
    expect(laneFor("status", H), "an onboarding notice in the first days").toBe("setup");
    expect(laneFor("status", 10 * D), "a notice later is hers, and budgeted").toBe("hers");
    for (const k of ["morning", "shoot_today", "missed", "checkin", "saw_it", "partnership"]) expect(laneFor(k, 10 * D), k).toBe("theirs");
    for (const k of ["scout", "for_you", "milestone", "nudge", "engage", undefined, "something_new"]) expect(laneFor(k, 10 * D), String(k)).toBe("hers");
  });

  it("budgets while they're talking to her: one of hers a day, two about their day, three in all", () => {
    const base = { timezone: "UTC", pairedAt: PAIRED_LONG_AGO, lastInboundAt: T0 - 30 * 60_000 };
    expect(reachOutHold({ ...base, kind: "scout", now: T0, sent: [] })).toBeNull();
    expect(reachOutHold({ ...base, kind: "scout", now: T0, sent: [{ ts: T0 - H, kind: "for_you" }] })).toMatch(/something of hers today/);
    expect(reachOutHold({ ...base, kind: "scout", now: T0, sent: [{ ts: T0 - 20 * H, kind: "scout" }] }), "yesterday's doesn't count today, and they've written since").toBeNull();
    expect(reachOutHold({ ...base, kind: "scout", now: T0, pairedAt: T0 - 2 * D, sent: [] }), "no quiet start (2026-10-21)").toBeNull();
    expect(reachOutHold({ ...base, kind: "shoot_today", now: T0, pairedAt: T0 - 2 * D, sent: [] }), "their own shoot goes in the first days").toBeNull();
    const two = [{ ts: T0 - H, kind: "morning" }, { ts: T0 - 2 * H, kind: "checkin" }];
    expect(reachOutHold({ ...base, kind: "missed", now: T0, sent: two })).toMatch(/about their day/);
    const three = [...two, { ts: T0 - 3 * H, kind: "scout" }];
    expect(reachOutHold({ ...base, kind: "missed", now: T0, sent: three, pace: "more" })).toMatch(/3 times today/);
    for (const k of ["routine", "reminder", "plan"]) expect(reachOutHold({ ...base, kind: k, now: T0, sent: three }), k).toBeNull();
  });

  it("their pace: less is one every few days, more is two a day", () => {
    const base = { timezone: "UTC", pairedAt: PAIRED_LONG_AGO, kind: "scout", lastInboundAt: T0 - 30 * 60_000 };
    expect(reachOutHold({ ...base, now: T0, pace: "less", sent: [{ ts: T0 - 2 * D, kind: "scout" }] })).toMatch(/fewer texts/);
    expect(reachOutHold({ ...base, now: T0, pace: "less", sent: [{ ts: T0 - 3 * D - H, kind: "scout" }] })).toBeNull();
    expect(reachOutHold({ ...base, now: T0, pace: "more", sent: [{ ts: T0 - H, kind: "scout" }] })).toBeNull();
    expect(reachOutHold({ ...base, now: T0, pace: "more", sent: [{ ts: T0 - H, kind: "scout" }, { ts: T0 - 2 * H, kind: "for_you" }] })).toMatch(/2 of 2/);
  });

  it("days are theirs, not UTC: 11pm and 1am the next day are different days in Los Angeles", () => {
    const la = "America/Los_Angeles";
    const elevenPm = Date.UTC(2026, 9, 14, 6, 0); // Oct 13, 23:00 PDT
    const oneAm = Date.UTC(2026, 9, 14, 8, 0); // Oct 14, 01:00 PDT
    expect(reachOutHold({ kind: "scout", now: oneAm, timezone: la, pairedAt: PAIRED_LONG_AGO, lastInboundAt: elevenPm + 30 * 60_000, sent: [{ ts: elevenPm, kind: "scout" }] })).toBeNull();
  });
});

describe("the back-off into silence (2026-11-02): never zero", () => {
  const base = { timezone: "UTC", pairedAt: PAIRED_LONG_AGO, kind: "scout" };
  const lastIn = T0 - 20 * D;
  const at = (...days: number[]) => days.map((d) => ({ ts: T0 - d * D, kind: "scout" }));
  it("one unanswered: the next waits about a day", () => {
    expect(reachOutHold({ ...base, now: T0, lastInboundAt: lastIn, sent: at(0.5) })).toMatch(/about a day/);
    expect(reachOutHold({ ...base, now: T0, lastInboundAt: lastIn, sent: at(1) })).toBeNull();
  });
  it("two or three unanswered: one every few days", () => {
    expect(reachOutHold({ ...base, now: T0, lastInboundAt: lastIn, sent: at(4, 2) })).toMatch(/every few days/);
    expect(reachOutHold({ ...base, now: T0, lastInboundAt: lastIn, sent: at(7, 5, 3) })).toBeNull();
  });
  it("four or more: one a week, and never 'quiet until they write'", () => {
    expect(reachOutHold({ ...base, now: T0, lastInboundAt: lastIn, sent: at(17, 13, 10, 4) })).toMatch(/one a week/);
    expect(reachOutHold({ ...base, now: T0, lastInboundAt: lastIn, sent: at(19, 16, 13, 7) })).toBeNull();
    expect(reachOutHold({ ...base, kind: "partnership", now: T0, lastInboundAt: lastIn, sent: at(19, 16, 13, 7) }), "a deal is her weekly text").toBeNull();
  });
  it("Adina's week: plan, idea, nudge unanswered, then a deal and the Sunday plan still reach her", () => {
    const lastHers = Date.UTC(2026, 9, 18, 22, 7);
    const sent = [{ ts: Date.UTC(2026, 9, 18, 23), kind: "plan" }, { ts: Date.UTC(2026, 9, 20, 15), kind: "scout" }, { ts: Date.UTC(2026, 9, 23, 16, 15), kind: "ideas_waiting" }];
    expect(reachOutHold({ kind: "plan", now: Date.UTC(2026, 9, 25, 22), timezone: "America/New_York", pairedAt: Date.UTC(2026, 9, 13), sent, lastInboundAt: lastHers }), "the plan they asked for").toBeNull();
    expect(reachOutHold({ kind: "partnership", now: Date.UTC(2026, 9, 26, 18), timezone: "America/New_York", pairedAt: Date.UTC(2026, 9, 13), sent, lastInboundAt: lastHers }), "two unanswered, three days on: a deal goes").toBeNull();
  });
  it("their own stuff counts like hers once they've gone quiet", () => {
    expect(reachOutHold({ ...base, kind: "saw_it", now: T0, lastInboundAt: lastIn, sent: at(0.2) })).toMatch(/about a day/);
    expect(reachOutHold({ ...base, kind: "saw_it", now: T0, lastInboundAt: T0 - H, sent: [{ ts: T0 - 0.5 * H, kind: "scout" }] }), "while they're talking, it rides on top").toBeNull();
  });
});

describe("held inside send", () => {
  async function seed(t: ReturnType<typeof convexTest>, key: string, extra: Record<string, unknown> = {}) {
    return await t.run((ctx) => seedCreator(ctx, key, { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO }, ...extra }));
  }
  const send = (t: ReturnType<typeof convexTest>, creatorId: unknown, kind: string, key: string, ts = T0, proactive = true) =>
    t.mutation(internal.core.messages.send, { creatorId: creatorId as never, surface: "telegram", body: `${kind} text`, dedupeKey: key, proactive, kind, ts });

  it("a second idea in a day is held with a reason and nothing written; replies and routines always go", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    expect(await send(t, a, "scout", "s1")).toMatchObject({ sent: true });
    expect(await send(t, a, "for_you", "s2", T0 + H)).toMatchObject({ sent: false, messageId: null, held: expect.stringMatching(/something of hers|about a day/) });
    expect(await send(t, a, "routine", "r1", T0 + 2 * H)).toMatchObject({ sent: true });
    expect(await send(t, a, "reply", "x1", T0 + 2 * H, false)).toMatchObject({ sent: true });
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    expect(out.map((m) => m.kind).sort()).toEqual(["reply", "routine", "scout"]);
  });

  it("cross-tenant: one person's busy day holds nothing of anyone else's", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    const b = await seed(t, "b");
    await send(t, a, "scout", "s1");
    expect(await send(t, b, "scout", "s1")).toMatchObject({ sent: true });
  });

  it("day one (no quiet start): two finds of hers, a third waits; the plan goes", async () => {
    const t = convexTest(schema, modules);
    const fresh = await seed(t, "new", { channel: { paired: true, pairedAt: T0 - 2 * H } });
    expect(await send(t, fresh, "scout", "s1")).toMatchObject({ sent: true });
    expect(await send(t, fresh, "engage", "e1", T0 + 4 * H), "the later one that day").toMatchObject({ sent: true });
    expect(await send(t, fresh, "for_you", "f1", T0 + 6 * H), "not a third").toMatchObject({ sent: false, held: expect.stringMatching(/day one/) });
    expect(await send(t, fresh, "plan", "p1", T0 + 6 * H)).toMatchObject({ sent: true });
  });

  it("adversarial: an unknown or missing kind is treated as hers and budgeted, never as asked", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, "a");
    await send(t, a, "scout", "s1");
    expect(await send(t, a, "totally_new_kind", "x1", T0 + H)).toMatchObject({ sent: false });
    expect(await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "no kind", dedupeKey: "x2", proactive: true, ts: T0 + H })).toMatchObject({ sent: false });
  });
});

describe("a simulated week: how many texts she starts", () => {
  it("every one of her paths fires every hour for a week: at most one find a day, three in all, and the routine every morning", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run((ctx) => seedCreator(ctx, "week", { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO } }));
    const kinds = ["scout", "for_you", "milestone", "nudge", "morning", "checkin", "saw_it", "missed", "status"];
    for (let day = 0; day < 7; day++) {
      for (let hour = 8; hour < 21; hour++) {
        const ts = Date.UTC(2026, 9, 12 + day, hour, 0);
        for (const k of kinds) await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: `${k} ${day} ${hour}`, dedupeKey: `${k}:${day}:${hour}`, proactive: true, kind: k, ts });
        if (hour === 9) await t.mutation(internal.core.messages.send, { creatorId: c, surface: "telegram", body: "your 3 ideas", dedupeKey: `routine:${day}`, proactive: true, kind: "routine", ts });
      }
    }
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out");
    const byDay = new Map<number, typeof out>();
    for (const m of out) { const d = new Date(m.ts).getUTCDate(); byDay.set(d, [...(byDay.get(d) ?? []), m]); }
    expect(byDay.size).toBe(7);
    for (const [d, ms] of byDay) {
      const started = ms.filter((m) => m.kind !== "routine");
      expect(started.length, `day ${d}: ${started.map((m) => m.kind).join(", ")}`).toBeLessThanOrEqual(REACH_OUT.startedPerDay);
      expect(started.filter((m) => laneFor(m.kind, 10 * D) === "hers").length, `day ${d}`).toBeLessThanOrEqual(1);
      expect(ms.filter((m) => m.kind === "routine"), `day ${d}: the routine they asked for`).toHaveLength(1);
    }
    // Before: every path on its own timer would have sent 9 kinds × 13 hours a day.
    expect(out.length).toBeLessThanOrEqual(7 * (REACH_OUT.startedPerDay + 1));
  });
});

describe("routines (pure)", () => {
  const r = { id: "r1", what: "3 ideas", hour: 9, days: "weekdays" as const, createdAt: 0 };
  it("is due at its hour on their clock, on its days, once a day", () => {
    expect(isDue(r, T0, "UTC")).toBe(true); // Tuesday 9:00
    expect(isDue(r, T0 + H, "UTC")).toBe(false);
    expect(isDue({ ...r, lastRunDay: "2026-10-13" }, T0, "UTC")).toBe(false);
    expect(isDue(r, Date.UTC(2026, 9, 17, 9), "UTC"), "saturday").toBe(false);
    expect(isDue({ ...r, days: "weekly", weekday: 2 }, T0, "UTC")).toBe(true);
    expect(isDue({ ...r, days: "weekly", weekday: 3 }, T0, "UTC")).toBe(false);
    expect(isDue(r, Date.UTC(2026, 9, 13, 16), "America/Los_Angeles"), "9am in LA").toBe(true);
  });
  it("quiet windows wrap midnight; descriptions read like her", () => {
    expect(hourInQuiet(23, { start: "22:00", end: "07:00" })).toBe(true);
    expect(hourInQuiet(6, { start: "22:00", end: "07:00" })).toBe(true);
    expect(hourInQuiet(7, { start: "22:00", end: "07:00" })).toBe(false);
    expect(hourInQuiet(13, { start: "12:00", end: "14:00" })).toBe(true);
    expect(describeRoutine(r)).toBe("weekdays at 9am: 3 ideas");
    expect(describeRoutine({ ...r, hour: 12, days: "daily" })).toBe("every day at 12pm: 3 ideas");
  });
});

describe("routines on rows", () => {
  it("add validates (hour, quiet hours, the cap, empty), stop removes only theirs", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "ra", { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO } }));
    const b = await t.run((ctx) => seedCreator(ctx, "rb", { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO } }));
    expect(await t.mutation(internal.core.routines.add, { creatorId: a, what: "", hour: 9, days: "daily" })).toMatchObject({ ok: false });
    expect(await t.mutation(internal.core.routines.add, { creatorId: a, what: "ideas", hour: 25, days: "daily" })).toMatchObject({ ok: false });
    expect(await t.mutation(internal.core.routines.add, { creatorId: a, what: "ideas", hour: 23, days: "daily" })).toMatchObject({ ok: false, body: expect.stringMatching(/quiet hours/) });
    expect(await t.mutation(internal.core.routines.add, { creatorId: a, what: "ideas", hour: 9, days: "weekly" })).toMatchObject({ ok: false, body: expect.stringMatching(/weekday/) });
    const ok = await t.mutation(internal.core.routines.add, { creatorId: a, what: "x".repeat(500), hour: 9, days: "daily" });
    expect(ok).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) await t.mutation(internal.core.routines.add, { creatorId: a, what: `r${i}`, hour: 10 + i, days: "daily" });
    expect(await t.mutation(internal.core.routines.add, { creatorId: a, what: "one too many", hour: 18, days: "daily" })).toMatchObject({ ok: false, body: expect.stringMatching(/stop one first/) });
    const row = (await t.run((ctx) => ctx.db.get(a)))!;
    expect(row.routines).toHaveLength(5);
    expect(row.routines![0].what.length).toBeLessThanOrEqual(200);
    // The schedule row carries the hours, so the hourly pass reads no creator rows.
    const sched = (await t.run((ctx) => ctx.db.query("schedule").collect())).find((s) => s.creatorId === a);
    expect(sched?.routineHours).toEqual([9, 10, 11, 12, 13]);
    // Cross-tenant: b can't stop a's routine by id.
    expect(await t.mutation(internal.core.routines.stop, { creatorId: b, id: ok.id! })).toMatchObject({ ok: false });
    expect(await t.mutation(internal.core.routines.stop, { creatorId: a, id: ok.id! })).toMatchObject({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(a)))!.routines).toHaveLength(4);
  });

  it("the hourly pass runs a due routine once, as asked, past a day she already used up; paused people get nothing", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "run", { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO } }));
    const p = await t.run((ctx) => seedCreator(ctx, "paused", { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO }, messagingPausedAt: T0 - D }));
    for (const c of [a, p]) await t.mutation(internal.core.routines.add, { creatorId: c, what: "3 ideas for today", hour: 9, days: "daily" });
    // She already used today's budget on her own find.
    await t.mutation(internal.core.messages.send, { creatorId: a, surface: "telegram", body: "an idea", dedupeKey: "s1", proactive: true, kind: "scout", ts: T0 - 30 * 60_000 });
    expect(await t.action(internal.core.routines.runAll, { now: T0 })).toEqual({ ran: 1 });
    await t.finishAllScheduledFunctions(() => undefined);
    expect(await t.action(internal.core.routines.runAll, { now: T0 + 10 * 60_000 }), "claimed once").toEqual({ ran: 0 });
    const out = (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.direction === "out" && m.kind === "routine");
    expect(out).toHaveLength(1);
    expect(out[0].creatorId).toBe(a);
    expect(out[0].body).toMatch(/three for today/i);
  });

  it("her settings change only in answer to their own message", async () => {
    const { REPLY_ONLY_TOOLS, runTool, DEFAULT_BUDGET } = await import("../../agent/tools");
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "tool", { timezone: "UTC", channel: { paired: true, pairedAt: PAIRED_LONG_AGO } }));
    expect([...REPLY_ONLY_TOOLS].sort()).toEqual(["idea_add", "pause_texts", "routine_add", "routine_stop", "texting_pace", "week_plans"]);
    const out = await t.action(async (ctx) => runTool(ctx as never, a, { name: "texting_pace", args: { pace: "less", why: "x" } }, DEFAULT_BUDGET(), [], undefined));
    expect(out).toMatch(/refused/);
    expect((await t.run((ctx) => ctx.db.get(a)))!.textFirstPace).toBeUndefined();
  });
});

describe("drafting for someone who isn't reading (2026-11-02)", () => {
  it("a new idea every few days, not daily, once ideas go unopened and texts unanswered", async () => {
    const { notReadingHold } = await import("../../scout/scout");
    expect(notReadingHold({ lastSeenAt: null, unanswered: 3, lastDraftAt: T0 - D, now: T0 })).toMatch(/every few days/);
    expect(notReadingHold({ lastSeenAt: null, unanswered: 3, lastDraftAt: T0 - 3 * D, now: T0 })).toBeNull();
    expect(notReadingHold({ lastSeenAt: T0 - 2 * D, unanswered: 3, lastDraftAt: T0 - D, now: T0 }), "they opened one this week").toBeNull();
    expect(notReadingHold({ lastSeenAt: null, unanswered: 1, lastDraftAt: T0 - D, now: T0 }), "still answering").toBeNull();
  });
});
