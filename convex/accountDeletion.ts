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

const sourceValidator = v.union(v.literal("web"), v.literal("imessage"));

/**
 * Rows deleted per pass. Well under Convex's 4,096-read ceiling, because the
 * scan itself costs reads too — a budget at the limit would still throw.
 */
const DELETE_BUDGET = 1_000;

/**
 * Sprint 0b — the purge lists after the schema prune.
 *
 * The creator and service products were deleted, and with them ~70 tables.
 * What remains creator-scoped is the shared infrastructure that outlived both:
 * Composio connections, the LLM call log, weekly reviews, and the deletion
 * requests themselves. Everything else a live account owns is account-scoped
 * (GTM) and lives in ACCOUNT_SCOPED_TABLES below.
 */
type CreatorScopedTable =
  | "connectedAccounts"
  | "aiCallLog"
  | "weeklyReviews"
  | "accountDeletionRequests";

type AccountScopedTable =
  | "growthWaitlist"
  // GTM account-scoped tables, all indexed by_account on accountId
  // (= creator._id). The 5 CROSS-TENANT tables are intentionally EXEMPT and
  // never appear here: gtmPlatformBriefs / gtmPlatformClaims /
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
  "connectedAccounts",
  "aiCallLog",
  "weeklyReviews",
  "accountDeletionRequests",
];

const ACCOUNT_SCOPED_TABLES: AccountScopedTable[] = [
  "growthWaitlist",
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
        q.eq("creatorId", creator._id).eq("status", "requested"),
      )
      .collect();
    for (const row of rows) {
      await ctx.db.patch(row._id, { status: "cancelled" });
    }
    return { cancelled: rows.length };
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
    ctx,
  ): Promise<{
    deleted: Record<string, number>;
    total: number;
    done: boolean;
  }> => {
    const PREVIOUSLY_MISSED: AccountScopedTable[] = [
      "gtmChannelWatermarks",
      "gtmWatchLaneState",
      "gtmAgentTrace",
      "mayaMessages",
      "gtmSteeringDirectives",
    ];
    const BATCH = 600;
    const liveAccountIds = new Set(
      (await ctx.db.query("creators").collect()).map((c) => c._id as string),
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
  clerkUserId: string,
) {
  return await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first();
}

async function expirePriorRequests(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  now: number,
): Promise<void> {
  const rows = await ctx.db
    .query("accountDeletionRequests")
    .withIndex("by_creator_and_status", (q) =>
      q.eq("creatorId", creatorId).eq("status", "requested"),
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
  source: "web" | "imessage",
) {
  const stripeCustomerIds = [creator.stripeCustomerId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const flyAppIds = await flyAppIdsForAccount(ctx, creator);
  const zernioAccountIds = await zernioAccountIdsForAccount(ctx, creator._id);

  // Zernio disconnect is Convex-side for the same reason as Fly/Stripe below
  // (ZERNIO_API_KEY lives here). Collected BEFORE the cascade deletes the
  // gtmAgents rows that hold the account ids; deleting each account revokes
  // the user's social OAuth grant and stops its pay-per-account billing.
  if (zernioAccountIds.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.accountDeletion.disconnectZernioAccountsInternal,
      { zernioAccountIds, attempt: 1 },
    );
  }
  // Fly teardown MUST happen Convex-side: FLY_API_TOKEN lives in this
  // deployment's env, not on the web host (the Vercel route's best-effort
  // destroy silently no-ops without a token — that gap orphaned a machine on
  // 2026-07-06 that burned OpenRouter spend all night with its agent row gone).
  // Scheduling from the purge makes teardown follow the row delete atomically
  // for every entry point (web route, Clerk webhook, iMessage, retention sweep).
  if (flyAppIds.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.accountDeletion.destroyFlyAppsInternal,
      {
        flyAppIds,
        attempt: 1,
      },
    );
  }
  // Stripe delete is Convex-side for the same reason (STRIPE_SECRET_KEY lives
  // here, not on Vercel). Deleting the customer cancels every subscription —
  // without this, a web-route deletion kept billing the user (the complete
  // hardDeleteMyGtmAccount action existed but no UI path invoked it).
  if (stripeCustomerIds.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.accountDeletion.deleteStripeCustomersInternal,
      {
        stripeCustomerIds,
        attempt: 1,
      },
    );
  }

  /**
   * Deleted in bounded passes, not all at once.
   *
   * Convex caps one mutation at 4,096 reads, so a single sweep threw on any
   * account with real history — which is to say, on every account this is
   * actually for. `done: false` means rows remain and the caller should invoke
   * again; the creator row itself is deleted LAST, so a partially-purged
   * account is still findable and resumable rather than orphaned.
   *
   * External teardown (Fly, Stripe, Zernio) was already scheduled above, on the
   * first pass — the machine stops billing immediately rather than waiting for
   * the row-delete to finish.
   */
  const creatorDeleted = await deleteCreatorScopedRows(
    ctx,
    creator._id,
    DELETE_BUDGET,
  );
  const accountDeleted = await deleteAccountScopedRows(
    ctx,
    creator._id,
    DELETE_BUDGET - creatorDeleted.count,
  );
  /**
   * ⭐ The live product. Added 2026-08-11 — every table above belongs to the
   * deleted one, so none of this founder's actual data was being removed.
   */
  const mayaDeleted = await deleteMayaCustomerRows(
    ctx,
    creator._id,
    DELETE_BUDGET - creatorDeleted.count - accountDeleted.count,
  );
  const done =
    !creatorDeleted.exhausted &&
    !accountDeleted.exhausted &&
    !mayaDeleted.exhausted;

  if (done) {
    for (const customerId of stripeCustomerIds) {
      await deleteStripeWebhookRows(ctx, customerId);
    }
    await ctx.db.delete(creator._id);
  }

  return {
    source,
    done,
    clerkUserId: creator.clerkUserId,
    email: creator.email,
    deletedRows: {
      creatorScoped: creatorDeleted.count,
      accountScoped: accountDeleted.count,
      mayaScoped: mayaDeleted.count,
      creator: done ? 1 : 0,
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
    args,
  ): Promise<{ deleted: number; failed: string[] }> => {
    const { getStripeClient } = await import("./billing/stripeClient");
    const stripe = getStripeClient();
    const failed: string[] = [];
    let deleted = 0;
    for (const customerId of [
      ...new Set(args.stripeCustomerIds.filter(Boolean)),
    ]) {
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
          `[accountDeletion] Stripe customer delete failed for ${customerId} (attempt ${args.attempt}): ${message}`,
        );
      }
    }
    if (failed.length > 0) {
      if (args.attempt < FLY_DESTROY_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          FLY_DESTROY_RETRY_MS,
          internal.accountDeletion.deleteStripeCustomersInternal,
          { stripeCustomerIds: failed, attempt: args.attempt + 1 },
        );
      } else {
        console.error(
          `[accountDeletion] STRIPE CUSTOMERS NOT DELETED after ${args.attempt} attempts: ${failed.join(", ")} — the user may still be billed; delete manually in the Stripe dashboard.`,
        );
      }
    }
    return { deleted, failed };
  },
});

/**
 * Disconnect the user's Zernio-connected social accounts collected during an
 * account purge. `DELETE /api/v1/accounts/{id}` revokes the platform OAuth
 * grant and stops that account's pay-per-account billing. 404 / not-found =
 * already disconnected = success. Failures re-schedule with the same backoff
 * as the Fly teardown, then log loudly — a missed disconnect means we keep a
 * live grant to post on a deleted user's social account.
 */
export const disconnectZernioAccountsInternal = internalAction({
  args: { zernioAccountIds: v.array(v.string()), attempt: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ disconnected: number; failed: string[] }> => {
    const failed: string[] = [];
    let disconnected = 0;
    if (!process.env.ZERNIO_API_KEY) {
      // Retrying won't conjure a key; make the miss loud and actionable.
      console.error(
        `[accountDeletion] ZERNIO_API_KEY missing — cannot disconnect Zernio accounts ${args.zernioAccountIds.join(", ")}; disconnect them manually in the Zernio dashboard.`,
      );
      return { disconnected: 0, failed: args.zernioAccountIds };
    }
    const { ZernioClient } = await import("./integrations/zernio/client");
    const { deleteAccount } = await import("./integrations/zernio/endpoints");
    const client = new ZernioClient({ apiKey: process.env.ZERNIO_API_KEY });
    for (const accountId of [
      ...new Set(args.zernioAccountIds.filter(Boolean)),
    ]) {
      try {
        await deleteAccount(client, accountId);
        disconnected += 1;
        console.log(
          `[accountDeletion] disconnected Zernio account ${accountId}`,
        );
      } catch (error) {
        const status = (error as { status?: number }).status;
        const message = error instanceof Error ? error.message : String(error);
        // Already disconnected/gone reads as success (duck-typed: instanceof
        // breaks across convex-test's module boundary).
        if (status === 404 || /404|not found/i.test(message)) {
          disconnected += 1;
          continue;
        }
        failed.push(accountId);
        console.error(
          `[accountDeletion] Zernio disconnect failed for ${accountId} (attempt ${args.attempt}): ${message}`,
        );
      }
    }
    if (failed.length > 0) {
      if (args.attempt < FLY_DESTROY_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          FLY_DESTROY_RETRY_MS,
          internal.accountDeletion.disconnectZernioAccountsInternal,
          { zernioAccountIds: failed, attempt: args.attempt + 1 },
        );
      } else {
        console.error(
          `[accountDeletion] ZERNIO ACCOUNTS NOT DISCONNECTED after ${args.attempt} attempts: ${failed.join(", ")} — the user's social OAuth grants are still live; disconnect manually in the Zernio dashboard.`,
        );
      }
    }
    return { disconnected, failed };
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
    args,
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
          }`,
        );
      }
    }
    if (failed.length > 0) {
      if (args.attempt < FLY_DESTROY_MAX_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          FLY_DESTROY_RETRY_MS,
          internal.accountDeletion.destroyFlyAppsInternal,
          { flyAppIds: failed, attempt: args.attempt + 1 },
        );
      } else {
        console.error(
          `[accountDeletion] ORPHANED FLY APPS after ${args.attempt} attempts: ${failed.join(", ")} — destroy manually (they burn LLM spend headlessly).`,
        );
      }
    }
    return { destroyed, failed };
  },
});

/**
 * Collect the user's Zernio-connected social accounts (X / LinkedIn / IG / …)
 * BEFORE the cascade deletes the gtmAgents rows that hold them. Deleting an
 * account in Zernio (`DELETE /api/v1/accounts/{id}`) revokes the OAuth
 * connection and stops its pay-per-account billing — without this, a deleted
 * user's live social-posting grants sit in our shared Zernio workspace
 * forever. (Service-product `zernioConnections` rows are NOT collected: those
 * hold per-business Zernio API keys for the business's OWN workspace, which
 * our shared-workspace key cannot and should not touch.)
 */
async function zernioAccountIdsForAccount(
  ctx: QueryCtx | MutationCtx,
  creatorId: Id<"creators">,
): Promise<string[]> {
  const ids = new Set<string>();
  const gtmAgents = await ctx.db
    .query("gtmAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creatorId))
    .collect();
  for (const agent of gtmAgents) {
    if (!agent.connectedAccountsJson) continue;
    try {
      const accounts = JSON.parse(agent.connectedAccountsJson) as Array<{
        accountId?: string;
      }>;
      if (Array.isArray(accounts)) {
        for (const account of accounts) {
          if (typeof account?.accountId === "string" && account.accountId) {
            ids.add(account.accountId);
          }
        }
      }
    } catch {
      // Corrupt JSON: nothing recoverable to disconnect from this agent.
    }
  }
  return [...ids];
}

async function flyAppIdsForAccount(
  ctx: QueryCtx | MutationCtx,
  creator: Doc<"creators">,
): Promise<string[]> {
  const ids = new Set<string>();
  if (creator.mayaFlyAppId) ids.add(creator.mayaFlyAppId);
  // The GTM agent's Fly machine. CRITICAL for stop-answering: inbound Telegram
  // hits the Fly machine directly, so a Convex flag alone won't silence Maya —
  // the machine must be destroyed. Collected here (before the cascade deletes
  // the gtmAgents row) so destroyFlyAppsInternal tears it down.
  const gtmAgents = await ctx.db
    .query("gtmAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .collect();
  for (const agent of gtmAgents) {
    if (agent.openClawFlyAppId) ids.add(agent.openClawFlyAppId);
  }
  return [...ids];
}

async function deleteCreatorScopedRows(
  ctx: MutationCtx,
  creatorId: Id<"creators">,
  budget: number,
): Promise<{ count: number; exhausted: boolean }> {
  let count = 0;
  for (const table of CREATOR_SCOPED_TABLES) {
    if (count >= budget) return { count, exhausted: true };
    const rows = await queryByIndex(
      ctx,
      table,
      "by_creator",
      "creatorId",
      creatorId,
      budget - count,
    );
    for (const row of rows) {
      await ctx.db.delete(row._id);
      count += 1;
    }
    // A full page means there is probably more behind it.
    if (rows.length >= budget - (count - rows.length)) {
      return { count, exhausted: true };
    }
  }
  return { count, exhausted: false };
}

async function deleteAccountScopedRows(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  budget: number,
): Promise<{ count: number; exhausted: boolean }> {
  let count = 0;
  for (const table of ACCOUNT_SCOPED_TABLES) {
    if (count >= budget) return { count, exhausted: true };
    const rows = await queryByIndex(
      ctx,
      table,
      "by_account",
      "accountId",
      accountId,
      budget - count,
    );
    for (const row of rows) {
      await ctx.db.delete(row._id);
      count += 1;
    }
    if (rows.length >= budget - (count - rows.length)) {
      return { count, exhausted: true };
    }
  }
  return { count, exhausted: false };
}

/**
 * ⭐ The LIVE product's tables, keyed by `customerId`.
 *
 * ⚠️ Every table in the lists above is `gtm*` — the DELETED product — plus
 * `mayaMessages`, which is also from that era. **None of the live module's
 * data was purged at all.** "Delete my account" removed the dead product's
 * rows and left the founder's actual messages, posts, ideas, media and
 * strategy history in place.
 *
 * The same shape as the 2026-07-15 orphan sweep noted above, one product later:
 * the tables changed and the list didn't. A deletion routine is only as
 * complete as its list, and nothing fails when the list falls behind.
 */
export const MAYA_CUSTOMER_SCOPED: Array<{ table: string; index: string }> = [
  { table: "messages", index: "by_customer" },
  { table: "drafts", index: "by_customer" },
  { table: "placements", index: "by_customer" },
  { table: "ideas", index: "by_customer" },
  { table: "observations", index: "by_customer_and_captured" },
  { table: "targets", index: "by_customer" },
  { table: "mediaAssets", index: "by_customer" },
  { table: "directives", index: "by_customer" },
  { table: "dayPlans", index: "by_customer" },
  { table: "strategyChanges", index: "by_customer_and_created" },
  { table: "dashboardState", index: "by_customer" },
  { table: "costEvents", index: "by_customer_and_at" },
  { table: "channels", index: "by_customer" },
  /**
   * ⭐ Both of these were missing from my own first draft of this list, and the
   * schema-derived test below is the only reason they are here. Two of fifteen
   * — on a list I had just written, for a bug that was exactly "the list fell
   * behind". A list maintained by hand is wrong; the test is the fix.
   */
  { table: "inboxItems", index: "by_customer" },
  /**
   * ⚠️ Several of these have no plain `by_customer` — only a compound. That is
   * fine: `customerId` is the first field, so an `.eq` on it alone is a valid
   * prefix scan. It is NOT fine to guess the name, which is why the test
   * checks each one against the schema.
   */
  { table: "memorySnapshots", index: "by_customer_and_capturedAt" },
];

/**
 * Delete the live module's rows for every customer under this account.
 *
 * ⚠️ The `customers` row goes LAST, for the same reason the creator does: a
 * partially-purged account must stay findable and resumable rather than
 * becoming an orphan nobody can finish deleting.
 */
async function deleteMayaCustomerRows(
  ctx: MutationCtx,
  accountId: Id<"creators">,
  budget: number,
): Promise<{ count: number; exhausted: boolean }> {
  let count = 0;

  const customers = (await ctx.db
    .query("customers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect()) as Doc<"customers">[];

  for (const customer of customers) {
    for (const { table, index } of MAYA_CUSTOMER_SCOPED) {
      if (count >= budget) return { count, exhausted: true };

      const rows = await queryByIndex(
        ctx,
        table,
        index,
        "customerId",
        customer._id,
        budget - count,
      );

      for (const row of rows) {
        /**
         * ⚠️ The FILE, not just the row. A media asset row points at a stored
         * blob — deleting the row alone leaves the founder's screenshots and
         * recordings sitting in storage after they asked us to delete
         * everything, which is the part of "delete my account" that actually
         * matters.
         */
        if (table === "mediaAssets") {
          const key = (row as unknown as Doc<"mediaAssets">).storageKey;
          try {
            await ctx.storage.delete(key as Id<"_storage">);
          } catch {
            // An externally-hosted key won't resolve; the row still goes.
          }
        }
        await ctx.db.delete(row._id);
        count += 1;
      }

      if (rows.length >= budget - (count - rows.length)) {
        return { count, exhausted: true };
      }
    }
  }

  // Only once everything beneath them is gone.
  for (const customer of customers) {
    if (count >= budget) return { count, exhausted: true };
    await ctx.db.delete(customer._id);
    count += 1;
  }

  return { count, exhausted: false };
}

async function deleteStripeWebhookRows(
  ctx: MutationCtx,
  customerId: string,
): Promise<number> {
  const rows = await ctx.db
    .query("stripeWebhookEvents")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .take(500);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/**
 * Read at most `limit` rows.
 *
 * `.collect()` was the bug: it reads every matching row in one mutation, and
 * Convex caps a single execution at 4,096 reads. A GTM account with a week of
 * messages, cost-ledger entries and traces blows straight past that, so
 * `purgeGtmAccountByCreatorId` THREW on exactly the accounts it existed to
 * delete — and deletion is something this product promises customers, not a
 * convenience. Found trying to tear down the staging dogfood account, which had
 * all of $20 of history.
 */
async function queryByIndex(
  ctx: QueryCtx | MutationCtx,
  table: string,
  index: string,
  field: string,
  value: unknown,
  limit: number,
): Promise<Array<{ _id: Parameters<MutationCtx["db"]["delete"]>[0] }>> {
  type UntypedIndexBuilder = {
    eq: (fieldName: string, fieldValue: unknown) => unknown;
  };
  type UntypedDb = {
    query: (tableName: string) => {
      withIndex: (
        indexName: string,
        builder: (q: UntypedIndexBuilder) => unknown,
      ) => {
        take: (
          n: number,
        ) => Promise<
          Array<{ _id: Parameters<MutationCtx["db"]["delete"]>[0] }>
        >;
      };
    };
  };
  const db = ctx.db as unknown as UntypedDb;
  return await db
    .query(table)
    .withIndex(index, (q) => q.eq(field, value))
    .take(limit);
}

function normalizeConfirmation(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
