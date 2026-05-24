import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createCalendarEvent } from "../integrations/google/calendar";
import { ensureFreshAccessToken } from "./calendarOAuth";

/**
 * Sprint 9 — GTM Google Calendar event writer.
 *
 * Called from /lc_gtm/calendar_proposal after Maya has proposed events
 * and the idempotency key is claimed. This module owns:
 *   1. Token refresh (delegates to ensureFreshAccessToken).
 *   2. Per-event Google Calendar POST.
 *   3. Persisting gtmCalendarEvents rows tagged createdBy="maya" for
 *      the maya-owned delete safeguard.
 *   4. Soft-fail per event (one failure doesn't abort the batch).
 */

interface CalendarEventProposal {
  title: string;
  description?: string;
  startsAtMs: number;
  endsAtMs: number;
  kind?: GtmCalendarEventKind;
}

// Sprint 1.2 — typed event kinds. warmup_block is the new one closing the
// "Maya knows warmup matters but never put it on your calendar" gap; the
// rest formalize what was previously a free-form title-prefix convention.
const EVENT_KIND = v.union(
  v.literal("warmup_block"),
  v.literal("engagement_block"),
  v.literal("soft_launch_post"),
  v.literal("hard_launch_anchor"),
  v.literal("reply_window"),
  v.literal("weekly_review"),
  v.literal("first_50_dms")
);
export type GtmCalendarEventKind =
  | "warmup_block"
  | "engagement_block"
  | "soft_launch_post"
  | "hard_launch_anchor"
  | "reply_window"
  | "weekly_review"
  | "first_50_dms";

const EVENT_INPUT = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  startsAtMs: v.number(),
  endsAtMs: v.number(),
  kind: v.optional(EVENT_KIND),
});

function toIsoWithTimezone(ms: number, timezone: string | undefined): {
  dateTime: string;
  timeZone?: string;
} {
  const iso = new Date(ms).toISOString();
  return timezone ? { dateTime: iso, timeZone: timezone } : { dateTime: iso };
}

export const writeCalendarEventsForAgent = internalAction({
  args: {
    agentId: v.id("gtmAgents"),
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    events: v.array(EVENT_INPUT),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    written: number;
    failed: number;
    eventIds: string[];
    errors: string[];
  }> => {
    let accessToken: string;
    try {
      accessToken = await ensureFreshAccessToken(ctx, args.accountId);
    } catch (err) {
      throw new Error(
        `cannot write calendar events: ${(err as Error).message}`
      );
    }

    const conn = await ctx.runQuery(
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
      { accountId: args.accountId }
    );
    const timezone = conn?.timezone ?? "UTC";

    const writtenIds: string[] = [];
    const errors: string[] = [];

    for (const event of args.events) {
      try {
        const result = await createCalendarEvent(accessToken, {
          payload: {
            summary: `[Maya GTM] ${event.title}`,
            description: event.description,
            start: toIsoWithTimezone(event.startsAtMs, timezone),
            end: toIsoWithTimezone(event.endsAtMs, timezone),
            reminders: {
              useDefault: false,
              overrides: [
                { method: "popup", minutes: 30 },
              ],
            },
          },
        });
        writtenIds.push(result.id);
        await ctx.runMutation(
          internal.gtmMaya.calendarWrite.persistGtmCalendarEvent,
          {
            accountId: args.accountId,
            agentId: args.agentId,
            researchJobId: args.researchJobId,
            providerEventId: result.id,
            htmlLink: result.htmlLink,
            title: event.title,
            description: event.description,
            startsAtMs: event.startsAtMs,
            endsAtMs: event.endsAtMs,
            timezone,
            kind: event.kind,
          }
        );
      } catch (err) {
        errors.push(
          `event "${event.title.slice(0, 40)}": ${(err as Error).message}`
        );
      }
    }

    return {
      written: writtenIds.length,
      failed: errors.length,
      eventIds: writtenIds,
      errors,
    };
  },
});

export const persistGtmCalendarEvent = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    providerEventId: v.string(),
    htmlLink: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    startsAtMs: v.number(),
    endsAtMs: v.number(),
    timezone: v.string(),
    kind: v.optional(EVENT_KIND),
  },
  handler: async (ctx, args): Promise<Id<"gtmCalendarEvents">> => {
    const now = Date.now();
    return await ctx.db.insert("gtmCalendarEvents", {
      accountId: args.accountId,
      agentId: args.agentId,
      researchJobId: args.researchJobId,
      providerEventId: args.providerEventId,
      htmlLink: args.htmlLink,
      title: args.title,
      description: args.description,
      startsAtMs: args.startsAtMs,
      endsAtMs: args.endsAtMs,
      timezone: args.timezone,
      kind: args.kind,
      status: "scheduled",
      createdBy: "maya",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Public query for the mission board to surface Maya-written events.
 */
export const getMyCalendarEvents = query({
  args: {},
  handler: async (ctx): Promise<Doc<"gtmCalendarEvents">[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!creator || creator.accountType !== "gtm-agent") return [];
    return await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .order("desc")
      .take(40);
  },
});
