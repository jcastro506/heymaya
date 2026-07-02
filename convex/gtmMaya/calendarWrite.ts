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
  // Turn-key payload (pillar 4) — one-tap deep link + verbatim paste block.
  openUrl?: string;
  draftText?: string;
  sourceNote?: string;
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
  // Turn-key payload (pillar 4). openUrl = one-tap deep link
  // (thread/composer/submit URL); draftText = the verbatim copy-paste
  // reply/post in the founder's voice; sourceNote = the cited "why this".
  openUrl: v.optional(v.string()),
  draftText: v.optional(v.string()),
  sourceNote: v.optional(v.string()),
  // Maya v2 (S3) — auto-post routing. When the populator names a connected
  // channel + account, the row becomes an auto-post queue entry (status
  // 'queued') instead of a Google-Calendar draft. Reddit/TikTok are FORCED to
  // needs_confirm server-side regardless of what the skill emitted (ban-safety).
  channel: v.optional(v.string()),
  zernioAccountId: v.optional(v.string()),
  // For reply events (engagement), so the dedup ledger keys correctly.
  targetExternalId: v.optional(v.string()),
  targetCommentId: v.optional(v.string()),
  // #15 idempotency — optional stable identity. When the populator passes one
  // (e.g. "day1_first_move"), a re-run UPSERTS rather than appending. When
  // omitted, the server derives one from the thread/kind+day so watchdog
  // re-entry still can't produce duplicate events.
  dedupeKey: v.optional(v.string()),
});

// The 6 offered auto-post channels. A row naming anything else stays a draft.
const OFFERED_AUTOPOST_CHANNELS = new Set([
  "x",
  "linkedin",
  "instagram",
  "tiktok",
  "youtube",
  "reddit",
]);

/**
 * Decide a calendar row's stored status + auto-post execution state at
 * populate time. PURE + deterministic (testable). The ban-safety guarantee:
 *   - no recognized connected channel/account => 'draft' (deep-link fallback),
 *   - reddit/tiktok => 'needs_confirm' ALWAYS (forced, never auto-queued),
 *   - any other offered channel with an account => 'queued' (auto-eligible;
 *     the publish engine still re-runs every gate before it actually posts).
 * The skill cannot override this; a populator bug can never auto-queue a
 * ban-risk channel.
 */
export function routeAutoPostStatus(input: {
  channel?: string;
  zernioAccountId?: string;
  targetExternalId?: string;
  targetCommentId?: string;
}): { status: "draft" | "queued" | "needs_confirm"; autoPostJson?: string } {
  const channel = input.channel;
  if (!channel || !OFFERED_AUTOPOST_CHANNELS.has(channel) || !input.zernioAccountId) {
    return { status: "draft" };
  }
  const mode = decidePublishMode(channel);
  const status = mode === "manual_confirm" ? "needs_confirm" : "queued";
  return {
    status,
    autoPostJson: JSON.stringify({
      channel,
      zernioAccountId: input.zernioAccountId,
      mode,
      targetExternalId: input.targetExternalId,
      targetCommentId: input.targetCommentId,
    }),
  };
}

// Pillar-4 turn-key validation. These kinds put the founder in front of a
// real customer / public launch surface, so every such event MUST be
// one-tap-actionable: an http(s) deep link AND a non-trivial verbatim
// paste block. warmup_block / engagement_block legitimately have neither
// (no product link while warming a cold channel) and are EXEMPT.
const TURN_KEY_REQUIRED_KINDS = new Set<GtmCalendarEventKind>([
  "reply_window",
  "soft_launch_post",
  "hard_launch_anchor",
]);

const HTTP_URL_RE = /https?:\/\/[^\s)]+/i;
// A verbatim paste block must be substantive — a stray "TBD" or a one-word
// placeholder doesn't count. Require some real copy the founder can paste.
const MIN_DRAFT_CHARS = 12;

function hasHttpUrl(...fields: Array<string | undefined>): boolean {
  return fields.some((f) => !!f && HTTP_URL_RE.test(f));
}

function hasVerbatimDraft(draftText: string | undefined): boolean {
  return !!draftText && draftText.trim().length >= MIN_DRAFT_CHARS;
}

/**
 * Pillar-4 server-side backstop: an event of a turn-key kind is only
 * schedulable if it carries BOTH a one-tap http(s) URL (openUrl, or a URL
 * embedded in the description) AND a non-trivial verbatim draftText paste
 * block. Returns true when the event passes (or is an exempt kind).
 */
function passesTurnKeyGate(event: {
  kind?: GtmCalendarEventKind;
  description?: string;
  openUrl?: string;
  draftText?: string;
}): boolean {
  if (!event.kind || !TURN_KEY_REQUIRED_KINDS.has(event.kind)) return true;
  return (
    hasHttpUrl(event.openUrl, event.description) &&
    hasVerbatimDraft(event.draftText)
  );
}

/**
 * #15 — derive a stable dedupe identity for a calendar event when the populator
 * didn't pass one explicitly. Same event identity on a re-run → same key → the
 * persist mutation upserts instead of appending a duplicate. Tied to a thread
 * when one exists (channel:commentOrThreadId), else to the kind + calendar day +
 * a title slug so a same-day re-run of the same logical task collapses.
 */
function deriveEventDedupeKey(event: {
  dedupeKey?: string;
  channel?: string;
  kind?: GtmCalendarEventKind;
  startsAtMs: number;
  title: string;
  targetExternalId?: string;
  targetCommentId?: string;
}): string {
  if (event.dedupeKey && event.dedupeKey.trim().length > 0) {
    return event.dedupeKey.trim();
  }
  const channelOrKind = event.channel ?? event.kind ?? "event";
  const threadAnchor = event.targetCommentId ?? event.targetExternalId;
  if (threadAnchor) return `${channelOrKind}:${threadAnchor}`;
  const isoDay = new Date(event.startsAtMs).toISOString().slice(0, 10);
  const titleSlug = event.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${channelOrKind}:${isoDay}:${titleSlug}`;
}

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
    rejected: number;
    rejectedTitles: string[];
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
    const rejectedTitles: string[] = [];
    for (const event of args.events) {
      // Pillar-4 backstop: turn-key kinds (reply_window / soft_launch_post /
      // hard_launch_anchor) MUST ship a one-tap URL + verbatim paste block.
      // warmup_block / engagement_block are exempt. Reject (drop) the rest so
      // a half-baked launch/reply never silently reaches the calendar; the
      // returned count lets Maya see and fix them.
      if (!passesTurnKeyGate(event)) {
        rejectedTitles.push(event.title);
        continue;
      }
      // BAN-SAFETY FORCE (mandatory server-side guard): decide the auto-post
      // status here, never trusting the skill. A row naming a connected
      // auto-channel becomes 'queued'; reddit/tiktok are FORCED to
      // needs_confirm regardless of what the populator emitted; anything
      // without a recognized connected channel stays a 'draft' (deep-link
      // fallback). A populator bug can therefore NEVER silently auto-queue a
      // ban-risk channel.
      const routed = routeAutoPostStatus({
        channel: event.channel,
        zernioAccountId: event.zernioAccountId,
        targetExternalId: event.targetExternalId,
        targetCommentId: event.targetCommentId,
      });
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
          openUrl: event.openUrl,
          draftText: event.draftText,
          sourceNote: event.sourceNote,
          status: routed.status,
          autoPostJson: routed.autoPostJson,
          dedupeKey: deriveEventDedupeKey(event),
        }
      );
      draftIds.push(id);
    }
    return {
      stored: draftIds.length,
      draftIds,
      rejected: rejectedTitles.length,
      rejectedTitles,
    };
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
    mirrorDisabled?: boolean;
  }> => {
    // Maya v2: the Google Calendar flood is RETIRED. The day's plan is Maya's
    // internal auto-post queue, rendered in the web Today view. This push is a
    // no-op UNLESS the founder explicitly turned on the off-by-default
    // googleCalendarMirrorEnabled toggle (suppressed from onboarding entirely;
    // the flag stays dormant for the rare founder who opts in via Settings).
    const mirrorOn = await ctx.runQuery(
      internal.gtmMaya.calendarWrite.isGoogleMirrorEnabled,
      { agentId: args.agentId }
    );
    if (!mirrorOn) {
      return {
        pushed: 0,
        failed: 0,
        eventIds: [],
        errors: [],
        needsOAuth: false,
        mirrorDisabled: true,
      };
    }
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
    // Turn-key payload (pillar 4) — additive/optional for back-compat.
    openUrl: v.optional(v.string()),
    draftText: v.optional(v.string()),
    sourceNote: v.optional(v.string()),
    // Maya v2 (S3) — auto-post status + execution state. Defaults preserve the
    // old behavior ('draft', no autoPostJson) for callers that don't set them.
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("queued"),
        v.literal("needs_confirm")
      )
    ),
    autoPostJson: v.optional(v.string()),
    // #15 idempotency — when set, a second persist with the same (agent,
    // dedupeKey) returns the EXISTING row instead of appending a duplicate.
    // The foundation pass passes "day1_first_move"; the daily pass passes
    // "<channel>:<isoDay>:<threadId>". This is what stops watchdog re-entry
    // from producing 9 day-1 events.
    dedupeKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"gtmCalendarEvents">> => {
    const now = Date.now();
    if (args.dedupeKey) {
      const existing = await ctx.db
        .query("gtmCalendarEvents")
        .withIndex("by_agent_dedupe", (q) =>
          q.eq("agentId", args.agentId).eq("dedupeKey", args.dedupeKey)
        )
        .first();
      if (existing) {
        // Refresh the turn-key payload in place (a re-run may have a better
        // draft) but never create a second event for this identity.
        await ctx.db.patch(existing._id, {
          title: args.title,
          description: args.description,
          openUrl: args.openUrl ?? existing.openUrl,
          draftText: args.draftText ?? existing.draftText,
          sourceNote: args.sourceNote ?? existing.sourceNote,
          autoPostJson: args.autoPostJson ?? existing.autoPostJson,
          updatedAt: now,
        });
        return existing._id;
      }
    }
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
      openUrl: args.openUrl,
      draftText: args.draftText,
      sourceNote: args.sourceNote,
      autoPostJson: args.autoPostJson,
      dedupeKey: args.dedupeKey,
      status: args.status ?? "draft",
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

// ════════════════════════════════════════════════════════════════════════
// Maya v2 (S3) — the auto-post execution engine.
//
// gtmCalendarEvents is no longer a Google-Calendar staging buffer; it is
// Maya's internal auto-post queue. A 'queued' row fires publishQueuedEvent,
// which runs every gate (ban-safety, plan caps, the S2.7 three-verdict
// autonomous-publish gate, the S3 dedup ledger, live account health) and
// either auto-publishes via Zernio (status 'posting') or downgrades to
// 'needs_confirm' (a one-tap founder approval). confirmEventLanded is the
// 24h re-poll that flips 'posting' -> 'published' (NEVER off the POST 200).
// ════════════════════════════════════════════════════════════════════════

/** The 2 ban-safety channels: always one-tap-confirm, never auto-published. */
const MANUAL_CONFIRM_CHANNELS = new Set(["reddit", "tiktok"]);

export type PublishMode = "auto" | "manual_confirm";

/**
 * Ban-safety publish-mode decision (pure). Reddit + TikTok are ALWAYS
 * manual-confirm (account-ban risk AND the technical reality: Reddit >50%
 * fail, TikTok legal consent). Everything else is eligible for auto-publish
 * (still subject to the other gates).
 */
export function decidePublishMode(channel: string): PublishMode {
  return MANUAL_CONFIRM_CHANNELS.has(channel) ? "manual_confirm" : "auto";
}

export interface AutoPostGateInput {
  mode: PublishMode;
  planAllowsAutoPost: boolean;
  autoPublishAllowed: boolean; // S2.7 three-verdict gate
  dedupAllowed: boolean; // S3 engagement-ledger gate
  healthCanPost: boolean;
}

export type AutoPostAction = "auto" | "needs_confirm";

/**
 * Compose the final publish action (pure, fail-closed). Auto-publish ONLY
 * when the channel is auto-eligible AND the plan allows AND the S2.7 gate
 * passed AND the dedup gate passed AND the account is healthy. ANY miss
 * downgrades to needs_confirm (a one-tap card), never a silent drop and
 * never a forced publish.
 */
export function composeAutoPostAction(
  input: AutoPostGateInput
): { action: AutoPostAction; reasons: string[] } {
  const reasons: string[] = [];
  if (input.mode === "manual_confirm") reasons.push("ban-safety channel (reddit/tiktok)");
  if (!input.planAllowsAutoPost) reasons.push("plan does not allow auto-post");
  if (!input.autoPublishAllowed) reasons.push("voice/slop/safety gate not passed");
  if (!input.dedupAllowed) reasons.push("already engaged (dedup)");
  if (!input.healthCanPost) reasons.push("account unhealthy / not connected");
  return { action: reasons.length === 0 ? "auto" : "needs_confirm", reasons };
}

export const isGoogleMirrorEnabled = internalQuery({
  args: { agentId: v.id("gtmAgents") },
  handler: async (ctx, args): Promise<boolean> => {
    const agent = await ctx.db.get(args.agentId);
    return agent?.googleCalendarMirrorEnabled === true;
  },
});

interface AutoPostJson {
  channel: string;
  zernioAccountId?: string;
  zernioPostId?: string;
  mode?: PublishMode;
  scheduledForIso?: string;
  publishConfirmedAt?: number;
  platformPostUrl?: string;
  targetExternalId?: string;
  targetCommentId?: string;
  lastError?: string;
}

export const markCalendarEventAutoPost = internalMutation({
  args: {
    eventId: v.id("gtmCalendarEvents"),
    status: v.union(
      v.literal("queued"),
      v.literal("posting"),
      v.literal("published"),
      v.literal("failed"),
      v.literal("needs_confirm")
    ),
    autoPostJson: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.eventId, {
      status: args.status,
      autoPostJson: args.autoPostJson,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Atomic compare-and-set claim for the auto-post path. Flips `queued` →
 * `posting` in a SINGLE serializable mutation so only ONE invocation of
 * publishQueuedEvent proceeds to the external Zernio POST. Without it, two
 * concurrent fires (a re-scheduled event, an agent retry, a sweep + direct
 * call) both read status `queued` and both publish — a duplicate post. The
 * caller publishes only on `{ claimed: true }`; on publish failure the outcome
 * handlers move `posting` → `failed`/`needs_confirm` as before.
 */
export const claimQueuedEventForPublish = internalMutation({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (ctx, args): Promise<{ claimed: boolean }> => {
    const ev = await ctx.db.get(args.eventId);
    if (!ev || ev.status !== "queued") return { claimed: false };
    await ctx.db.patch(args.eventId, { status: "posting", updatedAt: Date.now() });
    return { claimed: true };
  },
});

export const getCalendarEventForAgent = internalQuery({
  args: { eventId: v.id("gtmCalendarEvents") },
  handler: async (ctx, args): Promise<Doc<"gtmCalendarEvents"> | null> => {
    return await ctx.db.get(args.eventId);
  },
});
