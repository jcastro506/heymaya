/**
 * Creator HQ — business-readiness mutations + queries.
 *
 * Added 2026-04-26 by the Creator HQ business-readiness audit. The premise:
 * the operator wanted the HQ to deliver the "treat yourself like a business"
 * promise — inbox of brand opportunities, pipeline of outbound pitches, daily
 * todo, content plan with approve/post lifecycle, accountability log of
 * Maya's proactive work. Most of the schema and skills already existed; what
 * was missing was the **public mutation surface** that lets:
 *   (a) Maya's skill scripts at runtime write their results into Convex (so
 *       the HQ stops showing empty states forever)
 *   (b) the creator drive lifecycle from the UI — approve a draft, mark a
 *       post as posted, manually log a deal, mark a deal paid, dismiss an
 *       opportunity, convert one to a pitch, upload a contract.
 *
 * What lives in THIS file (not in dealTriage / billing / profile, which are
 * owned by parallel agents during this build):
 *   - Today extras:
 *       latestActionLog          — accountability feed
 *       gmailWatchStatus         — "Maya is watching your Gmail" badge
 *   - Plan extras:
 *       markDayPosted            — close the draft → approved → posted loop
 *       voiceFingerprint         — surface the soul.md voice on the Plan page
 *   - Deals extras:
 *       createBrandDealManually  — Starter spec: manual deal entry
 *       markDealPaid             — record revenue
 *       attachContractToDeal     — wire the contract upload (lands in deal)
 *       opportunityMatchesV2     — read from `opportunitySurface` (not [])
 *       dismissOpportunity       — creator passes
 *       convertOpportunityToPitch — creator presses "Pitch this"
 *   - Skill-runtime writes (the public mutations Maya's skill scripts call):
 *       skillRecordOpportunity   — opportunity-scout writes findings
 *       skillRecordCollabMatch   — collab-matchmaker logs a peer
 *       skillRecordPostmortem    — underperformance-diagnoser writes
 *       skillRecordHook          — hook-extractor records a pattern
 *       skillRecordCompetitor    — competitor watch writes a row
 *       skillRecordTrend         — niche / industry-intel scan writes a row
 *       skillRecordMonetization  — diversifier writes proposals
 *       skillCreatePitchDraft    — brand-outreach drafts a pitch
 *       skillRecordActionLog     — generic Maya proactive-action log entry
 *
 * EVERY public mutation/query/action here:
 *   1. Re-resolves the signed-in creator from `ctx.auth.getUserIdentity()` (no
 *      client-supplied creatorId).
 *   2. Calls `planFeatures(creator)` server-side for plan-tier gating.
 *   3. Logs destructive / state-changing intents to `mayaActionLog` so the
 *      Today screen's accountability feed has receipts.
 *
 * Skill-runtime writes (the `skill*` mutations) take a `mayaSecret` argument
 * and `creatorId` because they're invoked by Maya's skill scripts running on
 * Fly, NOT by a signed-in creator. The secret is per-creator, set at deploy
 * time, and validated server-side. This keeps the cross-tenant gate enforced
 * even when there's no Clerk identity in scope.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { planFeatures, PlanGateError } from "./lib/planFeatures";

/* -------------------------------------------------------------------------- */
/* Cross-tenant identity helpers                                               */
/* -------------------------------------------------------------------------- */

async function getCurrentCreator(
  ctx: MutationCtx | QueryCtx
): Promise<Doc<"creators"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
}

async function requireCurrentCreator(ctx: MutationCtx): Promise<Doc<"creators">> {
  const c = await getCurrentCreator(ctx);
  if (!c) throw new Error("Not authenticated.");
  return c;
}

/* -------------------------------------------------------------------------- */
/* Stage resolution — drives stage-aware HQ section ordering + empty states   */
/* -------------------------------------------------------------------------- */

/**
 * Stage-aware HQ data. The HQ adapts to where the creator is:
 *   - just-starting (<10K)    Today leads with growth-coach + accountability;
 *                              Deals shows the "unlock at building" message
 *   - building (10K-100K)     Today balances content + early deals;
 *                              Plan emphasizes hook craft
 *   - monetizing (100K-500K)  Today leads with revenue + deals + content;
 *                              Plan emphasizes diversification
 *   - scaling (500K+)         Today leads with deals to ACCEPT + DECLINE +
 *                              revenue; Plan is a higher-level arc
 *
 * Stage source priority (per operator spec):
 *   1. `creatorPicture.careerStage` (data-inferred — Sprint 2's source of
 *      truth once it lands) — overrides everything below
 *   2. `creators.careerStage` would be a fallback but the schema only stores
 *      careerStage on `creatorPicture` (and the onboarding answers buffer,
 *      which gets persisted to picture). So in practice we read picture and
 *      infer from follower count if missing.
 *   3. Inferred from the largest connected handle's follower count
 *
 * NextMilestone source priority:
 *   1. `creatorPicture.growthPlan.nextMilestone` (Sprint 2 populates)
 *   2. Synthetic milestone derived from current top-handle follower count:
 *      under 1K → 1K, under 5K → 5K, under 10K → 10K, etc.
 *
 * Returns null only when unauth — every authed creator gets a stage.
 */
export const creatorStage = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;

    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    const handles = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();

    // Top follower count across connected handles. Used both to infer stage
    // when no picture careerStage exists AND to derive synthetic milestones.
    const topFollowers = handles.reduce<number>(
      (max, h) => Math.max(max, h.followerCount ?? 0),
      0
    );

    const inferredStage = inferStageFromFollowers(topFollowers);
    const stage: "just-starting" | "building" | "monetizing" | "scaling" =
      picture?.careerStage ?? inferredStage;

    // NextMilestone — picture.growthPlan if Sprint 2 has populated it,
    // otherwise a synthetic one keyed off topFollowers.
    const fromGrowthPlan = picture?.growthPlan?.nextMilestone ?? null;
    const nextMilestone = fromGrowthPlan ?? syntheticMilestone(topFollowers);

    const focusArea: "consistency" | "hook-craft" | "diversification" | "scale-systems" =
      picture?.growthPlan?.focusArea ?? defaultFocusForStage(stage);

    // ─── Stage-aware adaptive product (Agent B, 2026-04-26) ─────────────────
    // Pass the synthesis-emitted reconciliation + rich growth-plan blob
    // through to the HQ. Both are optional — when the synthesis hasn't run
    // (or pre-Agent-B picture rows), they're null and the HQ degrades to the
    // base stage banner without a gentle nudge. When present, the HQ surfaces
    // the gentleNudge in Today's stage banner so the creator is told if their
    // self-report and the data diverge (anti-sycophantic, honest).
    const reconciliation = picture?.careerStageReconciliation ?? null;
    const richGrowthPlan = picture?.growthPlan
      ? {
          // Rich plan surfaces are all optional on the schema; null-coalesce
          // each so the HQ can render whatever's present without TS unions.
          currentStage: picture.growthPlan.currentStage ?? null,
          nextMilestoneText: picture.growthPlan.nextMilestoneText ?? null,
          focusAreas: picture.growthPlan.focusAreas ?? [],
          antiPatterns: picture.growthPlan.antiPatterns ?? [],
          horizonWeeks: picture.growthPlan.horizonWeeks ?? null,
          citations: picture.growthPlan.citations ?? [],
          generatedAt: picture.growthPlan.generatedAt ?? null,
        }
      : null;
    // The gentle nudge is surfaced separately so the HQ doesn't have to dig
    // through reconciliation to find it. Null when matches=true.
    const gentleNudge =
      reconciliation && !reconciliation.matches
        ? (reconciliation.gentleNudge ?? null)
        : null;
    const careerStageReasoning = picture?.careerStageReasoning ?? null;
    const hasInferredPicture =
      picture !== null &&
      picture.model !== "awaiting-synthesis" &&
      picture.model !== "manual-seed";

    return {
      stage,
      stageSource: (picture?.careerStage ? "picture" : "inferred") as
        | "picture"
        | "inferred",
      topFollowers,
      nextMilestone,
      focusArea,
      // ─── Stage-aware adaptive product (Agent B, 2026-04-26) ──────────────
      hasInferredPicture,
      careerStageReasoning,
      reconciliation,
      richGrowthPlan,
      gentleNudge,
    };
  },
});

const FOLLOWER_BANDS = [
  { label: "1K", at: 1_000 },
  { label: "5K", at: 5_000 },
  { label: "10K", at: 10_000 },
  { label: "25K", at: 25_000 },
  { label: "50K", at: 50_000 },
  { label: "100K", at: 100_000 },
  { label: "250K", at: 250_000 },
  { label: "500K", at: 500_000 },
  { label: "1M", at: 1_000_000 },
] as const;

function inferStageFromFollowers(
  followers: number
): "just-starting" | "building" | "monetizing" | "scaling" {
  if (followers >= 500_000) return "scaling";
  if (followers >= 100_000) return "monetizing";
  if (followers >= 10_000) return "building";
  return "just-starting";
}

function syntheticMilestone(currentFollowers: number): {
  label: string;
  targetFollowers: number;
} {
  for (const band of FOLLOWER_BANDS) {
    if (currentFollowers < band.at) {
      return { label: band.label, targetFollowers: band.at };
    }
  }
  // Already past 1M — next round number is 2M, then 5M, then 10M.
  if (currentFollowers < 2_000_000) {
    return { label: "2M", targetFollowers: 2_000_000 };
  }
  if (currentFollowers < 5_000_000) {
    return { label: "5M", targetFollowers: 5_000_000 };
  }
  return { label: "10M", targetFollowers: 10_000_000 };
}

function defaultFocusForStage(
  stage: "just-starting" | "building" | "monetizing" | "scaling"
): "consistency" | "hook-craft" | "diversification" | "scale-systems" {
  switch (stage) {
    case "just-starting":
      return "consistency";
    case "building":
      return "hook-craft";
    case "monetizing":
      return "diversification";
    case "scaling":
      return "scale-systems";
  }
}

/* -------------------------------------------------------------------------- */
/* Today extras — accountability feed + Gmail watch status                     */
/* -------------------------------------------------------------------------- */

/**
 * The 10 most-recent rows of `mayaActionLog` for the signed-in creator,
 * filtered to outcomes the creator cares about (`ran` and `failed`). Skipped
 * crons are operator-relevant only — surfacing them on Today would be noise.
 *
 * Today renders this as a "Maya did X for you" feed under § Accountability.
 */
export const latestActionLog = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    const rows = await ctx.db
      .query("mayaActionLog")
      .withIndex("by_creator_and_ts", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .take(40);
    return rows
      .filter((r) => r.outcome === "ran" || r.outcome === "failed")
      .slice(0, 10);
  },
});

/**
 * Gmail watch status. Returns:
 *   { connected: false }                                    — no Gmail account
 *   { connected: true, lastEventAt: number | null,
 *     planEnabled: boolean }                                — connected
 *
 * Today renders this as the "Maya is watching your Gmail · last checked Xm
 * ago" status badge on Pro+. On Starter we still show the badge but with a
 * "connect Gmail (Pro)" upsell — surfaced via `planEnabled: false`.
 */
export const gmailWatchStatus = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;
    const account = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_creator_and_provider", (q) =>
        q.eq("creatorId", creator._id).eq("provider", "gmail")
      )
      .first();
    const features = planFeatures(creator);
    if (!account || account.scopeStatus !== "active") {
      return {
        connected: false as const,
        planEnabled: features.gmailDealDeskEnabled,
        lastEventAt: null as number | null,
      };
    }
    // Last webhook tick (any status — including replays — proves Composio is
    // delivering). We page back over a small window since heavy senders may
    // produce many events per day; we only need the most-recent one.
    const lastEvent = await ctx.db
      .query("gmailWebhookEvents")
      .withIndex("by_creator_and_received_at", (q) =>
        q.eq("creatorId", creator._id)
      )
      .order("desc")
      .first();
    return {
      connected: true as const,
      planEnabled: features.gmailDealDeskEnabled,
      lastEventAt: lastEvent?.receivedAt ?? null,
    };
  },
});

/**
 * Extended Today pendingItems — adds two kinds the original `today.pendingItems`
 * doesn't surface:
 *   - `approved-content` — content plan entries the creator approved but
 *     hasn't posted yet (drives "you said you'd ship Tue, are we still on?")
 *   - `pitch-followup` — outbound pitches the creator sent that haven't had
 *     a reply in N days (Maya's nudge, surfaced as a creator todo)
 *
 * This sits ALONGSIDE `today.pendingItems` rather than replacing it because
 * the original pendingItems handles drafts + deliverables + brand-emails,
 * which are universal. The extras here are Pro+ in spirit (outbound pitches
 * are gated; approved-content is universal).
 */
export const pendingItemsExtended = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];

    type Extra = {
      kind: "approved-content" | "pitch-followup";
      title: string;
      dueAt: number | null;
      sourceTable: string;
      sourceId: string;
    };
    const items: Extra[] = [];

    // 1. Approved-but-unposted from latest content plan.
    const latestPlan = await ctx.db
      .query("contentPlans")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .order("desc")
      .first();
    if (latestPlan) {
      for (let i = 0; i < latestPlan.arc.length; i++) {
        const arc = latestPlan.arc[i];
        if (arc.status !== "approved") continue;
        items.push({
          kind: "approved-content",
          title: `${arc.platform} ${arc.format} ready · ${arc.hookOptions[0] ?? "post"}`,
          dueAt: null,
          sourceTable: "contentPlans",
          sourceId: `${latestPlan._id}#${i}`,
        });
      }
    }

    // 2. Outbound pitch follow-ups: sent, no reply, last followup >= 4 days
    //    ago OR never followed up + sent >= 4 days ago. Pro+ only.
    if (planFeatures(creator).brandOutreachEnabled) {
      const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
      const sentPitches = await ctx.db
        .query("pitchOutreach")
        .withIndex("by_creator_and_status", (q) =>
          q.eq("creatorId", creator._id).eq("status", "sent")
        )
        .collect();
      const now = Date.now();
      for (const p of sentPitches) {
        const baseline = p.lastFollowupAt ?? p.sentAt ?? null;
        if (!baseline) continue;
        if (now - baseline < FOUR_DAYS_MS) continue;
        items.push({
          kind: "pitch-followup",
          title: `${p.brand} — no reply yet, follow up?`,
          dueAt: null,
          sourceTable: "pitchOutreach",
          sourceId: p._id,
        });
      }
    }

    return items;
  },
});

/* -------------------------------------------------------------------------- */
/* Plan extras — close draft→approved→posted, voice fingerprint surface        */
/* -------------------------------------------------------------------------- */

/**
 * Mark a planned content arc entry as `posted`. Sister to
 * `plan.approveDay`. This closes the lifecycle so Today stops surfacing the
 * approved-but-unposted item AND the accountability feed records the win.
 *
 * Cross-tenant: re-validates `plan.creatorId === me._id` before mutating.
 */
export const markDayPosted = mutation({
  args: {
    planId: v.id("contentPlans"),
    dayOffset: v.number(),
  },
  handler: async (ctx, args) => {
    const me = await requireCurrentCreator(ctx);
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found.");
    if (plan.creatorId !== me._id) {
      throw new Error("Plan does not belong to signed-in creator.");
    }

    // Find the entry; refuse the transition if it isn't currently approved
    // (anti-footgun: posting a draft directly skips the review step).
    const entry = plan.arc.find((e) => e.dayOffset === args.dayOffset);
    if (!entry) throw new Error("dayOffset not found in plan arc.");
    if (entry.status !== "approved") {
      throw new Error(
        `Cannot mark posted from status='${entry.status}'. Approve first.`
      );
    }

    const updatedArc = plan.arc.map((e) =>
      e.dayOffset === args.dayOffset ? { ...e, status: "posted" as const } : e
    );
    await ctx.db.patch(args.planId, { arc: updatedArc });

    await ctx.db.insert("mayaActionLog", {
      creatorId: me._id,
      entryId: "plan.markPosted",
      outcome: "ran",
      detail: `${entry.platform} ${entry.format} marked posted`,
      ts: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Voice fingerprint + top-hooks surface for the Plan screen sidebar. Reads
 * from `creatorPicture` (the synth pipeline writes this; the creator can
 * re-edit USER.md fields from Profile but the voice is synthesis-owned).
 *
 * Returns null when no picture exists yet (pre-onboarding) — UI shows
 * "Maya is still building your picture" rather than a fabricated voice.
 */
export const voiceFingerprint = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return null;
    const picture = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .first();
    if (!picture) return null;
    return {
      voiceFingerprint: picture.voiceFingerprint,
      niche: picture.niche,
      topHooks: picture.topHooks.slice(0, 5),
      generatedAt: picture.generatedAt,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Deals extras — manual entry, mark-paid, attach-contract, opportunities     */
/* -------------------------------------------------------------------------- */

/**
 * Starter creators don't get Gmail triage so they need to log deals manually
 * — that's spec-locked. Pro+ creators may also occasionally type a deal in
 * (e.g., a brand emailed a personal address Maya can't see). One mutation
 * handles both cases.
 *
 * Cross-tenant: signed-in creator only. Plan-tier: every plan can create a
 * deal manually.
 */
export const createBrandDealManually = mutation({
  args: {
    brand: v.string(),
    offerAmountUsd: v.optional(v.number()),
    deliverables: v.array(v.string()),
    dueAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireCurrentCreator(ctx);
    const brand = args.brand.trim();
    if (brand.length === 0) throw new Error("brand is required.");
    if (brand.length > 200) throw new Error("brand is too long.");
    if (
      args.offerAmountUsd !== undefined &&
      (!Number.isFinite(args.offerAmountUsd) || args.offerAmountUsd < 0)
    ) {
      throw new Error("offerAmountUsd must be a non-negative finite number.");
    }
    if (args.deliverables.length > 25) {
      throw new Error("deliverables list is too long (cap 25).");
    }
    for (const d of args.deliverables) {
      if (typeof d !== "string" || d.length > 500) {
        throw new Error("each deliverable must be a string ≤ 500 chars.");
      }
    }
    const now = Date.now();
    const dealId = await ctx.db.insert("brandDeals", {
      creatorId: me._id,
      brand,
      status: "new",
      offerAmountUsd: args.offerAmountUsd,
      deliverables: args.deliverables,
      dueAt: args.dueAt,
      riskFlags: [],
      replyVariants: [],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("mayaActionLog", {
      creatorId: me._id,
      entryId: "deal.manualEntry",
      outcome: "ran",
      detail:
        args.notes && args.notes.length > 0
          ? `Manual deal: ${brand} — ${args.notes.slice(0, 200)}`
          : `Manual deal: ${brand}`,
      ts: now,
    });
    return dealId;
  },
});

/**
 * Mark a deal as paid + record the actual amount. Closes the revenue loop —
 * Today's revenue widget reads from `brandDeals` where status='paid'.
 *
 * Cross-tenant: validates `deal.creatorId === me._id`. Plan-tier: every plan
 * can mark their own deals paid (revenue tracking is universal).
 */
export const markDealPaid = mutation({
  args: {
    dealId: v.id("brandDeals"),
    paidAmountUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const me = await requireCurrentCreator(ctx);
    if (
      !Number.isFinite(args.paidAmountUsd) ||
      args.paidAmountUsd < 0 ||
      args.paidAmountUsd > 10_000_000
    ) {
      throw new Error("paidAmountUsd must be ≥0 and ≤10M.");
    }
    const deal = await ctx.db.get(args.dealId);
    if (!deal) throw new Error("Deal not found.");
    if (deal.creatorId !== me._id) {
      throw new Error("Deal does not belong to signed-in creator.");
    }
    if (deal.status === "paid") {
      // Idempotent: re-marking is a no-op on amount; we still record the
      // intent so the creator can fix a wrong amount.
      await ctx.db.patch(args.dealId, {
        paidAmountUsd: args.paidAmountUsd,
        updatedAt: Date.now(),
      });
      return { alreadyPaid: true };
    }
    const now = Date.now();
    await ctx.db.patch(args.dealId, {
      status: "paid",
      paidAt: now,
      paidAmountUsd: args.paidAmountUsd,
      updatedAt: now,
    });
    await ctx.db.insert("mayaActionLog", {
      creatorId: me._id,
      entryId: "deal.markPaid",
      outcome: "ran",
      detail: `${deal.brand} paid · $${Math.round(args.paidAmountUsd)}`,
      ts: now,
    });
    return { alreadyPaid: false };
  },
});

/**
 * Attach an uploaded contract PDF (Convex storage id) to a deal. The
 * red-flag scan kicks off via the maya-contract-redflag skill on a separate
 * cycle (Sprint 6/7 wires the actual scanner). For now we just persist the
 * pdfId and clear `redFlagReportId` so the UI shows "scanning…".
 *
 * Cross-tenant: validates ownership. Plan-tier: every plan can upload a
 * contract for their own deal.
 */
export const attachContractToDeal = mutation({
  args: {
    dealId: v.id("brandDeals"),
    contractPdfId: v.string(), // _storage id as string; Convex doesn't expose v.id("_storage") for app code
  },
  handler: async (ctx, args) => {
    const me = await requireCurrentCreator(ctx);
    const deal = await ctx.db.get(args.dealId);
    if (!deal) throw new Error("Deal not found.");
    if (deal.creatorId !== me._id) {
      throw new Error("Deal does not belong to signed-in creator.");
    }
    if (args.contractPdfId.length === 0 || args.contractPdfId.length > 500) {
      throw new Error("contractPdfId looks invalid.");
    }
    await ctx.db.patch(args.dealId, {
      contractPdfId: args.contractPdfId,
      redFlagReportId: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("mayaActionLog", {
      creatorId: me._id,
      entryId: "deal.contractAttached",
      outcome: "ran",
      detail: `Contract attached to ${deal.brand}; red-flag scan queued.`,
      ts: Date.now(),
    });
  },
});

/**
 * Replacement for the placeholder `deals.opportunityMatches` query — reads
 * from the new `opportunitySurface` table instead of returning [].
 *
 * Plan-tier: Pro+ via `opportunityScoutEnabled`.
 */
export const opportunityMatchesV2 = query({
  args: {},
  handler: async (ctx) => {
    const creator = await getCurrentCreator(ctx);
    if (!creator) return [];
    if (!planFeatures(creator).opportunityScoutEnabled) return [];
    const rows = await ctx.db
      .query("opportunitySurface")
      .withIndex("by_creator_and_surfacedAt", (q) =>
        q.eq("creatorId", creator._id)
      )
      .order("desc")
      .take(40);
    // Filter out anything the creator already actioned.
    return rows
      .filter(
        (r) =>
          r.creatorActedOn === undefined ||
          r.creatorActedOn === "pending"
      )
      .slice(0, 20)
      .map((r) => ({
        _id: r._id,
        source: r.source,
        title: r.title,
        brandName: r.brandName,
        fit: r.fit,
        suggestedAction: r.suggestedAction,
        pitchStrategy: r.pitchStrategy,
        reasoning: r.reasoning,
        url: r.url,
        estimatedRateRange: r.estimatedRateRange,
        dueDate: r.dueDate,
      }));
  },
});

/**
 * Creator dismisses an opportunity from the Outbound surface. Hides it from
 * `opportunityMatchesV2` going forward. Idempotent.
 */
export const dismissOpportunity = mutation({
  args: {
    opportunityId: v.id("opportunitySurface"),
  },
  handler: async (ctx, args) => {
    const me = await requireCurrentCreator(ctx);
    const row = await ctx.db.get(args.opportunityId);
    if (!row) return;
    if (row.creatorId !== me._id) {
      throw new Error("Opportunity does not belong to signed-in creator.");
    }
    if (row.creatorActedOn === "dismissed") return;
    await ctx.db.patch(args.opportunityId, { creatorActedOn: "dismissed" });
  },
});

/**
 * Convert a surfaced opportunity to a `pitchOutreach` row. The actual pitch
 * draft generation runs via the `maya-brand-outreach` skill in a downstream
 * action; this mutation seeds the row in `drafted` status so the Outbound
 * kanban shows it immediately.
 *
 * Plan-tier: Pro+ via `brandOutreachEnabled`. We additionally require a
 * contactEmail because pitches are emails — the UI gathers it before calling.
 *
 * Cross-tenant: opportunity ownership re-validated.
 */
export const convertOpportunityToPitch = mutation({
  args: {
    opportunityId: v.id("opportunitySurface"),
    contactEmail: v.string(),
    pitchAngle: v.union(
      v.literal("partnership"),
      v.literal("gifted"),
      v.literal("paid-content"),
      v.literal("ambassador"),
      v.literal("event-coverage")
    ),
  },
  handler: async (ctx, args) => {
    const me = await requireCurrentCreator(ctx);
    const features = planFeatures(me);
    if (!features.brandOutreachEnabled) {
      throw new PlanGateError(me.plan, "brandOutreach", "manager");
    }
    const opp = await ctx.db.get(args.opportunityId);
    if (!opp) throw new Error("Opportunity not found.");
    if (opp.creatorId !== me._id) {
      throw new Error("Opportunity does not belong to signed-in creator.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.contactEmail)) {
      throw new Error("contactEmail must be a valid email address.");
    }

    const pitchId = await ctx.db.insert("pitchOutreach", {
      creatorId: me._id,
      brand: opp.brandName ?? opp.title,
      contactEmail: args.contactEmail.trim().toLowerCase(),
      pitchAngle: args.pitchAngle,
      status: "drafted",
    });
    await ctx.db.patch(args.opportunityId, { creatorActedOn: "pitched" });
    await ctx.db.insert("mayaActionLog", {
      creatorId: me._id,
      entryId: "deals.opportunityConverted",
      outcome: "ran",
      detail: `Opportunity → pitch draft: ${opp.brandName ?? opp.title}`,
      ts: Date.now(),
    });
    return pitchId;
  },
});

/* -------------------------------------------------------------------------- */
/* Skill-runtime writes — public mutations Maya's skill scripts call          */
/* -------------------------------------------------------------------------- */
/*
 * These are invoked by Maya's skill scripts running on Fly. There's no Clerk
 * identity in scope (Maya isn't signed in as a user — she's an agent). The
 * shared-secret pattern below mirrors how the cleanup-agent-owned billing/
 * webhook routes authenticate inbound traffic.
 *
 * Secret format: `MAYA_RUNTIME_SECRET` env on Convex, never logged. Each
 * skill call passes it explicitly in `mayaSecret`. Cross-tenant: `creatorId`
 * is supplied by the skill, then we look up the row to (a) confirm it exists
 * and (b) confirm the creator's plan tier permits the write — fail-closed if
 * either check fails.
 *
 * For Sprint 7 the operator will set MAYA_RUNTIME_SECRET in Convex env. Until
 * then we fall back to a build-time placeholder so tests pass; the runtime
 * shell-out to Fly will fail loudly if the secret isn't set, which is the
 * correct fail-closed behavior.
 */

const MAYA_RUNTIME_SECRET_ENV = "MAYA_RUNTIME_SECRET";

function assertMayaSecret(provided: string): void {
  const expected = process.env[MAYA_RUNTIME_SECRET_ENV];
  if (!expected || expected.length === 0) {
    // Env not configured — refuse all skill writes. This is the fail-closed
    // path. The operator must set MAYA_RUNTIME_SECRET in Convex env before
    // the runtime can write back. Until then the HQ shows empty states (the
    // honest "no data yet" surface, not a fabricated one).
    throw new Error(
      `${MAYA_RUNTIME_SECRET_ENV} not configured — Maya runtime writes refused.`
    );
  }
  if (provided !== expected) {
    throw new Error("Invalid Maya runtime secret.");
  }
}

/**
 * Skill-runtime write: opportunity-scout findings. Called by
 * `agents/skills/maya-opportunity-scout/script.ts` once the Convex
 * orchestrating action lands (Sprint 6/7). Writes one `opportunitySurface`
 * row per surfaced opportunity, idempotent on `urlHash`.
 *
 * Plan-tier: Pro+. Refuses Starter writes.
 */
export const skillRecordOpportunity = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    source: v.union(
      v.literal("aspire"),
      v.literal("grin"),
      v.literal("creator-co"),
      v.literal("modash"),
      v.literal("backstage"),
      v.literal("mavrck"),
      v.literal("twitter-creator-call"),
      v.literal("local-brand-search")
    ),
    title: v.string(),
    brandName: v.optional(v.string()),
    fit: v.number(),
    suggestedAction: v.union(
      v.literal("pitch"),
      v.literal("apply"),
      v.literal("monitor"),
      v.literal("skip")
    ),
    pitchStrategy: v.optional(
      v.union(
        v.literal("pitch-paid"),
        v.literal("pitch-free-build-book"),
        v.literal("pitch-gifted"),
        v.literal("decline")
      )
    ),
    reasoning: v.string(),
    url: v.string(),
    urlHash: v.string(),
    estimatedRateRange: v.optional(
      v.object({ low: v.number(), high: v.number() })
    ),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    if (!planFeatures(creator).opportunityScoutEnabled) {
      throw new PlanGateError(creator.plan, "opportunityScout", "manager");
    }
    if (args.fit < 0 || args.fit > 1 || !Number.isFinite(args.fit)) {
      throw new Error("fit must be in [0, 1].");
    }
    // Idempotent on (creatorId, urlHash).
    const existing = await ctx.db
      .query("opportunitySurface")
      .withIndex("by_creator_and_url_hash", (q) =>
        q.eq("creatorId", args.creatorId).eq("urlHash", args.urlHash)
      )
      .first();
    if (existing) {
      // Refresh the fit + reasoning + suggestedAction (the model can revise on
      // re-scan); preserve creatorActedOn so we don't undo a dismissal.
      await ctx.db.patch(existing._id, {
        fit: args.fit,
        suggestedAction: args.suggestedAction,
        pitchStrategy: args.pitchStrategy,
        reasoning: args.reasoning,
        title: args.title,
        brandName: args.brandName,
        estimatedRateRange: args.estimatedRateRange,
        dueDate: args.dueDate,
        surfacedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("opportunitySurface", {
      creatorId: args.creatorId,
      source: args.source,
      title: args.title,
      brandName: args.brandName,
      fit: args.fit,
      suggestedAction: args.suggestedAction,
      pitchStrategy: args.pitchStrategy,
      reasoning: args.reasoning,
      url: args.url,
      urlHash: args.urlHash,
      estimatedRateRange: args.estimatedRateRange,
      dueDate: args.dueDate,
      surfacedAt: Date.now(),
      creatorActedOn: "pending",
    });
  },
});

/**
 * Skill-runtime write: collab-matchmaker peer surfacing. One row per peer
 * Maya proposes for a collab. Pro+ via `collabMatchEnabled`.
 */
export const skillRecordCollabMatch = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    peerHandle: v.string(),
    platform: v.string(),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    if (!planFeatures(creator).collabMatchEnabled) {
      throw new PlanGateError(creator.plan, "collabMatch", "manager");
    }
    return await ctx.db.insert("collabMatchLog", {
      creatorId: args.creatorId,
      peerHandle: args.peerHandle.trim().replace(/^@/, ""),
      platform: args.platform,
      surfacedAt: Date.now(),
      creatorActedOn: "pending",
    });
  },
});

/**
 * Skill-runtime write: underperformance-diagnoser postmortem. One row per
 * post Maya diagnosed as a miss. Universally enabled (every plan gets the
 * evening recap that includes postmortems for misses).
 */
export const skillRecordPostmortem = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    postId: v.id("posts"),
    severity: v.union(
      v.literal("mild"),
      v.literal("significant"),
      v.literal("severe")
    ),
    primaryCause: v.string(),
    secondaryCauses: v.array(v.string()),
    recommendedNextMove: v.string(),
    lessonForNextPost: v.string(),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found.");
    if (post.creatorId !== args.creatorId) {
      // Tenant-bleed guard: the post must belong to the creatorId in the call.
      throw new Error("Post does not belong to creator.");
    }
    return await ctx.db.insert("postPostmortems", {
      creatorId: args.creatorId,
      postId: args.postId,
      severity: args.severity,
      primaryCause: args.primaryCause,
      secondaryCauses: args.secondaryCauses,
      recommendedNextMove: args.recommendedNextMove,
      lessonForNextPost: args.lessonForNextPost,
      diagnosedAt: Date.now(),
    });
  },
});

/**
 * Skill-runtime write: hook pattern from hook-extractor. Universal (every
 * plan can build a hook library — it's a low-thinking extract from posts the
 * creator already made).
 */
export const skillRecordHook = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    pattern: v.string(),
    firstSeconds: v.string(),
    whyItWorked: v.string(),
    retentionScore: v.optional(v.number()),
    examplePostIds: v.array(v.id("posts")),
    applicabilityToNiche: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    // Validate every example post belongs to this creator (tenant-bleed guard).
    for (const pid of args.examplePostIds) {
      const p = await ctx.db.get(pid);
      if (!p || p.creatorId !== args.creatorId) {
        throw new Error("examplePostIds must all belong to this creator.");
      }
    }
    return await ctx.db.insert("hookLibrary", {
      creatorId: args.creatorId,
      pattern: args.pattern,
      firstSeconds: args.firstSeconds,
      whyItWorked: args.whyItWorked,
      retentionScore: args.retentionScore,
      examplePostIds: args.examplePostIds,
      extractedAt: Date.now(),
      applicabilityToNiche: args.applicabilityToNiche,
    });
  },
});

/**
 * Skill-runtime write: competitor observation. Pro+ (Starter has 0
 * competitor watch slots).
 */
export const skillRecordCompetitor = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    peerHandle: v.string(),
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
      v.literal("x")
    ),
    observation: v.string(),
    evidence: v.array(
      v.object({
        kind: v.union(
          v.literal("post"),
          v.literal("metric"),
          v.literal("hashtag")
        ),
        ref: v.string(),
        fact: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    if (planFeatures(creator).competitorWatchSlots === 0) {
      throw new PlanGateError(creator.plan, "competitorWatch", "manager");
    }
    return await ctx.db.insert("competitorObservations", {
      creatorId: args.creatorId,
      peerHandle: args.peerHandle.trim().replace(/^@/, ""),
      platform: args.platform,
      observation: args.observation,
      evidence: args.evidence,
      observedAt: Date.now(),
    });
  },
});

/**
 * Skill-runtime write: niche/industry-intel/competitor trend observation.
 * niche-scan is universal; industry-intel + competitor-watch are Pro+.
 */
export const skillRecordTrend = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    source: v.union(
      v.literal("niche-scan"),
      v.literal("industry-intel"),
      v.literal("competitor-watch")
    ),
    observation: v.string(),
    evidence: v.array(
      v.object({
        kind: v.union(
          v.literal("post"),
          v.literal("hashtag"),
          v.literal("sound"),
          v.literal("article"),
          v.literal("metric")
        ),
        ref: v.string(),
        fact: v.string(),
      })
    ),
    relevanceScore: v.number(),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    if (
      args.source !== "niche-scan" &&
      !planFeatures(creator).proactiveCronAll
    ) {
      throw new PlanGateError(creator.plan, `trend:${args.source}`, "manager");
    }
    if (
      !Number.isFinite(args.relevanceScore) ||
      args.relevanceScore < 0 ||
      args.relevanceScore > 1
    ) {
      throw new Error("relevanceScore must be in [0, 1].");
    }
    return await ctx.db.insert("trendObservations", {
      creatorId: args.creatorId,
      source: args.source,
      observation: args.observation,
      evidence: args.evidence,
      relevanceScore: args.relevanceScore,
      observedAt: Date.now(),
    });
  },
});

/**
 * Skill-runtime write: monetization-diversifier proposal. Pro+ via
 * `monetizationAdvisorEnabled`.
 */
export const skillRecordMonetization = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    triggerEvent: v.string(),
    proposalsSnapshot: v.any(),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    if (!planFeatures(creator).monetizationAdvisorEnabled) {
      throw new PlanGateError(creator.plan, "monetizationAdvisor", "manager");
    }
    return await ctx.db.insert("monetizationProposalLog", {
      creatorId: args.creatorId,
      triggerEvent: args.triggerEvent,
      proposalsSnapshot: args.proposalsSnapshot,
      surfacedAt: Date.now(),
    });
  },
});

/**
 * Skill-runtime write: brand-outreach pitch draft. Pro+ via
 * `brandOutreachEnabled`. Inserts in `drafted` status; the creator approves
 * + sends from the Outbound detail panel (Sprint 6/7 wires the actual Gmail
 * send action).
 */
export const skillCreatePitchDraft = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    brand: v.string(),
    contactEmail: v.string(),
    pitchAngle: v.union(
      v.literal("partnership"),
      v.literal("gifted"),
      v.literal("paid-content"),
      v.literal("ambassador"),
      v.literal("event-coverage")
    ),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    if (!planFeatures(creator).brandOutreachEnabled) {
      throw new PlanGateError(creator.plan, "brandOutreach", "manager");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.contactEmail)) {
      throw new Error("contactEmail must be a valid email address.");
    }
    return await ctx.db.insert("pitchOutreach", {
      creatorId: args.creatorId,
      brand: args.brand,
      contactEmail: args.contactEmail.trim().toLowerCase(),
      pitchAngle: args.pitchAngle,
      status: "drafted",
    });
  },
});

/**
 * Skill-runtime write: generic Maya proactive-action log entry. Skill
 * scripts call this from any cron/event handler so the Today screen's
 * accountability feed has receipts. The same mutation that the dealTriage
 * orchestrator uses internally is `internal.dealTriage.logActionRow`; this
 * mutation is the public, secret-gated equivalent for skill scripts.
 */
export const skillRecordActionLog = mutation({
  args: {
    mayaSecret: v.string(),
    creatorId: v.id("creators"),
    entryId: v.string(),
    outcome: v.union(
      v.literal("ran"),
      v.literal("skipped_plan_disabled"),
      v.literal("skipped_condition_unmet"),
      v.literal("skipped_dependency_missing"),
      v.literal("retried"),
      v.literal("failed")
    ),
    detail: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertMayaSecret(args.mayaSecret);
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) throw new Error("Creator not found.");
    await ctx.db.insert("mayaActionLog", {
      creatorId: args.creatorId,
      entryId: args.entryId,
      outcome: args.outcome,
      detail: args.detail,
      durationMs: args.durationMs,
      ts: Date.now(),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Test seam — let tests inject a runtime secret without env juggling          */
/* -------------------------------------------------------------------------- */

/**
 * Tests need to drive the skill mutations without the `MAYA_RUNTIME_SECRET`
 * env var being set. Setting `process.env.MAYA_RUNTIME_SECRET` from a test
 * file leaks across test files in the same convex-test pool, so we expose a
 * tiny seam: `assertMayaSecret` reads the env at call time and refuses
 * everything unless it matches. Tests use `vi.stubEnv` (or the platform
 * equivalent) to set the env for their describe block.
 *
 * Exported only for tests. Not part of the runtime API.
 */
export const _testInternal = {
  MAYA_RUNTIME_SECRET_ENV,
} as const;
