import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createCalendarEvent } from "../integrations/google/calendar";
import { ensureFreshAccessToken } from "./calendarOAuth";

/**
 * Sprint 9 — GTM Google Calendar event writer.
 * Sprint 2.22 — split storage from push.
 *
 * Two-phase commit for calendar events:
 *
 *   Phase A: storeProposedCalendarEvents
 *     - Called from /lc_gtm/calendar_proposal when Maya finishes her plan.
 *     - Always succeeds. Stores rows with status:"draft" + no
 *       providerEventId. Does NOT touch Google Calendar.
 *     - This is Maya's autonomous "lock the plan in her view" step.
 *
 *   Phase B: pushApprovedCalendarEvents
 *     - Called from /lc_gtm/approve_calendar when operator approves.
 *     - For each draft event for that agent: POST to Google Cal API,
 *       update row to status:"scheduled" + set providerEventId.
 *     - Requires OAuth — throws cleanly if not connected so the caller
 *       can prompt operator to connect Google Calendar.
 *     - Soft-fail per event (one failure doesn't abort the batch).
 *
 * This separation is the architecture operator wanted: Maya plans
 * autonomously, then asks for permission to touch the operator's
 * external Google Calendar.
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

/**
 * Sprint 2.22 Phase A — Store events as DRAFTS. Always succeeds, no
 * OAuth required. Maya calls this when she finishes Phase 3 of the
 * foundation pass.
 */
export const storeProposedCalendarEvents = internalAction({
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
    stored: number;
    draftIds: Id<"gtmCalendarEvents">[];
  }> => {
    // Read the operator's timezone for proper ISO encoding when we
    // eventually push. If no connection exists, fall back to UTC; the
    // push step will surface "needs Google Calendar OAuth" cleanly.
    const conn = await ctx.runQuery(
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
      { accountId: args.accountId }
    );
    const timezone = conn?.timezone ?? "UTC";

    const draftIds: Id<"gtmCalendarEvents">[] = [];
    for (const event of args.events) {
      const id = await ctx.runMutation(
        internal.gtmMaya.calendarWrite.persistGtmCalendarEventDraft,
        {
          accountId: args.accountId,
          agentId: args.agentId,
          researchJobId: args.researchJobId,
          title: event.title,
          description: event.description,
          startsAtMs: event.startsAtMs,
          endsAtMs: event.endsAtMs,
          timezone,
          kind: event.kind,
        }
      );
      draftIds.push(id);
    }
    return { stored: draftIds.length, draftIds };
  },
});

/**
 * Sprint 2.22 Phase B — Push ALL draft events for an agent to the
 * operator's Google Calendar. Operator's "approved" reply triggers
 * this. Throws cleanly if Google Calendar OAuth not connected, so
 * the caller can prompt the operator to connect.
 */
export const pushApprovedCalendarEvents = internalAction({
  args: { agentId: v.id("gtmAgents"), accountId: v.id("creators") },
  handler: async (
    ctx,
    args
  ): Promise<{
    pushed: number;
    failed: number;
    eventIds: string[];
    errors: string[];
    needsOAuth: boolean;
  }> => {
    // Fetch the OAuth token. If missing, return cleanly so the caller
    // can prompt the operator to connect their Google Calendar.
    let accessToken: string;
    try {
      accessToken = await ensureFreshAccessToken(ctx, args.accountId);
    } catch {
      return {
        pushed: 0,
        failed: 0,
        eventIds: [],
        errors: [],
        needsOAuth: true,
      };
    }
    const conn = await ctx.runQuery(
      internal.gtmMaya.calendarOAuth.getGtmCalendarConnection,
      { accountId: args.accountId }
    );
    const timezone = conn?.timezone ?? "UTC";

    const drafts = await ctx.runQuery(
      internal.gtmMaya.calendarWrite.getDraftCalendarEvents,
      { agentId: args.agentId }
    );

    const writtenIds: string[] = [];
    const errors: string[] = [];

    for (const draft of drafts) {
      try {
        const result = await createCalendarEvent(accessToken, {
          payload: {
            summary: `[Maya GTM] ${draft.title}`,
            description: draft.description,
            start: toIsoWithTimezone(draft.startsAtMs, timezone),
            end: toIsoWithTimezone(draft.endsAtMs, timezone),
            reminders: {
              useDefault: false,
              overrides: [{ method: "popup", minutes: 30 }],
            },
          },
        });
        writtenIds.push(result.id);
        await ctx.runMutation(
          internal.gtmMaya.calendarWrite.markGtmCalendarEventScheduled,
          {
            id: draft._id,
            providerEventId: result.id,
            htmlLink: result.htmlLink,
          }
        );
      } catch (err) {
        errors.push(
          `event "${draft.title.slice(0, 40)}": ${(err as Error).message}`
        );
      }
    }

    return {
      pushed: writtenIds.length,
      failed: errors.length,
      eventIds: writtenIds,
      errors,
      needsOAuth: false,
    };
  },
});

/**
 * Sprint 2.22 — store a single draft event (no Google Cal push yet).
 */
export const persistGtmCalendarEventDraft = internalMutation({
  args: {
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
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
      providerEventId: undefined,
      htmlLink: undefined,
      title: args.title,
      description: args.description,
      startsAtMs: args.startsAtMs,
      endsAtMs: args.endsAtMs,
      timezone: args.timezone,
      kind: args.kind,
      status: "draft",
      createdBy: "maya",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Sprint 2.22 — read draft events for an agent (pre-push query).
 */
export const getDraftCalendarEvents = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<Doc<"gtmCalendarEvents">[]> => {
    const all = await ctx.db
      .query("gtmCalendarEvents")
      .withIndex("by_agent", (q) => q.eq("agentId", args.agentId))
      .collect();
    return all.filter((e) => e.status === "draft");
  },
});

/**
 * Sprint 2.22 — flip a draft row to "scheduled" after Google Cal push.
 */
export const markGtmCalendarEventScheduled = internalMutation({
  args: {
    id: v.id("gtmCalendarEvents"),
    providerEventId: v.string(),
    htmlLink: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.id, {
      providerEventId: args.providerEventId,
      htmlLink: args.htmlLink,
      status: "scheduled",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Sprint 9 ORIGINAL writer — kept as a compat alias that delegates
 * through the new split: stores drafts, then pushes them. New callers
 * should use storeProposedCalendarEvents + pushApprovedCalendarEvents
 * directly for the approval-gated flow.
 */
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
    await ctx.runAction(
      internal.gtmMaya.calendarWrite.storeProposedCalendarEvents,
      args
    );
    const push = await ctx.runAction(
      internal.gtmMaya.calendarWrite.pushApprovedCalendarEvents,
      { agentId: args.agentId, accountId: args.accountId }
    );
    return {
      written: push.pushed,
      failed: push.failed,
      eventIds: push.eventIds,
      errors: push.errors,
    };
  },
});

/**
 * Legacy persist for pushed events — DEPRECATED. New code should use
 * persistGtmCalendarEventDraft + markGtmCalendarEventScheduled.
 * Kept for back-compat with any caller still using the old shape.
 */
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
