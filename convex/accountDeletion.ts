import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWebhookSecret } from "./lib/webhookSecret";
import { FlyClient, FlyError } from "./lib/flyClient";

const CONFIRMATION_PHRASE = "DELETE MAYA";
const REQUEST_TTL_MS = 30 * 60 * 1000;

const channelValidator = v.union(
  v.literal("imessage"),
  v.literal("whatsapp"),
  v.literal("sms")
);

const sourceValidator = v.union(v.literal("web"), v.literal("imessage"));

type CreatorScopedTable =
  | "creatorHandles"
  | "connectedAccounts"
  | "creatorPicture"
  | "aiCallLog"
  | "scrapeCreatorsCache"
  | "calendarEventOptOuts"
  | "industryIntelSeen"
  | "posts"
  | "postMetrics"
  | "dailyBriefs"
  | "weeklyReviews"
  | "hookLibrary"
  | "contentPlans"
  | "brandDeals"
  | "packetGenerations"
  | "mayaActionLog"
  | "pitchOutreach"
  | "opportunityScoutSeen"
  | "monetizationProposalLog"
  | "collabMatchLog"
  | "postPostmortems"
  | "trendObservations"
  | "competitorObservations"
  | "pairedChannels"
  | "gmailWebhookEvents"
  | "opportunitySurface"
  | "onboardingJobs"
  | "creatorMayaV0Onboarding"
  | "creatorMayaV0TiktokAccounts"
  | "creatorMayaV0TiktokPosts"
  | "creatorMayaV0CalendarConnections"
  | "creatorMayaV0CalendarEvents"
  | "creatorMayaV0Intake"
  | "creatorMayaV0CreatorPictures"
  | "creatorMayaV0DailyBriefs"
  | "creatorMayaV0ActionLog"
  | "creatorMayaV0OpenClawDeployments"
  | "creatorMayaV0BrandTargets"
  | "creatorMayaV0MediaAssets"
  | "creatorMayaV0EditRequests"
  | "accountDeletionRequests";

type BusinessScopedTable =
  | "businessPicture"
  | "businessMayaV0Intake"
  | "gbpLocations"
  | "serviceCustomers"
  | "serviceJobs"
  | "gbpPosts"
  | "reviews"
  | "reviewRequests"
  | "serviceContent"
  | "inboundLeads"
  | "crmConnections"
  | "voiceChannels"
  | "voiceCallTranscripts"
  | "voiceUsage"
  | "mediaAssets"
  | "customSkills"
  | "approvalRules"
  | "zernioConnections"
  | "mayaTaskQueue"
  | "wikiProjections"
  | "weeklyLearnings"
  | "gbpHealthScores"
  | "serviceTelemetry";

type AccountScopedTable =
  | "growthAgents"
  | "growthPosts"
  | "growthWaitlist"
  // S7 — GTM (ClawLaunch) account-scoped tables. All scoped by_account on
  // accountId (= creator._id). The 5 CROSS-TENANT tables are intentionally
  // EXEMPT and never appear here: gtmPlatformBriefs / gtmPlatformClaims /
  // gtmPlatformRefreshRuns (shared platform-algo intelligence),
  // gtmArchetypeLearnings + gtmSkillImprovementProposals (cross-tenant
  // learnings) — deleting one tenant must not erase shared knowledge.
  | "gtmAgents"
  | "gtmTelegramPairingTokens"
  | "gtmCalendarConnections"
  | "gtmCalendarEvents"
  | "gtmWorkspaceMutations"
  | "gtmOauthStateTokens"
  | "gtmHookCallbacks"
  | "gtmDeliveryFailures"
  | "gtmApps"
  | "gtmResearchJobs"
  | "gtmWalkthroughUploads"
  | "gtmEvidenceCards"
  | "gtmBuyerSegments"
  | "gtmChannelScores"
  | "gtmDistributionMotions"
  | "gtmFormatExperiments"
  | "gtmContentBankItems"
  | "gtmCostLedger"
  | "gtmToolCallLog"
  | "gtmContentDrafts"
  | "gtmResultSnapshots"
  | "gtmSafetyStates"
  | "gtmAuditEvents"
  | "gtmConnectionHealth"
  | "gtmMachineHealth"
  | "gtmBetaCohort"
  | "gtmHumanPlanReviews"
  | "gtmUserReportedSignals"
  | "gtmUgcReadinessReports"
  | "gtmTargetThreads"
  | "gtmTargetAccounts"
  | "gtmDraftedContent"
  | "gtmPostResults"
  | "gtmLinkWraps"
  | "gtmLinkClicks"
  | "gtmConversions"
  | "gtmAgentActivity"
  | "gtmBuyerMap"
  | "gtmCompetitiveMap"
  | "gtmChannelScorecard"
  | "gtmContentAngles"
  | "gtmRelationshipTargets"
  | "gtmCompetitorMoves"
  | "gtmNichePulse"
  | "gtmActionLog"
  | "gtmNicheLearnings"
  | "gtmMemoryWrites"
  // 2026-07-15 — five account-scoped tables found ORPHANED after a live
  // dashboard deletion (rows survived the purge; mayaMessages = the founder's
  // private DM transcript, gtmAgentTrace = thinking timeline,
  // gtmSteeringDirectives = the founder's own instructions — all
  // privacy-relevant). All five carry a by_account index.
  | "gtmChannelWatermarks"
  | "gtmWatchLaneState"
  | "gtmAgentTrace"
  | "mayaMessages"
  | "gtmSteeringDirectives";

const CREATOR_SCOPED_TABLES: CreatorScopedTable[] = [
  "creatorHandles",
  "connectedAccounts",
  "creatorPicture",
  "aiCallLog",
  "scrapeCreatorsCache",
  "calendarEventOptOuts",
  "industryIntelSeen",
  "posts",
  "postMetrics",
  "dailyBriefs",
  "weeklyReviews",
  "hookLibrary",
  "contentPlans",
  "brandDeals",
  "packetGenerations",
  "mayaActionLog",
  "pitchOutreach",
  "opportunityScoutSeen",
  "monetizationProposalLog",
  "collabMatchLog",
  "postPostmortems",
  "trendObservations",
  "competitorObservations",
  "pairedChannels",
  "gmailWebhookEvents",
  "opportunitySurface",
  "onboardingJobs",
  "creatorMayaV0Onboarding",
  "creatorMayaV0TiktokAccounts",
  "creatorMayaV0TiktokPosts",
  "creatorMayaV0CalendarConnections",
  "creatorMayaV0CalendarEvents",
  "creatorMayaV0Intake",
  "creatorMayaV0CreatorPictures",
  "creatorMayaV0DailyBriefs",
  "creatorMayaV0ActionLog",
  "creatorMayaV0OpenClawDeployments",
  "creatorMayaV0BrandTargets",
  "creatorMayaV0EditRequests",
  "creatorMayaV0MediaAssets",
  "accountDeletionRequests",
];

const BUSINESS_SCOPED_TABLES: BusinessScopedTable[] = [
  "businessPicture",
  "businessMayaV0Intake",
  "gbpLocations",
  "serviceCustomers",
  "serviceJobs",
  "gbpPosts",
  "reviews",
  "reviewRequests",
  "serviceContent",
  "inboundLeads",
  "crmConnections",
  "voiceChannels",
  "voiceCallTranscripts",
  "voiceUsage",
  "mediaAssets",
  "customSkills",
  "approvalRules",
  "zernioConnections",
  "mayaTaskQueue",
  "wikiProjections",
  "weeklyLearnings",
  "gbpHealthScores",
  "serviceTelemetry",
];

const ACCOUNT_SCOPED_TABLES: AccountScopedTable[] = [
  "growthAgents",
  "growthPosts",
  "growthWaitlist",
  // S7 — GTM cascade (cross-tenant tables intentionally omitted; see type).
  "gtmAgents",
  "gtmTelegramPairingTokens",
  "gtmCalendarConnections",
  "gtmCalendarEvents",
  "gtmWorkspaceMutations",
  "gtmOauthStateTokens",
  "gtmHookCallbacks",
  "gtmDeliveryFailures",
  "gtmApps",
  "gtmResearchJobs",
  "gtmWalkthroughUploads",
  "gtmEvidenceCards",
  "gtmBuyerSegments",
  "gtmChannelScores",
  "gtmDistributionMotions",
  "gtmFormatExperiments",
  "gtmContentBankItems",
  "gtmCostLedger",
  "gtmToolCallLog",
  "gtmContentDrafts",
  "gtmResultSnapshots",
  "gtmSafetyStates",
  "gtmAuditEvents",
  "gtmConnectionHealth",
  "gtmMachineHealth",
  "gtmBetaCohort",
  "gtmHumanPlanReviews",
  "gtmUserReportedSignals",
  "gtmUgcReadinessReports",
  "gtmTargetThreads",
  "gtmTargetAccounts",
  "gtmDraftedContent",
  "gtmPostResults",
  "gtmLinkWraps",
  "gtmLinkClicks",
  "gtmConversions",
  "gtmAgentActivity",
  "gtmBuyerMap",
  "gtmCompetitiveMap",
  "gtmChannelScorecard",
  "gtmContentAngles",
  "gtmRelationshipTargets",
  "gtmCompetitorMoves",
  "gtmNichePulse",
  "gtmActionLog",
  "gtmNicheLearnings",
  "gtmMemoryWrites",
  "gtmChannelWatermarks",
  "gtmWatchLaneState",
  "gtmAgentTrace",
  "mayaMessages",
  "gtmSteeringDirectives",
];

export const requestMyAccountDeletion = mutation({
  args: { source: sourceValidator },
  handler: async (ctx, args) => {
    const creator = await requireCurrentCreator(ctx);
    const now = Date.now();
    await expirePriorRequests(ctx, creator._id, now);
    const requestId = await ctx.db.insert("accountDeletionRequests", {
      creatorId: creator._id,
      source: args.source,
      confirmationPhrase: CONFIRMATION_PHRASE,
      status: "requested",
      requestedAt: now,
      expiresAt: now + REQUEST_TTL_MS,
    });
    return {
      requestId,
      confirmationPhrase: CONFIRMATION_PHRASE,
      expiresAt: now + REQUEST_TTL_MS,
    };
  },
});

export const cancelMyAccountDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const creator = await requireCurrentCreator(ctx);
    const rows = await ctx.db
      .query("accountDeletionRequests")
      .withIndex("by_creator_and_status", (q) =>
        q.eq("creatorId", creator._id).eq("status", "requested")
      )
      .collect();
    for (const row of rows) {
      await ctx.db.patch(row._id, { status: "cancelled" });
    }
    return { cancelled: rows.length };
  },
});

export const requestDeletionByPhonePublic = mutation({
  args: {
    secret: v.string(),
    channel: channelValidator,
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    assertWebhookSecret(args.secret);
    const creator = await activeCreatorForPhone(ctx, args);
    if (!creator) {
      return {
        ok: false,
        reason: "active-channel-not-found",
        confirmationPhrase: CONFIRMATION_PHRASE,
      } as const;
    }
    const now = Date.now();
    await expirePriorRequests(ctx, creator._id, now);
    await ctx.db.insert("accountDeletionRequests", {
      creatorId: creator._id,
      source: "imessage",
      confirmationPhrase: CONFIRMATION_PHRASE,
      status: "requested",
      requestedAt: now,
      expiresAt: now + REQUEST_TTL_MS,
    });
    return {
      ok: true,
      confirmationPhrase: CONFIRMATION_PHRASE,
      expiresAt: now + REQUEST_TTL_MS,
    } as const;
  },
});

export const confirmDeletionByPhonePublic = mutation({
  args: {
    secret: v.string(),
    channel: channelValidator,
    phoneNumber: v.string(),
    confirmationText: v.string(),
  },
  handler: async (ctx, args) => {
    assertWebhookSecret(args.secret);
    if (normalizeConfirmation(args.confirmationText) !== CONFIRMATION_PHRASE) {
      return {
        ok: false,
        reason: "confirmation-mismatch",
        confirmationPhrase: CONFIRMATION_PHRASE,
      } as const;
    }

    const creator = await activeCreatorForPhone(ctx, args);
    if (!creator) {
      return {
        ok: false,
        reason: "active-channel-not-found",
        confirmationPhrase: CONFIRMATION_PHRASE,
      } as const;
    }

    const request = await latestDeletionRequest(ctx, creator._id);
    const now = Date.now();
    if (!request || request.expiresAt < now) {
      if (request) await ctx.db.patch(request._id, { status: "expired" });
      return {
        ok: false,
        reason: "request-expired-or-missing",
        confirmationPhrase: CONFIRMATION_PHRASE,
      } as const;
    }

    await ctx.db.patch(request._id, {
      status: "confirmed",
      confirmedAt: now,
    });
    const result = await purgeCreatorAccount(ctx, creator, "imessage");
    return { ok: true, ...result } as const;
  },
});

export const purgeByClerkUserIdPublic = mutation({
  args: {
    secret: v.string(),
    clerkUserId: v.string(),
    source: sourceValidator,
  },
  handler: async (ctx, args) => {
    assertWebhookSecret(args.secret);
    const creator = await creatorByClerkUserId(ctx, args.clerkUserId);
    if (!creator) {
      return {
        ok: true,
        deleted: false,
        clerkUserId: args.clerkUserId,
        reason: "creator-not-found",
        flyAppIds: [],
      } as const;
    }
    const result = await purgeCreatorAccount(ctx, creator, args.source);
    return { ok: true, deleted: true, ...result } as const;
  },
});

/**
 * Authoritative table-purge for a GTM account by creator id. The CALLER (the
 * `hardDeleteMyGtmAccount` action, or the retention sweep) is responsible for
 * verifying ownership / eligibility BEFORE invoking this — it does no auth of
 * its own beyond confirming the row is a gtm-agent (a defense-in-depth guard so
 * this can never be mis-pointed at a creator/business account). Returns the
 * collected `flyAppIds` so the calling ACTION can destroy the Fly app(s) +
 * delete the Stripe customer (network work the mutation can't do). Idempotent:
 * a missing/already-purged creator returns `deleted:false` with empty flyAppIds.
 */
export const purgeGtmAccountByCreatorId = internalMutation({
  args: { creatorId: v.id("creators"), source: sourceValidator },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      return {
        ok: true,
        deleted: false,
        reason: "creator-not-found",
        flyAppIds: [] as string[],
      } as const;
    }
    if (creator.accountType !== "gtm-agent") {
      // Hard guard: this entry point only ever purges GTM accounts. A
      // creator/business account must go through the existing creator path.
      return {
        ok: false,
        deleted: false,
        reason: "not-a-gtm-account",
        flyAppIds: [] as string[],
      } as const;
    }
    const result = await purgeCreatorAccount(ctx, creator, args.source);
    return { ok: true, deleted: true, ...result } as const;
  },
});

/**
 * 2026-07-15 — orphan sweep. Five account-scoped tables were missing from the
 * purge list, so rows survived past account deletions (mayaMessages — the
 * founder's private DM transcript — among them). The list is fixed above; this
 * mutation retro-purges rows whose accountId no longer resolves to a live
 * creator. Idempotent; batched under the 4096-read mutation limit — re-run
 * until it reports done:true.
 *   npx convex run accountDeletion:sweepOrphanedAccountRows
 */
export const sweepOrphanedAccountRows = internalMutation({
  args: {},
  handler: async (
    ctx
  ): Promise<{ deleted: Record<string, number>; total: number; done: boolean }> => {
    const PREVIOUSLY_MISSED: AccountScopedTable[] = [
      "gtmChannelWatermarks",
      "gtmWatchLaneState",
      "gtmAgentTrace",
      "mayaMessages",
      "gtmSteeringDirectives",
    ];
    const BATCH = 600;
    const liveAccountIds = new Set(
      (await ctx.db.query("creators").collect()).map((c) => c._id as string)
    );
    const deleted: Record<string, number> = {};
    let total = 0;
    let readBudget = 3200;
    let exhaustedAll = true;
    for (const table of PREVIOUSLY_MISSED) {
      if (readBudget <= 0) {
        exhaustedAll = false;
        break;
      }
      const take = Math.min(BATCH, readBudget);
      const rows = await (
        ctx.db as unknown as {
          query: (t: string) => {
            take: (n: number) => Promise<
              Array<{
                _id: Parameters<MutationCtx["db"]["delete"]>[0];
                accountId?: string;
              }>
            >;
          };
        }
      )
        .query(table)
        .take(take);
      readBudget -= rows.length;
      if (rows.length === take) exhaustedAll = false;
      let n = 0;
      for (const row of rows) {
        if (row.accountId && !liveAccountIds.has(row.accountId)) {
          await ctx.db.delete(row._id);
          n += 1;
        }
      }
      deleted[table] = n;
      total += n;
    }
    return { deleted, total, done: exhaustedAll };
  },
});

async function requireCurrentCreator(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication required.");
  const creator = await creatorByClerkUserId(ctx, identity.subject);
  if (!creator) throw new Error("Account not found.");
  return creator;
}

async function creatorByClerkUserId(
  ctx: QueryCtx | MutationCtx,
  clerkUserId: string
) {
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first();
}

async function activeCreatorForPhone(
  ctx: QueryCtx | MutationCtx,
  args: { channel: "imessage" | "whatsapp" | "sms"; phoneNumber: string }
): Promise<Doc<"creators"> | null> {
  const rows = await ctx.db
    .query("pairedChannels")
    .withIndex("by_channel_and_phone", (q) =>
      q.eq("channel", args.channel).eq("phoneNumber", args.phoneNumber)
    )
    .collect();
  const active = rows
    .filter((row) => row.status === "active")
    .sort((a, b) => (b.pairedAt ?? b.requestedAt) - (a.pairedAt ?? a.requestedAt))[0];
  if (!active) return null;
  return await ctx.db.get(active.creatorId);
}

async function latestDeletionRequest(
  ctx: QueryCtx | MutationCtx,
  creatorId: Id<"creators">
): Promise<Doc<"accountDeletionRequests"> | null> {
  const rows = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_creator_and_status", (q) =>
      q.eq("creatorId", creatorId).eq("status", "requested")
    )
    .collect();
  rows.sort((a, b) => b.requestedAt - a.requestedAt);
  return rows[0] ?? null;
}

async function expirePriorRequests(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  now: number
): Promise<void> {
  const rows = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_creator_and_status", (q) =>
      q.eq("creatorId", creatorId).eq("status", "requested")
    )
    .collect();
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      status: row.expiresAt < now ? "expired" : "cancelled",
    });
  }
}

async function purgeCreatorAccount(
  ctx: MutationCtx,
  creator: Doc<"creators">,
  source: "web" | "imessage"
) {
  const businessIds = await businessIdsForAccount(ctx, creator._id);
  const businesses = await Promise.all(businessIds.map((id) => ctx.db.get(id)));
  const stripeCustomerIds = [
    creator.stripeCustomerId,
    ...businesses.map((business) => business?.stripeCustomerId),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  const flyAppIds = await flyAppIdsForAccount(ctx, creator, businesses);

  // Fly teardown MUST happen Convex-side: FLY_API_TOKEN lives in this
  // deployment's env, not on the web host (the Vercel route's best-effort
  // destroy silently no-ops without a token — that gap orphaned a machine on
  // 2026-07-06 that burned OpenRouter spend all night with its agent row gone).
  // Scheduling from the purge makes teardown follow the row delete atomically
  // for every entry point (web route, Clerk webhook, iMessage, retention sweep).
  if (flyAppIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.destroyFlyAppsInternal, {
      flyAppIds,
      attempt: 1,
    });
  }
  // Stripe delete is Convex-side for the same reason (STRIPE_SECRET_KEY lives
  // here, not on Vercel). Deleting the customer cancels every subscription —
  // without this, a web-route deletion kept billing the user (the complete
  // hardDeleteMyGtmAccount action existed but no UI path invoked it).
  if (stripeCustomerIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.accountDeletion.deleteStripeCustomersInternal, {
      stripeCustomerIds,
      attempt: 1,
    });
  }

  const creatorDeleted = await deleteCreatorScopedRows(ctx, creator._id);
  const accountDeleted = await deleteAccountScopedRows(ctx, creator._id);
  let businessDeleted = 0;
  for (const businessId of businessIds) {
    businessDeleted += await deleteBusinessScopedRows(ctx, businessId);
    const business = await ctx.db.get(businessId);
    if (business) {
      await ctx.db.delete(businessId);
      businessDeleted += 1;
    }
  }
  for (const customerId of stripeCustomerIds) {
    await deleteStripeWebhookRows(ctx, customerId);
  }
  await ctx.db.delete(creator._id);

  return {
    source,
    clerkUserId: creator.clerkUserId,
    email: creator.email,
    deletedRows: {
      creatorScoped: creatorDeleted,
      accountScoped: accountDeleted,
      businessScoped: businessDeleted,
      creator: 1,
    },
    flyAppIds,
  };
}

const FLY_DESTROY_MAX_ATTEMPTS = 4;
const FLY_DESTROY_RETRY_MS = 60_000;

/**
 * Delete the Stripe customers collected during an account purge. Deleting a
 * customer cancels all of their subscriptions immediately (same semantics the
 * hardDeleteMyGtmAccount action relies on). Runs Convex-side where
 * STRIPE_SECRET_KEY lives. Already-deleted customers are success; failures
 * re-schedule with the same backoff as the Fly teardown, then log loudly —
 * a missed delete means the user keeps getting billed after deleting their
 * account.
 */
export const deleteStripeCustomersInternal = internalAction({
  args: { stripeCustomerIds: v.array(v.string()), attempt: v.number() },
  handler: async (
    ctx,
    args
  ): Promise<{ deleted: number; failed: string[] }> => {
    const { getStripeClient } = await import("./billing/stripeClient");
    const stripe = getStripeClient();
    const failed: string[] = [];
    let deleted = 0;
    for (const customerId of [...new Set(args.stripeCustomerIds.filter(Boolean))]) {
      try {
        if (stripe.customers.del) {
          await stripe.customers.del(customerId);
        }
        deleted += 1;
        console.log(`[accountDeletion] deleted Stripe customer ${customerId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Stripe raises resource_missing for an already-deleted customer.
        if (/no such customer|resource_missing/i.test(message)) continue;
        failed.push(customerId);
        console.error(
          `[accountDeletion] Stripe customer delete failed for ${customerId} (attempt ${args.attempt}): ${message}`
        );
      }
    }
    if (failed.length > 0) {
      if (args.attempt < FLY_DESTROY_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          FLY_DESTROY_RETRY_MS,
          internal.accountDeletion.deleteStripeCustomersInternal,
          { stripeCustomerIds: failed, attempt: args.attempt + 1 }
        );
      } else {
        console.error(
          `[accountDeletion] STRIPE CUSTOMERS NOT DELETED after ${args.attempt} attempts: ${failed.join(", ")} — the user may still be billed; delete manually in the Stripe dashboard.`
        );
      }
    }
    return { deleted, failed };
  },
});

/**
 * Destroy the per-user OpenClaw Fly apps collected during an account purge.
 * Runs Convex-side so it always has FLY_API_TOKEN. 404 = already gone =
 * success. Any app that fails is re-scheduled (60s backoff, max 4 attempts);
 * a final failure is loud in the logs — an orphaned machine keeps burning
 * LLM spend with no owning agent row, so this must never fail silently.
 */
export const destroyFlyAppsInternal = internalAction({
  args: { flyAppIds: v.array(v.string()), attempt: v.number() },
  handler: async (
    ctx,
    args
  ): Promise<{ destroyed: number; failed: string[] }> => {
    const fly = new FlyClient();
    const failed: string[] = [];
    let destroyed = 0;
    for (const appId of [...new Set(args.flyAppIds.filter(Boolean))]) {
      try {
        await fly.destroyApp(appId);
        destroyed += 1;
        console.log(`[accountDeletion] destroyed Fly app ${appId}`);
      } catch (error) {
        if (error instanceof FlyError && error.status === 404) continue;
        failed.push(appId);
        console.error(
          `[accountDeletion] Fly destroy failed for ${appId} (attempt ${args.attempt}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    if (failed.length > 0) {
      if (args.attempt < FLY_DESTROY_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          FLY_DESTROY_RETRY_MS,
          internal.accountDeletion.destroyFlyAppsInternal,
          { flyAppIds: failed, attempt: args.attempt + 1 }
        );
      } else {
        console.error(
          `[accountDeletion] ORPHANED FLY APPS after ${args.attempt} attempts: ${failed.join(", ")} — destroy manually (they burn LLM spend headlessly).`
        );
      }
    }
    return { destroyed, failed };
  },
});

async function flyAppIdsForAccount(
  ctx: QueryCtx | MutationCtx,
  creator: Doc<"creators">,
  businesses: Array<Doc<"businesses"> | null>
): Promise<string[]> {
  const ids = new Set<string>();
  if (creator.mayaFlyAppId) ids.add(creator.mayaFlyAppId);
  for (const business of businesses) {
    if (business?.mayaFlyAppId) ids.add(business.mayaFlyAppId);
  }
  const deployments = await ctx.db
    .query("creatorMayaV0OpenClawDeployments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  for (const deployment of deployments) {
    if (deployment.flyAppId) ids.add(deployment.flyAppId);
  }
  const growthAgents = await ctx.db
    .query("growthAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .collect();
  for (const agent of growthAgents) {
    if (agent.rileyFlyAppId) ids.add(agent.rileyFlyAppId);
  }
  // S7 — GTM agent's Fly machine. CRITICAL for stop-answering: inbound
  // Telegram hits the Fly machine directly, so a Convex flag alone won't
  // silence Maya — the machine must be destroyed. Collected here (before the
  // cascade deletes the gtmAgents row) so destroyMayaFlyApps tears it down.
  const gtmAgents = await ctx.db
    .query("gtmAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .collect();
  for (const agent of gtmAgents) {
    if (agent.openClawFlyAppId) ids.add(agent.openClawFlyAppId);
  }
  return [...ids];
}

async function businessIdsForAccount(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"creators">
): Promise<Array<Id<"businesses">>> {
  const rows = await ctx.db
    .query("businesses")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const ids = rows.map((row) => row._id);
  const account = await ctx.db.get(accountId);
  if (account?.businessId && !ids.includes(account.businessId)) {
    ids.push(account.businessId);
  }
  return ids;
}

async function deleteCreatorScopedRows(
  ctx: MutationCtx,
  creatorId: Id<"creators">
): Promise<number> {
  let count = 0;
  for (const table of CREATOR_SCOPED_TABLES) {
    if (table === "creatorMayaV0MediaAssets") {
      const rows = await ctx.db
        .query("creatorMayaV0MediaAssets")
        .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
        .collect();
      for (const row of rows) {
        if (row.storageId) {
          await ctx.storage.delete(row.storageId);
        }
        await ctx.db.delete(row._id);
        count += 1;
      }
      continue;
    }
    const rows = await queryByIndex(ctx, table, "by_creator", "creatorId", creatorId);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      count += 1;
    }
  }
  return count;
}

async function deleteBusinessScopedRows(
  ctx: MutationCtx,
  businessId: Id<"businesses">
): Promise<number> {
  let count = 0;
  for (const table of BUSINESS_SCOPED_TABLES) {
    if (table === "mediaAssets") {
      const rows = await ctx.db
        .query("mediaAssets")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect();
      for (const row of rows) {
        if (row.storageId) {
          await ctx.storage.delete(row.storageId);
        }
        await ctx.db.delete(row._id);
        count += 1;
      }
      continue;
    }
    const rows = await queryByIndex(ctx, table, "by_business", "businessId", businessId);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      count += 1;
    }
  }
  return count;
}

async function deleteAccountScopedRows(
  ctx: MutationCtx,
  accountId: Id<"creators">
): Promise<number> {
  let count = 0;
  for (const table of ACCOUNT_SCOPED_TABLES) {
    const rows = await queryByIndex(ctx, table, "by_account", "accountId", accountId);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      count += 1;
    }
  }
  return count;
}

async function deleteStripeWebhookRows(
  ctx: MutationCtx,
  customerId: string
): Promise<number> {
  const rows = await ctx.db
    .query("stripeWebhookEvents")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

async function queryByIndex(
  ctx: QueryCtx | MutationCtx,
  table: string,
  index: string,
  field: string,
  value: unknown
): Promise<Array<{ _id: Parameters<MutationCtx["db"]["delete"]>[0] }>> {
  type UntypedIndexBuilder = {
    eq: (fieldName: string, fieldValue: unknown) => unknown;
  };
  type UntypedDb = {
    query: (tableName: string) => {
      withIndex: (
        indexName: string,
        builder: (q: UntypedIndexBuilder) => unknown
      ) => {
        collect: () => Promise<
          Array<{ _id: Parameters<MutationCtx["db"]["delete"]>[0] }>
        >;
      };
    };
  };
  const db = ctx.db as unknown as UntypedDb;
  return await db
    .query(table)
    .withIndex(index, (q) => q.eq(field, value))
    .collect();
}

function normalizeConfirmation(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
