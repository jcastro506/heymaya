/**
 * The plan, for the belt (Sprint 4b): one read and three writes. These are the chat path
 * for every calendar control, so "make it thursday", "skip that one" and "add an edit block
 * sunday morning" all land on the same rows the buttons and the web use. Times arrive on
 * the creator's clock as YYYY-MM-DDTHH:MM; the model never does timezone arithmetic.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { zonedTimeToEpoch } from "./time";

const MAX_DAYS_AHEAD = 21;

export const weekRows = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<Array<{ id: string; when: string; kind: string; title: string; state: string }>> => {
    const creator = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!creator) return [];
    const blocks = ((await ctx.db.query("calendarBlocks").withIndex("by_creator", (q) => q.eq("creatorId", a.creatorId).gte("start", a.now - 3_600_000).lte("start", a.now + 8 * 86_400_000)).take(60)) as Doc<"calendarBlocks">[])
      .filter((b) => b.status !== "deleted").sort((x, y) => x.start - y.start);
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: creator.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return blocks.map((b) => ({
      id: String(b._id),
      when: fmt.format(b.start).toLowerCase().replace(":00", ""),
      kind: b.kind,
      title: b.title.replace(/^(film|edit|post)( \(experiment\))?: /, ""),
      state: !b.consentAt ? "proposed, not booked" : b.filmedAt ? "booked, filmed" : "booked",
    }));
  },
});

function parseWhen(whenLocal: unknown, tz: string, now: number): { ok: true; at: number } | { ok: false; reason: string } {
  if (typeof whenLocal !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(whenLocal)) return { ok: false, reason: "whenLocal must be YYYY-MM-DDTHH:MM on their clock" };
  const at = zonedTimeToEpoch(whenLocal, tz);
  if (!Number.isFinite(at)) return { ok: false, reason: "that time did not parse" };
  if (at < now - 5 * 60_000) return { ok: false, reason: "that time is in the past" };
  if (at > now + MAX_DAYS_AHEAD * 86_400_000) return { ok: false, reason: `further out than ${MAX_DAYS_AHEAD} days` };
  return { ok: true, at };
}

/** A write they asked for is done at once and confirmed by the caller in one line. */
export const write = internalAction({
  args: { creatorId: v.id("creators"), op: v.union(v.literal("block_move"), v.literal("block_drop"), v.literal("block_add")), args: v.any() },
  handler: async (ctx, a): Promise<{ ok: boolean; reason?: string; detail?: string }> => {
    const now = Date.now();
    const creator = await ctx.runQuery(internal.calendar.sync.creatorTz, { creatorId: a.creatorId });
    const tz = creator?.timezone ?? "UTC";
    const args = (a.args ?? {}) as Record<string, unknown>;
    const fmt = (e: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(e).toLowerCase().replace(":00", "");

    if (a.op === "block_add") {
      const when = parseWhen(args.whenLocal, tz, now);
      if (!when.ok) return { ok: false, reason: when.reason };
      const kind = String(args.kind) as "film" | "edit" | "post";
      if (!["film", "edit", "post"].includes(kind)) return { ok: false, reason: "kind must be film, edit or post" };
      const minutes = Math.max(10, Math.min(240, Number(args.minutes) || 45));
      const title = `${kind}: ${String(args.title ?? "").slice(0, 70) || "as asked"}`;
      const blockId = await ctx.runMutation(internal.calendar.blocks.propose, { creatorId: a.creatorId, kind, start: when.at, end: when.at + minutes * 60_000, title });
      // They asked, so the ask is the consent: book it now.
      const r = await ctx.runAction(internal.calendar.blocks.confirm, { blockId });
      await ctx.runAction(internal.calendar.reminders.scheduleFor, { blockId });
      return { ok: true, detail: `added ${kind} block ${fmt(when.at)} (${minutes} min)${r.ok ? ", on their calendar" : ", saved here (calendar not connected)"}. id ${blockId}` };
    }

    const blockId = String(args.blockId ?? "") as Id<"calendarBlocks">;
    const b = await ctx.runQuery(internal.calendar.blocks.byId, { blockId });
    // Cross-tenant: a block id from another creator's plan is not theirs to touch.
    if (!b || b.creatorId !== a.creatorId) return { ok: false, reason: "no such block on their plan; read week_plan for the ids" };

    if (a.op === "block_drop") {
      const r = await ctx.runAction(internal.calendar.blocks.remove, { blockId });
      return r.ok ? { ok: true, detail: `dropped ${b.kind} block ${fmt(b.start)} (${b.title})` } : { ok: false, reason: r.reason ?? "could not drop it" };
    }

    const when = parseWhen(args.whenLocal, tz, now);
    if (!when.ok) return { ok: false, reason: when.reason };
    const len = b.end - b.start;
    const r = await ctx.runAction(internal.calendar.blocks.move, { blockId, start: when.at, end: when.at + len });
    if (!r.ok) return { ok: false, reason: r.reason ?? "could not move it" };
    if (b.consentAt) await ctx.runAction(internal.calendar.reminders.scheduleFor, { blockId });
    return { ok: true, detail: `moved ${b.kind} block to ${fmt(when.at)} (was ${fmt(b.start)})` };
  },
});
