/**
 * The iPhone's own calendar (2026-10-01). The app asks once, at the moment there's something to put on
 * it, and then writes their booked sessions into whatever calendar the phone uses (iCloud, Google,
 * Outlook), with no Google sign-in and no OAuth review. It also reports when they're busy, start and
 * end only, never what the event is, so she plans around their real week. The server says what should
 * be on the calendar; the app makes it so whenever it runs and reports back the event ids.
 */
import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import { mutation } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { creatorForIdentity } from "../core/identity";
import { liveBlocks } from "./liveness";
import { eventDescription, eventSummary, ideaForEvent } from "./eventBody";

export const DEVICE = { aheadDays: 21, maxBusy: 150, maxSpanMs: 14 * 3_600_000 } as const;

async function windowBlocks(ctx: QueryCtx, creatorId: Id<"creators">, now: number): Promise<Doc<"calendarBlocks">[]> {
  return (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", creatorId).gte("start", now - 86_400_000).lte("start", now + DEVICE.aheadDays * 86_400_000)).take(200)) as Doc<"calendarBlocks">[];
}

/** What their phone's calendar should hold: every booked session ahead, and the ones to take off. */
export const plan = query({
  args: {},
  handler: async (ctx): Promise<{ status: "granted" | "denied" | null; write: Array<{ id: string; title: string; notes: string; start: number; end: number; eventId: string | null }>; remove: Array<{ id: string; eventId: string }> } | null> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return null;
    const now = Date.now();
    const all = await windowBlocks(ctx, c._id, now);
    const live = new Set((await liveBlocks(ctx, c._id, all)).map((b) => String(b._id)));
    const write = [];
    const remove = [];
    for (const b of all) {
      const keep = live.has(String(b._id)) && b.status !== "deleted" && Boolean(b.consentAt) && b.end > now;
      if (keep) {
        const idea = b.ideaId ? ((await ctx.db.get(b.ideaId)) as Doc<"ideas"> | null) : null;
        write.push({ id: String(b._id), title: eventSummary(b.kind, b.title), notes: eventDescription({ kind: b.kind, idea: ideaForEvent(idea) }), start: b.start, end: b.end, eventId: b.deviceEventId ?? null });
      } else if (b.deviceEventId) remove.push({ id: String(b._id), eventId: b.deviceEventId });
    }
    return { status: c.deviceCalendar?.status ?? null, write, remove };
  },
});

/** Their answer to the permission prompt. */
export const setStatus = mutation({
  args: { status: v.union(v.literal("granted"), v.literal("denied")) },
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false };
    await ctx.db.patch(c._id, { deviceCalendar: { ...(c.deviceCalendar ?? {}), status: a.status, at: Date.now(), ...(a.status === "denied" ? { busy: [], busyAt: Date.now() } : {}) }, updatedAt: Date.now() });
    return { ok: true };
  },
});

/** What the app wrote and removed. Only their own blocks; an unknown id is ignored. */
export const synced = mutation({
  args: { written: v.array(v.object({ id: v.string(), eventId: v.string() })), removed: v.array(v.string()) },
  handler: async (ctx, a): Promise<{ ok: boolean; updated: number }> => {
    const c = await creatorForIdentity(ctx);
    if (!c) return { ok: false, updated: 0 };
    let updated = 0;
    for (const w of a.written.slice(0, 200)) {
      const id = ctx.db.normalizeId("calendarBlocks", w.id);
      const b = id ? ((await ctx.db.get(id)) as Doc<"calendarBlocks"> | null) : null;
      if (b && b.creatorId === c._id && w.eventId.length <= 300) { await ctx.db.patch(b._id, { deviceEventId: w.eventId }); updated++; }
    }
    for (const r of a.removed.slice(0, 200)) {
      const id = ctx.db.normalizeId("calendarBlocks", r);
      const b = id ? ((await ctx.db.get(id)) as Doc<"calendarBlocks"> | null) : null;
      if (b && b.creatorId === c._id) { await ctx.db.patch(b._id, { deviceEventId: undefined }); updated++; }
    }
    return { ok: true, updated };
  },
});

/** Pure: busy times as the app reported them, kept sane. Never titles; sorted; bounded. */
export function cleanBusy(windows: Array<{ s: number; e: number }>, now: number): Array<{ s: number; e: number }> {
  return windows
    .filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e) && w.e > w.s && w.e - w.s <= DEVICE.maxSpanMs && w.e > now - 86_400_000 && w.s < now + DEVICE.aheadDays * 86_400_000)
    .sort((x, y) => x.s - y.s)
    .slice(0, DEVICE.maxBusy);
}

export const busy = mutation({
  args: { windows: v.array(v.object({ s: v.number(), e: v.number() })) },
  handler: async (ctx, a): Promise<{ ok: boolean; kept: number }> => {
    const c = await creatorForIdentity(ctx);
    if (!c || c.deviceCalendar?.status !== "granted") return { ok: false, kept: 0 };
    const kept = cleanBusy(a.windows.slice(0, 1000), Date.now());
    await ctx.db.patch(c._id, { deviceCalendar: { ...c.deviceCalendar, busy: kept, busyAt: Date.now() } });
    return { ok: true, kept: kept.length };
  },
});

/** Busy times from their phone, for the planner and her free-time list. Empty when not granted. */
export function deviceBusyOf(c: Pick<Doc<"creators">, "deviceCalendar">): Array<{ start: number; end: number }> {
  return c.deviceCalendar?.status === "granted" ? (c.deviceCalendar.busy ?? []).map((w) => ({ start: w.s, end: w.e })) : [];
}
