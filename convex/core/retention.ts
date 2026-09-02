/**
 * Retention while the account exists (plan §16.5): messages twelve months, calendar
 * fields ninety days rolling, expired oauth state tokens a day. Own-post reads and
 * public content stay. Nightly, bounded per run so a big backlog drains over nights
 * rather than blowing a mutation's limits.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const MESSAGE_DAYS = 365;
export const CALENDAR_DAYS = 90;
export const OAUTH_STATE_HOURS = 24;
const BATCH = 500;

export const nightly = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ messages: number; calendarEvents: number; oauthStates: number }> => {
    const now = a.now ?? Date.now();
    let messages = 0, calendarEvents = 0, oauthStates = 0;
    const oldMessages = (await ctx.db.query("messages").filter((q) => q.lt(q.field("ts"), now - MESSAGE_DAYS * 86_400_000)).take(BATCH)) as Doc<"messages">[];
    for (const m of oldMessages) {
      if (m.fileId) await ctx.storage.delete(m.fileId).catch(() => undefined);
      await ctx.db.delete(m._id);
      messages++;
    }
    // Calendar rows are kept ninety days past their start; a rolling window, never the whole calendar.
    const oldEvents = (await ctx.db.query("calendarEvents").filter((q) => q.lt(q.field("start"), now - CALENDAR_DAYS * 86_400_000)).take(BATCH)) as Doc<"calendarEvents">[];
    for (const e of oldEvents) {
      await ctx.db.delete(e._id);
      calendarEvents++;
    }
    const oldStates = (await ctx.db.query("oauthStates").filter((q) => q.lt(q.field("expiresAt"), now - OAUTH_STATE_HOURS * 3_600_000)).take(BATCH)) as Doc<"oauthStates">[];
    for (const s of oldStates) {
      await ctx.db.delete(s._id);
      oauthStates++;
    }
    return { messages, calendarEvents, oauthStates };
  },
});
