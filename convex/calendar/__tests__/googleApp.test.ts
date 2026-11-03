/**
 * Google Calendar from the app (2026-11-02): people who live in Google Calendar, not the iPhone's, connect it
 * from onboarding or Settings. One calendar holds the sessions (Google, once connected), what they'd already
 * booked moves over, and the same event on both calendars is one idea.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { googleOwnsWrites } from "../device";
import { APP_RETURN, calendarRedirectUri } from "../oauth";
import { eventKey } from "../sync";
import type { Doc, Id } from "../../_generated/dataModel";

const H = 3_600_000;
let saved: string | undefined;
beforeEach(() => { saved = process.env.GOOGLE_CLIENT_ID; process.env.GOOGLE_CLIENT_ID = "client-test"; });
afterEach(() => { if (saved === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = saved; });

async function world(t: ReturnType<typeof convexTest>, suffix: string) {
  const c = await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC" }));
  const as = t.withIdentity({ subject: (await t.run((ctx) => ctx.db.get(c)))!.clerkUserId });
  return { c, as, now: Date.now() };
}
const connect = (t: ReturnType<typeof convexTest>, c: Id<"creators">, status: "connected" | "needs_reconnect" | "disconnected" = "connected") =>
  t.run((ctx) => ctx.db.insert("connections", { creatorId: c, provider: "google_calendar", status, tokenRef: "x", calendars: [], calendarIds: ["primary"], updatedAt: Date.now() } as never));

describe("connecting from the app", () => {
  it("a consent page for this creator only, bound to a one-use state that remembers the redirect and comes back to the app", async () => {
    const t = convexTest(schema, modules);
    const { c, as } = await world(t, "g1");
    const r = await as.mutation(api.calendar.oauth.connectApp, {});
    expect(r.ok).toBe(true);
    const url = new URL(r.url!);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(calendarRedirectUri());
    const state = url.searchParams.get("state")!;
    const row = (await t.run((ctx) => ctx.db.query("oauthStates").withIndex("by_token", (q) => q.eq("token", state)).unique())) as Doc<"oauthStates">;
    expect(row).toMatchObject({ creatorId: c, provider: "google", returnTo: APP_RETURN, redirectUri: calendarRedirectUri() });
    const claim = await t.mutation(internal.calendar.oauth.claimState, { token: state });
    expect(claim).toMatchObject({ creatorId: c, redirectUri: calendarRedirectUri() });
    expect(await t.mutation(internal.calendar.oauth.claimState, { token: state }), "one use").toBeNull();
  });

  it("fails closed: no sign-in, or Google not set up, is a plain no, never a link", async () => {
    const t = convexTest(schema, modules);
    expect(await t.mutation(api.calendar.oauth.connectApp, {})).toMatchObject({ ok: false });
    const { as } = await world(t, "g2");
    delete process.env.GOOGLE_CLIENT_ID;
    const r = await as.mutation(api.calendar.oauth.connectApp, {});
    expect(r.ok).toBe(false);
    expect(r.url).toBeUndefined();
    expect(r.reason).not.toMatch(/GOOGLE|CLIENT|env/);
  });

  it("the redirect is the configured one, else the site's own callback", () => {
    expect(calendarRedirectUri({ GOOGLE_CALENDAR_REDIRECT_URI: "https://x.test/cb", APP_URL: "https://y.test" })).toBe("https://x.test/cb");
    expect(calendarRedirectUri({ APP_URL: "https://staging.hey-maya.ai/" })).toBe("https://staging.hey-maya.ai/api/google-calendar/callback");
  });
});

describe("one calendar holds the sessions", () => {
  it("with Google connected the phone gets none, and the copies it wrote come off", async () => {
    const t = convexTest(schema, modules);
    const { c, as, now } = await world(t, "g3");
    const onPhone = await t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId: c, kind: "film", start: now + 24 * H, end: now + 25 * H, title: "film: night pan", status: "confirmed", consentAt: now, deviceEventId: "EV-1", createdAt: now } as never));
    expect((await as.query(api.calendar.device.plan, {}))!.write).toHaveLength(1);
    await connect(t, c);
    const p = (await as.query(api.calendar.device.plan, {}))!;
    expect(p.google).toBe(true);
    expect(p.write).toEqual([]);
    expect(p.remove).toEqual([{ id: String(onPhone), eventId: "EV-1" }]);
  });

  it("Google keeps them until they disconnect", () => {
    expect(googleOwnsWrites(null)).toBe(false);
    expect(googleOwnsWrites({ status: "connected" })).toBe(true);
    expect(googleOwnsWrites({ status: "needs_reconnect" })).toBe(true);
    expect(googleOwnsWrites({ status: "disconnected" })).toBe(false);
  });

  it("cross-tenant: another creator's Google connection never takes this one's sessions off the phone", async () => {
    const t = convexTest(schema, modules);
    const a = await world(t, "g4");
    const b = await world(t, "g5");
    await t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId: a.c, kind: "film", start: a.now + 24 * H, end: a.now + 25 * H, title: "film: x", status: "confirmed", consentAt: a.now, createdAt: a.now } as never));
    await connect(t, b.c);
    expect((await a.as.query(api.calendar.device.plan, {}))!.write).toHaveLength(1);
  });

  it("what they'd already booked is what moves to Google: their yes, ahead, not yet on Google", async () => {
    const t = convexTest(schema, modules);
    const { c, now } = await world(t, "g6");
    const ins = (over: Record<string, unknown>) => t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId: c, kind: "film", start: now + 24 * H, end: now + 25 * H, title: "film: a", status: "confirmed", consentAt: now, createdAt: now, ...over } as never));
    const move = await ins({});
    await ins({ title: "film: b", start: now + 48 * H, end: now + 49 * H, status: "proposed", consentAt: undefined });
    await ins({ title: "film: c", start: now + 72 * H, end: now + 73 * H, externalEventId: "G-1" });
    await ins({ title: "film: d", start: now - 48 * H, end: now - 47 * H });
    expect(await t.query(internal.calendar.blocks.unwritten, { creatorId: c, now })).toEqual([move]);
  });
});

describe("disconnecting", () => {
  it("her upcoming sessions leave Google and go back on the phone; past ones and other creators' are untouched", async () => {
    const t = convexTest(schema, modules);
    const { c, as, now } = await world(t, "g8");
    const other = await world(t, "g9");
    await connect(t, c);
    const ins = (creatorId: Id<"creators">, over: Record<string, unknown>) => t.run((ctx) => ctx.db.insert("calendarBlocks", { creatorId, kind: "film", start: now + 24 * H, end: now + 25 * H, title: "film: a", status: "confirmed", consentAt: now, externalEventId: "G-1", calendarId: "primary", createdAt: now, ...over } as never));
    const ahead = await ins(c, {});
    const past = await ins(c, { start: now - 48 * H, end: now - 47 * H, externalEventId: "G-0" });
    const theirs = await ins(other.c, { externalEventId: "G-9" });
    expect((await as.query(api.calendar.device.plan, {}))!.write).toEqual([]);
    expect(await as.action(api.calendar.oauth.disconnect, {})).toEqual({ ok: true });
    const get = (id: Id<"calendarBlocks">) => t.run((ctx) => ctx.db.get(id)) as Promise<Doc<"calendarBlocks">>;
    expect((await get(ahead)).externalEventId).toBeUndefined();
    expect((await get(past)).externalEventId).toBe("G-0");
    expect((await get(theirs)).externalEventId).toBe("G-9");
    const p = (await as.query(api.calendar.device.plan, {}))!;
    expect(p.google).toBe(false);
    expect(p.write.map((w) => w.id)).toEqual([String(ahead)]);
  });
});

describe("one event, one idea", () => {
  it("the same race on Google and on the phone is one calendar idea", async () => {
    const t = convexTest(schema, modules);
    const { c, now } = await world(t, "g7");
    const start = now + 5 * 24 * H;
    for (const [calendarId, externalId] of [["primary", "google-1"], ["device", "phone-1@1"]]) {
      await t.run((ctx) => ctx.db.insert("calendarEvents", { creatorId: c, calendarId, externalId, title: "Half marathon", start, end: start + 3 * H, allDay: false, recurring: false, class: "filmable", classifiedBy: "model", status: "active", updatedAt: now, createdAt: now } as never));
    }
    expect(await t.mutation(internal.calendar.sync.writeSignals, { creatorId: c, timezone: "UTC", now })).toBe(1);
    expect(await t.mutation(internal.calendar.sync.writeSignals, { creatorId: c, timezone: "UTC", now }), "and not again later").toBe(0);
    expect(eventKey({ title: " Half  Marathon ", start })).toBe(eventKey({ title: "half marathon", start }));
  });
});
