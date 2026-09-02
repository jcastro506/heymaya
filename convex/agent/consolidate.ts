/**
 * Nightly consolidation (plan §15.7 layer 3), the code half: expired notes are
 * tombstoned, and the hour they tend to reply in is learned from their own inbound
 * messages (§13.10 (5) cadence). No model call tonight; the weekly learn-creator
 * rewrite already reads the live notes and folds contradictions in.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { localHourMinute } from "../scout/gate";

export const MIN_REPLIES_FOR_HOUR = 6;

/** Median local hour of their replies over 28 days, or undefined below the floor. Pure. */
export function preferredHour(replyTs: number[], timezone: string): number | undefined {
  if (replyTs.length < MIN_REPLIES_FOR_HOUR) return undefined;
  const hours = replyTs.map((t) => localHourMinute(t, timezone).hour).sort((a, b) => a - b);
  return hours[Math.floor(hours.length / 2)];
}

export const nightly = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ creators: number; expiredNotes: number; hoursLearned: number }> => {
    const now = a.now ?? Date.now();
    const creators = (await ctx.db.query("creators").collect()) as Doc<"creators">[];
    let expiredNotes = 0, hoursLearned = 0;
    for (const c of creators) {
      const patch: Partial<Doc<"creators">> = {};
      const notes = (c.notes ?? []).map((n) => {
        // §21.5 callbacks: a running bit never expires on its own; only "forget that" ends one.
        if (!n.tombstonedAt && n.expiresHint && n.expiresHint < now && !n.confirmedAt && n.kind !== "bit") {
          expiredNotes++;
          return { ...n, tombstonedAt: now };
        }
        return n;
      });
      if (expiredNotes) patch.notes = notes;
      const inbound = (await ctx.db.query("messages").withIndex("by_creator_and_ts", (q) => q.eq("creatorId", c._id).gte("ts", now - 28 * 86_400_000)).collect()) as Doc<"messages">[];
      const hour = preferredHour(inbound.filter((m) => m.direction === "in" && (m.kind ?? "inbound") === "inbound").map((m) => m.ts), c.timezone);
      if (hour !== undefined && hour !== c.preferredSendHour) {
        patch.preferredSendHour = hour;
        hoursLearned++;
      }
      if (Object.keys(patch).length) await ctx.db.patch(c._id, { ...patch, updatedAt: now });
    }
    return { creators: creators.length, expiredNotes, hoursLearned };
  },
});
