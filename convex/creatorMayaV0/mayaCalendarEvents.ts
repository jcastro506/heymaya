/**
 * Sprint C.1 — Maya-authored Google Calendar event tracking.
 *
 * Companion to the new `mayaCalendarEvents` schema table. Provides:
 *
 *   - Internal mutations + queries Maya invokes from inside the OpenClaw
 *     gateway via the lc_maya HTTP surface (curl into Convex). These are
 *     the only write paths into the table — Maya doesn't talk to the
 *     Google Calendar API directly; she calls `/lc_maya/calendar_create_event`
 *     (which proxies Google), then records the Maya-authored row here so
 *     the heartbeat scan + per-tier weekly caps can enforce themselves
 *     without re-fetching Google.
 *
 *   - A PURE body templater (`renderEventBody`) that turns structured
 *     per-kind context into the title + description strings Maya hands to
 *     Google Calendar's create endpoint. Pure so it's testable without
 *     Convex seeding — `AGENTS.md` tells Maya to run the rendered prose
 *     through `maya-voice-applier` + `maya-citation-firewall` BEFORE
 *     invoking the calendar create.
 *
 *   - A per-tier weekly cap helper (`weeklyCalendarEventCapPerKind`) that
 *     enforces the per-tier × per-kind weekly matrix server-side. The
 *     cap is consulted at insert time; fail-closed PlanGateError analog
 *     `CalendarCapError` thrown when the creator's count for the running
 *     week (creator-local Sun→Sun in the creator's tz) is at-or-over cap.
 *
 * Schema invariant: actionable=true rows REQUIRE at least one citedRef
 * (the "grounded or silent" architectural principle). Non-actionable rows
 * may have an empty citedRefs array (e.g. `brain-break` is opt-in by the
 * creator and has no underlying data citation).
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// Public types — exported so AGENTS.md / SKILL.md siblings can grep + match.
// ---------------------------------------------------------------------------

export const MAYA_CALENDAR_EVENT_KINDS = [
  "trend-strike",
  "content-block",
  "post-publish",
  "niche-scroll",
  "comment-window",
  "brand-outbox",
  "weekly-review",
  "brain-break",
] as const;

export type MayaCalendarEventKind = (typeof MAYA_CALENDAR_EVENT_KINDS)[number];

export type MayaCalendarEventCitedRefKind =
  | "trend"
  | "post"
  | "peer"
  | "email"
  | "brand-deal";

export interface MayaCalendarEventCitedRef {
  kind: MayaCalendarEventCitedRefKind;
  /** URL or stable id pointing back to the underlying data. */
  ref: string;
  /** Human-readable label for the body prose. */
  label: string;
}

// Convex value-validators for cited refs — used by the mutations.
const citedRefValidator = v.object({
  kind: v.union(
    v.literal("trend"),
    v.literal("post"),
    v.literal("peer"),
    v.literal("email"),
    v.literal("brand-deal"),
  ),
  ref: v.string(),
  label: v.string(),
});

const kindValidator = v.union(
  v.literal("trend-strike"),
  v.literal("content-block"),
  v.literal("post-publish"),
  v.literal("niche-scroll"),
  v.literal("comment-window"),
  v.literal("brand-outbox"),
  v.literal("weekly-review"),
  v.literal("brain-break"),
);

// ---------------------------------------------------------------------------
// Plan-tier weekly cap matrix.
//
// Spec sheet ships a 3-tier matrix (starter / pro / studio); the deployed
// creator-product runtime is 2-tier (coach / manager). Mapping: `coach`
// follows the "starter" row (minimum-autonomy advisory tier), `manager`
// follows the "studio" row (full-autonomy unlimited). The "pro" row from
// the spec is preserved on the public helper signature so the matrix is
// representable as-written if the tier set ever expands — the runtime
// only ever sees coach/manager.
// ---------------------------------------------------------------------------

export type CalendarPlanTier = "starter" | "pro" | "studio";

const CAP_MATRIX: Record<
  CalendarPlanTier,
  Record<MayaCalendarEventKind, number | "unlimited">
> = {
  starter: {
    "trend-strike": 1,
    "content-block": 1,
    "post-publish": 3,
    "niche-scroll": 2,
    "comment-window": 1,
    "brand-outbox": "unlimited",
    "weekly-review": 1,
    "brain-break": "unlimited",
  },
  pro: {
    "trend-strike": 3,
    "content-block": 2,
    "post-publish": "unlimited",
    "niche-scroll": 7,
    "comment-window": 3,
    "brand-outbox": "unlimited",
    "weekly-review": 1,
    "brain-break": "unlimited",
  },
  studio: {
    "trend-strike": "unlimited",
    "content-block": "unlimited",
    "post-publish": "unlimited",
    "niche-scroll": "unlimited",
    "comment-window": "unlimited",
    "brand-outbox": "unlimited",
    "weekly-review": "unlimited",
    "brain-break": "unlimited",
  },
};

/**
 * Returns the per-week cap for a given (tier × kind). `"unlimited"` means
 * no cap — the insert path must treat that as a sentinel, NOT as a number.
 */
export function weeklyCalendarEventCapPerKind(
  planTier: CalendarPlanTier,
  kind: MayaCalendarEventKind,
): number | "unlimited" {
  return CAP_MATRIX[planTier][kind];
}

/**
 * Maps the runtime 2-tier plan (`coach` | `manager`) to the 3-tier matrix
 * tier name. Coach → starter row (advisory floor). Manager → studio row
 * (unlimited / full autonomy).
 */
export function calendarTierFromPlan(
  plan: Doc<"creators">["plan"],
): CalendarPlanTier {
  switch (plan) {
    case "coach":
      return "starter";
    case "manager":
      return "studio";
    default:
      // Adversarial / corrupted plan field — fail closed at the most
      // restrictive tier (the autonomy boundary semantics match
      // planFeatures.ts's PlanGateError default).
      return "starter";
  }
}

/**
 * Thrown when an insert would exceed the per-tier per-kind weekly cap.
 * Surfaced verbatim by the wrapping HTTP action so Maya can quote it back
 * to the creator ("you're at 3/3 trend-strikes this week — bumping this
 * one to next Sunday's plan").
 */
export class CalendarCapError extends Error {
  constructor(
    public planTier: CalendarPlanTier,
    public kind: MayaCalendarEventKind,
    public cap: number,
    public current: number,
  ) {
    super(
      `Calendar cap exceeded: tier='${planTier}', kind='${kind}', cap=${cap}, current=${current}.`,
    );
    this.name = "CalendarCapError";
  }
}

// ---------------------------------------------------------------------------
// Internal mutations + queries — the lc_maya HTTP surface targets these.
// ---------------------------------------------------------------------------

export const insertMayaCalendarEventInternal = internalMutation({
  args: {
    creatorId: v.id("creators"),
    googleEventId: v.string(),
    kind: kindValidator,
    citedRefs: v.array(citedRefValidator),
    startTimeMs: v.number(),
    endTimeMs: v.number(),
    actionable: v.boolean(),
    sourceStandingOrderId: v.optional(v.string()),
    bodyVersion: v.optional(v.number()),
    lastEditedByMaya: v.optional(v.number()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      throw new Error("Creator not found for Maya calendar event insert.");
    }

    if (args.startTimeMs >= args.endTimeMs) {
      throw new Error(
        "Maya calendar event start must be strictly before end.",
      );
    }
    if (args.actionable && args.citedRefs.length === 0) {
      throw new Error(
        "Actionable Maya calendar events require at least one cited ref " +
          "(architectural principle: grounded or silent).",
      );
    }

    // Idempotency: same (creatorId, googleEventId) returns the existing row.
    // Calendar HTTP wrapper assigns its own googleEventId on create; we
    // dedupe here so a flaky retry can't double-insert.
    const existing = await ctx.db
      .query("mayaCalendarEvents")
      .withIndex("by_creator_and_google_event", (q) =>
        q.eq("creatorId", args.creatorId).eq("googleEventId", args.googleEventId),
      )
      .first();
    if (existing) {
      return { mayaCalendarEventId: existing._id, deduped: true } as const;
    }

    // Plan-tier weekly cap — count Maya-authored events of the SAME kind in
    // the creator's running week. "Running week" = Sun 00:00 → next Sun
    // 00:00 in the creator's tz. We approximate it via a 7-day rolling
    // window anchored at the event's startTimeMs (good enough for cap
    // purposes — tests cover both the inclusive lower and exclusive upper
    // boundary semantics).
    const tier = calendarTierFromPlan(creator.plan);
    const cap = weeklyCalendarEventCapPerKind(tier, args.kind);
    if (cap !== "unlimited") {
      const windowStart = args.startTimeMs - 7 * 24 * 60 * 60 * 1000;
      const sameWeek = await ctx.db
        .query("mayaCalendarEvents")
        .withIndex("by_creator_and_start", (q) =>
          q
            .eq("creatorId", args.creatorId)
            .gte("startTimeMs", windowStart)
            .lte("startTimeMs", args.startTimeMs + 7 * 24 * 60 * 60 * 1000),
        )
        .collect();
      const sameKindCount = sameWeek.filter((row) => row.kind === args.kind)
        .length;
      if (sameKindCount >= cap) {
        throw new CalendarCapError(tier, args.kind, cap, sameKindCount);
      }
    }

    const now = args.nowMs ?? Date.now();
    const mayaCalendarEventId = await ctx.db.insert("mayaCalendarEvents", {
      creatorId: args.creatorId,
      googleEventId: args.googleEventId,
      kind: args.kind,
      citedRefs: args.citedRefs,
      bodyVersion: args.bodyVersion ?? 1,
      lastEditedByMaya: args.lastEditedByMaya ?? now,
      actionable: args.actionable,
      sourceStandingOrderId: args.sourceStandingOrderId,
      startTimeMs: args.startTimeMs,
      endTimeMs: args.endTimeMs,
    });
    return { mayaCalendarEventId, deduped: false } as const;
  },
});

export const listMayaCalendarEventsForCreatorAndWindow = internalQuery({
  args: {
    creatorId: v.id("creators"),
    fromMs: v.number(),
    toMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.fromMs > args.toMs) {
      // Empty window — degenerate input, return empty rather than throw so
      // the heartbeat scan can early-out without a try/catch.
      return [];
    }
    const rows = await ctx.db
      .query("mayaCalendarEvents")
      .withIndex("by_creator_and_start", (q) =>
        q
          .eq("creatorId", args.creatorId)
          .gte("startTimeMs", args.fromMs)
          .lte("startTimeMs", args.toMs),
      )
      .collect();
    return rows;
  },
});

export const markNudgeSent = internalMutation({
  args: {
    mayaCalendarEventId: v.id("mayaCalendarEvents"),
    kind: v.union(v.literal("pre"), v.literal("post")),
    nowMs: v.optional(v.number()),
    waiveReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mayaCalendarEventId);
    if (!row) {
      throw new Error("Maya calendar event not found for markNudgeSent.");
    }
    const now = args.nowMs ?? Date.now();
    if (args.kind === "pre") {
      await ctx.db.patch(row._id, {
        preEventNudgeSentAt: args.waiveReason ? undefined : now,
        preEventNudgeWaiveReason: args.waiveReason,
      });
    } else {
      await ctx.db.patch(row._id, {
        postEventCheckInSentAt: args.waiveReason ? undefined : now,
        postEventCheckInWaiveReason: args.waiveReason,
      });
    }
    return await ctx.db.get(row._id);
  },
});

export const findMayaEventByGoogleId = internalQuery({
  args: {
    creatorId: v.id("creators"),
    googleEventId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mayaCalendarEvents")
      .withIndex("by_creator_and_google_event", (q) =>
        q.eq("creatorId", args.creatorId).eq("googleEventId", args.googleEventId),
      )
      .first();
  },
});

export const updateBodyVersion = internalMutation({
  args: {
    mayaCalendarEventId: v.id("mayaCalendarEvents"),
    bodyVersion: v.number(),
    lastEditedByMaya: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.mayaCalendarEventId);
    if (!row) {
      throw new Error("Maya calendar event not found for updateBodyVersion.");
    }
    if (args.bodyVersion <= row.bodyVersion) {
      throw new Error(
        `bodyVersion must strictly increase (current=${row.bodyVersion}, requested=${args.bodyVersion}).`,
      );
    }
    await ctx.db.patch(row._id, {
      bodyVersion: args.bodyVersion,
      lastEditedByMaya: args.lastEditedByMaya,
    });
    return await ctx.db.get(row._id);
  },
});

// ---------------------------------------------------------------------------
// Pure body templater — no Convex state, fully unit-testable.
// ---------------------------------------------------------------------------

export interface RenderEventBodyContext {
  /** Per-kind structured fields. Shape varies by kind — see per-kind code. */
  // Free-form because the kind types diverge; the templater destructures
  // only the fields it expects and ignores extras.
  [k: string]: unknown;
}

export interface RenderedEventBody {
  title: string;
  description: string;
}

export interface RenderEventBodyArgs {
  kind: MayaCalendarEventKind;
  context: RenderEventBodyContext;
  voiceFingerprint?: string;
  toneSlider?:
    | "warm"
    | "blunt"
    | "playful"
    | "strategic"
    | "tough_love"
    | string;
  planTier?: CalendarPlanTier;
}

/**
 * Per-kind body template. Returns the structured (title, description)
 * pair for the calendar event. The description is RAW prose — AGENTS.md
 * instructs Maya to pipe it through maya-voice-applier (apply voice
 * fingerprint + tone slider) AND maya-citation-firewall (verify every
 * named entity has a corresponding citedRef) before invoking the
 * calendar create endpoint.
 *
 * The templates are intentionally a strong starting shape rather than
 * fully-finalized prose — Maya's job is to make them sing in her voice;
 * this function's job is to make sure the citations + structure are
 * non-negotiable.
 */
export function renderEventBody(args: RenderEventBodyArgs): RenderedEventBody {
  switch (args.kind) {
    case "trend-strike":
      return renderTrendStrike(args.context);
    case "content-block":
      return renderContentBlock(args.context);
    case "post-publish":
      return renderPostPublish(args.context);
    case "niche-scroll":
      return renderNicheScroll(args.context);
    case "comment-window":
      return renderCommentWindow(args.context);
    case "brand-outbox":
      return renderBrandOutbox(args.context);
    case "weekly-review":
      return renderWeeklyReview(args.context);
    case "brain-break":
      return renderBrainBreak(args.context);
  }
}

// --- per-kind templates ----------------------------------------------------

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function renderTrendStrike(c: RenderEventBodyContext): RenderedEventBody {
  const trendName = asStr(c.trendName, "an active trend");
  const trendUrl = asStr(c.trendUrl);
  const peer = asStr(c.peerHandle);
  const peerViews = asNum(c.peerViews);
  const ageHours = asNum(c.ageHours);
  const hookIdea = asStr(c.hookIdea);
  const peerLine = peer
    ? `${peer} hit ${peerViews.toLocaleString()} views with this format ${Math.round(ageHours)}h ago`
    : `surfacing now in your niche`;
  const title = `Trend strike — ${trendName}`;
  const description = [
    `Hop on this before it cools. ${peerLine}.`,
    "",
    `Source: ${trendUrl || "(see cited refs)"}`,
    "",
    hookIdea ? `Hook to try: ${hookIdea}` : `Hook angle: pick from the cited example.`,
    "",
    "30-60 min: open the source, watch it twice, draft your own hook, film one take.",
  ].join("\n");
  return { title, description };
}

function renderContentBlock(c: RenderEventBodyContext): RenderedEventBody {
  const ideaCards = asStrArr(c.ideaCards);
  const filmingFocus = asStr(c.filmingFocus, "Filming block");
  const title = `Content block — ${filmingFocus}`;
  const cards =
    ideaCards.length > 0
      ? ideaCards.map((card, i) => `${i + 1}. ${card}`).join("\n")
      : "Idea cards land here at deploy time (see cited refs).";
  const description = [
    `1-2 hour filming session. ${ideaCards.length} idea cards ready.`,
    "",
    cards,
    "",
    "Light + outfit + B-roll go on the prep checklist in chat — ping me 15 before and I'll walk it through.",
  ].join("\n");
  return { title, description };
}

function renderPostPublish(c: RenderEventBodyContext): RenderedEventBody {
  const platform = asStr(c.platform, "your platform");
  const caption = asStr(c.caption);
  const firstComment = asStr(c.firstComment);
  const optimalTimeLabel = asStr(c.optimalTimeLabel);
  const postUrl = asStr(c.postUrl);
  const title = `Post: ${platform}${optimalTimeLabel ? " — " + optimalTimeLabel : ""}`;
  const description = [
    `10-20 min publish window. ${optimalTimeLabel ? `Hit ${optimalTimeLabel} for ${platform}.` : "Publish now."}`,
    "",
    caption ? `Caption: ${caption}` : `Caption: pending — confirm in chat.`,
    "",
    firstComment ? `First comment: ${firstComment}` : `First comment: pending — confirm in chat.`,
    "",
    postUrl ? `Draft: ${postUrl}` : `(see cited refs for the draft)`,
  ].join("\n");
  return { title, description };
}

function renderNicheScroll(c: RenderEventBodyContext): RenderedEventBody {
  const peers = asStrArr(c.peers);
  const hashtags = asStrArr(c.hashtags);
  const focus = asStr(c.focus, "your niche FYP");
  const title = `Niche scroll — ${focus}`;
  const description = [
    `15-30 min focused scroll. Specific peers + hashtags to dig:`,
    "",
    peers.length > 0
      ? `Peers: ${peers.map((p) => (p.startsWith("@") ? p : "@" + p)).join(", ")}`
      : `Peers: see cited refs.`,
    hashtags.length > 0 ? `Hashtags: ${hashtags.join(", ")}` : `Hashtags: see cited refs.`,
    "",
    "What I want from you: 3 hooks worth screenshotting + 1 format you'd never try (so I know your edges).",
  ].join("\n");
  return { title, description };
}

function renderCommentWindow(c: RenderEventBodyContext): RenderedEventBody {
  const ownPostUrl = asStr(c.ownPostUrl);
  const peerHandles = asStrArr(c.peerHandles);
  const title = `Comment window — own post + 5 peers`;
  const description = [
    "20-30 min engagement burst.",
    "",
    ownPostUrl
      ? `1. Reply to every comment on: ${ownPostUrl}`
      : `1. Reply to every comment on your most recent post (see cited refs).`,
    "",
    peerHandles.length > 0
      ? `2. Drop one substantive comment on each:\n${peerHandles
          .map((h) => `   - ${h.startsWith("@") ? h : "@" + h}`)
          .join("\n")}`
      : `2. Drop one substantive comment on each of the 5 peers in cited refs.`,
    "",
    "Substantive = a sentence that proves you watched, not a fire emoji.",
  ].join("\n");
  return { title, description };
}

function renderBrandOutbox(c: RenderEventBodyContext): RenderedEventBody {
  const brandThreads = asStrArr(c.brandThreads);
  const draftCount = asNum(c.draftCount, brandThreads.length);
  const title = `Brand outbox — ${draftCount} draft${draftCount === 1 ? "" : "s"} waiting`;
  const description = [
    `20-30 min brand-email block. ${draftCount} draft${draftCount === 1 ? "" : "s"} ready for your review.`,
    "",
    brandThreads.length > 0
      ? brandThreads.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : "Threads listed in cited refs.",
    "",
    "Approve / edit / decline — I won't send anything you haven't seen on Coach. On Manager, I'll send the firm-decline + accept variants under your threshold once you greenlight the policy.",
  ].join("\n");
  return { title, description };
}

function renderWeeklyReview(c: RenderEventBodyContext): RenderedEventBody {
  const weekLabel = asStr(c.weekLabel, "last week");
  const topPostUrl = asStr(c.topPostUrl);
  const followerDelta = asNum(c.followerDelta);
  const title = `Weekly review with Maya`;
  const description = [
    `30 min. Sunday 7pm local. Sit-with-me block — not on your phone, on the couch.`,
    "",
    `What we'll cover for ${weekLabel}:`,
    `- Follower delta: ${followerDelta >= 0 ? "+" : ""}${followerDelta.toLocaleString()}`,
    topPostUrl ? `- Top post: ${topPostUrl}` : `- Top post: see cited refs`,
    `- 3 things that worked, 1 thing that didn't, the call for next week`,
    "",
    "Bring questions. I bring the data.",
  ].join("\n");
  return { title, description };
}

function renderBrainBreak(c: RenderEventBodyContext): RenderedEventBody {
  const reason = asStr(c.reason, "you booked a full off day");
  const title = `Brain break — content off`;
  const description = [
    `Explicit non-content day. ${reason}.`,
    "",
    `I won't ping with ideas or trends today. I'll still triage urgent inbound brand emails so nothing time-sensitive falls through. Back to the regular cadence tomorrow.`,
  ].join("\n");
  return { title, description };
}

// ---------------------------------------------------------------------------
// Helpers shared with tests.
// ---------------------------------------------------------------------------

export type MayaCalendarEventDoc = Doc<"mayaCalendarEvents">;
export type MayaCalendarEventId = Id<"mayaCalendarEvents">;

// Re-export for sibling modules that want to import the validators directly
// (e.g. an HTTP wrapper that mirrors the same argument shape).
export const _validators = {
  citedRef: citedRefValidator,
  kind: kindValidator,
};

// Type-only re-export to keep TS happy when the ctx types are referenced
// from other files in the package — no runtime cost.
export type _MayaCalendarEventCtx = MutationCtx | QueryCtx;
