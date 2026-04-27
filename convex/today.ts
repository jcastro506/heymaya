/**
 * Today screen queries.
 *
 * The Today screen at `app/(creator)/today/page.tsx` is the most-trafficked
 * Creator HQ surface — it loads on every brief notification tap. Every query
 * here is a cross-tenant-safe read against the signed-in creator only:
 *   1. Resolve identity from Clerk via `ctx.auth.getUserIdentity()`.
 *   2. Look up the creators row by clerkUserId.
 *   3. Filter every downstream `withIndex("by_creator", ...)` to that row.
 * Returning `null` for unauth / unresolved is the canonical signal the UI
 * uses to render "loading" vs "empty" — never throw, the dashboard renders
 * inside a Convex subscription that retries automatically.
 *
 * Plan-tier gating: most Today queries are universally available (every plan
 * gets a morning brief), but `outlierPosts` is Pro+ because it depends on
 * the post-publish reaction that Starter doesn't run (see playbook § Plan-tier
 * matrix). On Starter we return an empty array rather than throwing — the
 * UI hides the section gracefully.
 */

import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { planFeatures } from "./lib/planFeatures";

/**
 * Resolve the signed-in creator. Returns null when the request is unauth or
 * the Clerk user has no creators row yet (e.g., webhook still in-flight).
 *
 * Centralizing this here keeps every query in this file using the exact same
 * cross-tenant gate. Adding a new query? Call this first; never accept a
 * `creatorId` argument from the client.
 */
async function getCurrentCreator(
  ctx: QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

/**
 * Latest dailyBriefs row for the signed-in creator. The Today screen renders
 * `markdown` directly + iterates `recommendations` and `pendingItems`.
 *
 * Returns null when:
 *   - Unauthenticated (UI shows skeleton)
 *   - Creator row not yet provisioned (webhook lag)
 *   - Maya hasn't written today's brief yet (UI shows empty state)
 *
 * We sort by `_creationTime` desc rather than `briefDateLocal` because the
 * latter is a string and a brand-new creator can have multiple draft briefs
 * in flight on day one — the most-recently-written wins.
 */
export const latestBrief = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;
    return await ctx.db
      .query("dailyBriefs")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .first();
  },
});

/**
 * Pending items the creator needs to act on:
 *   - drafts in `contentPlans.arc` with status === 'draft'
 *   - deliverables in `brandDeals` with status in ('signed','shooting','submitted') AND not yet paid
 *   - brand-emails in `brandDeals` with status === 'new' or 'reviewing' awaiting first reply
 *
 * The Today screen `pendingItems` section reads this directly. Items are
 * sorted: due-soon first, then by priority of kind (brand-email > deliverable
 * > draft) — drafts can wait, brand emails cannot.
 */
export const pendingItems = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];

    type Item = {
      kind: "draft" | "deliverable" | "brand-email";
      title: string;
      dueAt: number | null;
      sourceTable: string;
      sourceId: string;
    };
    const items: Item[] = [];

    // Drafts from this week's contentPlans (if any). We only surface drafts
    // for the most recent plan to avoid stacking weeks.
    const latestPlan = await ctx.db
      .query("contentPlans")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .first();
    if (latestPlan) {
      for (let i = 0; i < latestPlan.arc.length; i++) {
        const arc = latestPlan.arc[i];
        if (arc.status !== "draft") continue;
        items.push({
          kind: "draft",
          title: `${arc.platform} ${arc.format} — ${arc.hookOptions[0] ?? "draft"}`,
          dueAt: null,
          sourceTable: "contentPlans",
          sourceId: `${latestPlan._id}#${i}`,
        });
      }
    }

    // Active brand deals — partition into deliverable vs brand-email.
    const deals = await ctx.db
      .query("brandDeals")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    for (const d of deals) {
      if (d.status === "new" || d.status === "reviewing") {
        items.push({
          kind: "brand-email",
          title: `${d.brand} — awaiting your reply`,
          dueAt: null,
          sourceTable: "brandDeals",
          sourceId: d._id,
        });
      } else if (
        d.status === "signed" ||
        d.status === "shooting" ||
        d.status === "submitted"
      ) {
        items.push({
          kind: "deliverable",
          title: `${d.brand} — ${d.deliverables.join(", ") || "deliverable"}`,
          dueAt: d.dueAt ?? null,
          sourceTable: "brandDeals",
          sourceId: d._id,
        });
      }
    }

    // Brand-email > deliverable > draft, then dueAt asc (nulls last).
    const KIND_RANK: Record<Item["kind"], number> = {
      "brand-email": 0,
      deliverable: 1,
      draft: 2,
    };
    items.sort((a, b) => {
      const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
      if (k !== 0) return k;
      if (a.dueAt === null && b.dueAt === null) return 0;
      if (a.dueAt === null) return 1;
      if (b.dueAt === null) return -1;
      return a.dueAt - b.dueAt;
    });

    return items;
  },
});

/**
 * Revenue widget data — MTD count and a 30-day daily-totals array (sparkline-
 * ready). MTD is the sum of `paidAmountUsd` across `brandDeals` with
 * status === 'paid' and `paidAt` falling in the current local month.
 *
 * The 30-day trend is daily totals over the last 30 days, oldest first.
 * Returns `{ mtdUsd: 0, trend: [...] }` when nothing is paid yet — Today's
 * widget always shows the line, even if flat at zero.
 */
export const revenueWidget = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;

    const now = Date.now();
    const monthStart = startOfMonthUtc(now);
    const trendStart = now - 30 * 24 * 60 * 60 * 1000;

    const paidDeals = await ctx.db
      .query("brandDeals")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", creator._id).eq("status", "paid")
      )
      .collect();

    let mtdUsd = 0;
    const buckets = new Array<number>(30).fill(0);
    for (const d of paidDeals) {
      const ts = d.paidAt ?? d.updatedAt;
      const usd = d.paidAmountUsd ?? d.offerAmountUsd ?? 0;
      if (ts >= monthStart) mtdUsd += usd;
      if (ts >= trendStart && ts <= now) {
        const dayOffset = Math.floor((now - ts) / (24 * 60 * 60 * 1000));
        const idx = 29 - dayOffset;
        if (idx >= 0 && idx < 30) buckets[idx] += usd;
      }
    }

    return { mtdUsd, trend: buckets };
  },
});

/**
 * Today's outlier posts — posts marked in the latest brief's `outlierPostIds`
 * that the 2h performance check flagged as top-quartile vs the creator's
 * trailing-30 baseline. The Today screen surfaces these as a "Outlier"
 * lime-pill badge that links into Performance.
 *
 * Plan-tier: this depends on the post-publish reaction + 2h performance
 * check, both of which Starter does not run. We return [] for Starter rather
 * than throwing — fail-closed but graceful (UI hides the section).
 */
export const outlierPosts = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];

    // Plan-tier gate. Starter doesn't run the 2h performance check that
    // produces outlier flags (see playbook § 7 plan-tier matrix). Returning
    // [] here keeps the UI clean while still being fail-closed: even if a
    // rogue write put outlier ids into a Starter brief, we won't surface
    // them.
    const features = planFeatures(creator);
    if (!features.proactiveCronAll) return [];

    const latest = await ctx.db
      .query("dailyBriefs")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .first();
    if (!latest || latest.outlierPostIds.length === 0) return [];

    // Hydrate post rows. Filter creatorId-mismatch defensively — should never
    // happen given how briefs are written, but a stale outlierPostIds entry
    // pointing to another creator's post would otherwise leak.
    const posts: Doc<"posts">[] = [];
    for (const pid of latest.outlierPostIds) {
      const p = await ctx.db.get(pid as Id<"posts">);
      if (!p) continue;
      if (p.creatorId !== creator._id) continue;
      posts.push(p);
    }
    return posts;
  },
});

/* -------------------------------------------------------------------------- */
/* Goals + Focus + Maya activity strip — Today's anchor (added 2026-04-26)     */
/* -------------------------------------------------------------------------- */

/**
 * `goalsFocusContext` powers the GoalsFocusStrip that sits ABOVE every other
 * Today section. The strip's job is to anchor the creator: open the app and
 * immediately see (a) the goals they told Maya about, (b) the strategic focus
 * Maya is working under right now, and (c) what Maya is actively running.
 *
 * Plan-tier: every tier sees this. The strip is universal — it's the
 * orientation surface, not a feature. Plan-gated capabilities show up
 * elsewhere (deal desk, opportunity scout, brand outreach).
 *
 * Cross-tenant: identity-resolved like every other read in this file. We
 * never accept a client-supplied creatorId.
 *
 * Defensive shape: the strip is meant to absorb future onboarding fields
 * (Wave 2 will add multi-select goals, blockers, 90-day priority, etc.).
 * The query returns a wide goals object whose fields are nullable so the UI
 * can render only what's present without breaking.
 *
 * Returns null on unauth so the UI can skip the strip cleanly.
 */
export const goalsFocusContext = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;

    // ─── Goals (left column) ────────────────────────────────────────────────
    // Read from the onboarding answers buffer first. Once Sprint 2's
    // submitOnboardingAnswers persists into creatorPicture, we mirror to
    // picture-owned fields too — so we coalesce the buffer with picture
    // fields (buffer wins because it's the latest creator-stated truth).
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    const answers = creator.onboardingProgress?.answers;

    const goalFree = (answers?.goal ?? null) as string | null;
    const oneYear =
      (answers?.longTermGoals?.oneYear ??
        picture?.longTermGoals?.oneYear ??
        null) as string | null;
    const fiveYear =
      (answers?.longTermGoals?.fiveYear ??
        picture?.longTermGoals?.fiveYear ??
        null) as string | null;
    const revenueStreams: ReadonlyArray<string> = (answers?.revenueStreams ??
      picture?.currentRevenueStreams ??
      []) as ReadonlyArray<string>;
    // careerStage on the buffer is the SELF-REPORTED value (Sprint 2 may
    // override picture.careerStage with the data-inferred call). We surface
    // the picture-owned value when available because it's the source of truth
    // post-synthesis; the answer-buffer fallback covers pre-synthesis.
    const careerStage = (picture?.careerStage ??
      answers?.careerStage ??
      null) as
      | "just-starting"
      | "building"
      | "monetizing"
      | "scaling"
      | null;

    // ─── Focus (middle column) ──────────────────────────────────────────────
    // Prefer the rich growthPlan synthesis emits; fall back to the legacy
    // narrow `nextMilestone.label` + `focusArea` shape if rich fields aren't
    // populated yet.
    const growthPlan = picture?.growthPlan ?? null;
    const richFocusAreas = growthPlan?.focusAreas ?? null;
    const nextMilestoneText =
      growthPlan?.nextMilestoneText ??
      growthPlan?.nextMilestone?.label ??
      null;
    const focusAreas: ReadonlyArray<string> =
      richFocusAreas && richFocusAreas.length > 0
        ? richFocusAreas
        : growthPlan?.focusArea
          ? [growthPlan.focusArea]
          : [];
    const horizonWeeks = growthPlan?.horizonWeeks ?? null;

    // ─── Maya's currently working on (right column) ─────────────────────────
    // Top 3 most recent `outcome="ran"` rows in the last 24h. We read the
    // by_creator_and_ts index in desc order to get the freshest first.
    const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - TWENTY_FOUR_H_MS;
    const recentRows = await ctx.db
      .query("mayaActionLog")
      .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .take(40);
    const recentMayaActions = recentRows
      .filter((r) => r.outcome === "ran" && r.ts >= cutoff)
      .slice(0, 3)
      .map((r) => ({
        entryId: r.entryId,
        detail: r.detail ?? null,
        ts: r.ts,
      }));

    // Next-scheduled cron hint — synthetic, derived from the creator's
    // timezone + the well-known cron schedule (morning_brief 7am, evening_recap
    // 7pm, weekly_review Sunday 9pm). Reading jobs.json from a query is
    // disallowed (no fs in the Convex sandbox), so we synthesize.
    const nextScheduledCronHint = computeNextScheduledHint(
      Date.now(),
      creator.timezone
    );

    // hasInferredPicture mirrors `creatorStage`'s definition so the HQ stays
    // coherent: a picture exists AND it isn't a placeholder ("awaiting-synthesis"
    // or "manual-seed" mean Maya hasn't actually inferred yet).
    const hasInferredPicture =
      picture !== null &&
      picture.model !== "awaiting-synthesis" &&
      picture.model !== "manual-seed";

    return {
      goals: {
        free: goalFree,
        oneYear,
        fiveYear,
        revenueStreams,
        careerStage,
      },
      focus: {
        nextMilestoneText,
        focusAreas,
        horizonWeeks,
      },
      recentMayaActions,
      nextScheduledCronHint,
      hasInferredPicture,
    };
  },
});

/**
 * Synthesize the next scheduled cron hint based on the well-known shared
 * cron schedule (morning_brief 7am local; evening_recap 7pm local; weekly_review
 * Sunday 9pm local). Returns the next future event from `nowMs` in the
 * creator's timezone, formatted as a short label.
 *
 * Why synthetic: the runtime jobs.json lives on Fly with Maya's workspace and
 * isn't readable from a Convex query (no filesystem). The schedule is locked
 * shared infra (see standingOrders.ts) and changes via deploy, not at
 * runtime, so a synthetic hint is the right call here.
 *
 * Returns null when the timezone string is malformed (defensive — Intl
 * throws on bad timezones).
 */
function computeNextScheduledHint(
  nowMs: number,
  timezone: string | undefined
): string | null {
  if (!timezone) return null;
  // Read the local hour + day-of-week in the creator's tz. We use Intl with
  // a defensive try-catch because a malformed tz throws.
  let localHour: number;
  let localDow: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(new Date(nowMs));
    const hourPart = parts.find((p) => p.type === "hour");
    const dowPart = parts.find((p) => p.type === "weekday");
    if (!hourPart || !dowPart) return null;
    localHour = Number(hourPart.value);
    if (!Number.isFinite(localHour)) return null;
    const DOW: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    localDow = DOW[dowPart.value] ?? -1;
    if (localDow < 0) return null;
  } catch {
    return null;
  }

  // Earliest of: today's 7am, today's 7pm, Sunday 9pm. Compare in local-hour
  // arithmetic — close-enough for a hint, no need for full date math.
  if (localHour < 7) return "Morning brief at 7am local";
  if (localHour < 19) return "Evening recap at 7pm local";
  // After 7pm — next event is tomorrow's morning brief unless tonight is
  // Sunday and weekly_review (9pm) hasn't fired yet.
  if (localDow === 0 && localHour < 21) {
    return "Weekly review at 9pm local";
  }
  return "Morning brief at 7am local tomorrow";
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * UTC start-of-month for revenue MTD bucketing. We use UTC rather than the
 * creator's local-month boundary because Stripe payouts are timestamped in
 * UTC and a "month" mismatch between revenue and the rest of the dashboard
 * is more confusing than a 24h timezone drift on the boundary day.
 *
 * If a creator obsesses about local-month precision we'll revisit; for v0
 * the sparkline shape matters more than the day-1 boundary.
 */
function startOfMonthUtc(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}
