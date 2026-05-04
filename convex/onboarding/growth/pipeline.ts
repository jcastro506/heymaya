/**
 * Growth-product onboarding pipeline (Riley).
 *
 * Single-user product (Josh personally), but the flow is shaped like a real
 * onboarding for two reasons:
 *   1. It forces the right architectural shape (multi-tenant ready) so we
 *      can productize this later if it works for Josh.
 *   2. It's the closest thing to dogfood we have — Josh experiences the
 *      product like a customer would.
 *
 * Steps mirror `app/onboarding/growth/`:
 *   1. connect-linkedin   — operator connects LinkedIn via Composio dashboard
 *   2. connect-twitter    — same for X (Twitter)
 *   3. product-context    — what is Riley building hype for?
 *   4. voice-samples      — paste 5-10 LinkedIn posts + 5-10 tweets
 *   5. deploy             — operator clicks "deploy Riley" → spawns Fly machine
 *   6. complete           — agent is running; UI redirects to dashboard
 *
 * Cross-tenant: every entry point is Clerk-identity-scoped via
 * `getMeForGrowthOAuth` (mirrors creator-side). Single user today; safe for
 * future multi-tenant since the account-id flows from auth, never the client.
 */

import { v } from "convex/values";
import {
  action,
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Validators                                                                  */
/* -------------------------------------------------------------------------- */

const ONBOARDING_STEP = v.union(
  v.literal("connect-linkedin"),
  v.literal("connect-twitter"),
  v.literal("product-context"),
  v.literal("voice-samples"),
  v.literal("deploy"),
  v.literal("complete")
);

const PRODUCT_CONTEXT = v.object({
  productName: v.string(),
  oneLiner: v.string(),
  targetAudience: v.string(),
  primaryUrl: v.optional(v.string()),
  focus: v.string(),
});

const VOICE_SAMPLES = v.object({
  linkedin: v.array(v.string()),
  twitter: v.array(v.string()),
});

/* -------------------------------------------------------------------------- */
/* Internal helpers — Clerk → growth-agent row                                 */
/* -------------------------------------------------------------------------- */

export const getMyGrowthAgentInternal = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (
    ctx,
    args
  ): Promise<{
    creator: Pick<Doc<"creators">, "_id" | "clerkUserId" | "email">;
    agent: Doc<"growthAgents"> | null;
  } | null> => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .first();
    if (!creator) return null;
    const agent = await ctx.db
      .query("growthAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    return {
      creator: {
        _id: creator._id,
        clerkUserId: creator.clerkUserId,
        email: creator.email,
      },
      agent,
    };
  },
});

export const findOrCreateGrowthAgent = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    creatorId: Id<"creators">;
    agentId: Id<"growthAgents">;
    created: boolean;
  }> => {
    const now = Date.now();
    let creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", args.clerkUserId)
      )
      .first();
    if (!creator) {
      const cid = await ctx.db.insert("creators", {
        clerkUserId: args.clerkUserId,
        email: args.email,
        // Default channel; operator can change later.
        channelPreference: "imessage",
        timezone: "America/New_York",
        status: "active",
        plan: "coach",
        accountType: "growth-agent",
        createdAt: now,
      });
      creator = (await ctx.db.get(cid))!;
    } else if (!creator.accountType) {
      // Existing creator pre-migration — claim this row for the growth product.
      await ctx.db.patch(creator._id, { accountType: "growth-agent" });
    }

    let agent = await ctx.db
      .query("growthAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator!._id))
      .first();
    let created = false;
    if (!agent) {
      const aid = await ctx.db.insert("growthAgents", {
        accountId: creator._id,
        onboardingStep: "connect-linkedin",
        createdAt: now,
        updatedAt: now,
      });
      agent = (await ctx.db.get(aid))!;
      created = true;
    }
    return { creatorId: creator._id, agentId: agent._id, created };
  },
});

/* -------------------------------------------------------------------------- */
/* Public surface — UI calls these                                             */
/* -------------------------------------------------------------------------- */

export const startGrowthOnboarding = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    creatorId: Id<"creators">;
    agentId: Id<"growthAgents">;
    created: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        "startGrowthOnboarding: signed-in Clerk user required."
      );
    }
    return await ctx.runMutation(
      internal.onboarding.growth.pipeline.findOrCreateGrowthAgent,
      {
        clerkUserId: identity.subject,
        email: identity.email ?? `${identity.subject}@unknown.heymaya`,
      }
    );
  },
});

export const getMyGrowthAgent = query({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    creator: Pick<Doc<"creators">, "_id" | "clerkUserId" | "email">;
    agent: Doc<"growthAgents"> | null;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) =>
        q.eq("clerkUserId", identity.subject)
      )
      .first();
    if (!creator) return null;
    const agent = await ctx.db
      .query("growthAgents")
      .withIndex("by_account", (q) => q.eq("accountId", creator._id))
      .first();
    return {
      creator: {
        _id: creator._id,
        clerkUserId: creator.clerkUserId,
        email: creator.email,
      },
      agent,
    };
  },
});

export const setOnboardingStep = mutation({
  args: { step: ONBOARDING_STEP },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("setOnboardingStep: signed-in required.");
    const agent = await resolveGrowthAgent(ctx, identity.subject);
    if (!agent) throw new Error("setOnboardingStep: no growth-agent row.");
    await ctx.db.patch(agent._id, {
      onboardingStep: args.step,
      updatedAt: Date.now(),
    });
  },
});

export const setProductContext = mutation({
  args: { productContext: PRODUCT_CONTEXT },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("setProductContext: signed-in required.");
    const agent = await resolveGrowthAgent(ctx, identity.subject);
    if (!agent) throw new Error("setProductContext: no growth-agent row.");
    await ctx.db.patch(agent._id, {
      productContext: args.productContext,
      updatedAt: Date.now(),
    });
  },
});

export const setVoiceSamples = mutation({
  args: { voiceSamples: VOICE_SAMPLES },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("setVoiceSamples: signed-in required.");
    const agent = await resolveGrowthAgent(ctx, identity.subject);
    if (!agent) throw new Error("setVoiceSamples: no growth-agent row.");
    await ctx.db.patch(agent._id, {
      voiceSamples: args.voiceSamples,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Manually mark a Composio connection as complete. The UI calls this after
 * the operator has connected via the Composio dashboard and pasted the
 * resulting `connectedAccountId` into our form.
 *
 * NOTE: Wave C will replace this with a real OAuth round-trip via Composio's
 * /api/connections endpoints. For Wave B (this commit), the manual paste
 * pattern is fine for a single-user product where the operator IS the
 * developer.
 */
export const markPlatformConnected = mutation({
  args: {
    platform: v.union(v.literal("linkedin"), v.literal("twitter")),
    composioAccountId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("markPlatformConnected: signed-in required.");
    const agent = await resolveGrowthAgent(ctx, identity.subject);
    if (!agent) throw new Error("markPlatformConnected: no growth-agent row.");
    // We don't encrypt here — the per-creator encryption seam lives in
    // `convex/lib/encryption.ts` and is a deploy concern. For this single-
    // user product the connectedAccountId flows directly. When we
    // multi-tenant this later, replace with the encrypted shape used by
    // `connectedAccounts` rows (composioAccountId + composioAccountIdHash).
    const stored = {
      composioAccountId: args.composioAccountId,
      composioAccountIdHash: args.composioAccountId, // placeholder
      connectedAt: Date.now(),
    };
    if (args.platform === "linkedin") {
      await ctx.db.patch(agent._id, {
        linkedinConnection: stored,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(agent._id, {
        twitterConnection: stored,
        updatedAt: Date.now(),
      });
    }
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function resolveGrowthAgent(
  ctx: MutationCtx,
  clerkUserId: string
): Promise<Doc<"growthAgents"> | null> {
  const creator = await ctx.db
    .query("creators")
    .withIndex("by_clerk_user", (q) =>
      q.eq("clerkUserId", clerkUserId)
    )
    .first();
  if (!creator) return null;
  const agent = await ctx.db
    .query("growthAgents")
    .withIndex("by_account", (q) => q.eq("accountId", creator._id))
    .first();
  return agent ?? null;
}
