/**
 * Filming blocks (plan §12.5, §11.3 `calendar` tool). `propose` never writes to
 * Google. The write happens only after the creator's explicit yes, and the mutation
 * that records an external event id refuses without a `consentAt`: the named test
 * "calendar write without a consent row is impossible" lives at that mutation, not
 * in a prompt. Every event Maya writes carries her marker and is reversible.
 */

import { v } from "convex/values";
import { eventDescription, eventSummary, ideaForEvent } from "./eventBody";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { ensureAccessToken } from "./oauth";
import { createEvent, deleteEvent, patchEvent } from "../integrations/google/calendar";
import { formatLocal } from "./time";

const KIND = v.union(v.literal("film"), v.literal("edit"), v.literal("post"));

export const propose = internalMutation({
  args: { creatorId: v.id("creators"), kind: KIND, start: v.number(), end: v.number(), title: v.string(), ideaId: v.optional(v.id("ideas")) },
  handler: async (ctx, a): Promise<Id<"calendarBlocks">> => {
    if (!(a.end > a.start)) throw new Error("block must end after it starts");
    return await ctx.db.insert("calendarBlocks", { creatorId: a.creatorId, kind: a.kind, start: a.start, end: a.end, title: a.title.slice(0, 80), ideaId: a.ideaId, status: "proposed", createdAt: Date.now() });
  },
});

export const byId = internalQuery({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<Doc<"calendarBlocks"> | null> => (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null,
});

/** What the event should say: the block's idea and the creator's clock. */
export const eventContext = internalQuery({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<{ idea: Doc<"ideas"> | null; timezone: string } | null> => {
    const b = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!b) return null;
    const idea = b.ideaId ? ((await ctx.db.get(b.ideaId)) as Doc<"ideas"> | null) : null;
    const c = (await ctx.db.get(b.creatorId)) as Doc<"creators"> | null;
    return { idea: idea && idea.creatorId === b.creatorId ? idea : null, timezone: c?.timezone ?? "UTC" };
  },
});

/** The live events for an idea: booked, written to Google, not deleted. */
export const liveForIdea = internalQuery({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas") },
  handler: async (ctx, a): Promise<Doc<"calendarBlocks">[]> => {
    const rows = (await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", Date.now() - 30 * 86_400_000)).collect()) as Doc<"calendarBlocks">[];
    return rows.filter((b) => b.ideaId === a.ideaId && b.consentAt && b.externalEventId && b.status !== "deleted");
  },
});

/**
 * The idea changed (a hook edited by text, a shot list written): every event booked for it gets
 * the new words. Times untouched. Best effort per event; a failure is a named reason, never a throw.
 */
export const refreshForIdea = internalAction({
  args: { creatorId: v.id("creators"), ideaId: v.id("ideas") },
  handler: async (ctx, a): Promise<{ refreshed: number; reason?: string }> => {
    const blocks = await ctx.runQuery(internal.calendar.blocks.liveForIdea, { creatorId: a.creatorId, ideaId: a.ideaId });
    if (!blocks.length) return { refreshed: 0, reason: "no booked event for this idea" };
    const conn = await ctx.runQuery(internal.calendar.oauth.connection, { creatorId: a.creatorId });
    if (!conn || conn.status !== "connected") return { refreshed: 0, reason: "calendar not connected" };
    let refreshed = 0;
    for (const b of blocks) {
      const c = await ctx.runQuery(internal.calendar.blocks.eventContext, { blockId: b._id });
      if (!c) continue;
      try {
        const token = await ensureAccessToken(ctx, conn);
        await patchEvent(token, { calendarId: b.calendarId ?? conn.calendarIds?.[0] ?? "primary", eventId: b.externalEventId!, timeZone: c.timezone, summary: eventSummary(b.kind, b.title), description: eventDescription({ kind: b.kind, idea: ideaForEvent(c.idea) }) });
        refreshed += 1;
      } catch (e) {
        console.error(`[calendar] refresh of ${b._id} failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
      }
    }
    return { refreshed };
  },
});

/** Their yes, as a row. Idempotent. */
export const consent = internalMutation({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<null> => {
    const b = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!b) throw new Error("block not found");
    if (!b.consentAt) await ctx.db.patch(a.blockId, { consentAt: Date.now() });
    return null;
  },
});

/** The guard. An external id can only be recorded on a block that carries consent. */
export const recordExternal = internalMutation({
  args: { blockId: v.id("calendarBlocks"), externalEventId: v.string(), calendarId: v.string() },
  handler: async (ctx, a): Promise<null> => {
    const b = (await ctx.db.get(a.blockId)) as Doc<"calendarBlocks"> | null;
    if (!b) throw new Error("block not found");
    if (!b.consentAt) throw new Error("calendar write without consent"); // §6 Sprint 3 named test
    await ctx.db.patch(a.blockId, { externalEventId: a.externalEventId, calendarId: a.calendarId, status: "confirmed" });
    return null;
  },
});

export const setStatus = internalMutation({
  args: { blockId: v.id("calendarBlocks"), status: v.union(v.literal("proposed"), v.literal("confirmed"), v.literal("moved"), v.literal("deleted")), start: v.optional(v.number()), end: v.optional(v.number()) },
  handler: async (ctx, a): Promise<null> => {
    const { blockId, ...rest } = a;
    await ctx.db.patch(blockId, rest);
    return null;
  },
});

/** The creator said yes: consent row first, then the Google write, then the id on the row. */
export const confirm = internalAction({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<{ ok: true; htmlLink: string; when: string } | { ok: false; reason: string; when: string }> => {
    const b = await ctx.runQuery(internal.calendar.blocks.byId, { blockId: a.blockId });
    if (!b) return { ok: false, reason: "block not found", when: "" };
    const creator = await ctx.runQuery(internal.calendar.sync.creatorTz, { creatorId: b.creatorId });
    const tz = creator?.timezone ?? "UTC";
    const when = formatLocal(b.start, tz);
    if (b.status === "confirmed" && b.externalEventId) return { ok: true, htmlLink: "", when };
    await ctx.runMutation(internal.calendar.blocks.consent, { blockId: a.blockId });
    const conn = await ctx.runQuery(internal.calendar.oauth.connection, { creatorId: b.creatorId });
    if (!conn || conn.status !== "connected") return { ok: false, reason: "calendar not connected", when };
    const calendarId = conn.calendarIds?.[0] ?? "primary";
    try {
      const token = await ensureAccessToken(ctx, conn);
      // What they see when they click into it: the idea, the shot list, the post that started it (2026-09-09).
      const c = await ctx.runQuery(internal.calendar.blocks.eventContext, { blockId: a.blockId });
      const ev = await createEvent(token, { calendarId, summary: eventSummary(b.kind, b.title), description: eventDescription({ kind: b.kind, idea: ideaForEvent(c?.idea) }), start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString(), timeZone: tz });
      await ctx.runMutation(internal.calendar.blocks.recordExternal, { blockId: a.blockId, externalEventId: ev.id, calendarId });
      return { ok: true, htmlLink: ev.htmlLink, when };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message.slice(0, 100) : "write failed", when };
    }
  },
});

export const decline = internalMutation({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<null> => {
    await ctx.db.patch(a.blockId, { status: "deleted" });
    return null;
  },
});

/** Move a confirmed block; the calendar event follows. */
export const move = internalAction({
  args: { blockId: v.id("calendarBlocks"), start: v.number(), end: v.number() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const b = await ctx.runQuery(internal.calendar.blocks.byId, { blockId: a.blockId });
    if (!b) return { ok: false, reason: "block not found" };
    if (b.externalEventId && b.consentAt) {
      const conn = await ctx.runQuery(internal.calendar.oauth.connection, { creatorId: b.creatorId });
      if (!conn || conn.status !== "connected") return { ok: false, reason: "calendar not connected" };
      const creator = await ctx.runQuery(internal.calendar.sync.creatorTz, { creatorId: b.creatorId });
      try {
        const token = await ensureAccessToken(ctx, conn);
        await patchEvent(token, { calendarId: b.calendarId ?? conn.calendarIds?.[0] ?? "primary", eventId: b.externalEventId, start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), timeZone: creator?.timezone ?? "UTC" });
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message.slice(0, 100) : "move failed" };
      }
    }
    await ctx.runMutation(internal.calendar.blocks.setStatus, { blockId: a.blockId, status: "moved", start: a.start, end: a.end });
    return { ok: true };
  },
});

/** Delete a block; the calendar event goes with it (404 counts as gone). */
export const remove = internalAction({
  args: { blockId: v.id("calendarBlocks") },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string }> => {
    const b = await ctx.runQuery(internal.calendar.blocks.byId, { blockId: a.blockId });
    if (!b) return { ok: false, reason: "block not found" };
    if (b.externalEventId) {
      const conn = await ctx.runQuery(internal.calendar.oauth.connection, { creatorId: b.creatorId });
      if (conn && conn.status === "connected") {
        try {
          const token = await ensureAccessToken(ctx, conn);
          await deleteEvent(token, { calendarId: b.calendarId ?? conn.calendarIds?.[0] ?? "primary", eventId: b.externalEventId });
        } catch (e) {
          return { ok: false, reason: e instanceof Error ? e.message.slice(0, 100) : "delete failed" };
        }
      }
    }
    await ctx.runMutation(internal.calendar.blocks.setStatus, { blockId: a.blockId, status: "deleted" });
    return { ok: true };
  },
});
