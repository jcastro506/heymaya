/**
 * Profile screen queries — `/biz/profile`.
 *
 * Per Service Sprint Plan § 12.6:
 *   - Editable business profile
 *   - Connections panel (GBP, CRM, FB/IG, Calendar, Voice)
 *   - Channel preference
 *   - Auto-send threshold + tone slider + memory reset
 *   - Billing tab (current plan, MTD voice minutes)
 *   - GDPR data export
 *   - "Trust Maya" approvalRules section
 *
 * Plan-tier UX:
 *   - Locked features show greyed with "Upgrade to Pro/Studio" inline pitch
 *     — never silently fail. Server-side gating via `planFeaturesService`
 *     decides which `approvalRules.ruleType`s are enableable; the UI mirrors
 *     this matrix.
 */

import { query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { getCurrentBusinessSession } from "./_session";
import {
  planFeaturesService,
  type ServicePlanFeatures,
} from "../../planService";

/**
 * Profile bundle: the business row + the account row (for email/timezone)
 * + the planFeatures matrix the UI uses to render gating UX.
 */
export const getProfile = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    business: Doc<"businesses">;
    account: Doc<"creators">;
    features: ServicePlanFeatures;
    voiceChannel: Doc<"voiceChannels"> | null;
  } | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const features = planFeaturesService(session.business);

    const voiceChannel = await ctx.db
      .query("voiceChannels")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .first();

    return {
      business: session.business,
      account: session.account,
      features,
      voiceChannel,
    };
  },
});

/**
 * Approval-rules state for the "Trust Maya" panel. Returns:
 *   - `rules`: existing rows for this business
 *   - `enableable`: the per-tier matrix surfacing which ruleType values can
 *     be enabled (UI greys out the rest)
 *   - `forbiddenAtAllTiers`: rule types that can never be enabled
 *     (review-reply-auto-publish-allowlist — Google ReviewReplyState lock)
 */
export const getApprovalRules = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    rules: Doc<"approvalRules">[];
    enableable: ReadonlyArray<string>;
    forbiddenAtAllTiers: ReadonlyArray<string>;
    plan: ServicePlanFeatures["plan"];
  } | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const features = planFeaturesService(session.business);

    const rules = await ctx.db
      .query("approvalRules")
      .withIndex("by_business", (q) =>
        q.eq("businessId", session.business._id)
      )
      .collect();

    return {
      rules,
      enableable: features.approvalRulesEnableable,
      // Hard-coded list of rules forbidden at every tier — kept in sync with
      // `convex/planService.ts` `approvalRuleEnableable` early-return.
      forbiddenAtAllTiers: ["review-reply-auto-publish-allowlist"],
      plan: features.plan,
    };
  },
});

/**
 * Connections panel data: GBP locations, CRM connections, voice channel,
 * plus the Zernio umbrella connection (FB/IG live under Zernio per the
 * service-product locked decision 2026-04-27).
 *
 * Returns `null` for unauth / mid-onboarding so the UI shows a loading
 * shell.
 */
export const getConnections = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    gbpLocations: Doc<"gbpLocations">[];
    crmConnections: Doc<"crmConnections">[];
    voiceChannel: Doc<"voiceChannels"> | null;
    zernioConnection: Doc<"zernioConnections"> | null;
    canConnectVoice: boolean;
    canConnectCrm: boolean;
    maxGbpLocations: number;
  } | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const features = planFeaturesService(session.business);

    const [gbpLocations, crmConnections, voiceChannel, zernioConnection] =
      await Promise.all([
        ctx.db
          .query("gbpLocations")
          .withIndex("by_business", (q) =>
            q.eq("businessId", session.business._id)
          )
          .collect(),
        ctx.db
          .query("crmConnections")
          .withIndex("by_business", (q) =>
            q.eq("businessId", session.business._id)
          )
          .collect(),
        ctx.db
          .query("voiceChannels")
          .withIndex("by_business", (q) =>
            q.eq("businessId", session.business._id)
          )
          .first(),
        ctx.db
          .query("zernioConnections")
          .withIndex("by_business", (q) =>
            q.eq("businessId", session.business._id)
          )
          .first(),
      ]);

    return {
      gbpLocations,
      crmConnections,
      voiceChannel,
      zernioConnection,
      canConnectVoice: features.voice,
      canConnectCrm: features.crmIntegration,
      maxGbpLocations: features.maxGbpLocations,
    };
  },
});

/**
 * Billing-tab data: plan + MTD voice minutes + subscription status.
 *
 * MTD voice computation (Wave D Stripe agent): the canonical counter is the
 * latest `voiceUsage` row's `minutesUsed`. The legacy
 * `voiceChannels.monthlyMinutesUsed` is preserved for backwards-compat (Wave
 * D voice agent may still write to it for telemetry) but the source of
 * truth for billing-tab display is `voiceUsage` since it tracks Stripe-
 * billing-period boundaries (matches `currentPlanPeriodEnd` rollover).
 */
export const getBilling = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    plan: ServicePlanFeatures["plan"];
    voice: {
      enabled: boolean;
      minutesUsed: number;
      minutesIncluded: number;
      overageRate: number | null;
      hardCap: number | null;
      cappedAt: number | null;
    };
    chat: {
      cap: ServicePlanFeatures["chatTurnsPerMonth"];
    };
    trialEndsAt: number | null;
    subscriptionStatus: string | null;
    stripeCustomerId: string | null;
    billingInterval: "monthly" | "annual" | null;
  } | null> => {
    const session = await getCurrentBusinessSession(ctx);
    if (!session) return null;

    const features = planFeaturesService(session.business);

    const [voiceChannel, voiceUsage] = await Promise.all([
      ctx.db
        .query("voiceChannels")
        .withIndex("by_business", (q) =>
          q.eq("businessId", session.business._id)
        )
        .first(),
      ctx.db
        .query("voiceUsage")
        .withIndex("by_business_and_period", (q) =>
          q.eq("businessId", session.business._id)
        )
        .order("desc")
        .first(),
    ]);

    // Prefer voiceUsage (Stripe-period-aligned) over voiceChannels.monthly-
    // MinutesUsed (legacy counter) for the surfaced number. Fall back to
    // voiceChannels for ops who haven't crossed a finalize event yet.
    const minutesUsed =
      voiceUsage?.minutesUsed ?? voiceChannel?.monthlyMinutesUsed ?? 0;

    return {
      plan: features.plan,
      voice: {
        enabled: features.voice,
        minutesUsed,
        minutesIncluded: features.voiceMinIncluded,
        overageRate: features.voiceOverageRate,
        hardCap: features.voiceHardCap,
        cappedAt: voiceUsage?.cappedAt ?? null,
      },
      chat: { cap: features.chatTurnsPerMonth },
      trialEndsAt: session.business.trialEndsAt ?? null,
      subscriptionStatus: session.business.subscriptionStatus ?? null,
      stripeCustomerId: session.business.stripeCustomerId ?? null,
      billingInterval: session.business.billingInterval ?? null,
    };
  },
});
