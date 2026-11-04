/**
 * Day one waits for them (2026-11-04). A tester got her opening, then "found 3 creators… want me to watch
 * them?" ten minutes later and a month plan ten after that, before she had answered anything. When one of
 * those comes due while the opening's question is still unanswered, it waits for the next morning, once: if
 * they've replied by its time it simply goes, and a person who never answers still hears from her the next day.
 */
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { atLocalHour } from "../calendar/postTime";

const H = 3_600_000;

/** Pure: half past nine tomorrow (or this morning, if it's still before then), on their clock. */
export function nextMorning(now: number, timezone: string): number {
  const today = atLocalHour(now, 9, timezone) + 30 * 60_000;
  return today > now ? today : atLocalHour(now + 24 * H, 9, timezone) + 30 * 60_000;
}

/** Pure: is her opening still waiting for an answer? Taps and replies count; a reaction or START doesn't. */
export function openingUnanswered(msgs: Array<Pick<Doc<"messages">, "direction" | "kind" | "ts" | "deliveredAt">>, now: number): boolean {
  const openings = msgs.filter((m) => m.direction === "out" && (m.kind === "first_read" || m.kind === "hello") && m.deliveredAt !== undefined && now - (m.deliveredAt ?? 0) < 48 * H);
  if (!openings.length) return false;
  const at = Math.min(...openings.map((m) => m.deliveredAt!));
  return !msgs.some((m) => m.direction === "in" && m.kind !== "pairing" && m.kind !== "reaction" && m.ts > at);
}

export const openingWaits = internalQuery({
  args: { creatorId: v.id("creators"), now: v.number() },
  handler: async (ctx, a): Promise<{ wait: boolean; until: number }> => {
    const c = (await ctx.db.get(a.creatorId)) as Doc<"creators"> | null;
    if (!c?.channel.paired) return { wait: false, until: a.now };
    const msgs = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", a.creatorId).gte("ts", a.now - 48 * H)).take(200)) as Doc<"messages">[];
    return { wait: openingUnanswered(msgs, a.now), until: nextMorning(a.now, c.timezone) };
  },
});
