/**
 * Stage-aware HQ helpers — added 2026-04-26 by the Creator HQ business-
 * readiness audit, second pass.
 *
 * The product serves creators from their first 1K through 500K+. The HQ
 * adapts to wherever the creator is at via `creatorPicture.careerStage`
 * (data-inferred — Sprint 2 owns) with fallback to inference from current
 * top-handle follower count. This module provides:
 *
 *   - `Stage` type + the empty-state copy table
 *   - `<StageEmpty>`  — the common stage-aware empty card the HQ pages render
 *   - `<StageBanner>` — top-of-page "Maya knows where you are" banner
 *                        (just-starting + scaling get specialized framing)
 *   - `sectionOrderFor(stage)` — returns the ordering of Today/Plan/Deals
 *                                sections per stage so each page can order
 *                                its sections deterministically
 *
 * Empty-state copy lives here (not on the server) because (a) it's pure UI
 * prose, (b) the server returns the structured stage payload and the UI
 * decides which copy to render, (c) operator wants to iterate on the copy
 * without redeploying Convex.
 */

import Link from "next/link";

export type Stage = "just-starting" | "building" | "monetizing" | "scaling";

export type FocusArea =
  | "consistency"
  | "hook-craft"
  | "diversification"
  | "scale-systems";

export interface StageContext {
  stage: Stage;
  stageSource: "picture" | "inferred";
  topFollowers: number;
  nextMilestone: { label: string; targetFollowers: number };
  focusArea: FocusArea;
  // ─── Stage-aware adaptive product (Agent B, 2026-04-26) — optional ──────
  // Synthesis-emitted reconciliation + rich growth plan. All optional so
  // pre-synthesis pictures (or the fallback degrades-to-inferred path) keep
  // working. The HQ surfaces:
  //   - `gentleNudge` in StageBanner when present (Today only) so the
  //     creator is honestly told if their self-report and the data diverge.
  //   - `richGrowthPlan` in Plan/Today expandable disclosures.
  //   - `hasInferredPicture` so HQ pages can render "Maya is still
  //     synthesizing your picture" instead of crashing on null fields.
  hasInferredPicture?: boolean;
  careerStageReasoning?: string | null;
  gentleNudge?: string | null;
  richGrowthPlan?: {
    currentStage: Stage | null;
    nextMilestoneText: string | null;
    focusAreas: ReadonlyArray<string>;
    antiPatterns: ReadonlyArray<string>;
    horizonWeeks: number | null;
    citations: ReadonlyArray<{ platform: string; postId: string; usedFor: string }>;
    generatedAt: number | null;
  } | null;
  reconciliation?: {
    selfReported?: Stage | null | undefined;
    inferred: Stage;
    matches: boolean;
    evidence: string;
    gentleNudge?: string | null | undefined;
  } | null;
}

/* -------------------------------------------------------------------------- */
/* Empty-state copy table                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Per-screen × per-stage empty state copy. Each entry returns `{ title, body }`
 * shaped exactly like the existing `<EmptyCard>` callers expect, plus an
 * optional `cta` link (path + label) the page renders below the body.
 *
 * Operator note (2026-04-26): the worst outcome is a 1K creator seeing an
 * empty Deals pipeline and thinking "this product isn't for me." The
 * just-starting variants must reassure + cite the milestone Maya is tracking.
 */

export interface EmptyCopy {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}

export type EmptySlot =
  | "deals-inbound"
  | "deals-outbound"
  | "deals-opportunities"
  | "plan-current"
  | "today-brief"
  | "today-pending"
  | "today-revenue";

export function emptyCopyFor(slot: EmptySlot, ctx: StageContext): EmptyCopy {
  const milestone = ctx.nextMilestone.label;

  switch (slot) {
    case "deals-inbound":
      switch (ctx.stage) {
        case "just-starting":
          return {
            title: "Brand deals unlock at the building stage.",
            body: `Brand outreach kicks in once you're consistently posting in a clear niche. Your milestone is ${milestone} — Maya is tracking that. Until then, focus on the content plan and let the audience compound.`,
            cta: { href: "/plan", label: "Open this week's plan" },
          };
        case "building":
          return {
            title: "You're at the size where pitches make sense.",
            body: "Maya can draft your first one — connect Gmail in Profile so she can triage incoming brand emails too, and she'll start surfacing pitch-worthy opportunities in Outbound.",
            cta: { href: "/profile", label: "Connect Gmail" },
          };
        case "monetizing":
          return {
            title: "No active deals right now.",
            body: "Your follower count means brands should be in your inbox. If they're not, Maya's outreach can fix that — connect Gmail in Profile and check the Outbound tab.",
            cta: { href: "/profile", label: "Connect Gmail" },
          };
        case "scaling":
          return {
            title: "Deal queue is empty.",
            body: "At your size this is unusual — either Gmail isn't connected, or Maya's filtering is too aggressive. Check Profile → Connections, then revisit the auto-send threshold.",
            cta: { href: "/profile", label: "Open Profile" },
          };
      }
      break;

    case "deals-outbound":
      switch (ctx.stage) {
        case "just-starting":
          return {
            title: "Outbound waits until you're build-stage.",
            body: `Pitching brands cold before ${milestone} usually wastes the warm-pitch you'll have at your milestone. Maya focuses on growth right now — outbound queues up automatically once you cross.`,
          };
        case "building":
          return {
            title: "First pitches land here.",
            body: "Outreach is Pro+. Maya drafts pitches to brands you flag or to opportunities the scout finds — you approve, then she sends through Gmail.",
            cta: { href: "/profile", label: "Upgrade to Pro" },
          };
        case "monetizing":
        case "scaling":
          return {
            title: "No outbound pitches yet.",
            body: "Outreach is Pro+. Maya drafts pitches to brands you flag or to opportunities the scout finds — you approve, then she sends through Gmail.",
            cta: { href: "/profile", label: "Open Profile" },
          };
      }
      break;

    case "deals-opportunities":
      switch (ctx.stage) {
        case "just-starting":
          return {
            title: "Opportunity scout starts at building stage.",
            body: `Most UGC marketplaces have follower minimums (1K–10K). Maya turns this on automatically once you cross the ${milestone} mark — until then she's watching for early-signal local brands instead.`,
          };
        case "building":
          return {
            title: "Opportunity scout is warming up.",
            body: "Pro+ scout watches UGC marketplaces (Aspire, GRIN, Creator.co) and Twitter creator-call hashtags. Most matches come within the first 7 days of plan upgrade — give it a beat.",
          };
        case "monetizing":
        case "scaling":
          return {
            title: "No opportunities surfaced today.",
            body: "Pro+ scout watches UGC marketplaces, Twitter creator-call hashtags, and your local brand market for fits. Maya only surfaces what scores above her relevance bar — quiet day, not a broken pipeline.",
          };
      }
      break;

    case "plan-current":
      switch (ctx.stage) {
        case "just-starting":
          return {
            title: "Maya's first plan lands after she sees your pattern.",
            body: "She generates a weekly plan after watching ~2 weeks of your posting cadence. Keep posting; she'll have one ready by Sunday. Until then, focus on consistency — that's the only metric that matters this stage.",
          };
        case "building":
          return {
            title: "No plan yet — first one drops Sunday 4pm.",
            body: "At your stage Maya emphasizes hook craft. Each idea card she ships will lead with the hook pattern she thinks fits your voice + niche.",
          };
        case "monetizing":
          return {
            title: "No plan yet — first one drops Sunday 4pm.",
            body: "At your stage Maya emphasizes diversification across formats + platforms. Expect a 7-day arc with platform-specific variants per day.",
          };
        case "scaling":
          return {
            title: "No plan yet — first one drops Sunday 4pm.",
            body: "At your size Maya plans at the arc level — themed weeks, multi-platform launches, evergreen reuse. Expect a higher-altitude framing than per-day idea cards.",
          };
      }
      break;

    case "today-brief":
      // Brief is universal but the framing nudge varies.
      switch (ctx.stage) {
        case "just-starting":
          return {
            title: "Maya's brief lands at 7am local.",
            body: `She's still calibrating to your voice. Until then, your job is consistency. Milestone in sight: ${milestone}.`,
          };
        default:
          return {
            title: "Maya hasn't written today's brief yet.",
            body: "The morning brief lands at 7am in your timezone. If it's past 7 and the brief still hasn't shown up, Maya may be waiting on a fresh ScrapeCreators pull — she'll catch up at the next heartbeat.",
          };
      }

    case "today-pending":
      // Pending is universal — the empty state framing differs only slightly.
      return {
        title: "Inbox zero.",
        body:
          ctx.stage === "just-starting"
            ? "No drafts, no deliverables waiting on you. Post something today — that's the work at this stage."
            : "No drafts, no deliverables, no brand emails waiting on you right now. Enjoy the quiet.",
      };

    case "today-revenue":
      switch (ctx.stage) {
        case "just-starting":
          return {
            title: "Revenue arrives once deals do.",
            body: `Brand revenue is a milestone effect — usually shows up around 5K–10K followers. Track here: when your first paid deal closes, the widget lights up. You're at ${formatFollowers(ctx.topFollowers)}.`,
          };
        case "building":
          return {
            title: "Revenue widget activates with your first paid deal.",
            body: "Connect Stripe in Profile if you've already got revenue from other sources (digital products, affiliate). Maya folds it in.",
            cta: { href: "/profile", label: "Connect Stripe" },
          };
        case "monetizing":
        case "scaling":
          return {
            title: "Revenue will surface here once Stripe is connected.",
            body: "Maya reads paid brand deals from the brandDeals pipeline and folds in Stripe payouts when you've connected the account from Profile.",
            cta: { href: "/profile", label: "Open Profile" },
          };
      }
      break;
  }
  // Exhaustiveness backstop. TypeScript proves every slot+stage is handled
  // above; this only triggers if a future slot is added without coverage.
  return {
    title: "Nothing here yet.",
    body: "Maya is still gathering data. Check back after the next heartbeat.",
  };
}

/* -------------------------------------------------------------------------- */
/* Section ordering per stage                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Returns an ordered list of section ids for a given page+stage. The pages
 * iterate this list and render whichever sections are present in their JSX —
 * this keeps the section-shape table-driven without forcing the pages to know
 * the per-stage rules inline.
 *
 * Each section id matches a render branch in the page; pages render in the
 * order returned. Sections not in the list for a stage are NOT shown.
 */

export type TodaySection =
  | "brief"
  | "topMove"
  | "growth"      // just-starting only — surfaces growth-coach milestone framing
  | "pending"
  | "revenue"
  | "accountability"
  | "outliers";

export type PlanSection = "voice" | "days" | "history";

export type DealsSection = "inbound" | "outbound" | "opportunities";

export function todaySectionsFor(stage: Stage): ReadonlyArray<TodaySection> {
  switch (stage) {
    case "just-starting":
      // Lead with growth + accountability. Revenue sits at the bottom because
      // it's almost always empty at this stage; surfacing it high reads as
      // "you don't have any" instead of "Maya is helping you build to it".
      return [
        "brief",
        "growth",
        "topMove",
        "accountability",
        "pending",
        "outliers",
        "revenue",
      ];
    case "building":
      // Balance content + early deals. Revenue mid-stack — first paid deals
      // start landing in this band.
      return [
        "brief",
        "topMove",
        "pending",
        "revenue",
        "outliers",
        "accountability",
      ];
    case "monetizing":
      // Lead with revenue + deals + content. Pending typically has brand
      // emails so it sits high.
      return [
        "brief",
        "revenue",
        "pending",
        "topMove",
        "outliers",
        "accountability",
      ];
    case "scaling":
      // Deals to ACCEPT + DECLINE + revenue come first. Brief is still on
      // top (it's the daily anchor), but pending/revenue dominate below.
      return [
        "brief",
        "pending",
        "revenue",
        "topMove",
        "outliers",
        "accountability",
      ];
  }
}

export function planSectionsFor(stage: Stage): ReadonlyArray<PlanSection> {
  // Every stage shows the same three sections in the same order today; the
  // per-stage emphasis lives in the empty-state copy + voice-section caption
  // rather than in section ordering. We keep the helper so the contract is
  // explicit and a future redesign can flip ordering without page-side edits.
  return ["voice", "days", "history"];
}

export function dealsSectionsFor(stage: Stage): ReadonlyArray<DealsSection> {
  switch (stage) {
    case "just-starting":
      // No outbound. Inbound shows the stage-aware "unlock at building" copy.
      return ["inbound"];
    case "building":
      return ["inbound", "outbound", "opportunities"];
    case "monetizing":
    case "scaling":
      // Same set, but stage-aware copy varies — the page reads from emptyCopyFor.
      return ["inbound", "outbound", "opportunities"];
  }
}

/* -------------------------------------------------------------------------- */
/* Stage-aware UI components                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Common stage-aware empty card. Drop-in replacement for the page-local
 * `<EmptyCard title body />` callers — adds an optional CTA link below the
 * body, styled to match the existing Section vocabulary.
 *
 * Pages that haven't migrated yet keep using their local `<EmptyCard>`; this
 * one is wired wherever the audit added stage-awareness.
 */
export function StageEmpty({ copy }: { copy: EmptyCopy }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-6 sm:p-8">
      <p className="font-display text-xl text-paper">{copy.title}</p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-paper-dim">
        {copy.body}
      </p>
      {copy.cta && (
        <Link
          href={copy.cta.href}
          className="mt-4 inline-flex items-center gap-1 text-sm text-lime underline-offset-4 hover:underline"
        >
          {copy.cta.label} →
        </Link>
      )}
    </div>
  );
}

/**
 * Top-of-page stage banner — surfaces "Maya knows where you are" so the
 * just-starting creator doesn't feel the product is mis-targeted to them.
 *
 * Optional render: pages call <StageBanner ctx={...} /> only when they want
 * the framing nudge. Today renders it under the greeting; Deals renders it
 * for just-starting only (the body of the page communicates stage on its own
 * for higher tiers).
 */
export function StageBanner({
  ctx,
  variant = "default",
}: {
  ctx: StageContext;
  variant?: "default" | "compact";
}) {
  const verb = stageVerb(ctx.stage);
  const focusLabel = focusAreaLabel(ctx.focusArea);
  if (variant === "compact") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-paper-dim">
        <span className="text-lime">·</span>
        {verb} · focus {focusLabel} · next {ctx.nextMilestone.label}
      </div>
    );
  }
  // Stage-aware adaptive product: surface the gentle nudge when synthesis
  // detected a divergence between self-report and observed signal. This is
  // anti-sycophantic by design — Maya tells the creator she sees them where
  // they actually are, not where they said they were.
  const richMilestoneText =
    ctx.richGrowthPlan?.nextMilestoneText ?? null;
  return (
    <div className="rounded-2xl border border-lime/30 bg-lime/5 p-5">
      <div className="font-mono text-[11px] uppercase tracking-widest text-lime">
        Maya knows where you are
      </div>
      <p className="mt-2 font-display text-xl leading-snug text-paper">
        You&rsquo;re {verb}. Focus this stage: <span className="text-lime">{focusLabel}</span>.
      </p>
      <p className="mt-2 text-sm text-paper-dim">
        Maya&rsquo;s tracking your next milestone:{" "}
        <span className="text-paper">
          {richMilestoneText ?? ctx.nextMilestone.label}
        </span>
        {ctx.topFollowers > 0
          ? ` · you're at ${formatFollowers(ctx.topFollowers)} on your top platform.`
          : "."}
      </p>
      {ctx.gentleNudge && (
        <p className="mt-3 rounded-xl border border-rose/30 bg-rose/5 px-3 py-2 text-sm leading-relaxed text-paper">
          <span className="font-mono text-[10px] uppercase tracking-widest text-rose">
            Reality check ·{" "}
          </span>
          {ctx.gentleNudge}
        </p>
      )}
    </div>
  );
}

function stageVerb(stage: Stage): string {
  switch (stage) {
    case "just-starting":
      return "just starting out";
    case "building":
      return "building";
    case "monetizing":
      return "monetizing";
    case "scaling":
      return "scaling";
  }
}

function focusAreaLabel(f: FocusArea): string {
  switch (f) {
    case "consistency":
      return "consistency";
    case "hook-craft":
      return "hook craft";
    case "diversification":
      return "revenue diversification";
    case "scale-systems":
      return "scale + systems";
  }
}

export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n === 0) return "0";
  return String(n);
}
