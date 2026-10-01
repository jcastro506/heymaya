/**
 * A fake Google Calendar v3 (2026-10-01), served by our own HTTP router so the real calendar code
 * (sync, confirm, move, drop, edit-patch) runs end to end in a sim. Same rules as the other fakes
 * (eval/fakes.ts): it answers only with EVAL_FAKES=1 on a local deployment, and a deployment reaches
 * it only through GOOGLE_CALENDAR_BASE_URL pointing at itself. State per calendar id in syncState, so a
 * sim can plant their life ("half marathon saturday") and read back exactly what she wrote.
 */
import { v } from "convex/values";
import { httpAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { internal } from "../_generated/api";

const fakesOn = () => process.env.EVAL_FAKES === "1" && process.env.ENVIRONMENT_NAME === "local";
const keyFor = (calendarId: string) => `eval:fake_gcal:${calendarId}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export type FakeEvent = { id: string; summary: string; description?: string; start: string; end: string; status: "confirmed" | "cancelled"; maya: boolean; recurring?: boolean; updated: number };

export const read = internalQuery({
  args: { calendarId: v.string() },
  handler: async (ctx, a): Promise<FakeEvent[]> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.calendarId))).unique();
    return row ? (JSON.parse(row.value) as FakeEvent[]) : [];
  },
});

export const write = internalMutation({
  args: { calendarId: v.string(), events: v.any() },
  handler: async (ctx, a): Promise<null> => {
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.calendarId))).unique();
    const value = JSON.stringify(a.events);
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key: keyFor(a.calendarId), value, updatedAt: Date.now() });
    return null;
  },
});

/** A sim plants their own events (not hers): the life she should plan around and film. */
export const plant = internalMutation({
  args: { calendarId: v.string(), events: v.array(v.object({ summary: v.string(), start: v.number(), end: v.number(), recurring: v.optional(v.boolean()) })) },
  handler: async (ctx, a): Promise<string[]> => {
    if (!fakesOn()) throw new Error("fakes are off");
    const row = await ctx.db.query("syncState").withIndex("by_key", (q) => q.eq("key", keyFor(a.calendarId))).unique();
    const have = row ? (JSON.parse(row.value) as FakeEvent[]) : [];
    const ids: string[] = [];
    for (const e of a.events) {
      const id = `life${have.length + ids.length}x${Date.now().toString(36)}`;
      ids.push(id);
      have.push({ id, summary: e.summary, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), status: "confirmed", maya: false, recurring: e.recurring, updated: Date.now() });
    }
    const value = JSON.stringify(have);
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() }); else await ctx.db.insert("syncState", { key: keyFor(a.calendarId), value, updatedAt: Date.now() });
    return ids;
  },
});

/** Pure: the calendar API's view of one fake event. */
export function asGoogle(e: FakeEvent): Record<string, unknown> {
  return { id: e.id, status: e.status, summary: e.summary, description: e.description, start: { dateTime: e.start }, end: { dateTime: e.end }, htmlLink: `https://calendar.google.com/fake/${e.id}`, updated: new Date(e.updated).toISOString(), ...(e.recurring ? { recurringEventId: `r-${e.id}` } : {}), ...(e.maya ? { extendedProperties: { private: { maya: "block" } } } : {}) };
}

export const gcal = httpAction(async (ctx, req) => {
  if (!fakesOn()) return json({ error: "fakes are off" }, 404);
  const url = new URL(req.url);
  const m = url.pathname.match(/\/fake\/gcal\/(?:calendar\/v3\/)?(users\/me\/calendarList|calendars\/([^/]+)\/events(?:\/([^/]+))?)$/);
  if (!m) return json({ error: "unknown path" }, 404);
  if (m[1] === "users/me/calendarList") return json({ items: [{ id: "primary", summary: "Primary", primary: true, accessRole: "owner", selected: true }] });
  const calendarId = decodeURIComponent(m[2]);
  const eventId = m[3] ? decodeURIComponent(m[3]) : null;
  const events = await ctx.runQuery(internal.eval.fakeGoogle.read, { calendarId });
  const save = (next: FakeEvent[]) => ctx.runMutation(internal.eval.fakeGoogle.write, { calendarId, events: next });
  const dt = (t?: { dateTime?: string }) => (t?.dateTime ? new Date(t.dateTime).toISOString() : "");
  if (req.method === "GET" && !eventId) {
    const min = Date.parse(url.searchParams.get("timeMin") ?? "1970-01-01");
    const max = Date.parse(url.searchParams.get("timeMax") ?? "2999-01-01");
    return json({ items: events.filter((e) => Date.parse(e.end) > min && Date.parse(e.start) < max).sort((x, y) => Date.parse(x.start) - Date.parse(y.start)).map(asGoogle), timeZone: "UTC" });
  }
  if (req.method === "POST" && !eventId) {
    const b = (await req.json()) as { summary?: string; description?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; extendedProperties?: { private?: Record<string, string> } };
    const ev: FakeEvent = { id: `maya${events.length}x${Date.now().toString(36)}`, summary: b.summary ?? "", description: b.description, start: dt(b.start), end: dt(b.end), status: "confirmed", maya: b.extendedProperties?.private?.maya === "block", updated: Date.now() };
    await save([...events, ev]);
    return json(asGoogle(ev));
  }
  const i = events.findIndex((e) => e.id === eventId);
  if (i < 0 || events[i].status === "cancelled") return json({ error: "not found" }, req.method === "DELETE" ? 410 : 404);
  if (req.method === "PATCH") {
    const b = (await req.json()) as { summary?: string; description?: string; start?: { dateTime?: string }; end?: { dateTime?: string } };
    const ev = { ...events[i], ...(b.summary !== undefined ? { summary: b.summary } : {}), ...(b.description !== undefined ? { description: b.description } : {}), ...(b.start ? { start: dt(b.start) } : {}), ...(b.end ? { end: dt(b.end) } : {}), updated: Date.now() };
    await save(events.map((e, k) => (k === i ? ev : e)));
    return json(asGoogle(ev));
  }
  if (req.method === "DELETE") {
    await save(events.map((e, k) => (k === i ? { ...e, status: "cancelled" as const, updated: Date.now() } : e)));
    return new Response(null, { status: 204 });
  }
  return json({ error: "method" }, 405);
});
