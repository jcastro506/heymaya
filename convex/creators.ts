import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { assertWebhookSecret } from "./lib/webhookSecret";

/**
 * Called by the Clerk webhook handler at app/api/clerk/webhook/route.ts on
 * `user.created`. Creates the creators row that every other Maya table
 * eventually references via creatorId.
 *
 * Idempotent on clerkUserId so webhook retries don't double-insert.
 *
 * `accountType` (Sprint 0 service-product cleanup follow-up) — when set to
 * "service-business" the row is flagged for the service product onboarding.
 * The webhook bridge passes "service-business" by default when
 * Sprint 0: the creator product was deleted; this is no longer flag-gated.
 */
export const createFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    timezone: v.optional(v.string()),
    accountType: v.optional(
      v.union(
        v.literal("creator"),
        v.literal("service-business"),
        v.literal("gtm-agent")
      )
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (existing) {
      // Patch accountType ONLY if MISSING (legacy pre-cleanup rows). NEVER
      // overwrite an already-set type: the Clerk webhook fires async and is
      // svix-retried for hours, so overwriting would DOWNGRADE a live gtm-agent
      // (set by startGtmOnboarding once the user reached onboarding) back to
      // the signup default — blanking their Mission Control mid-flow.
      if (args.accountType !== undefined && existing.accountType === undefined) {
        await ctx.db.patch(existing._id, { accountType: args.accountType });
      }
      return existing._id;
    }

    return await ctx.db.insert("creators", {
      clerkUserId: args.clerkUserId,
      email: args.email,
      channelPreference: "web",
      timezone: args.timezone ?? "America/Los_Angeles",
      status: "onboarding",
      plan: "coach",
      accountType: args.accountType,
      createdAt: Date.now(),
    });
  },
});

/**
 * Public webhook bridge wrapper for `createFromClerk`. The Clerk webhook
 * route (`app/api/clerk/webhook/route.ts`) calls this from
 * `ConvexHttpClient`, which cannot reach `internal.*` references (TS2345).
 *
 * Security: validates `WEBHOOK_INTERNAL_SECRET` (constant-time compare,
 * fail-closed) before delegating. Operator must set the secret in BOTH
 * Next.js env and Convex env. See `convex/lib/webhookSecret.ts`.
 *
 * The body inlines `createFromClerk` rather than runMutation-ing it because
 * Convex disallows mutation→mutation calls. Keep the two bodies in sync.
 */
export const createFromClerkPublic = mutation({
  args: {
    secret: v.string(),
    clerkUserId: v.string(),
    email: v.string(),
    timezone: v.optional(v.string()),
    accountType: v.optional(
      v.union(
        v.literal("creator"),
        v.literal("service-business"),
        v.literal("gtm-agent")
      )
    ),
  },
  handler: async (ctx, args): Promise<Id<"creators">> => {
    assertWebhookSecret(args.secret);
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (existing) {
      // No-downgrade: only set accountType when MISSING, never overwrite a live
      // type (async/retried webhook must not downgrade a gtm-agent). See
      // createFromClerk above.
      if (args.accountType !== undefined && existing.accountType === undefined) {
        await ctx.db.patch(existing._id, { accountType: args.accountType });
      }
      return existing._id;
    }
    return await ctx.db.insert("creators", {
      clerkUserId: args.clerkUserId,
      email: args.email,
      channelPreference: "web",
      timezone: args.timezone ?? "America/Los_Angeles",
      status: "onboarding",
      plan: "coach",
      accountType: args.accountType,
      createdAt: Date.now(),
    });
  },
});

/**
 * Resolve the creators row for the currently-authenticated Clerk user. Used
 * by frontend queries to load the signed-in creator's state.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
  },
});

/* -------------------------------------------------------------------------- */
/* Sprint 3.7 — onboarding answers persistence                                */
/* -------------------------------------------------------------------------- */

/**
 * Validator for the conversational answer payload submitted at the end of
 * the `questions` step. All fields optional so partial progress can be
 * persisted as the cursor advances.
 *
 * The full required-vs-optional gate runs in the handler — the validator is
 * intentionally permissive so a refresh mid-flow can be saved verbatim.
 */
const answersValidator = v.object({
  goal: v.optional(v.string()),
  tone: v.optional(
    v.union(
      v.literal("supportive"),
      v.literal("strategic"),
      v.literal("tough-love")
    )
  ),
  brandDealFloorUsd: v.optional(v.number()),
  careerStage: v.optional(
    v.union(
      v.literal("just-starting"),
      v.literal("building"),
      v.literal("monetizing"),
      v.literal("scaling")
    )
  ),
  location: v.optional(
    v.object({
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      country: v.optional(v.string()),
      timezone: v.optional(v.string()),
    })
  ),
  monthlyRevenueUsd: v.optional(v.number()),
  revenueStreams: v.optional(
    v.array(
      v.union(
        v.literal("brand-deals"),
        v.literal("affiliate"),
        v.literal("merch"),
        v.literal("courses"),
        v.literal("subs"),
        v.literal("ad-rev"),
        v.literal("email-list"),
        v.literal("live-events"),
        v.literal("consulting"),
        v.literal("other")
      )
    )
  ),
  longTermGoals: v.optional(
    v.object({
      oneYear: v.optional(v.string()),
      fiveYear: v.optional(v.string()),
    })
  ),
  // ─── Wave 2 (dynamic onboarding) — added 2026-04-26 ─────────────────────
  // Stage-tiered Q's; all optional. Foundational path (just-starting / building)
  // surfaces primaryGoals/biggestBlockers/ninetyDayPriority/howSerious/
  // brandTypes/weeklyHoursAvailable; senior path (monetizing / scaling)
  // surfaces sixToTwelveMonthChanges/deprioritizingPlatforms/hiringReadiness/
  // weeklyHoursAvailable. The handler accepts whatever subset shows up.
  primaryGoals: v.optional(
    v.array(
      v.union(
        v.literal("grow-following"),
        v.literal("make-money"),
        v.literal("become-full-time"),
        v.literal("land-brand-deals"),
        v.literal("launch-product"),
        v.literal("build-community"),
        v.literal("monetize-existing-audience"),
        v.literal("personal-brand-for-career"),
        v.literal("creative-outlet")
      )
    )
  ),
  biggestBlockers: v.optional(
    v.array(
      v.union(
        v.literal("consistency"),
        v.literal("what-to-make"),
        v.literal("slow-growth"),
        v.literal("low-engagement"),
        v.literal("no-monetization"),
        v.literal("no-time"),
        v.literal("brand-deals-not-coming"),
        v.literal("unclear-niche"),
        v.literal("burnout")
      )
    )
  ),
  ninetyDayPriority: v.optional(
    v.union(
      v.literal("grow-following"),
      v.literal("make-money"),
      v.literal("become-full-time"),
      v.literal("land-brand-deals"),
      v.literal("launch-product"),
      v.literal("build-community"),
      v.literal("monetize-existing-audience"),
      v.literal("personal-brand-for-career"),
      v.literal("creative-outlet")
    )
  ),
  howSerious: v.optional(
    v.union(
      v.literal("hobby"),
      v.literal("side-hustle"),
      v.literal("transitioning-full-time"),
      v.literal("already-full-time")
    )
  ),
  brandTypes: v.optional(v.array(v.string())),
  weeklyHoursAvailable: v.optional(v.number()),
  sixToTwelveMonthChanges: v.optional(
    v.array(
      v.union(
        v.literal("hire-team"),
        v.literal("launch-product"),
        v.literal("deprioritize-platform"),
        v.literal("focus-monetization-shift"),
        v.literal("scale-down-deal-volume"),
        v.literal("raise-rates"),
        v.literal("less-content-more-strategy")
      )
    )
  ),
  deprioritizingPlatforms: v.optional(
    v.array(
      v.union(
        v.literal("tiktok"),
        v.literal("instagram"),
        v.literal("youtube"),
        v.literal("linkedin"),
        v.literal("x")
      )
    )
  ),
  hiringReadiness: v.optional(
    v.union(
      v.literal("not-yet"),
      v.literal("considering"),
      v.literal("actively-looking"),
      v.literal("already-hired")
    )
  ),
  // ─── end Wave 2 ─────────────────────────────────────────────────────────
});

