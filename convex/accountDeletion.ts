import { v } from "convex/values";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertWebhookSecret } from "./lib/webhookSecret";

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

type AccountScopedTable = "growthAgents" | "growthPosts" | "growthWaitlist";

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
      } as const;
    }
    const result = await purgeCreatorAccount(ctx, creator, args.source);
    return { ok: true, deleted: true, ...result } as const;
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
  const stripeCustomerIds = [
    creator.stripeCustomerId,
    ...(await Promise.all(businessIds.map((id) => ctx.db.get(id)))).map(
      (business) => business?.stripeCustomerId
    ),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);

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
  };
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
