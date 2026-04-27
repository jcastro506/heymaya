/**
 * Growth tab queries — service-business HQ "outcome surface".
 *
 * Per `docs/SPRINT_PLAN_SERVICE_V0.md` § 12 (Wave C.7) and the operator's
 * north-star directive (`project_north_star_outcomes.md`): the two numbers
 * that matter are jobs booked + 5-star reviews. The lever between Maya's
 * actions and those numbers is GBP local-pack ranking. This file is the
 * READ surface that exposes Maya's attribution chain (Wave C.5 schema:
 * inboundLeads.originatingActionKind/Id + serviceJobs.originatingLeadId +
 * reviewRequests.attributedReviewId + weeklyLearnings) and her GBP Health
 * Score (Wave C.6 schema: gbpHealthScores) to the operator.
 *
 * Hard rules (operator-stated, not negotiable):
 *   1. Trust LLM judgment, no hardcoded rules. The score on display IS Maya's
 *      persisted `compositeScore` + her `reasoning` verbatim. No recomputed
 *      scores, no synthesized rankings, no helper that takes input data and
 *      returns a score/rating — the judgment-not-rules invariant test
 *      enforces this by grepping for `function compute*Score` etc.
 *   2. Cross-tenant isolation is structural. Every query resolves via
 *      `getCurrentBusinessSession(ctx)` (no client-supplied `businessId`),
 *      and the one query that DOES accept a customerId also resolves
 *      cross-tenant via the customer's businessId match.
 *   3. Plan-tier gating is server-side and fail-closed. Starter is window-
 *      capped at 30d; Pro/Studio are unlimited. Pro/Studio additionally
 *      see per-action attribution breakdown + per-nudge audit log; Starter
 *      sees aggregates only.
 *
 * All queries return null/empty rather than throwing on no-session — the
 * UI uses `undefined` (loading) vs `null/empty` (no-data) to drive states.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { getCurrentBusinessSession, getSessionForBusiness } from "./_session";
import { planFeaturesService } from "../../planService";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;
const NINETY_DAYS_MS = 90 * ONE_DAY_MS;

/**
 * Window literal accepted by Growth queries. Starter clamps `90d` and `ytd`
 * to `30d`; Pro/Studio honor all four. Bogus values fall through to `30d`
 * (the adversarial-input path).
 */
const WINDOW_VALIDATOR = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("90d"),
  v.literal("ytd")
);

type GrowthWindow = "7d" | "30d" | "90d" | "ytd";

interface ResolvedWindow {
  /** UTC ms — inclusive lower bound. */
  startMs: number;
  /** UTC ms — exclusive upper bound (= now). */
  endMs: number;
  /** The window the data IS for (post-clamp). */
  effective: GrowthWindow;
  /** Set when Starter requested a wider window than allowed. */
  clampedFromRequestedWindow: GrowthWindow | null;
}

/**
 * Resolve the [start, end) window. Starter is capped to 30d; Pro/Studio
 * are unlimited. `ytd` is computed against UTC (the dashboard surface uses
 * UTC for cross-period comparison consistency; Today screen uses operator
 * timezone for the daily greeting because that's a per-day question).
 */
function resolveWindow(
  business: Pick<Doc<"businesses">, "planTier">,
  requested: GrowthWindow
): ResolvedWindow {
  const features = planFeaturesService(business);
  const isStarter = features.plan === "starter";
  const now = Date.now();

  // Plan-tier clamp: Starter cannot ask for windows wider than 30d.
  let effective: GrowthWindow = requested;
  let clampedFromRequestedWindow: GrowthWindow | null = null;
  if (isStarter && (requested === "90d" || requested === "ytd")) {
    effective = "30d";
    clampedFromRequestedWindow = requested;
  }

  let startMs: number;
  switch (effective) {
    case "7d":
      startMs = now - SEVEN_DAYS_MS;
      break;
    case "30d":
      startMs = now - THIRTY_DAYS_MS;
      break;
    case "90d":
      startMs = now - NINETY_DAYS_MS;
      break;
    case "ytd": {
      const d = new Date(now);
      startMs = Date.UTC(d.getUTCFullYear(), 0, 1);
      break;
    }
  }
  return { startMs, endMs: now, effective, clampedFromRequestedWindow };
}

/* -------------------------------------------------------------------------- */
/* getGrowthSummary — top-line metrics + period-over-period deltas             */
/* -------------------------------------------------------------------------- */

export interface GrowthMetric {
  /** Stable key — UI uses this for icon/copy mapping. */
  key:
    | "jobsBooked"
    | "fiveStarReviews"
    | "totalReviews"
    | "gbpCalls"
    | "gbpDirections"
    | "gbpWebsiteClicks"
    | "metaPostEngagement"
    | "leadToJobConversion"
    | "avgResponseLatencyMs";
  /** Aggregate count / value over the window. */
  value: number;
  /** Same metric for the prior, equal-length window. Null when no prior data. */
  priorValue: number | null;
  /** Per-step values for the in-window sparkline (1 step = 1 day). */
  spark: ReadonlyArray<number>;
  /**
   * Subset of `value` attributable to a Maya action via the C.5 attribution
   * chain. Null when the metric isn't attribution-applicable (e.g. raw
   * GBP-Insights pulls aren't action-attributed at the source). The UI
   * renders this as a "Maya: X of Y" badge.
   */
  attributedToMaya: number | null;
}

export interface GrowthSummary {
  /** The window the response is FOR — may differ from requested on Starter. */
  window: GrowthWindow;
  /** When set, indicates the requested window was clamped down. */
  clampedFromRequestedWindow: GrowthWindow | null;
  /** Operator's plan tier, surfaced so the UI can decide upgrade-CTAs without a second query. */
  plan: "starter" | "pro" | "studio";
  /** Top-line metric set; renderer order = display order. */
  metrics: ReadonlyArray<GrowthMetric>;
  /** UTC ms range, exposed so the UI can render period labels. */
  startMs: number;
  endMs: number;
}

export const getGrowthSummary = query({
  args: { window: WINDOW_VALIDATOR },
  handler: async (ctx, args): Promise<GrowthSummary | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const resolved = resolveWindow(session.business, args.window);
    const businessId = session.business._id;
    const features = planFeaturesService(session.business);

    // Pull the source rows once — every metric below is a projection of
    // these collections rather than per-metric ctx.db round-trips.
    const [jobs, reviews, leads, posts] = await Promise.all([
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("reviews")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("inboundLeads")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("gbpPosts")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
    ]);

    const periodLen = resolved.endMs - resolved.startMs;
    const priorStart = resolved.startMs - periodLen;
    const priorEnd = resolved.startMs;

    // ── Jobs booked — count distinct serviceJobs whose scheduledAt OR
    // completedAt falls in window. We use scheduledAt-or-completedAt because
    // a job booked Friday but completed Monday should count as a "Friday
    // book" against the window of booking. Falls back to createdAt when
    // neither is set (no-CRM rows).
    const jobBookedAt = (j: Doc<"serviceJobs">): number =>
      j.scheduledAt ?? j.completedAt ?? j.createdAt;

    const jobsInWindow = jobs.filter((j) => {
      const at = jobBookedAt(j);
      return at >= resolved.startMs && at < resolved.endMs;
    });
    const jobsPrior = jobs.filter((j) => {
      const at = jobBookedAt(j);
      return at >= priorStart && at < priorEnd;
    });
    const jobsAttributed = jobsInWindow.filter(
      (j) => j.originatingLeadId !== undefined
    ).length;

    // ── Reviews ─────────────────────────────────────────────────────────
    const reviewsInWindow = reviews.filter(
      (r) => r.receivedAt >= resolved.startMs && r.receivedAt < resolved.endMs
    );
    const reviewsPrior = reviews.filter(
      (r) => r.receivedAt >= priorStart && r.receivedAt < priorEnd
    );
    const fiveStarInWindow = reviewsInWindow.filter(
      (r) => r.starRating >= 5
    );
    const fiveStarPrior = reviewsPrior.filter((r) => r.starRating >= 5);

    // 5-star reviews attributed to Maya: the matching reviewRequests row
    // linked back via attributedReviewId. We resolve via a single per-business
    // pull rather than per-review lookup.
    const reviewRequests = await ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    const attributedReviewIds = new Set<Id<"reviews">>();
    for (const rr of reviewRequests) {
      if (rr.attributedReviewId) attributedReviewIds.add(rr.attributedReviewId);
    }
    const fiveStarAttributed = fiveStarInWindow.filter((r) =>
      attributedReviewIds.has(r._id)
    ).length;

    // ── GBP engagement (calls / directions / website clicks) ────────────
    // engagementMetrics is engagement OVER THE LIFETIME of the post —
    // we attribute to a window by `engagementPolledAt` falling in window
    // (the poller writes the absolute totals on each pull). For accurate
    // window math we'd need delta-snapshots; for v0 we use the latest poll
    // per post that lands in window.
    let gbpCalls = 0;
    let gbpDirections = 0;
    let gbpWebsite = 0;
    let gbpCallsPrior = 0;
    let gbpDirectionsPrior = 0;
    let gbpWebsitePrior = 0;
    for (const p of posts) {
      if (!p.engagementMetrics || p.engagementPolledAt === undefined) continue;
      const t = p.engagementPolledAt;
      if (t >= resolved.startMs && t < resolved.endMs) {
        gbpCalls += p.engagementMetrics.callsClicked;
        gbpDirections += p.engagementMetrics.directionsClicked;
        gbpWebsite += p.engagementMetrics.websiteClicked;
      } else if (t >= priorStart && t < priorEnd) {
        gbpCallsPrior += p.engagementMetrics.callsClicked;
        gbpDirectionsPrior += p.engagementMetrics.directionsClicked;
        gbpWebsitePrior += p.engagementMetrics.websiteClicked;
      }
    }

    // ── Meta post engagement ────────────────────────────────────────────
    // The schema's `engagement` (FB/IG via Zernio) is on gbpPosts only at
    // present; per the Wave C handoff Meta post engagement is tracked on
    // the same `engagement` shape but without its own table yet, so we
    // surface a 0 here and let the UI label it as Meta-pending. This is
    // intentionally NOT computed from `engagementMetrics` — those are
    // GBP-Insights-only fields.
    const metaPostEngagement = 0;
    const metaPostEngagementPrior = 0;

    // ── Lead-to-job conversion (% of leads in window that converted) ────
    const leadsInWindow = leads.filter(
      (l) => l.capturedAt >= resolved.startMs && l.capturedAt < resolved.endMs
    );
    const leadsPrior = leads.filter(
      (l) => l.capturedAt >= priorStart && l.capturedAt < priorEnd
    );
    const convInWindow =
      leadsInWindow.length === 0
        ? 0
        : Math.round(
            (leadsInWindow.filter((l) => l.convertedJobId !== undefined)
              .length /
              leadsInWindow.length) *
              1000
          ) / 10;
    const convPrior =
      leadsPrior.length === 0
        ? 0
        : Math.round(
            (leadsPrior.filter((l) => l.convertedJobId !== undefined).length /
              leadsPrior.length) *
              1000
          ) / 10;

    // ── Avg response latency (ms) — only count leads that have responded ─
    const respondedInWindow = leadsInWindow.filter(
      (l) => l.responseLatencyMs !== undefined
    );
    const respondedPrior = leadsPrior.filter(
      (l) => l.responseLatencyMs !== undefined
    );
    const avgLatency =
      respondedInWindow.length === 0
        ? 0
        : Math.round(
            respondedInWindow.reduce(
              (acc, l) => acc + (l.responseLatencyMs ?? 0),
              0
            ) / respondedInWindow.length
          );
    const avgLatencyPrior =
      respondedPrior.length === 0
        ? 0
        : Math.round(
            respondedPrior.reduce(
              (acc, l) => acc + (l.responseLatencyMs ?? 0),
              0
            ) / respondedPrior.length
          );

    // ── Sparklines ──────────────────────────────────────────────────────
    // Daily buckets across the window. Caps at 90 buckets so we don't pay
    // an unbounded sparkline render cost on YTD requests.
    const SPARK_MAX = 90;
    const dayCount = Math.min(
      Math.max(1, Math.ceil(periodLen / ONE_DAY_MS)),
      SPARK_MAX
    );
    const stepMs = periodLen / dayCount;
    const bucket = (xs: ReadonlyArray<number>): number[] => {
      const out = new Array<number>(dayCount).fill(0);
      for (const t of xs) {
        const idx = Math.min(
          Math.max(Math.floor((t - resolved.startMs) / stepMs), 0),
          dayCount - 1
        );
        out[idx] += 1;
      }
      return out;
    };

    const metrics: GrowthMetric[] = [
      {
        key: "jobsBooked",
        value: jobsInWindow.length,
        priorValue: jobsPrior.length,
        spark: bucket(jobsInWindow.map(jobBookedAt)),
        attributedToMaya: jobsAttributed,
      },
      {
        key: "fiveStarReviews",
        value: fiveStarInWindow.length,
        priorValue: fiveStarPrior.length,
        spark: bucket(fiveStarInWindow.map((r) => r.receivedAt)),
        attributedToMaya: fiveStarAttributed,
      },
      {
        key: "totalReviews",
        value: reviewsInWindow.length,
        priorValue: reviewsPrior.length,
        spark: bucket(reviewsInWindow.map((r) => r.receivedAt)),
        attributedToMaya: null,
      },
      {
        key: "gbpCalls",
        value: gbpCalls,
        priorValue: gbpCallsPrior,
        spark: [],
        attributedToMaya: null,
      },
      {
        key: "gbpDirections",
        value: gbpDirections,
        priorValue: gbpDirectionsPrior,
        spark: [],
        attributedToMaya: null,
      },
      {
        key: "gbpWebsiteClicks",
        value: gbpWebsite,
        priorValue: gbpWebsitePrior,
        spark: [],
        attributedToMaya: null,
      },
      {
        key: "metaPostEngagement",
        value: metaPostEngagement,
        priorValue: metaPostEngagementPrior,
        spark: [],
        attributedToMaya: null,
      },
      {
        key: "leadToJobConversion",
        value: convInWindow,
        priorValue: convPrior,
        spark: [],
        attributedToMaya: null,
      },
      {
        key: "avgResponseLatencyMs",
        value: avgLatency,
        priorValue: avgLatencyPrior,
        spark: [],
        attributedToMaya: null,
      },
    ];

    return {
      window: resolved.effective,
      clampedFromRequestedWindow: resolved.clampedFromRequestedWindow,
      plan: features.plan,
      metrics,
      startMs: resolved.startMs,
      endMs: resolved.endMs,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* getMayaContributionThisWeek — Today header card                             */
/* -------------------------------------------------------------------------- */

export interface MayaContributionThisWeek {
  /** Jobs booked in the rolling 7d window with `originatingLeadId` set. */
  jobsAttributedCount: number;
  /** 5-star reviews in the rolling 7d window with a matching reviewRequest link. */
  fiveStarReviewsAttributedCount: number;
  /** Latest `gbpHealthScores.compositeScore` (any age). Null when no audit run yet. */
  gbpHealthScore: number | null;
  /** Maya's reasoning for the score. Null iff `gbpHealthScore` is null. */
  gbpHealthScoreReasoning: string | null;
  /** UTC ms — start of the rolling 7d window. */
  weekStartMs: number;
  /** UTC ms — end of the rolling 7d window (= now). */
  weekEndMs: number;
}

export const getMayaContributionThisWeek = query({
  args: {},
  handler: async (ctx): Promise<MayaContributionThisWeek | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const now = Date.now();
    const weekStart = now - SEVEN_DAYS_MS;
    const businessId = session.business._id;

    // Jobs booked in week with originatingLeadId set.
    const jobs = await ctx.db
      .query("serviceJobs")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    const jobsAttributed = jobs.filter((j) => {
      const at = j.scheduledAt ?? j.completedAt ?? j.createdAt;
      return (
        at >= weekStart && at < now && j.originatingLeadId !== undefined
      );
    }).length;

    // 5-star reviews in week with attributedReviewId match.
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_business_and_received_at", (q) =>
        q.eq("businessId", businessId).gte("receivedAt", weekStart)
      )
      .collect();
    const reviewRequests = await ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    const attributedReviewIds = new Set<Id<"reviews">>();
    for (const rr of reviewRequests) {
      if (rr.attributedReviewId) attributedReviewIds.add(rr.attributedReviewId);
    }
    const fiveStarAttributed = reviews.filter(
      (r) =>
        r.starRating >= 5 &&
        r.receivedAt < now &&
        attributedReviewIds.has(r._id)
    ).length;

    // Latest GBP health score (no window — most recent any age, per spec).
    const latestHealth = await ctx.db
      .query("gbpHealthScores")
      .withIndex("by_business_and_at", (q) =>
        q.eq("businessId", businessId)
      )
      .order("desc")
      .first();

    return {
      jobsAttributedCount: jobsAttributed,
      fiveStarReviewsAttributedCount: fiveStarAttributed,
      gbpHealthScore: latestHealth?.compositeScore ?? null,
      gbpHealthScoreReasoning: latestHealth?.reasoning ?? null,
      weekStartMs: weekStart,
      weekEndMs: now,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* getGbpHealthScoreLatest — drilldown panel                                   */
/* -------------------------------------------------------------------------- */

export interface GbpHealthLatest {
  score: Doc<"gbpHealthScores">;
}

export const getGbpHealthScoreLatest = query({
  args: {},
  handler: async (ctx): Promise<GbpHealthLatest | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const score = await ctx.db
      .query("gbpHealthScores")
      .withIndex("by_business_and_at", (q) =>
        q.eq("businessId", session.business._id)
      )
      .order("desc")
      .first();
    if (!score) return null;
    return { score };
  },
});

/* -------------------------------------------------------------------------- */
/* getCustomerProvenance — Customer detail panel                               */
/* -------------------------------------------------------------------------- */

export type ProvenanceActionKind =
  | "gbp-post"
  | "lead-nudge"
  | "review-request"
  | "review-reply"
  | "none";

export interface CustomerProvenance {
  /** The lead chain anchor — most recent inboundLeads row this customer matches. */
  lead: {
    id: Id<"inboundLeads">;
    capturedAt: number;
    source: Doc<"inboundLeads">["source"];
    contactName?: string;
    respondedAtMs?: number;
    responseLatencyMs?: number;
    originatingActionKind: ProvenanceActionKind;
    originatingActionId?: string;
    convertedJobId?: Id<"serviceJobs">;
  };
  /** The originating-action snippet — Maya's action that produced the lead. */
  action: {
    kind: ProvenanceActionKind;
    /** Compact display text (e.g. post body, request channel + sentAt). */
    summary: string;
    /** UTC ms when the action happened (post.postedAt, request.sentAt, etc.). Null when unknown. */
    atMs: number | null;
  } | null;
  /** Converted job snippet, if the chain resolved through to a job. */
  convertedJob: {
    id: Id<"serviceJobs">;
    serviceType?: string;
    status: Doc<"serviceJobs">["status"];
    completedAt?: number;
  } | null;
}

export const getCustomerProvenance = query({
  args: { customerId: v.id("serviceCustomers") },
  handler: async (ctx, args): Promise<CustomerProvenance | null> => {
    // Cross-tenant resolution: load the customer first, then resolve the
    // session against its businessId. If the customer's businessId doesn't
    // match the caller's, getSessionForBusiness returns null.
    const customer = await ctx.db.get(args.customerId);
    if (!customer) return null;
    const session = await getSessionForBusiness(ctx, customer.businessId);
    if (!session) return null;

    // Find the customer's most-recent lead. We don't have a direct
    // customer→lead FK in v0; we match by phone number when present
    // (NER extractor + CRM webhooks stamp `contactPhone`). Fallback: name
    // exact-match against `contactName`. No phone + no name match → null.
    const allLeads = await ctx.db
      .query("inboundLeads")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .order("desc")
      .collect();

    const phoneMatch = customer.phone
      ? allLeads.find((l) => l.contactPhone === customer.phone)
      : undefined;
    const nameMatch =
      phoneMatch ??
      allLeads.find(
        (l) =>
          l.contactName !== undefined &&
          l.contactName.trim().toLowerCase() ===
            customer.name.trim().toLowerCase()
      );
    const lead = nameMatch;
    if (!lead) return null;

    // Resolve the originating action. The kind dispatches across tables and
    // the FK is a string (not v.id) per schema § 1762 — see the schema
    // comment on `originatingActionId` for why.
    let action: CustomerProvenance["action"] = null;
    if (
      lead.originatingActionKind &&
      lead.originatingActionKind !== "none" &&
      lead.originatingActionId
    ) {
      action = await loadActionSnippet(
        ctx,
        session.business._id,
        lead.originatingActionKind,
        lead.originatingActionId
      );
    }

    let convertedJob: CustomerProvenance["convertedJob"] = null;
    if (lead.convertedJobId) {
      const job = await ctx.db.get(lead.convertedJobId);
      if (job && job.businessId === session.business._id) {
        convertedJob = {
          id: job._id,
          serviceType: job.serviceType,
          status: job.status,
          completedAt: job.completedAt,
        };
      }
    }

    return {
      lead: {
        id: lead._id,
        capturedAt: lead.capturedAt,
        source: lead.source,
        contactName: lead.contactName,
        respondedAtMs: lead.respondedAtMs,
        responseLatencyMs: lead.responseLatencyMs,
        originatingActionKind: lead.originatingActionKind ?? "none",
        originatingActionId: lead.originatingActionId,
        convertedJobId: lead.convertedJobId,
      },
      action,
      convertedJob,
    };
  },
});

/**
 * Resolve a polymorphic originating-action FK to a small UI-friendly snippet.
 * Validates `businessId` match defensively even though the action will have
 * been linked under the same business by `linkLeadToAction`.
 */
async function loadActionSnippet(
  ctx: QueryCtx,
  businessId: Id<"businesses">,
  kind: "gbp-post" | "lead-nudge" | "review-request" | "review-reply",
  actionId: string
): Promise<CustomerProvenance["action"]> {
  switch (kind) {
    case "gbp-post": {
      const post = await ctx.db.get(actionId as Id<"gbpPosts">);
      if (!post || post.businessId !== businessId) return null;
      const summary =
        post.text.length > 140 ? `${post.text.slice(0, 139)}…` : post.text;
      return {
        kind,
        summary,
        atMs: post.postedAt ?? post.createdAt,
      };
    }
    case "review-request": {
      const rr = await ctx.db.get(actionId as Id<"reviewRequests">);
      if (!rr || rr.businessId !== businessId) return null;
      return {
        kind,
        summary: `${rr.channel} review request · ${rr.status}`,
        atMs: rr.sentAt ?? rr.createdAt,
      };
    }
    case "review-reply": {
      const review = await ctx.db.get(actionId as Id<"reviews">);
      if (!review || review.businessId !== businessId) return null;
      const summary = review.draftReply
        ? review.draftReply.length > 140
          ? `${review.draftReply.slice(0, 139)}…`
          : review.draftReply
        : `Reply to ${review.starRating}-star review`;
      return {
        kind,
        summary,
        atMs: review.publishedAt ?? review.receivedAt,
      };
    }
    case "lead-nudge": {
      const sourceLead = await ctx.db.get(actionId as Id<"inboundLeads">);
      if (!sourceLead || sourceLead.businessId !== businessId) return null;
      return {
        kind,
        summary: `Lead-response nudge on ${humanLeadSource(sourceLead.source)}`,
        atMs: sourceLead.mayaNudgedAt ?? sourceLead.capturedAt,
      };
    }
  }
}

function humanLeadSource(source: Doc<"inboundLeads">["source"]): string {
  switch (source) {
    case "gbp-msg":
      return "GBP message";
    case "fb-dm":
      return "Facebook DM";
    case "twilio-missed-call":
      return "missed call";
    case "twilio-sms":
      return "text";
  }
}

/* -------------------------------------------------------------------------- */
/* getAttributionBreakdown — Pro/Studio only                                   */
/* -------------------------------------------------------------------------- */

export interface AttributionBreakdown {
  window: GrowthWindow;
  /** Counts per Maya action kind that drove a job in window. */
  jobsByActionKind: Record<ProvenanceActionKind, number>;
  /** Counts per request channel that drove a 5-star review in window. */
  fiveStarsByRequestChannel: { sms: number; email: number };
  /** Last N (≤25) weeklyLearnings.topPatterns entries with provenance pointers. */
  recentLearnings: ReadonlyArray<{
    weekStartMs: number;
    weekEndMs: number;
    kind: string;
    claim: string;
    sampleSize: number;
    jobsAttributed: number;
    fiveStarsAttributed: number;
    confidence: number;
    wikiVaultPath: string;
  }>;
}

export const getAttributionBreakdown = query({
  args: { window: WINDOW_VALIDATOR },
  handler: async (ctx, args): Promise<AttributionBreakdown | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    // Plan-tier gate: Starter is aggregates-only. Server returns null;
    // the UI hides the section.
    const features = planFeaturesService(session.business);
    if (features.plan === "starter") return null;

    const resolved = resolveWindow(session.business, args.window);
    const businessId = session.business._id;

    const [jobs, leads, reviews, requests, learningsRows] = await Promise.all([
      ctx.db
        .query("serviceJobs")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("inboundLeads")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("reviews")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("reviewRequests")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect(),
      ctx.db
        .query("weeklyLearnings")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .order("desc")
        .take(8),
    ]);

    // Map lead._id → originatingActionKind for the jobs join.
    const leadKindById = new Map<Id<"inboundLeads">, ProvenanceActionKind>();
    for (const l of leads) {
      leadKindById.set(l._id, l.originatingActionKind ?? "none");
    }

    const jobsByActionKind: Record<ProvenanceActionKind, number> = {
      "gbp-post": 0,
      "lead-nudge": 0,
      "review-request": 0,
      "review-reply": 0,
      none: 0,
    };
    for (const j of jobs) {
      const at = j.scheduledAt ?? j.completedAt ?? j.createdAt;
      if (at < resolved.startMs || at >= resolved.endMs) continue;
      if (!j.originatingLeadId) continue;
      const kind = leadKindById.get(j.originatingLeadId) ?? "none";
      jobsByActionKind[kind] += 1;
    }

    // Five-star reviews by request channel (only those with a matching
    // attributed reviewRequest in window).
    const fiveStarsByRequestChannel = { sms: 0, email: 0 };
    const reviewById = new Map<Id<"reviews">, Doc<"reviews">>();
    for (const r of reviews) reviewById.set(r._id, r);
    for (const rr of requests) {
      if (!rr.attributedReviewId) continue;
      const review = reviewById.get(rr.attributedReviewId);
      if (!review) continue;
      if (review.starRating < 5) continue;
      if (
        review.receivedAt < resolved.startMs ||
        review.receivedAt >= resolved.endMs
      )
        continue;
      if (rr.channel === "sms" || rr.channel === "email") {
        fiveStarsByRequestChannel[rr.channel] += 1;
      }
    }

    // Flatten the most-recent learnings rows into a single list, capped at 25.
    const recentLearnings: Array<
      AttributionBreakdown["recentLearnings"][number]
    > = [];
    for (const row of learningsRows) {
      for (const p of row.topPatterns) {
        recentLearnings.push({
          weekStartMs: row.weekStartMs,
          weekEndMs: row.weekEndMs,
          kind: p.kind,
          claim: p.claim,
          sampleSize: p.sampleSize,
          jobsAttributed: p.jobsAttributed,
          fiveStarsAttributed: p.fiveStarsAttributed,
          confidence: p.confidence,
          wikiVaultPath: p.wikiVaultPath,
        });
        if (recentLearnings.length >= 25) break;
      }
      if (recentLearnings.length >= 25) break;
    }

    return {
      window: resolved.effective,
      jobsByActionKind,
      fiveStarsByRequestChannel,
      recentLearnings,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* getLatestWeeklyLearnings — Pro/Studio "Maya is getting smarter" callout     */
/* -------------------------------------------------------------------------- */

export const getLatestWeeklyLearnings = query({
  args: {},
  handler: async (ctx): Promise<Doc<"weeklyLearnings"> | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;
    const features = planFeaturesService(session.business);
    if (features.plan === "starter") return null;
    return await ctx.db
      .query("weeklyLearnings")
      .withIndex("by_business_and_week", (q) =>
        q.eq("businessId", session.business._id)
      )
      .order("desc")
      .first();
  },
});
