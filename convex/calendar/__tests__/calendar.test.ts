/**
 * Sprint 3 named tests (plan §6): a calendar write without a consent row is
 * impossible at the mutation · private-looking events never become signals and keep
 * no title · state tokens are single-use · the calendar picker is tenant-scoped ·
 * wall-clock conversion survives a timezone.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { classifyByCode } from "../sync";
import { formatLocal, zonedTimeToEpoch } from "../time";

const DAY = 86_400_000;

describe("blocks: consent is a row, not a prompt", () => {
  it("recording an external event id without consent throws and leaves the block proposed", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "America/Los_Angeles" }));
    const start = Date.now() + 3 * DAY;
    const blockId = await t.mutation(internal.calendar.blocks.propose, { creatorId, kind: "film", start, end: start + 3_600_000, title: "film: the launch" });
    await expect(t.mutation(internal.calendar.blocks.recordExternal, { blockId, externalEventId: "evt_1", calendarId: "primary" })).rejects.toThrow(/without consent/);
    const row = await t.run((ctx) => ctx.db.get(blockId));
    expect(row?.status).toBe("proposed");
    expect(row?.externalEventId).toBeUndefined();

    await t.mutation(internal.calendar.blocks.consent, { blockId });
    await t.mutation(internal.calendar.blocks.recordExternal, { blockId, externalEventId: "evt_1", calendarId: "primary" });
    const after = await t.run((ctx) => ctx.db.get(blockId));
    expect(after?.status).toBe("confirmed");
    expect(after?.consentAt).toBeTypeOf("number");
  });

  it("a block cannot end before it starts", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a"));
    await expect(t.mutation(internal.calendar.blocks.propose, { creatorId, kind: "film", start: 10, end: 5, title: "x" })).rejects.toThrow();
  });
});

describe("events: what she keeps, and what she never references", () => {
  it("classifies by code: private keywords, recurring, routine, else unknown", () => {
    expect(classifyByCode({ title: "Dr. Patel follow-up", recurring: false })).toBe("private");
    expect(classifyByCode({ title: "Therapy", recurring: false })).toBe("private");
    expect(classifyByCode({ title: "Mortgage call", recurring: false })).toBe("private");
    expect(classifyByCode({ title: "Team standup", recurring: true })).toBe("routine");
    expect(classifyByCode({ title: "Mom's birthday", recurring: false })).toBe("routine");
    expect(classifyByCode({ title: "Flight to Lisbon", recurring: false })).toBe("unknown");
  });

  it("a private event keeps no title and never becomes a signal; a filmable one two days out does, once", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { timezone: "UTC" }));
    const now = Date.now();
    const rows = [
      { calendarId: "primary", externalId: "priv", title: "Therapy with Dana", start: now + 3 * DAY, end: now + 3 * DAY + 3_600_000, allDay: false, recurring: false, cancelled: false },
      { calendarId: "primary", externalId: "trip", title: "Flight to Lisbon", start: now + 5 * DAY, end: now + 5 * DAY + 3_600_000, allDay: false, recurring: false, cancelled: false },
      { calendarId: "primary", externalId: "soon", title: "Pop-up at the market", start: now + 1 * DAY, end: now + 1 * DAY + 3_600_000, allDay: false, recurring: false, cancelled: false },
    ];
    const { unknown } = await t.mutation(internal.calendar.sync.upsertEvents, { creatorId, rows });
    expect(unknown.map((u) => u.title).sort()).toEqual(["Flight to Lisbon", "Pop-up at the market"]);
    const stored = await t.run((ctx) => ctx.db.query("calendarEvents").collect());
    const priv = stored.find((e) => e.externalId === "priv")!;
    expect(priv.class).toBe("private");
    expect(priv.title).toBe("");

    // The model says both unknowns are filmable.
    await t.mutation(internal.calendar.sync.applyClasses, { creatorId, classes: unknown.map((u) => ({ id: u.id, class: "filmable" as const })) });
    const n1 = await t.mutation(internal.calendar.sync.writeSignals, { creatorId, timezone: "UTC", now });
    expect(n1).toBe(1); // the market pop-up is tomorrow: inside the two-day rail, no signal
    const n2 = await t.mutation(internal.calendar.sync.writeSignals, { creatorId, timezone: "UTC", now });
    expect(n2).toBe(0); // never twice for the same event
    const signals = await t.run((ctx) => ctx.db.query("signals").collect());
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("calendar");
    expect(signals[0].calendarEventId).toBe("trip");
    expect(signals[0].why).toContain("Lisbon");
    expect(signals.some((s) => s.why.includes("Therapy") || s.why.includes("Dana"))).toBe(false);
  });

  it("the model cannot reclassify another creator's event", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b", { clerkUserId: "u_b2", handles: { tiktok: "tt_b2" } }));
    const now = Date.now();
    const { unknown } = await t.mutation(internal.calendar.sync.upsertEvents, { creatorId: b, rows: [{ calendarId: "primary", externalId: "x", title: "Beach day", start: now + 4 * DAY, end: now + 4 * DAY + 3600_000, allDay: true, recurring: false, cancelled: false }] });
    await t.mutation(internal.calendar.sync.applyClasses, { creatorId: a, classes: [{ id: unknown[0].id, class: "private" }] });
    const row = await t.run((ctx) => ctx.db.get(unknown[0].id));
    expect(row?.class).toBe("unknown");
  });
});

describe("oauth: the state token is the auth", () => {
  it("issues for the signed-in creator, claims once, refuses a second claim and an expired one", async () => {
    const t = convexTest(schema, modules);
    const creatorId = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a" }));
    const asA = t.withIdentity({ subject: "user_a" });
    const { token } = await asA.mutation(api.calendar.oauth.issueState, {});
    expect(await t.mutation(internal.calendar.oauth.claimState, { token })).toBe(creatorId);
    expect(await t.mutation(internal.calendar.oauth.claimState, { token })).toBeNull();
    expect(await t.mutation(internal.calendar.oauth.claimState, { token: "nope" })).toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("oauthStates", { creatorId, provider: "google", token: "old", expiresAt: Date.now() - 1, createdAt: Date.now() - 20 * 60_000 });
    });
    expect(await t.mutation(internal.calendar.oauth.claimState, { token: "old" })).toBeNull();
  });

  it("a stranger cannot issue a state token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: "nobody" }).mutation(api.calendar.oauth.issueState, {})).rejects.toThrow();
  });

  it("the calendar picker is scoped to the signed-in creator and drops deselected events", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a", { clerkUserId: "user_a" }));
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("connections", { creatorId: a, provider: "google_calendar", status: "connected", tokenRef: "enc", calendars: [{ id: "primary", name: "Me", selected: true }, { id: "work", name: "Work", selected: true }], calendarIds: ["primary", "work"], updatedAt: now });
      await ctx.db.insert("calendarEvents", { creatorId: a, calendarId: "work", externalId: "w1", title: "Offsite", start: now + 3 * DAY, end: now + 3 * DAY + 1, allDay: true, recurring: false, class: "filmable", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now });
    });
    expect(await t.withIdentity({ subject: "user_zzz" }).mutation(api.calendar.oauth.selectCalendars, { ids: ["primary"] })).toEqual({ ok: false });
    expect(await t.withIdentity({ subject: "user_a" }).mutation(api.calendar.oauth.selectCalendars, { ids: ["primary"] })).toEqual({ ok: true });
    const st = await t.withIdentity({ subject: "user_a" }).query(api.calendar.oauth.status, {});
    expect(st?.calendars.map((c) => [c.id, c.selected])).toEqual([["primary", true], ["work", false]]);
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toHaveLength(0);
  });

  it("forget drops the bundle, the calendars and every stored event", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("connections", { creatorId: a, provider: "google_calendar", status: "connected", tokenRef: "enc", calendars: [{ id: "primary", name: "Me", selected: true }], calendarIds: ["primary"], updatedAt: now });
      await ctx.db.insert("calendarEvents", { creatorId: a, calendarId: "primary", externalId: "e", title: "x", start: now, end: now + 1, allDay: false, recurring: false, class: "unknown", classifiedBy: "code", status: "active", updatedAt: now, createdAt: now });
    });
    await t.mutation(internal.calendar.oauth.forget, { creatorId: a });
    const conn = await t.run((ctx) => ctx.db.query("connections").first());
    expect(conn?.status).toBe("disconnected");
    expect(conn?.tokenRef).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("calendarEvents").collect())).toHaveLength(0);
  });
});

describe("time: their clock, not ours", () => {
  it("converts a wall-clock time in Los Angeles and formats it back", () => {
    const epoch = zonedTimeToEpoch("2026-09-09T15:00", "America/Los_Angeles");
    expect(new Date(epoch).toISOString()).toBe("2026-09-09T22:00:00.000Z"); // PDT is UTC−7
    expect(formatLocal(epoch, "America/Los_Angeles")).toMatch(/Wed, Sep 9, 3:00 PM/);
    expect(Number.isNaN(zonedTimeToEpoch("next tuesday", "America/Los_Angeles"))).toBe(true);
  });
});
