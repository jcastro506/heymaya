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
 * `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT !== "true"`.
 */
export const createFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    timezone: v.optional(v.string()),
    accountType: v.optional(
      v.union(v.literal("creator"), v.literal("service-business"))
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (existing) {
      // Patch accountType if missing — happens when this row was created
      // pre-cleanup (no accountType column populated) and the new flow needs
      // it set. Idempotent for already-set rows.
      if (
        args.accountType !== undefined &&
        existing.accountType !== args.accountType
      ) {
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
      v.union(v.literal("creator"), v.literal("service-business"))
    ),
  },
  handler: async (ctx, args): Promise<Id<"creators">> => {
    assertWebhookSecret(args.secret);
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
    if (existing) {
      if (
        args.accountType !== undefined &&
        existing.accountType !== args.accountType
      ) {
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
 * the `questions` step. Mirrors `AnswersState` in
 * `app/onboarding/maya/_state.ts` but with all fields optional so partial
 * progress can be persisted as the cursor advances.
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

/**
 * Persist the conversational answer set to `creatorPicture`. Cross-tenant
 * safe: the caller passes a `creatorId` for explicitness, but we re-derive
 * the signed-in creator from Clerk and reject any mismatch — the client can
 * never write somebody else's row even if they spoof the id.
 *
 * Plan-tier: any tier can submit onboarding answers (this is part of the
 * sub-4-min flow that runs before the trial begins).
 *
 * Idempotency: the mutation upserts. If a `creatorPicture` row already
 * exists (e.g. multimodal synthesis ran first), we PATCH the 5 new fields;
 * otherwise we INSERT a row with empty values for the synthesis-owned
 * fields, which the synthesizer (`synthesizeCreatorPicture`) overwrites in
 * the deploy pipeline. Either ordering produces the same final row.
 */
export const submitOnboardingAnswers = mutation({
  args: {
    creatorId: v.id("creators"),
    answers: answersValidator,
  },
  handler: async (ctx, args) => {
    // Cross-tenant gate: identity → creators row → must equal args.creatorId.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated.");
    }
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!me) {
      throw new Error("Creator row not found for signed-in user.");
    }
    if (me._id !== args.creatorId) {
      throw new Error("creatorId does not match signed-in creator.");
    }

    // Required-vs-optional validation. Mirrors `allRequiredAnswered` on the
    // frontend but enforced server-side as the source of truth.
    const a = args.answers;
    if (!a.goal || a.goal.trim().length === 0) {
      throw new Error("goal is required.");
    }
    if (!a.tone) {
      throw new Error("tone is required.");
    }
    if (
      a.brandDealFloorUsd === undefined ||
      a.brandDealFloorUsd === null ||
      !Number.isFinite(a.brandDealFloorUsd) ||
      a.brandDealFloorUsd < 0
    ) {
      throw new Error("brandDealFloorUsd must be a non-negative number.");
    }
    if (!a.careerStage) {
      throw new Error("careerStage is required.");
    }
    if (
      !a.location ||
      !a.location.city ||
      a.location.city.trim().length === 0 ||
      !a.location.state ||
      a.location.state.trim().length === 0
    ) {
      throw new Error("location.city and location.state are required.");
    }
    if (!a.revenueStreams || a.revenueStreams.length === 0) {
      throw new Error("revenueStreams must include at least one stream.");
    }
    if (
      a.monthlyRevenueUsd !== undefined &&
      a.monthlyRevenueUsd !== null &&
      (!Number.isFinite(a.monthlyRevenueUsd) || a.monthlyRevenueUsd < 0)
    ) {
      throw new Error("monthlyRevenueUsd must be non-negative when provided.");
    }
    // Wave 2 — adversarial guard on weeklyHoursAvailable. Optional, but when
    // provided MUST be a non-negative finite integer ≤ 168 (hours in a week).
    if (
      a.weeklyHoursAvailable !== undefined &&
      a.weeklyHoursAvailable !== null &&
      (!Number.isFinite(a.weeklyHoursAvailable) ||
        a.weeklyHoursAvailable < 0 ||
        a.weeklyHoursAvailable > 168)
    ) {
      throw new Error(
        "weeklyHoursAvailable must be a non-negative number ≤ 168 when provided."
      );
    }

    // Patch (or insert) the creatorPicture row with the answer-owned fields.
    // The synthesis-owned fields are filled by `synthesizeCreatorPicture`
    // when it runs in the deploy pipeline; if it hasn't run yet they stay
    // empty, marked with model="awaiting-synthesis" so it's obvious in
    // dashboards which rows haven't been overwritten.
    const existing = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .first();

    // Wave 2: forward the dynamic onboarding fields into creatorPicture so
    // synthesis can read both the self-report AND the additive context. Each
    // is optional on the schema; we only set keys that were actually provided
    // so undefined doesn't write `null` into the row.
    const patch: Record<string, unknown> = {
      careerStage: a.careerStage,
      locationSoul: {
        city: a.location.city,
        state: a.location.state,
        country: a.location.country,
        timezone: a.location.timezone,
      },
      monthlyRevenueUsd: a.monthlyRevenueUsd,
      currentRevenueStreams: a.revenueStreams,
      longTermGoals: a.longTermGoals,
    };
    if (a.primaryGoals !== undefined) patch.primaryGoals = a.primaryGoals;
    if (a.biggestBlockers !== undefined) patch.biggestBlockers = a.biggestBlockers;
    if (a.ninetyDayPriority !== undefined) patch.ninetyDayPriority = a.ninetyDayPriority;
    if (a.howSerious !== undefined) patch.howSerious = a.howSerious;
    if (a.brandTypes !== undefined) patch.brandTypes = a.brandTypes;
    if (a.weeklyHoursAvailable !== undefined) patch.weeklyHoursAvailable = a.weeklyHoursAvailable;
    if (a.sixToTwelveMonthChanges !== undefined) {
      patch.sixToTwelveMonthChanges = a.sixToTwelveMonthChanges;
    }
    if (a.deprioritizingPlatforms !== undefined) {
      patch.deprioritizingPlatforms = a.deprioritizingPlatforms;
    }
    if (a.hiringReadiness !== undefined) patch.hiringReadiness = a.hiringReadiness;

    let pictureId: Id<"creatorPicture">;
    if (existing) {
      await ctx.db.patch(
        existing._id,
        patch as Parameters<typeof ctx.db.patch<"creatorPicture">>[1]
      );
      pictureId = existing._id;
    } else {
      // Synthesis-owned fields haven't been generated yet (this can happen
      // when the questions step finishes before the multimodal pipeline).
      // Insert with empty synthesis-owned fields; `synthesizeCreatorPicture`
      // overwrites them on deploy.
      pictureId = await ctx.db.insert("creatorPicture", {
        creatorId: me._id,
        niche: "",
        audience: {
          ageRanges: [],
          topGeos: [],
          interestTags: [],
        },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: Date.now(),
        model: "awaiting-synthesis",
        sourceCitations: [],
        ...patch,
      } as Parameters<typeof ctx.db.insert<"creatorPicture">>[1]);
    }

    // Clear the resume buffer — answers are now durable on creatorPicture.
    if (me.onboardingProgress) {
      await ctx.db.patch(me._id, { onboardingProgress: undefined });
    }

    return pictureId;
  },
});

/**
 * Persist a partial answer slice + cursor to `creators.onboardingProgress`
 * so a refresh mid-flow doesn't lose progress. Cross-tenant safe; rate-limit
 * (n/a in v0 — Convex bounds upstream by request budget).
 *
 * The full submission (`submitOnboardingAnswers`) clears this field once it
 * lands on `creatorPicture`. Treat this row as ephemeral.
 */
export const saveOnboardingProgress = mutation({
  args: {
    creatorId: v.id("creators"),
    currentQuestionIdx: v.number(),
    answers: answersValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const me = await ctx.db
      .query("creators")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
      .first();
    if (!me) throw new Error("Creator row not found for signed-in user.");
    if (me._id !== args.creatorId) {
      throw new Error("creatorId does not match signed-in creator.");
    }
    if (
      !Number.isFinite(args.currentQuestionIdx) ||
      args.currentQuestionIdx < 0
    ) {
      throw new Error("currentQuestionIdx must be a non-negative integer.");
    }

    // Translate the wire shape (which uses monthlyRevenueUsd as a number) to
    // the on-disk shape (same shape — we already did the bucket→USD
    // mapping client-side). This mirror exists so wire validation and
    // storage validation are independent. Wave 2 adds the stage-tiered Q's.
    await ctx.db.patch(me._id, {
      onboardingProgress: {
        currentQuestionIdx: args.currentQuestionIdx,
        answers: {
          goal: args.answers.goal,
          tone: args.answers.tone,
          brandDealFloorUsd: args.answers.brandDealFloorUsd,
          careerStage: args.answers.careerStage,
          location: args.answers.location,
          monthlyRevenueUsd: args.answers.monthlyRevenueUsd,
          revenueStreams: args.answers.revenueStreams,
          longTermGoals: args.answers.longTermGoals,
          // Wave 2 — stage-tiered Q's. All optional.
          primaryGoals: args.answers.primaryGoals,
          biggestBlockers: args.answers.biggestBlockers,
          ninetyDayPriority: args.answers.ninetyDayPriority,
          howSerious: args.answers.howSerious,
          brandTypes: args.answers.brandTypes,
          weeklyHoursAvailable: args.answers.weeklyHoursAvailable,
          sixToTwelveMonthChanges: args.answers.sixToTwelveMonthChanges,
          deprioritizingPlatforms: args.answers.deprioritizingPlatforms,
          hiringReadiness: args.answers.hiringReadiness,
        },
        updatedAt: Date.now(),
      },
    });
  },
});
