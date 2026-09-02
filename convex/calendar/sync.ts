/**
 * The calendar read (plan §12.5, §13.8 calendar rail). Every 30 minutes, for every
 * connected calendar: the next fourteen days, classified, stored as the five fields
 * we keep, and a `calendar` signal for each filmable event at least two days out.
 *
 * Classification is code first (private keywords → `private`, recurring → `routine`)
 * and the screener model for the rest. A private event keeps no title and is never
 * referenced anywhere. Maya's own blocks are recognised by their extended property
 * and skipped, so she never proposes filming around her own filming block.
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { callModel } from "../core/llm";
import { REGISTRY } from "../agent/registry";
import { THRESHOLDS } from "../config/thresholds";
import { ensureAccessToken } from "./oauth";
import { eventBounds, listEvents, MAYA_EVENT_PROPERTY } from "../integrations/google/calendar";
import { formatLocal } from "./time";

const LOOKBACK_MS = 24 * 3600 * 1000;
const HORIZON_MS = 14 * 24 * 3600 * 1000;
const MIN_LEAD_MS = 2 * 24 * 3600 * 1000; // the rail: a calendar idea needs two days of runway

export type EventClass = Doc<"calendarEvents">["class"];

const PRIVATE_RE = /\b(doctor|dr|dentist|therap\w*|clinic|hospital|medical|surgery|lawyer|attorney|court|bank|loan|mortgage|tax(es)?|accountant|hr|performance review|interview|salary|payroll|rehab|pharmacy|prescription|gyn\w*|urolog\w*|psychiat\w*|counsel\w*|divorce|custody|funeral|std|hiv|pregnan\w*|ivf)\b/i;
const ROUTINE_RE = /\b(birthday|holiday|out of office|ooo|pay ?day|rent|gym|workout|laundry|groceries|standup|stand-up|1:1|one on one|sync|check-?in|dentist)\b/i;

/** The code half of classification. `unknown` goes to the model. */
export function classifyByCode(input: { title: string; recurring: boolean }): EventClass {
  if (PRIVATE_RE.test(input.title)) return "private";
  if (input.recurring || ROUTINE_RE.test(input.title)) return "routine";
  return "unknown";
}

export const connectedCreators = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"creators">[]> => {
    const rows = (await ctx.db.query("connections").filter((q) => q.and(q.eq(q.field("provider"), "google_calendar"), q.eq(q.field("status"), "connected"))).collect()) as Doc<"connections">[];
    return rows.map((r) => r.creatorId);
  },
});

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.calendar.sync.connectedCreators, {});
    for (const creatorId of ids) await ctx.scheduler.runAfter(0, internal.calendar.sync.syncOne, { creatorId });
    return { scheduled: ids.length };
  },
});

export const syncOne = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; events?: number; signals?: number }> => {
    const conn = await ctx.runQuery(internal.calendar.oauth.connection, { creatorId: a.creatorId });
    if (!conn || conn.status !== "connected") return { ok: false, reason: "not connected" };
    const creator = await ctx.runQuery(internal.calendar.sync.creatorTz, { creatorId: a.creatorId });
    if (!creator) return { ok: false, reason: "creator not found" };
    let token: string;
    try {
      token = await ensureAccessToken(ctx, conn);
    } catch (e) {
      return { ok: false, reason: `token: ${e instanceof Error ? e.message : String(e)}` };
    }
    const now = Date.now();
    const timeMin = new Date(now - LOOKBACK_MS).toISOString();
    const timeMax = new Date(now + HORIZON_MS).toISOString();
    const rows: Array<{ calendarId: string; externalId: string; title: string; htmlLink?: string; start: number; end: number; allDay: boolean; recurring: boolean; cancelled: boolean }> = [];
    for (const calendarId of conn.calendarIds ?? ["primary"]) {
      let pageToken: string | undefined;
      try {
        do {
          const page = await listEvents(token, { calendarId, timeMin, timeMax, pageToken });
          for (const ev of page.items) {
            if (ev.extendedProperties?.private?.maya === MAYA_EVENT_PROPERTY.maya) continue; // hers
            const b = eventBounds(ev);
            if (!b) continue;
            rows.push({ calendarId, externalId: ev.id, title: (ev.summary ?? "").slice(0, 120), htmlLink: ev.htmlLink, ...b, recurring: Boolean(ev.recurringEventId), cancelled: ev.status === "cancelled" });
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (e) {
        await ctx.runMutation(internal.calendar.oauth.patchConnection, { id: conn._id, status: "attention", detail: `Couldn't read "${calendarId}": ${e instanceof Error ? e.message.slice(0, 80) : "error"}` });
        return { ok: false, reason: "list failed" };
      }
    }

    const { unknown } = await ctx.runMutation(internal.calendar.sync.upsertEvents, { creatorId: a.creatorId, rows });

    // The model half: only titles code could not place, in one cheap call.
    if (unknown.length > 0) {
      const spec = REGISTRY.screener;
      const r = await callModel(ctx, {
        creatorId: a.creatorId,
        purpose: "calendar_classify",
        model: spec.primary,
        messages: [
          { role: "system", content: `You sort a content creator's calendar titles. For each, answer one of: "filmable" (an outing, trip, event, launch, milestone, collaboration, anything a short video could ride), "routine" (life admin, meetings, chores, appointments with no story), "private" (health, legal, money, HR, relationships; when in doubt, private). Output ONLY JSON: [{"id": "", "class": ""}]` },
          { role: "user", content: JSON.stringify(unknown.map((u) => ({ id: u.id, title: u.title }))) },
        ],
        temperature: 0,
        maxTokens: 600,
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
      });
      const classes: Array<{ id: Id<"calendarEvents">; class: EventClass }> = [];
      if (r.ok) {
        try {
          const m = r.content.match(/\[[\s\S]*\]/);
          for (const x of JSON.parse(m ? m[0] : "[]") as Array<{ id: string; class: string }>) {
            if (x.class === "filmable" || x.class === "routine" || x.class === "private") classes.push({ id: x.id as Id<"calendarEvents">, class: x.class });
          }
        } catch {
          /* leave unknown; the next sync tries again */
        }
      }
      if (classes.length) await ctx.runMutation(internal.calendar.sync.applyClasses, { creatorId: a.creatorId, classes });
    }

    const signals = await ctx.runMutation(internal.calendar.sync.writeSignals, { creatorId: a.creatorId, timezone: creator.timezone, now });
    await ctx.runMutation(internal.calendar.oauth.patchConnection, { id: conn._id, lastSyncedAt: now, status: "connected", detail: undefined });
    return { ok: true, events: rows.length, signals };
  },
});

export const creatorTz = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, a): Promise<{ timezone: string } | null> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    return c ? { timezone: c.timezone } : null;
  },
});

/** Upsert by (creator, externalId). Private rows keep no title. Returns the rows still `unknown`. */
export const upsertEvents = internalMutation({
  args: {
    creatorId: v.id("creators"),
    rows: v.array(v.object({ calendarId: v.string(), externalId: v.string(), title: v.string(), htmlLink: v.optional(v.string()), start: v.number(), end: v.number(), allDay: v.boolean(), recurring: v.boolean(), cancelled: v.boolean() })),
  },
  handler: async (ctx, a): Promise<{ unknown: Array<{ id: Id<"calendarEvents">; title: string }> }> => {
    const now = Date.now();
    const unknown: Array<{ id: Id<"calendarEvents">; title: string }> = [];
    for (const r of a.rows) {
      const existing = (await ctx.db.query("calendarEvents").withIndex("by_creator_external", (q) => q.eq("creatorId", a.creatorId).eq("externalId", r.externalId)).first()) as Doc<"calendarEvents"> | null;
      const cls = existing && existing.classifiedBy === "model" && existing.title === r.title ? existing.class : classifyByCode({ title: r.title, recurring: r.recurring });
      const title = cls === "private" ? "" : r.title;
      const status = r.cancelled ? ("cancelled" as const) : ("active" as const);
      if (existing) {
        await ctx.db.patch(existing._id, { title, htmlLink: r.htmlLink, start: r.start, end: r.end, allDay: r.allDay, recurring: r.recurring, class: cls, classifiedBy: cls === existing.class ? existing.classifiedBy : "code", status, updatedAt: now });
        if (cls === "unknown" && status === "active") unknown.push({ id: existing._id, title: r.title });
      } else {
        const id = await ctx.db.insert("calendarEvents", { creatorId: a.creatorId, calendarId: r.calendarId, externalId: r.externalId, title, htmlLink: r.htmlLink, start: r.start, end: r.end, allDay: r.allDay, recurring: r.recurring, class: cls, classifiedBy: "code", status, updatedAt: now, createdAt: now });
        if (cls === "unknown" && status === "active") unknown.push({ id, title: r.title });
      }
    }
    return { unknown };
  },
});

export const applyClasses = internalMutation({
  args: { creatorId: v.id("creators"), classes: v.array(v.object({ id: v.id("calendarEvents"), class: v.union(v.literal("filmable"), v.literal("private"), v.literal("routine"), v.literal("unknown")) })) },
  handler: async (ctx, a): Promise<null> => {
    for (const x of a.classes) {
      const row = (await ctx.db.get(x.id)) as Doc<"calendarEvents"> | null;
      if (!row || row.creatorId !== a.creatorId) continue; // never cross a tenant on a model's say-so
      await ctx.db.patch(x.id, { class: x.class, classifiedBy: "model", title: x.class === "private" ? "" : row.title, updatedAt: Date.now() });
    }
    return null;
  },
});

/** One `calendar` signal per filmable event with two days of runway; never twice for the same event. */
export const writeSignals = internalMutation({
  args: { creatorId: v.id("creators"), timezone: v.string(), now: v.number() },
  handler: async (ctx, a): Promise<number> => {
    const events = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now + MIN_LEAD_MS).lte("start", a.now + HORIZON_MS)).collect()) as Doc<"calendarEvents">[];
    const filmable = events.filter((e) => e.class === "filmable" && e.status === "active" && e.title);
    if (filmable.length === 0) return 0;
    const existing = (await ctx.db.query("signals").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId)).order("desc").take(300)) as Doc<"signals">[];
    const seen = new Set(existing.filter((s) => s.kind === "calendar" && s.calendarEventId).map((s) => s.calendarEventId as string));
    let n = 0;
    for (const e of filmable) {
      if (seen.has(e.externalId)) continue;
      const daysOut = Math.round((e.start - a.now) / 86_400_000);
      await ctx.db.insert("signals", {
        creatorId: a.creatorId,
        kind: "calendar",
        sourcePostIds: [`cal:${e.externalId}`],
        calendarEventId: e.externalId,
        score: Math.max(1, 14 - daysOut) / 14 + 1, // sooner sorts higher, and above the 1× breakout floor
        corroboration: { accounts: 0, soundRising: false },
        verdict: "pending",
        why: `their calendar: "${e.title}" ${e.allDay ? "on" : "at"} ${formatLocal(e.start, a.timezone, { withTime: !e.allDay })} (${daysOut} days out); ${e.htmlLink ?? ""}`.trim(),
        thresholdsVersion: THRESHOLDS.version,
        createdAt: a.now,
      });
      n++;
    }
    return n;
  },
});

/** Plan tab and the scout's context: what is on their calendar in the next two weeks, minus private. */
export const upcoming = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Array<{ externalId: string; title: string; start: number; end: number; allDay: boolean; class: EventClass; htmlLink: string | null }>> => {
    const rows = (await ctx.db.query("calendarEvents").withIndex("by_creator_start", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now).lte("start", a.now + HORIZON_MS)).collect()) as Doc<"calendarEvents">[];
    return rows.filter((r) => r.status === "active" && r.class !== "private").map((r) => ({ externalId: r.externalId, title: r.title, start: r.start, end: r.end, allDay: r.allDay, class: r.class, htmlLink: r.htmlLink ?? null }));
  },
});
