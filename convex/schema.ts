import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  creators: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    primaryHandle: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    channelPreference: v.union(
      v.literal("imessage"),
      v.literal("whatsapp"),
      v.literal("sms"),
      v.literal("web")
    ),
    timezone: v.string(),
    status: v.union(
      v.literal("onboarding"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("churned")
    ),
    plan: v.union(
      v.literal("starter"),
      v.literal("pro"),
      v.literal("studio")
    ),
    trialEndsAt: v.optional(v.number()),
    mayaFlyAppId: v.optional(v.string()),
    mayaConfigVersion: v.optional(v.number()),
    /**
     * Sprint 6A — tone slider on the Profile screen. Optional + defaults to
     * the value Maya was deployed with (read off `creatorPicture` voice). This
     * field is the creator-controlled override; soul.md regen on the next
     * deploy reads this when present and falls back to inference otherwise.
     * Three locked values mirror the onboarding tone question.
     */
    tonePreference: v.optional(
      v.union(
        v.literal("supportive"),
        v.literal("strategic"),
        v.literal("tough-love")
      )
    ),
    // ─── Sprint 6B (Stripe billing) — added 2026-04-26 ─────────────────────
    // Stripe identifiers + subscription lifecycle state. All optional so
    // creators created before Stripe integration (or pre-checkout) don't
    // blow up. The webhook handlers in convex/billing/webhook.ts are the
    // ONLY writers — the frontend cannot patch `plan` directly. See also:
    // convex/billing/checkout.ts for how stripeCustomerId is created on
    // first checkout, convex/billing/portal.ts for portal access, and
    // app/api/billing/stripe-webhook/route.ts for the inbound route.
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    /** Unix-ms — end of the current paid (or trial) billing period. */
    currentPlanPeriodEnd: v.optional(v.number()),
    billingInterval: v.optional(
      v.union(v.literal("monthly"), v.literal("annual"))
    ),
    // ─── end Sprint 6B ─────────────────────────────────────────────────────
    // ─── Service product Sprint 0 (heymaya/service-v0) — added 2026-04-27 ─
    // Additive `accountType` discriminator. Optional so existing creator-side
    // rows pre-migration don't blow up — every row created BEFORE this field
    // landed is implicitly `creator`. The service product's onboarding writes
    // `accountType: "service-business"` + a `businessId` pointer at sign-up.
    //
    // The creator-side `creators` table is intentionally reused as the
    // account-level row (per service plan § 8 — "additive extension, not
    // rename") so the existing Clerk identity → row chain in
    // getCurrentCreator(...) keeps working unchanged. Service-business UI
    // resolves the user → creators row → businessId → businesses row.
    //
    // See convex/planService.ts for plan-tier gating on the service side;
    // the existing convex/lib/planFeatures.ts continues to govern the creator
    // side and the two are intentionally separate matrices.
    accountType: v.optional(
      v.union(v.literal("creator"), v.literal("service-business"))
    ),
    /** Pointer to the operator's business row. Only set when accountType = "service-business". */
    businessId: v.optional(v.id("businesses")),
    // ─── end Service product Sprint 0 ─────────────────────────────────────
    createdAt: v.number(),
    // Sprint 3.7 — partial onboarding answer cursor + payload so a refresh
    // mid-flow doesn't lose progress. The full answer set is persisted to
    // `creatorPicture` via `submitOnboardingAnswers` once the questions step
    // completes; this field exists only as a resume buffer.
    onboardingProgress: v.optional(
      v.object({
        currentQuestionIdx: v.number(),
        answers: v.object({
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
          // ─── Wave 2 (dynamic onboarding + smartAlternatives) — added 2026-04-26 ───
          // Stage-tiered Q's. All optional — different stage paths surface
          // different fields. The frontend `getQuestionPath(answers)` decides
          // which subset to ask (foundational for just-starting/building, senior
          // for monetizing/scaling). Persisted on the resume buffer AND mirrored
          // onto `creatorPicture` once `submitOnboardingAnswers` lands so the
          // synthesis pipeline can read them.
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
          /** Free-form list of brand categories the creator wants to work with. */
          brandTypes: v.optional(v.array(v.string())),
          weeklyHoursAvailable: v.optional(v.number()),
          // SENIOR-stage-only Q's (monetizing / scaling).
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
          // ─── end Wave 2 ──────────────────────────────────────────────────
        }),
        updatedAt: v.number(),
      })
    ),
  })
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_email", ["email"]),

  creatorHandles: defineTable({
    creatorId: v.id("creators"),
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
      v.literal("x"),
      v.literal("threads"),
      v.literal("reddit"),
      v.literal("pinterest")
    ),
    handle: v.string(),
    verified: v.boolean(),
    scrapedAt: v.optional(v.number()),
    followerCount: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_platform", ["creatorId", "platform"])
    .index("by_platform_and_handle", ["platform", "handle"]),

  connectedAccounts: defineTable({
    creatorId: v.id("creators"),
    provider: v.union(
      v.literal("gmail"),
      v.literal("stripe"),
      v.literal("calendar"),
      v.literal("apollo"),
      v.literal("hunter")
    ),
    /** Encrypted (AES-256-GCM, random IV) — see convex/lib/encryption.ts. */
    composioAccountId: v.string(),
    /**
     * Sprint 5 — SHA-256 hash of the *plaintext* composioAccountId, hex.
     * Required for inbound-webhook lookup: AES-GCM with random IVs is not
     * deterministic, so we cannot index the encrypted blob. The hash is a
     * one-way function of the plaintext, so two rows for the same account
     * collide on the hash but the plaintext stays at-rest-encrypted.
     * Optional for migration safety; OAuth completion writes both fields.
     */
    composioAccountIdHash: v.optional(v.string()),
    scopes: v.array(v.string()),
    scopeStatus: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired")
    ),
    autoSendThreshold: v.optional(v.number()),
    connectedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_provider", ["creatorId", "provider"])
    .index("by_account_hash", ["composioAccountIdHash"]),

  creatorPicture: defineTable({
    creatorId: v.id("creators"),
    niche: v.string(),
    audience: v.object({
      ageRanges: v.array(v.string()),
      genderSplit: v.optional(v.object({ male: v.number(), female: v.number(), other: v.number() })),
      topGeos: v.array(v.string()),
      interestTags: v.array(v.string()),
    }),
    voiceFingerprint: v.string(),
    topHooks: v.array(
      v.object({
        pattern: v.string(),
        examplePostId: v.string(),
        platform: v.string(),
        avgPerformanceLift: v.number(),
      })
    ),
    bottomHooks: v.array(
      v.object({
        pattern: v.string(),
        examplePostId: v.string(),
        platform: v.string(),
      })
    ),
    postingCadence: v.object({
      perPlatform: v.array(
        v.object({
          platform: v.string(),
          postsPerWeek: v.number(),
          bestDays: v.array(v.string()),
          bestHoursLocal: v.array(v.number()),
        })
      ),
    }),
    brandDealHistory: v.array(
      v.object({
        brand: v.string(),
        platform: v.string(),
        approxDate: v.optional(v.string()),
        format: v.string(),
      })
    ),
    generatedAt: v.number(),
    model: v.string(),
    sourceCitations: v.array(
      v.object({
        platform: v.string(),
        postId: v.string(),
        usedFor: v.string(),
      })
    ),
    // Sprint 3.7 (phase B) — additive fields backing the OpenClaw USER.md
    // "full picture" generator (phase A consumes these). All optional so
    // existing rows pre-3.7 don't blow up before backfill. Consumed by
    // `maya-pitch-strategy`, `maya-monetization-diversifier`,
    // `maya-opportunity-scout` (location → local brand search), and
    // `maya-growth-coach` (long-term goals).
    locationSoul: v.optional(
      v.object({
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        // Duplicates `creators.timezone` but useful for inference checks
        // (e.g. detecting tz-vs-stated-city mismatch).
        timezone: v.optional(v.string()),
      })
    ),
    careerStage: v.optional(
      v.union(
        // Behavioral classifications, NOT follower-count buckets. The synthesis
        // pipeline (and the operator's HQ logic) classifies stage HOLISTICALLY
        // from posting consistency, niche clarity, voice maturity, brand-deal
        // evidence, revenue evidence, and stated goals. Follower count is one
        // input among many. Examples: a 50K creator who posts twice a year is
        // `just-starting` behaviorally; a 5K creator with a sharp niche, daily
        // posting, and a first deal is `building`. The follower-count ranges
        // below are LOOSE GUIDANCE for the model — not hard rules.
        v.literal("just-starting"), // sparse posting, no clear niche, no monetization, regardless of raw follower count (typically <10K)
        v.literal("building"),      // consistent posting in a clear niche, voice forming, first deals possible (typically 10K–100K)
        v.literal("monetizing"),    // multi-stream revenue is real, audience compounding, deal flow steady (typically 100K–500K)
        v.literal("scaling")        // brand/business behind the channel, hires/team forming, deal selectivity required (typically 500K+)
      )
    ),
    monthlyRevenueUsd: v.optional(v.number()),
    currentRevenueStreams: v.optional(
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
    // ─── Creator HQ business-readiness audit — added 2026-04-26 ───────────
    // growthPlan: Sprint 2 multimodal-synth populates this once the data-
    // inferred careerStage lands. Until then it's undefined and the HQ
    // derives a synthetic milestone from current handle follower counts.
    // The HQ surfaces `nextMilestone` in stage-aware empty states (e.g.
    // "your milestone is 5K — Maya is tracking that").
    //
    // Stage-aware adaptive product extension (Agent B, 2026-04-26):
    // - `currentStage` mirrors `creatorPicture.careerStage` (denormalized for
    //   skill-runtime convenience — skills get the plan blob and don't have
    //   to re-resolve the stage independently).
    // - `nextMilestoneText` is a free-form string the synthesis emits so it
    //   isn't restricted to follower counts (e.g. "Ship your first paid deal"
    //   or "10 weekly posts in your niche for 4 straight weeks"). Coexists
    //   with the legacy `nextMilestone` object for HQ progress-bar compat.
    // - `focusAreas` / `antiPatterns` are stage-specific bullets the skills
    //   read to decide whether to recommend or defer (e.g. brand-outreach
    //   defers when antiPatterns says "don't pitch brands yet").
    // - `horizonWeeks` is how long the plan applies before re-eval.
    // - `citations` proves every plan claim cites a post or absence-of-post.
    growthPlan: v.optional(
      v.object({
        nextMilestone: v.object({
          /** "5K", "10K", "100K" — display string. */
          label: v.string(),
          /** Numeric follower target so progress bars work. */
          targetFollowers: v.number(),
          /** Optional unix-ms timestamp Maya estimates hitting it. */
          estimatedAt: v.optional(v.number()),
        }),
        /** What Maya thinks is the highest-leverage next move at this stage. */
        focusArea: v.optional(
          v.union(
            v.literal("consistency"),     // just-starting: post regularly
            v.literal("hook-craft"),      // building: each post needs a real hook
            v.literal("diversification"), // monetizing: revenue legs
            v.literal("scale-systems")    // scaling: process, team, brand
          )
        ),
        // ─── Stage-aware adaptive product — added 2026-04-26 (Agent B) ────
        currentStage: v.optional(
          v.union(
            v.literal("just-starting"),
            v.literal("building"),
            v.literal("monetizing"),
            v.literal("scaling")
          )
        ),
        /** Synthesis-emitted milestone, free-form (e.g. "Ship your first paid deal"). */
        nextMilestoneText: v.optional(v.string()),
        /** 2–4 things the creator should be working on right now. */
        focusAreas: v.optional(v.array(v.string())),
        /** 2–4 things the creator should NOT be doing yet. */
        antiPatterns: v.optional(v.array(v.string())),
        /** 4–12 weeks — how long this plan applies before re-eval. */
        horizonWeeks: v.optional(v.number()),
        citations: v.optional(
          v.array(
            v.object({
              platform: v.string(),
              postId: v.string(),
              usedFor: v.string(),
            })
          )
        ),
        generatedAt: v.optional(v.number()),
        // ─── end Stage-aware adaptive product ─────────────────────────────
        // ─── Wave 2 (smartAlternatives) — added 2026-04-26 ────────────────
        // Every entry in `antiPatterns[]` MUST have a paired entry here. The
        // synthesis prompt enforces 1:1 pairing; the parser rejects rows where
        // antiPatterns.length > 0 but smartAlternatives.length is 0 OR any
        // antiPattern lacks a paired smartAlternative entry.
        //
        // The skill orchestrators (and the 5 prompt-suffix-calibrated skill
        // scripts) read this list and ROUTE TO `insteadDoThis` rather than
        // refusing the original ask. `exampleAction` is the concrete move Maya
        // would take via her skills (NOT generic advice).
        smartAlternatives: v.optional(
          v.array(
            v.object({
              /** Mirror of an entry in antiPatterns[] — string-equality match. */
              antiPattern: v.string(),
              /** Stage-appropriate alternative move. */
              insteadDoThis: v.string(),
              /** Concrete "Maya could do this for you" action via her skills. */
              exampleAction: v.string(),
              /** Why this alternative works at this stage. */
              reasoning: v.string(),
            })
          )
        ),
        // ─── end Wave 2 (smartAlternatives) ───────────────────────────────
      })
    ),
    // ─── Stage-aware adaptive product — added 2026-04-26 (Agent B) ────────
    // Additional synthesis-owned stage fields. Adjacent to careerStage so
    // they're easy to read together. All optional for migration safety.
    /** 2–3 sentence reasoning citing what behavioral signals drove the call. */
    careerStageReasoning: v.optional(v.string()),
    /**
     * Reconciliation between the self-reported careerStage from onboarding
     * answers and the data-inferred careerStage from the synthesis. Drives
     * the gentle anti-sycophantic nudge in Maya's first message when they
     * diverge (e.g. self-reported "monetizing" but data says "just-starting"
     * → "You're earlier in the journey than the form let you say — that's
     * fine, we'll start where you actually are.").
     */
    careerStageReconciliation: v.optional(
      v.object({
        selfReported: v.optional(
          v.union(
            v.literal("just-starting"),
            v.literal("building"),
            v.literal("monetizing"),
            v.literal("scaling")
          )
        ),
        inferred: v.union(
          v.literal("just-starting"),
          v.literal("building"),
          v.literal("monetizing"),
          v.literal("scaling")
        ),
        matches: v.boolean(),
        evidence: v.string(),
        gentleNudge: v.optional(v.string()),
      })
    ),
    // ─── end Stage-aware adaptive product ────────────────────────────────
    // ─── Wave 2 (dynamic onboarding mirror) — added 2026-04-26 ────────────
    // Mirror of the stage-tiered onboarding answers persisted from
    // `submitOnboardingAnswers`. The synthesis pipeline reads these as
    // additional self-report context (alongside the existing locationSoul,
    // monthlyRevenueUsd, currentRevenueStreams, longTermGoals fields). All
    // optional — pre-Wave-2 picture rows are unaffected.
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
    // ─── end Wave 2 (dynamic onboarding mirror) ───────────────────────────
  }).index("by_creator", ["creatorId"]),

  aiCallLog: defineTable({
    creatorId: v.id("creators"),
    taskTag: v.string(),
    model: v.string(),
    thinkingBudget: v.union(
      v.literal("none"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    inputTokens: v.number(),
    outputTokens: v.number(),
    thinkingTokens: v.optional(v.number()),
    costUsd: v.number(),
    latencyMs: v.number(),
    ts: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_ts", ["creatorId", "ts"])
    .index("by_task_tag", ["taskTag"]),

  // ScrapeCreators response cache. Keyed by `sc:${platform}:${kind}:${handleOrId}`.
  // Per-creator scoping ensures cross-tenant isolation: every read filters by creatorId.
  // TTL is enforced in cache.ts (6h profile / 30min post metrics by default).
  scrapeCreatorsCache: defineTable({
    cacheKey: v.string(),
    creatorId: v.id("creators"),
    payload: v.any(),
    fetchedAt: v.number(),
    ttlSec: v.number(),
  })
    .index("by_cache_key", ["cacheKey"])
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_key", ["creatorId", "cacheKey"]),

  // Per-creator memory of "don't plan content around this calendar event" opt-outs.
  // Surfaced by Sprint 3 playbook § Calendar-aware content planning.
  // Keyed on (creatorId, eventId) — eventId is the Composio Calendar event ID,
  // stable across re-fetches. Maya checks this on every calendar_lookahead tick.
  calendarEventOptOuts: defineTable({
    creatorId: v.id("creators"),
    eventId: v.string(),
    optedOutAt: v.number(),
    reason: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_event", ["creatorId", "eventId"]),

  // Sprint 3.5 — `maya-platform-algo-researcher` cache. Algo signals are not
  // creator-specific (TikTok's algorithm doesn't change per creator), so this
  // table is global by default. `creatorId` is OPTIONAL: when set, the entry
  // was researched on a creator-initiated query and may include
  // creator-specific topic context; when null, the entry was cron-driven and
  // is shared across all Mayas.
  //
  // TTL is enforced at read time by checking `researchedAt + ttlDays * 86400000`
  // against `Date.now()`. Studio creators get fresher cache via faster cron
  // cadence (see `agents/skills/maya-platform/cron.md` § algo_research_*).
  platformAlgoCache: defineTable({
    creatorId: v.optional(v.id("creators")),
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
      v.literal("x")
    ),
    topic: v.optional(v.string()),
    signals: v.array(
      v.object({
        signal: v.string(),
        evidence: v.string(),
        dateLearned: v.string(),
      })
    ),
    whatsHotNow: v.string(),
    whatsCoolingOff: v.string(),
    sources: v.array(v.string()),
    researchedAt: v.number(),
    ttlDays: v.number(),
  })
    .index("by_platform_and_topic", ["platform", "topic"])
    .index("by_platform_and_researched_at", ["platform", "researchedAt"])
    .index("by_creator", ["creatorId"]),

  // Sprint 3.5 — `maya-industry-intel` per-creator dedupe cache.
  // The industry-intel skill watches creator-economy publications via Brave
  // search. Each surfaced URL is recorded here so the same article never
  // shows up twice in the same creator's morning brief, even if the headline
  // gets re-published or aggregated elsewhere.
  //
  // Garbage collection: rows older than 90d are dropped by an infra cron
  // (Sprint 3 has the cleanup job; until then, the table grows monotonically
  // — bounded by the volume of distinct industry-intel URLs per creator,
  // which is small).
  industryIntelSeen: defineTable({
    creatorId: v.id("creators"),
    sourceUrl: v.string(),
    seenAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_url", ["creatorId", "sourceUrl"]),

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 4 — Today + Performance UI source-of-truth tables.
  // Every table here carries `creatorId` and a `by_creator` index so the
  // sibling-file scan in tests/sprint1Acceptance.test.ts stays green and the
  // cross-tenant gate is enforceable from a single helper. Annotations live
  // on the rows themselves (e.g. `posts.mayaAnnotation`) so the UI never has
  // to JOIN to render Maya's read.
  // ────────────────────────────────────────────────────────────────────────

  // The canonical post record. Populated by Sprint 1's `runFullScrapePull`
  // for the initial bulk pull and by ScrapeCreators delta detection from then
  // on. `mayaAnnotation` is filled in by the post-publish reaction (event-
  // driven, see playbook § Post-publish reaction) — null while pending.
  posts: defineTable({
    creatorId: v.id("creators"),
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
      v.literal("x")
    ),
    platformPostId: v.string(),
    url: v.string(),
    caption: v.string(),
    mediaType: v.union(
      v.literal("video"),
      v.literal("image"),
      v.literal("carousel"),
      v.literal("text")
    ),
    thumbnailUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    /**
     * Video duration in seconds. Optional + additive (2026-04-26 — multimodal
     * batching pipeline). Populated by `runFullScrapePull` when the upstream
     * platform exposes it (TikTok statsV2, Instagram video_duration, YouTube
     * lengthSeconds, etc.). When missing, the synthesis batching module
     * (videoBatching.ts) treats it as 0/unknown — the caller still picks the
     * post for full-video synthesis but logs the unknown-duration warning.
     * TODO(s7): derive duration from videoUrl HEAD/Composio media-info when
     * the upstream payload doesn't surface it. ScrapeCreators may not return
     * duration for every platform — operator-confirmed only for TikTok statsV2
     * + YouTube long-form to date.
     */
    videoDurationSec: v.optional(v.number()),
    postedAt: v.number(),
    mayaAnnotation: v.optional(
      v.object({
        hookPattern: v.string(),
        whyItWorked: v.string(),
        retentionScore: v.optional(v.number()),
        generatedAt: v.number(),
        model: v.string(),
      })
    ),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_postedAt", ["creatorId", "postedAt"])
    .index("by_platform_and_post_id", ["platform", "platformPostId"]),

  // Time-series snapshots of post engagement metrics. Each row is a single
  // pull from ScrapeCreators (Sprint 1's `metrics_window` endpoint). The 2h
  // performance check (playbook § 2h performance check) appends here on a
  // cadence; the post-publish reaction appends a "t=0" row at publish.
  postMetrics: defineTable({
    creatorId: v.id("creators"),
    postId: v.id("posts"),
    ts: v.number(),
    viewCount: v.optional(v.number()),
    likeCount: v.optional(v.number()),
    commentCount: v.optional(v.number()),
    shareCount: v.optional(v.number()),
    saveCount: v.optional(v.number()),
    engagementRate: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_post_and_ts", ["postId", "ts"]),

  // Maya's morning brief, one row per creator per local-day. The brief is
  // assembled by playbook § Morning brief at 7am local. UI reads the latest
  // by_creator_and_briefDateLocal row for the Today screen.
  // `briefDateLocal` is YYYY-MM-DD in the creator's tz so timezone-aware
  // bucketing is a string compare, not a Date math operation.
  dailyBriefs: defineTable({
    creatorId: v.id("creators"),
    briefDateLocal: v.string(),
    markdown: v.string(),
    recommendations: v.array(
      v.object({
        priority: v.union(
          v.literal("p0"),
          v.literal("p1"),
          v.literal("p2")
        ),
        move: v.string(),
        evidence: v.string(),
        expectedOutcome: v.string(),
        citations: v.array(
          v.object({
            kind: v.union(
              v.literal("post"),
              v.literal("deal"),
              v.literal("metric"),
              v.literal("competitor"),
              v.literal("calendar"),
              v.literal("brief")
            ),
            ref: v.string(),
          })
        ),
      })
    ),
    pendingItems: v.array(
      v.object({
        kind: v.union(
          v.literal("draft"),
          v.literal("deliverable"),
          v.literal("brand-email")
        ),
        title: v.string(),
        dueAt: v.optional(v.number()),
        // Optional pointer back to the source row so the UI can link to detail.
        sourceTable: v.optional(v.string()),
        sourceId: v.optional(v.string()),
      })
    ),
    revenueSnapshotMtdUsd: v.optional(v.number()),
    outlierPostIds: v.array(v.id("posts")),
    generatedAt: v.number(),
    approvedByCreator: v.optional(v.boolean()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_briefDateLocal", ["creatorId", "briefDateLocal"]),

  // Sun 9pm weekly review (playbook § Weekly review). `weekStartLocal` is the
  // Monday of the reviewed week as YYYY-MM-DD, so chronological ordering on
  // the index is a string compare.
  weeklyReviews: defineTable({
    creatorId: v.id("creators"),
    weekStartLocal: v.string(),
    markdown: v.string(),
    winsArray: v.array(v.string()),
    lossesArray: v.array(v.string()),
    nextWeekRecommendations: v.array(v.string()),
    generatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_weekStartLocal", ["creatorId", "weekStartLocal"]),

  // Hook patterns Maya extracts from top-performing posts (playbook § Hook
  // library auto-build). `retentionScore` and `applicabilityToNiche` are
  // optional because the hook-extractor can return either — high-confidence
  // patterns get scored, lower-confidence ones land here without a score.
  hookLibrary: defineTable({
    creatorId: v.id("creators"),
    pattern: v.string(),
    firstSeconds: v.string(),
    whyItWorked: v.string(),
    retentionScore: v.optional(v.number()),
    examplePostIds: v.array(v.id("posts")),
    extractedAt: v.number(),
    applicabilityToNiche: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_score", ["creatorId", "retentionScore"]),

  // Sun 4pm weekly content plan (playbook § Weekly content plan). Each `arc`
  // entry is one day's idea card per platform; the Plan UI in Sprint 5 will
  // render this. We define the table now so Today can surface the next-day
  // plan item if one exists.
  contentPlans: defineTable({
    creatorId: v.id("creators"),
    weekStartLocal: v.string(),
    arc: v.array(
      v.object({
        dayOffset: v.number(),
        platform: v.union(
          v.literal("tiktok"),
          v.literal("instagram"),
          v.literal("youtube"),
          v.literal("linkedin"),
          v.literal("x")
        ),
        format: v.string(),
        hookOptions: v.array(v.string()),
        captionDraft: v.string(),
        postingTimeLocal: v.string(),
        status: v.union(
          v.literal("draft"),
          v.literal("approved"),
          v.literal("posted")
        ),
      })
    ),
    rationale: v.string(),
    generatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_weekStartLocal", ["creatorId", "weekStartLocal"]),

  // Brand-deal pipeline (playbook § Brand email triage). Status enum mirrors
  // the deal lifecycle the Deals screen renders in Sprint 5; Today surfaces
  // the count of "new" / "negotiating" deals as pending items.
  brandDeals: defineTable({
    creatorId: v.id("creators"),
    brand: v.string(),
    status: v.union(
      v.literal("new"),
      v.literal("reviewing"),
      v.literal("negotiating"),
      v.literal("signed"),
      v.literal("shooting"),
      v.literal("submitted"),
      v.literal("paid"),
      v.literal("lost")
    ),
    offerAmountUsd: v.optional(v.number()),
    suggestedRateUsd: v.optional(v.number()),
    deliverables: v.array(v.string()),
    dueAt: v.optional(v.number()),
    riskFlags: v.array(v.string()),
    gmailThreadId: v.optional(v.string()),
    replyVariants: v.array(v.string()),
    contractPdfId: v.optional(v.string()),
    redFlagReportId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    paidAmountUsd: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"])
    .index("by_creator_and_dueAt", ["creatorId", "dueAt"]),

  // Manager-readiness packet output store (playbook § Manager-readiness
  // packet). Generated quarterly on Pro, on-demand on Studio. Profile screen
  // in Sprint 6 surfaces the latest packet for download.
  packetGenerations: defineTable({
    creatorId: v.id("creators"),
    windowDays: v.number(),
    packetUrl: v.string(),
    generatedAt: v.number(),
  }).index("by_creator", ["creatorId"]),

  // Cron + behavior execution log for Maya's proactive actions.
  // Surfaced by Sprint 3 cron.md retry/skip discipline. Captures why a cron
  // entry skipped (plan-tier disabled, condition not met) or retried (5xx).
  // Operator dashboard reads this to surface degraded behaviors.
  mayaActionLog: defineTable({
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
    ts: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_ts", ["creatorId", "ts"])
    .index("by_creator_and_entry", ["creatorId", "entryId"])
    .index("by_outcome", ["outcome"]),

  // Sprint 3.5b — outbound brand pitch tracker for `maya-brand-outreach`.
  pitchOutreach: defineTable({
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
    status: v.union(
      v.literal("drafted"),
      v.literal("sent"),
      v.literal("replied"),
      v.literal("declined"),
      v.literal("no-response")
    ),
    sentAt: v.optional(v.number()),
    lastFollowupAt: v.optional(v.number()),
    replyAt: v.optional(v.number()),
    outcome: v.optional(v.string()),
    gmailThreadId: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"])
    .index("by_creator_and_brand", ["creatorId", "brand"]),

  // Sprint 3.5b — `maya-opportunity-scout` per-creator URL dedupe cache.
  opportunityScoutSeen: defineTable({
    creatorId: v.id("creators"),
    urlHash: v.string(),
    seenAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_url_hash", ["creatorId", "urlHash"]),

  // Sprint 3.5b — `maya-monetization-diversifier` proposal log.
  monetizationProposalLog: defineTable({
    creatorId: v.id("creators"),
    triggerEvent: v.string(),
    proposalsSnapshot: v.any(),
    creatorAccepted: v.optional(v.boolean()),
    surfacedAt: v.number(),
  }).index("by_creator", ["creatorId"]),

  // Sprint 3.5b — `maya-collab-matchmaker` surfaced-match audit log.
  collabMatchLog: defineTable({
    creatorId: v.id("creators"),
    peerHandle: v.string(),
    platform: v.string(),
    surfacedAt: v.number(),
    creatorActedOn: v.optional(
      v.union(v.literal("dm-sent"), v.literal("dismissed"), v.literal("pending"))
    ),
  }).index("by_creator", ["creatorId"]),

  // Sprint 3.5c — `maya-underperformance-diagnoser` post-mortem store.
  // Mirror to `posts.mayaAnnotation` (which captures top-performer reads);
  // this captures the why-it-bombed reads. Folded into evening recap.
  postPostmortems: defineTable({
    creatorId: v.id("creators"),
    postId: v.id("posts"),
    severity: v.union(v.literal("mild"), v.literal("significant"), v.literal("severe")),
    primaryCause: v.string(),
    secondaryCauses: v.array(v.string()),
    recommendedNextMove: v.string(),
    lessonForNextPost: v.string(),
    diagnosedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_post", ["creatorId", "postId"]),

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 5 — Trends screen source-of-truth tables.
  // `trendObservations` covers both the daily niche scan (6pm) and the
  // industry-intel daily push (7:30am) and the platform-wide trend watcher
  // (9am) — the `source` field disambiguates so the UI can tab them.
  // `competitorObservations` covers the per-creator named-peer watch (9am).
  // Both carry `creatorId` + `by_creator(*)` indexes so the cross-tenant gate
  // is enforceable from the same `getCurrentCreator` helper Today/Performance
  // already use.
  // ────────────────────────────────────────────────────────────────────────

  trendObservations: defineTable({
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
    observedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_observedAt", ["creatorId", "observedAt"])
    .index("by_creator_and_source", ["creatorId", "source"]),

  competitorObservations: defineTable({
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
    observedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_peer", ["creatorId", "peerHandle"])
    .index("by_creator_and_observedAt", ["creatorId", "observedAt"]),

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 6C — channel pairing rows.
  // Each row tracks one creator × channel pair-request lifecycle:
  //   pending  → pair-request issued, waiting on confirmation (QR scan / SMS code)
  //   active   → confirmed, OpenClaw is routing on this channel
  //   revoked  → unpaired by creator OR detached by OpenClaw upstream
  //   expired  → pair-request lifetime elapsed before confirmation
  // OpenClaw owns the actual channel routing + message handling at runtime
  // (see project_openclaw_alignment.md). Convex only persists the mapping so
  // the Profile UI can render status + the plan-tier check can deny pair-
  // requests before they reach OpenClaw. `externalPairingId` is the OpenClaw-
  // side pair-request id; `externalIdentifier` is the final channel id once
  // active (e.g. an iMessage thread id or WhatsApp jid). All cross-tenant
  // indexed.
  // ────────────────────────────────────────────────────────────────────────
  pairedChannels: defineTable({
    creatorId: v.id("creators"),
    channel: v.union(
      v.literal("imessage"),
      v.literal("whatsapp"),
      v.literal("sms")
    ),
    phoneNumber: v.string(), // E.164
    externalPairingId: v.string(), // OpenClaw-side pair request id
    externalIdentifier: v.optional(v.string()), // OpenClaw final channel id
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired")
    ),
    requestedAt: v.number(),
    pairedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_channel", ["creatorId", "channel"])
    .index("by_external_pairing_id", ["externalPairingId"]),

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 5 — Composio inbound webhook audit log.
  // Every signature-verified Composio webhook delivery lands here BEFORE we
  // route to a handler. This gives us:
  //   (a) replay-attack defense (eventId is unique-indexed so a redelivered
  //       event is dropped without re-processing)
  //   (b) operator forensics ("did Maya actually receive that email last
  //       Tuesday?") — the raw event is preserved
  //   (c) cross-tenant isolation audit — the resolved creatorId on the row
  //       lets us assert no event landed on the wrong creator
  // Status enum captures the routing outcome so we can dashboard error rates.
  // creatorId is OPTIONAL because some inbound events (e.g. unrecognized
  // composioAccountId) cannot be resolved to a creator — those land here so
  // we can investigate.
  // ────────────────────────────────────────────────────────────────────────
  gmailWebhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    composioAccountId: v.string(),
    creatorId: v.optional(v.id("creators")),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    status: v.union(
      v.literal("processed"),
      v.literal("replay_dropped"),
      v.literal("plan_dropped"),
      v.literal("resolved_no_creator"),
      v.literal("errored")
    ),
    detail: v.optional(v.string()),
    receivedAt: v.number(),
    /** Raw JSON payload, for forensics. Composio events are typically <10KB. */
    rawPayload: v.any(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_received_at", ["creatorId", "receivedAt"])
    .index("by_status", ["status"]),

  // ────────────────────────────────────────────────────────────────────────
  // ─── Sprint 6B (Stripe billing) — added 2026-04-26 ─────────────────────
  // Stripe inbound webhook audit log. Mirrors `gmailWebhookEvents` shape but
  // keyed by Stripe customer id (not creatorId) — Stripe events identify
  // the customer, and resolving customer→creator happens inside the
  // handler. By design `creatorId` is NOT a column here: the cross-tenant
  // sibling-file scan in tests/sprint1Acceptance.test.ts skips tables
  // without a `creatorId` field, which is correct for this audit log.
  //
  // Replay defense: `eventId` is unique-ish via the `by_event_id` index;
  // the recorder checks for an existing row before patching creators and
  // returns `replay_dropped` if seen, with a fresh row appended for forensic
  // audit of the redelivery attempt.
  // ────────────────────────────────────────────────────────────────────────
  stripeWebhookEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    status: v.union(
      v.literal("processed"),
      v.literal("replay_dropped"),
      v.literal("errored"),
      v.literal("skipped")
    ),
    detail: v.optional(v.string()),
    customerId: v.optional(v.string()),
    receivedAt: v.number(),
    rawPayload: v.any(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"]),
  // ─── end Sprint 6B ─────────────────────────────────────────────────────

  // ─── Creator HQ business-readiness audit — added 2026-04-26 ──────────────
  //
  // Purpose: surface "treat yourself like a business" data the HQ promises
  // but had no backing table or write path before this audit.
  //
  // 1. opportunitySurface — `maya-opportunity-scout` writes its findings here
  //    so the Deals → Outbound → Opportunities tab shows real rows. The query
  //    in convex/deals.ts.opportunityMatches read [] as a placeholder before;
  //    now reads from this table.
  //
  //    Cross-tenant: indexed by_creator + by_creator_and_observedAt. The
  //    sibling-file scan in tests/sprint1Acceptance.test.ts wants `creatorId`
  //    on every per-creator table, which this carries.
  //
  //    Plan-tier: writes are gated upstream (skill caller checks
  //    planFeatures.opportunityScoutEnabled); reads are gated in the query.
  // ────────────────────────────────────────────────────────────────────────
  opportunitySurface: defineTable({
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
    fit: v.number(), // 0..1
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
    estimatedRateRange: v.optional(
      v.object({ low: v.number(), high: v.number() })
    ),
    dueDate: v.optional(v.string()),
    /** SHA-canonicalized url for cross-cycle dedupe joins against opportunityScoutSeen. */
    urlHash: v.string(),
    surfacedAt: v.number(),
    /** Creator action: 'pitched' = converted to pitchOutreach row, 'dismissed' = creator passed. */
    creatorActedOn: v.optional(
      v.union(
        v.literal("pitched"),
        v.literal("dismissed"),
        v.literal("pending")
      )
    ),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_surfacedAt", ["creatorId", "surfacedAt"])
    .index("by_creator_and_url_hash", ["creatorId", "urlHash"]),

  // ─── Wave 3 (onboarding parallelism) — added 2026-04-26 ──────────────────
  // Background-job tracking for the two slow async stages of onboarding
  // (bulk ScrapeCreators pull + multimodal creator-picture synthesis). The
  // user kicks these off DURING onboarding (HandlesStep + QuestionsStep), so
  // by the time DeployStep runs the heavy work is already done. Deploy then
  // skips the corresponding stages and goes straight to Fly machine boot.
  //
  // `progress` and `result` fields use v.any() because their shape varies by
  // jobType:
  //   - bulk-pull progress: { handlesProcessed, totalHandles, postsPulled,
  //                           currentPlatform? }
  //   - synth-picture progress: { stage: "uploading" | "calling-gemini" |
  //                               "parsing" | "writing" }
  //   - bulk-pull result: pointer to the FullScrapePullResult shape
  //   - synth-picture result: { creatorPictureId } or similar pointer
  //
  // The internal action that does the heavy lifting is scheduled-only
  // (ctx.scheduler.runAfter(0, ...)) — never called from the client. The
  // public kickoff actions re-resolve the creator from Clerk identity, so
  // creator A cannot kick off / read creator B's jobs. TTL via expiresAt;
  // an infra cron drops rows older than 7d.
  onboardingJobs: defineTable({
    creatorId: v.id("creators"),
    jobType: v.union(
      v.literal("bulk-pull"),
      v.literal("synth-picture"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    // For bulk-pull: { handlesProcessed, totalHandles, postsPulled, currentPlatform? }
    // For synth-picture: { stage: "uploading" | "calling-gemini" | "parsing" | "writing" }
    progress: v.optional(v.any()),
    // Stored result for done jobs (for synth-picture: { creatorPictureId } or similar pointer)
    result: v.optional(v.any()),
    // Stored error for failed jobs
    errorDetail: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    // TTL — drop rows older than 7d. Cleaned by an infra cron (will add later).
    expiresAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_type", ["creatorId", "jobType"])
    .index("by_status", ["status"])
    .index("by_expires_at", ["expiresAt"]),

  // ────────────────────────────────────────────────────────────────────────
  // ─── Service product Sprint 0 (heymaya/service-v0) — added 2026-04-27 ──
  //
  // Service-business-side tables. Per docs/SPRINT_PLAN_SERVICE_V0.md § 8:
  //   - Every business-scoped table carries `businessId` and a `by_business`
  //     index so cross-tenant gating is enforceable from a single helper.
  //   - Tables live ALONGSIDE the creator-side tables (not in a separate
  //     schema) because Convex requires a single `defineSchema` call. The
  //     additive-block convention (search "Service product Sprint 0") makes
  //     the boundary explicit for grep + future refactor.
  //   - Plan-tier gating lives in convex/planService.ts (mirrors
  //     convex/lib/planFeatures.ts on the creator side).
  // ────────────────────────────────────────────────────────────────────────

  // The per-operator business row. One per service-business account.
  // Parallel to creator's onboarding-answers + identity fields.
  // Service plan § 8 + § 5 (onboarding flow) define the field set.
  businesses: defineTable({
    /** Pointer back to the `creators` row that owns this business (account-level). */
    accountId: v.id("creators"),
    name: v.string(),
    /** HVAC / plumbing / electrical / landscaping / cleaning / etc. (multi-select). */
    serviceTypes: v.array(v.string()),
    /**
     * GeoJSON-style polygon ring (array of [lng, lat] pairs) describing the
     * operator's service area. Stored generically as `v.any()` because the
     * polygon shape varies (rectangle of zips vs. drawn polygon vs. radius).
     * The geocoding step in onboarding normalizes whatever the operator
     * supplied into a polygon before persistence.
     */
    serviceAreaPolygon: v.optional(v.any()),
    /** Bucketed ticket size — service plan § 5 Q5. */
    ticketSizeBucket: v.optional(
      v.union(
        v.literal("under-200"),
        v.literal("200-500"),
        v.literal("500-2k"),
        v.literal("2k-10k"),
        v.literal("over-10k")
      )
    ),
    /** Crew size bucket — service plan § 5 Q3. */
    businessSize: v.optional(
      v.union(
        v.literal("solo"),
        v.literal("2-5"),
        v.literal("6-15"),
        v.literal("16-50"),
        v.literal("50-plus")
      )
    ),
    /** Service-business voice slider — service plan § 5 Q6. */
    tonePreference: v.optional(
      v.union(
        v.literal("friendly-neighborhood"),
        v.literal("professional-efficient"),
        v.literal("authoritative-expert")
      )
    ),
    /** Operator's Maya-reply-speed expectation — service plan § 5 Q7. */
    responseSpeed: v.optional(
      v.union(
        v.literal("instant"),
        v.literal("within-5-min"),
        v.literal("within-30-min")
      )
    ),
    /** Whether voice channel is provisioned. Studio-only per planFeaturesService. */
    voiceEnabled: v.optional(v.boolean()),
    /** Twilio number provisioned for this operator (E.164). */
    twilioNumber: v.optional(v.string()),
    /** Per-operator Fly machine app id (parallel to creators.mayaFlyAppId). */
    mayaFlyAppId: v.optional(v.string()),
    /** Service-side plan tier — separate enum from creator-side `creators.plan`. */
    planTier: v.optional(
      v.union(
        v.literal("starter"),
        v.literal("pro"),
        v.literal("studio")
      )
    ),
    /** Service-side trial expiry (mirrors creators.trialEndsAt). */
    trialEndsAt: v.optional(v.number()),
    // ─── Wave D Stripe billing (service-tier) — added 2026-04-27 ────────────
    // Stripe identifiers + subscription lifecycle state for the SERVICE
    // product. Mirrors the equivalent fields on `creators.*` (creator-side
    // Stripe pipeline lives on the `creators` row). Service product anchors
    // billing on the `businesses` row because:
    //   - `planTier` already lives here (separate enum from `creators.plan`)
    //   - Multi-business-per-account is a future possibility; per-business
    //     subscription state is the right grain.
    // All optional so businesses created pre-Stripe (mid-onboarding) don't
    // blow up. Webhook handlers in `convex/integrations/stripe/webhooks.ts`
    // are the ONLY writers — UI cannot patch `planTier` directly.
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    /** Unix-ms — end of the current paid (or trial) billing period. */
    currentPlanPeriodEnd: v.optional(v.number()),
    /** Subscription status from Stripe — used by HQ to gate writes when past_due/canceled. */
    subscriptionStatus: v.optional(
      v.union(
        v.literal("active"),
        v.literal("trialing"),
        v.literal("past_due"),
        v.literal("canceled"),
        v.literal("incomplete"),
        v.literal("incomplete_expired"),
        v.literal("unpaid"),
        v.literal("paused")
      )
    ),
    billingInterval: v.optional(
      v.union(v.literal("monthly"), v.literal("annual"))
    ),
    // ─── end Wave D Stripe billing ─────────────────────────────────────────
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_fly_app", ["mayaFlyAppId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  // Parallel to `creatorPicture`. High-thinking synthesis output written
  // once at onboarding (Gemini 3 Flash @ HIGH per § 3 routing matrix).
  // See § 5 step 8 for the synthesis inputs (reviews + brand-voice samples
  // + recurring service patterns + local-market position).
  businessPicture: defineTable({
    businessId: v.id("businesses"),
    brandVoice: v.string(),
    customerSentiment: v.optional(v.string()),
    recurringServicePatterns: v.array(v.string()),
    localCompetitors: v.array(v.string()),
    generatedAt: v.number(),
    model: v.string(),
    sourceCitations: v.array(
      v.object({
        platform: v.string(),
        externalId: v.string(),
        usedFor: v.string(),
      })
    ),
  }).index("by_business", ["businessId"]),

  // One row per claimed Google Business Profile. Studio: up to 5; Starter +
  // Pro: 1. Cap enforced in onboarding + Profile-screen mutations via
  // `planFeaturesService(business).maxGbpLocations`.
  gbpLocations: defineTable({
    businessId: v.id("businesses"),
    gbpLocationId: v.string(),
    gbpAccountId: v.string(),
    address: v.string(),
    primaryCategory: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    ownerEmail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_gbp_location_id", ["gbpLocationId"]),

  // CRM-mirrored customer records. Source-of-truth for review-request
  // targeting + customer-history surfaces. `crmCustomerId` is null for
  // operators on no-CRM (Persona A — Mike) where the NER extractor (Sprint 4)
  // upserts rows from "just finished the Johnson kitchen sink" text messages.
  serviceCustomers: defineTable({
    businessId: v.id("businesses"),
    crmCustomerId: v.optional(v.string()),
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    lifetimeValueUsd: v.optional(v.number()),
    lastJobAt: v.optional(v.number()),
    /** "asked" / "left" / "not-yet" / null. Powers Customers screen filter. */
    reviewStatus: v.optional(
      v.union(
        v.literal("not-yet"),
        v.literal("asked"),
        v.literal("left"),
        v.literal("declined")
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_crm_id", ["businessId", "crmCustomerId"])
    .index("by_business_and_phone", ["businessId", "phone"]),

  // CRM-mirrored job records. Source-of-truth for job-completion-driven
  // behaviors (#2 review request, #14 revenue snapshot). `crmJobId: null`
  // for no-CRM operators (NER extractor — Sprint 4).
  serviceJobs: defineTable({
    businessId: v.id("businesses"),
    customerId: v.optional(v.id("serviceCustomers")),
    crmJobId: v.optional(v.string()),
    /** Lifecycle: scheduled / in-progress / completed / cancelled. */
    status: v.union(
      v.literal("scheduled"),
      v.literal("in-progress"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    scheduledAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    technicianName: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    ticketAmountUsd: v.optional(v.number()),
    /** Photo URLs (R2 storage) — referenced by mediaAssets.serviceJobId. */
    photos: v.array(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    /**
     * Wave C.5 attribution chain (additive). The inboundLeads row this job
     * was reconciled from. Set by `linkLeadToJob`. Closes the outcome
     * chain: post → lead → job. The lead's own `convertedJobId` mirrors
     * back to this job — bidirectional for query convenience.
     */
    originatingLeadId: v.optional(v.id("inboundLeads")),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_crm_id", ["businessId", "crmJobId"])
    .index("by_business_and_status", ["businessId", "status"])
    .index("by_business_and_completed_at", ["businessId", "completedAt"])
    .index("by_business_and_originating_lead", ["businessId", "originatingLeadId"]),

  // Maya-generated + operator-approved GBP posts. `status` lifecycle:
  //   draft → pending → posted | rejected.
  // `gbpLocalPostId` is the Google-side id once published; null until then.
  gbpPosts: defineTable({
    businessId: v.id("businesses"),
    gbpLocationId: v.id("gbpLocations"),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("posted"),
      v.literal("rejected")
    ),
    text: v.string(),
    cta: v.optional(
      v.object({
        type: v.string(),
        url: v.optional(v.string()),
      })
    ),
    imageUrl: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    gbpLocalPostId: v.optional(v.string()),
    /** Engagement counters refreshed by GBP Insights cron. */
    engagement: v.optional(
      v.object({
        viewCount: v.optional(v.number()),
        clickCount: v.optional(v.number()),
        ctaClickCount: v.optional(v.number()),
        lastRefreshedAt: v.optional(v.number()),
      })
    ),
    /**
     * Wave C.5 outcome wire-back (additive). Polled nightly by
     * `convex/outcomes/gbpInsightsPoller.ts` from GBP Insights via Zernio.
     * Source-of-truth for "did this post drive a call / direction / website
     * click / view" — feeds the weekly learnings extractor (§ north star:
     * jobs + 5-stars). Counts are absolute, not deltas; the poller is
     * idempotent on (businessId, gbpLocalPostId).
     */
    engagementMetrics: v.optional(
      v.object({
        callsClicked: v.number(),
        directionsClicked: v.number(),
        websiteClicked: v.number(),
        postViews: v.number(),
      })
    ),
    /** UTC ms timestamp of the last successful Insights poll for this post. */
    engagementPolledAt: v.optional(v.number()),
    /**
     * inboundLeads ids that the attribution layer linked back to THIS post.
     * Append-only; entries never removed once linked (the audit trail is the
     * outcome story). Keyed for cross-tenant safety: lead.businessId must
     * match this post.businessId at link time (`linkLeadToAction` enforces).
     */
    attributedLeadIds: v.optional(v.array(v.id("inboundLeads"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_status", ["businessId", "status"])
    .index("by_gbp_location", ["gbpLocationId"]),

  // Cross-platform review pipeline. Yelp = monitor-only per § 6 + R1.
  // `replyStatus` lifecycle: drafted → approved → posted | rejected.
  // `customerMatchedJobId` is set by the review-reply-drafter when it can
  // match the reviewer to a recent job (last-name + service-type match).
  reviews: defineTable({
    businessId: v.id("businesses"),
    gbpLocationId: v.optional(v.id("gbpLocations")),
    platform: v.union(
      v.literal("gbp"),
      v.literal("fb"),
      v.literal("yelp")
    ),
    externalReviewId: v.string(),
    reviewerName: v.string(),
    starRating: v.number(),
    body: v.string(),
    sentiment: v.optional(
      v.union(
        v.literal("positive"),
        v.literal("neutral"),
        v.literal("negative")
      )
    ),
    customerMatchedJobId: v.optional(v.id("serviceJobs")),
    draftReply: v.optional(v.string()),
    /** CRITICAL: never auto-posted on GBP per Google ReviewReplyState moderation. */
    replyStatus: v.optional(
      v.union(
        v.literal("drafted"),
        v.literal("approved"),
        v.literal("posted"),
        v.literal("rejected")
      )
    ),
    publishedAt: v.optional(v.number()),
    receivedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_platform", ["businessId", "platform"])
    .index("by_business_and_received_at", ["businessId", "receivedAt"])
    .index("by_external_review_id", ["externalReviewId"]),

  // Review-request queue + send + followup tracking. Behaviors #2 + #3.
  reviewRequests: defineTable({
    businessId: v.id("businesses"),
    jobId: v.id("serviceJobs"),
    customerId: v.id("serviceCustomers"),
    channel: v.union(v.literal("sms"), v.literal("email")),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("opened"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    sentAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    followupCount: v.number(),
    lastFollowupAt: v.optional(v.number()),
    createdAt: v.number(),
    /**
     * Wave C.5 outcome wire-back (additive). Set by
     * `convex/outcomes/attribution.ts#recordReviewArrival` when a `reviews`
     * row arrives whose customer matches the request's customer within an
     * outcome window (≤30d after sentAt). The link is a primary signal for
     * the learnings extractor — review-request → review conversion is one
     * of the two north-star outcome chains.
     */
    responseAt: v.optional(v.number()),
    /** Star rating of the matched review (1-5). Mirror of reviews.starRating at link time. */
    responseRating: v.optional(v.number()),
    /** FK to the `reviews` row that this request drove. */
    attributedReviewId: v.optional(v.id("reviews")),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_status", ["businessId", "status"])
    .index("by_job", ["jobId"]),

  // Photo / video / before-after-pair library. Distinct from `mediaAssets`
  // (raw inbound asset library) — `serviceContent` is the curated/published
  // surface where Maya files things she's prepared for posting.
  serviceContent: defineTable({
    businessId: v.id("businesses"),
    type: v.union(
      v.literal("photo"),
      v.literal("video"),
      v.literal("before-after-pair")
    ),
    uploadedBy: v.union(v.literal("operator"), v.literal("maya")),
    originalUrl: v.string(),
    processedUrl: v.optional(v.string()),
    geminiFileId: v.optional(v.string()),
    jobId: v.optional(v.id("serviceJobs")),
    tags: v.array(v.string()),
    qualityScore: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_job", ["businessId", "jobId"]),

  // Inbound lead tracker. Powers behavior #8 (lead response alarm). `source`
  // distinguishes channel of origin for routing + analytics.
  inboundLeads: defineTable({
    businessId: v.id("businesses"),
    source: v.union(
      v.literal("gbp-msg"),
      v.literal("fb-dm"),
      v.literal("twilio-missed-call"),
      v.literal("twilio-sms")
    ),
    externalId: v.string(),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    body: v.optional(v.string()),
    capturedAt: v.number(),
    operatorRespondedAt: v.optional(v.number()),
    mayaNudgedAt: v.optional(v.number()),
    /**
     * Wave C.5 attribution chain (additive). The Maya action that PRODUCED
     * this lead — set by `convex/outcomes/attribution.ts#linkLeadToAction`
     * when a producing action is identified. `none` means "lead arrived
     * without traceable Maya action". For the learnings extractor: this is
     * the hop from "Maya did X" → "X drove a lead" → (downstream) "lead
     * converted to a job".
     */
    originatingActionKind: v.optional(
      v.union(
        v.literal("gbp-post"),
        v.literal("lead-nudge"),
        v.literal("review-request"),
        v.literal("review-reply"),
        v.literal("none")
      )
    ),
    /**
     * String FK to the producing action's row id. We use a free string
     * (not a typed v.id(...)) because the kind dispatches across multiple
     * tables (gbpPosts / reviewRequests / reviews / inboundLeads-self for
     * nudges) — a typed FK would force a polymorphic union of ids that
     * Convex doesn't support natively. The attribution layer validates
     * the id resolves within `businessId` before persisting.
     */
    originatingActionId: v.optional(v.string()),
    /**
     * The serviceJobs row this lead converted into. Set by
     * `linkLeadToJob` once a CRM job is reconciled to the lead. Closes
     * the outcome chain: post → lead → job.
     */
    convertedJobId: v.optional(v.id("serviceJobs")),
    /** UTC ms when operator (or Maya nudge) replied. Used for response-latency telemetry. */
    respondedAtMs: v.optional(v.number()),
    /** ms-since-capture latency. Computed once on response, frozen. */
    responseLatencyMs: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_source", ["businessId", "source"])
    .index("by_business_and_captured_at", ["businessId", "capturedAt"])
    .index("by_business_and_originating_action", [
      "businessId",
      "originatingActionKind",
      "originatingActionId",
    ]),

  // CRM connections (separate from `connectedAccounts` which is creator-side
  // Composio-only) so the creator-side schema stays clean. Tokens are
  // encrypted via convex/lib/encryption.ts (same primitive used by the
  // creator side). `planTierWarning` flags HCP non-MAX detection — see the
  // S0 spec for the preflight contract.
  crmConnections: defineTable({
    businessId: v.id("businesses"),
    provider: v.union(
      v.literal("jobber"),
      v.literal("hcp"),
      v.literal("qbo"),
      v.literal("servicetitan"),
      v.literal("none")
    ),
    /** AES-256-GCM encrypted via convex/lib/encryption.ts. */
    oauthAccessToken: v.optional(v.string()),
    /** AES-256-GCM encrypted via convex/lib/encryption.ts. */
    oauthRefreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    lastSyncAt: v.optional(v.number()),
    /** HCP MAX detection — null means OK; "hcp-not-max" means polling fallback. */
    planTierWarning: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_provider", ["businessId", "provider"]),

  // Twilio + ElevenLabs voice provisioning records. Studio-only rows —
  // gating is enforced server-side via `planFeaturesService(business).voice`.
  voiceChannels: defineTable({
    businessId: v.id("businesses"),
    twilioNumberSid: v.string(),
    twilioPhoneNumber: v.string(),
    elevenlabsAgentId: v.optional(v.string()),
    elevenlabsVoiceId: v.optional(v.string()),
    provisionedAt: v.number(),
    monthlyMinutesUsed: v.number(),
    lastBilledAt: v.optional(v.number()),
    /**
     * 4-digit PIN, PBKDF2-SHA256 hashed (Wave D voice agent — service plan
     * § 13 Sprint 6 PIN-challenge flow). Required before Maya executes
     * sensitive CRM writes via voice (caller-ID-trust pattern). Format:
     * `${saltB64}.${derivedB64}`. Null until operator sets one in Profile;
     * sensitive ops fail-closed when null.
     */
    pinHash: v.optional(v.string()),
    /** When the operator last set/rotated their PIN. */
    pinSetAt: v.optional(v.number()),
    /**
     * Allowlist of E.164 numbers Maya answers on inbound. Empty array means
     * no allowlist gating (plugin's `inboundPolicy: "allowlist"` blocks all).
     * Operator manages this from Profile → Connections → Voice.
     */
    inboundAllowlist: v.optional(v.array(v.string())),
    /** Realtime provider chosen by operator. Default: elevenlabs. */
    realtimeProvider: v.optional(
      v.union(v.literal("elevenlabs"), v.literal("gemini-live"))
    ),
  })
    .index("by_business", ["businessId"])
    .index("by_twilio_phone", ["twilioPhoneNumber"]),

  // Inbound + outbound voice-call transcripts persisted via the OpenClaw
  // `voice-call` plugin's transcript hook (Wave D — service plan § 13
  // Sprint 6). The plugin streams chunks to our Convex HTTP endpoint, which
  // writes here. Cross-tenant: every row keyed by `businessId`; queries
  // gate via `getCurrentBusinessSession`.
  //
  // Idempotency: `(callId, chunkIdx)` ordering enforced at the
  // `recordTranscriptChunk` mutation by appending in order; redelivery of
  // a prior chunkIdx is dropped silently. Finalization is one-shot keyed
  // by `callId` — second finalize call is a no-op.
  voiceCallTranscripts: defineTable({
    businessId: v.id("businesses"),
    /** Twilio CallSid — stable per call across both legs. */
    callId: v.string(),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    fromNumber: v.string(),
    toNumber: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    /**
     * Append-only ordered transcript chunks. Each chunk is one streaming
     * STT segment from the realtime provider. Plugin-supplied `ts` is the
     * caller-relative timestamp (ms from call start).
     */
    transcript: v.array(
      v.object({
        role: v.union(
          v.literal("caller"),
          v.literal("agent"),
          v.literal("system")
        ),
        ts: v.number(),
        text: v.string(),
        chunkIdx: v.number(),
      })
    ),
    /** One-shot post-call summary. Populated by `finalizeTranscript`. */
    summary: v.optional(v.string()),
    /** Whether the call escalated to a live operator. */
    escalatedToOperator: v.boolean(),
    /**
     * PIN challenge result. `null` = no sensitive op attempted; `true` =
     * operator entered correct PIN; `false` = wrong PIN, op blocked.
     */
    pinChallengePassed: v.union(v.boolean(), v.null()),
    /** Maya runtime call cost (US cents). Used for Wave D Stripe metering. */
    costCents: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_started_at", ["businessId", "startedAt"])
    .index("by_callId", ["callId"]),

  // ─── Wave D voice metering — added 2026-04-27 ──────────────────────────
  //
  // Per-business, per-billing-period voice-minute counter feeding Stripe
  // metered billing. Service plan § 3:
  //   - Pro ($149) — 30 min/mo inclusion + $0.20/min overage
  //   - Studio ($199) — 100 min/mo inclusion + $0.15/min overage,
  //                     hard cap 500 min/mo
  //
  // The (businessId, periodStartMs) tuple is unique. We never roll up across
  // periods; a new period creates a new row. The voice agent's
  // `finalizeTranscript` flow calls `recordVoiceMinutes(businessId, minutes)`
  // which:
  //   1. Resolves the current open period (or creates one).
  //   2. Increments `minutesUsed` atomically.
  //   3. If post-increment minutesUsed > planFeatures.voiceMinIncluded,
  //      schedules a meter-event report to Stripe in $5 increments.
  //   4. If post-increment minutesUsed >= planFeatures.voiceHardCap (Studio
  //      only), sets `cappedAt` so the next outbound-voice attempt refuses.
  //
  // Cross-tenant: `businessId` indexed; every reader filters on it. Period
  // rollover is bound to the Stripe billing period (current_period_end on
  // the subscription) so reset never drifts from the invoice cycle.
  // ────────────────────────────────────────────────────────────────────────
  voiceUsage: defineTable({
    businessId: v.id("businesses"),
    /** Unix-ms — start of this billing period. */
    periodStartMs: v.number(),
    /** Unix-ms — end of this billing period (= subscription.current_period_end). */
    periodEndMs: v.number(),
    /** Total voice minutes used in this period. Floor-rounded — partial minutes round up at recordVoiceMinutes time. */
    minutesUsed: v.number(),
    /**
     * Cumulative minutes already reported to Stripe via meter events. Used
     * by the $5-increment batcher to avoid double-reporting overage minutes
     * across multiple call finalizations within the same period.
     */
    minutesReportedToStripe: v.optional(v.number()),
    /** Unix-ms when minutesUsed crossed the hard cap (Studio 500). Null = uncapped. */
    cappedAt: v.optional(v.number()),
    /** Last call-finalize update — for observability. */
    lastUpdatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_period", ["businessId", "periodStartMs"]),

  // Webhook idempotency log. 24h TTL (purge cron lands later) +
  // fail-closed-on-duplicate per R3 § 4. Every inbound webhook records
  // (provider, externalEventId) before processing; redelivery is dropped
  // by checking for a prior row with matching keys.
  webhookEvents: defineTable({
    provider: v.string(),
    externalEventId: v.string(),
    kind: v.string(),
    processedAt: v.number(),
  })
    .index("by_provider_and_event_id", ["provider", "externalEventId"])
    .index("by_processed_at", ["processedAt"]),

  // The operator content library. Every photo/video/audio note from the
  // operator, persistently stored + cataloged once + retrievable.
  // Full schema spec at docs/SPRINT_PLAN_SERVICE_V0.md § 10.5. Indexes per
  // the spec: by_business, by_business_and_received_at, by_service_job
  // (the by_business_and_service_category index in the spec keys on a
  // nested catalog field which Convex doesn't support directly — replaced
  // with by_business_and_received_at-based filtering at read time + a
  // separate by_service_job index for CRM-linkage lookups).
  mediaAssets: defineTable({
    businessId: v.id("businesses"),
    storageUrl: v.string(),
    storageBytes: v.number(),
    mimeType: v.string(),
    source: v.union(
      v.literal("imessage"),
      v.literal("whatsapp"),
      v.literal("sms"),
      v.literal("web"),
      v.literal("crm-import")
    ),
    receivedAt: v.number(),
    serviceJobId: v.optional(v.id("serviceJobs")),
    serviceCustomerId: v.optional(v.id("serviceCustomers")),
    /**
     * sha256 of the raw bytes, scoped per-business for hash-dedupe at ingest.
     * The cataloger pipeline checks this index BEFORE incurring Gemini
     * multimodal cost — same hash = link to existing row, no re-catalog.
     */
    contentHash: v.optional(v.string()),
    /** Maya's one-time multimodal catalog. Gemini 3 Flash @ MEDIUM per § 3 routing. */
    catalog: v.object({
      primarySubject: v.string(),
      serviceCategory: v.string(),
      visualQuality: v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor")
      ),
      framingNotes: v.string(),
      suggestedUses: v.array(v.string()),
      pairableWithAssetId: v.optional(v.id("mediaAssets")),
      captionDraft: v.optional(v.string()),
      catalogedAt: v.number(),
      catalogModel: v.string(),
      catalogCostUsd: v.number(),
    }),
    /** Append-only per-platform usage history. Idempotent on (platform, postId). */
    usageHistory: v.array(
      v.object({
        platform: v.union(
          v.literal("gbp"),
          v.literal("facebook"),
          v.literal("instagram"),
          v.literal("tiktok")
        ),
        postId: v.optional(v.string()),
        postedAt: v.number(),
      })
    ),
    /** Soft-delete; archived rows excluded from rejuvenator + library list. */
    archivedAt: v.optional(v.number()),
    /** GDPR / retention policy; purge cron drops past-expiry rows. */
    expiresAt: v.optional(v.number()),
    /**
     * Wave-4 video editor (§ 12.5.7 Studio-only) — derivedFromAssetIds is
     * the set of source clips that fed an edit. Empty for raw-ingest assets.
     */
    derivedFromAssetIds: v.optional(v.array(v.id("mediaAssets"))),
    editVersion: v.optional(v.number()),
    /** Optional edit-plan blob — only present for derived/edited assets. */
    editPlan: v.optional(v.any()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_received_at", ["businessId", "receivedAt"])
    .index("by_business_and_content_hash", ["businessId", "contentHash"])
    .index("by_service_job", ["serviceJobId"]),

  // [v0 STATUS — DEPRECATED, not populated]
  //
  // Originally designed as the per-business install tracker for the
  // `maya-skill-installer` meta-skill (§ 8.5). Operator decision
  // 2026-04-27 (fourth correction): runtime skill installation is retired
  // for v0. Every Maya gets the same curated skill bundle at deploy time;
  // no per-business skill divergence; no operator-approved on-demand
  // installs. This table stays in schema (additive-only rule) but is
  // never written to in production v0. Cross-tenant + schema-shape tests
  // still reference it for invariant coverage; that's fine.
  //
  // If runtime extension is reintroduced post-MVP (Phase 1.5+), this
  // table becomes the install tracker again. Until then, treat any
  // production write as a bug.
  customSkills: defineTable({
    businessId: v.id("businesses"),
    skillName: v.string(),
    source: v.union(
      v.literal("clawhub"),
      v.literal("skills.sh"),
      v.literal("custom")
    ),
    sourceUrl: v.string(),
    version: v.string(),
    installedAt: v.number(),
    approvedByOperator: v.boolean(),
    /** Why operator approved it — surfaced in the audit log. */
    approvalContext: v.optional(v.string()),
    /** The Maya task that triggered the search — preserved for telemetry. */
    searchTriggerContext: v.optional(v.string()),
    verified: v.boolean(),
    requestedPermissions: v.array(v.string()),
    lastUsedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_skill_name", ["businessId", "skillName"]),

  // Tiered approval modes (operator addendum 2026-04-27 — § 8 + § 13
  // Sprint 5). Server-side gating enforces which `ruleType`s are enableable
  // per tier via `planFeaturesService(business).approvalRulesEnableable`.
  // CRITICAL: `review-reply-auto-publish-allowlist` is FORBIDDEN at every
  // tier because Google ReviewReplyState requires operator approval; any
  // attempt to enable that rule type must be rejected server-side.
  approvalRules: defineTable({
    businessId: v.id("businesses"),
    ruleType: v.union(
      v.literal("review-request-auto-send"),
      v.literal("gbp-post-auto-publish"),
      v.literal("review-reply-auto-publish-allowlist"),
      v.literal("content-rejuvenation-auto-publish")
    ),
    enabled: v.boolean(),
    /**
     * Per-rule constraints — shape varies by `ruleType` (e.g. delayHours for
     * review-request-auto-send, safeContentClasses[] for gbp-post-auto-publish).
     * Stored as a free-shape object; validation happens at the mutation layer.
     */
    scope: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastTriggeredAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_rule_type", ["businessId", "ruleType"]),

  // ────────────────────────────────────────────────────────────────────────
  // ─── Service product Sprint 1 (Zernio integration) — added 2026-04-27 ──
  //
  // Zernio (formerly Late, getlate.dev) is the v0 routing layer for ALL
  // service-side social platforms: GBP review-fetch + review-reply +
  // local-post create/update, FB Pages post, IG Business post, plus TikTok
  // / LinkedIn / X / Pinterest / Threads. Per service plan § 3 layer table
  // (operator decision 2026-04-27), v0 stays Zernio-mediated until the
  // operator's GBP / Meta / TikTok partner-access applications land — at
  // which point the parked code under `convex/integrations/gbp/direct/`
  // becomes the upgrade path.
  //
  // We deliberately do NOT extend the creator-side `connectedAccounts` table
  // — it is `creatorId`-scoped, single-account-per-creator, and the service
  // product's separate `crmConnections` table set the precedent that
  // service-side integrations get their own per-business table to keep the
  // creator-side schema clean. Zernio's per-platform connection model also
  // does not fit `connectedAccounts`'s shape: one Zernio account holds
  // many platform connections (GBP + FB + IG + …) in a single OAuth
  // umbrella, so we model that with a `connectedPlatforms[]` array.
  // ────────────────────────────────────────────────────────────────────────

  // One row per business that has connected Zernio. Holds the Zernio
  // workspace account id + the per-platform connection ids returned at
  // OAuth callback time. Tokens are encrypted via convex/lib/encryption.ts.
  // The `connectedPlatforms[]` array is the source of truth for "which
  // platforms can this business currently post to via Zernio?" and is
  // consulted by `multiPlatformPost` + the per-platform endpoint wrappers
  // to short-circuit calls to disconnected platforms with a clear error.
  zernioConnections: defineTable({
    businessId: v.id("businesses"),
    /** Zernio workspace account id (their `profileId` umbrella). */
    zernioAccountId: v.string(),
    /** AES-256-GCM encrypted Zernio API key. Per-business so a key leak does not cascade. */
    encryptedApiKey: v.string(),
    /**
     * SHA-256 hash of the plaintext API key, hex. Used for inbound webhook
     * routing without decrypting (mirror of the creator-side
     * `connectedAccounts.composioAccountIdHash` pattern). Optional for
     * additive migration safety; OAuth completion writes both fields.
     */
    apiKeyHash: v.optional(v.string()),
    /**
     * AES-256-GCM encrypted Zernio webhook signing secret. Verified per
     * inbound webhook delivery. Optional because the operator may opt out of
     * webhooks during onboarding (polling fallback covers behavior #4).
     */
    encryptedWebhookSecret: v.optional(v.string()),
    /**
     * Per-platform connection state. Each entry records one platform that the
     * operator OAuthed inside the Zernio dashboard. The `platformAccountId`
     * (e.g. GBP location id, FB Page id, IG account id) is what we pass to
     * Zernio's per-call `platform`-scoped endpoints. `status` tracks
     * mid-flight revocation: a platform can go from `active` → `revoked`
     * if the operator unlinks inside Zernio or Zernio detects an upstream
     * token revocation, in which case our endpoint wrappers must fail fast
     * with `ZernioAuthError`.
     */
    connectedPlatforms: v.array(
      v.object({
        platform: v.union(
          v.literal("gbp"),
          v.literal("facebook"),
          v.literal("instagram"),
          v.literal("tiktok"),
          v.literal("linkedin"),
          v.literal("x"),
          v.literal("pinterest"),
          v.literal("threads")
        ),
        /**
         * The platform-specific account / page / location id that Zernio
         * returns at OAuth callback. We pass this to per-platform endpoint
         * wrappers so Zernio knows which destination to post to.
         */
        platformAccountId: v.string(),
        /** Display name (e.g. GBP business name, FB Page name). */
        displayName: v.optional(v.string()),
        status: v.union(
          v.literal("active"),
          v.literal("revoked"),
          v.literal("expired")
        ),
        connectedAt: v.number(),
        revokedAt: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_zernio_account_id", ["zernioAccountId"])
    .index("by_api_key_hash", ["apiKeyHash"]),

  // ────────────────────────────────────────────────────────────────────────
  // Inbound work queue for Maya. Webhook receivers + polling actions enqueue
  // work here; the consumer (Sprint 3 skill orchestrator — `wakeMaya` →
  // skill dispatch) drains it. Decoupling the producer (webhook receiver,
  // sub-second budget) from the consumer (Maya skill dispatch, multi-second
  // LLM call) is what lets us hold the 1-second webhook ack budget Zernio
  // requires while still doing real work asynchronously.
  //
  // Schema is kept open (`payload: v.any()`) on purpose — the producer side
  // (this sprint) writes; the consumer side (Sprint 3) is responsible for
  // narrowing the payload via Zod parse at dispatch time. That keeps Sprint
  // 1 unblocked on fully-baked payload schemas while the .md layer agent
  // settles those.
  //
  // Cross-tenant: `businessId` indexed `by_business`. Every reader filters
  // on it. `processedAt` is null until the consumer processes; `failedAt`
  // captures terminal failures so the operator dashboard can surface them.
  // ────────────────────────────────────────────────────────────────────────
  mayaTaskQueue: defineTable({
    businessId: v.id("businesses"),
    /**
     * Task kind drives skill dispatch on the consumer side. The set is
     * intentionally OPEN (free string) for v0 because the .md layer agent
     * authors the kinds in parallel; we narrow with a Zod enum at dispatch
     * time. Known producers in this sprint: `review.created`, `post.failed`,
     * `engagement.received`, `zernio.poll.review`.
     */
    kind: v.string(),
    payload: v.any(),
    /** Source provider — for observability + retry routing. */
    source: v.union(
      v.literal("zernio-webhook"),
      v.literal("zernio-poll"),
      // CRM-side producers (Wave C — Jobber/HCP/QBO via Nango or aggregator).
      // Keep the literal-union closed so we can switch over it; service-product
      // wave-C agent extended this set additively (Convex schema rule: literal
      // union additions are backwards-compatible).
      v.literal("crm-webhook"),
      v.literal("crm-poll"),
      v.literal("crm-text-extract"),
      v.literal("manual")
    ),
    enqueuedAt: v.number(),
    processedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    /** When set, consumer counts this row's retry attempts toward a max. */
    attemptCount: v.optional(v.number()),
    /** Last failure detail surfaced to dashboards. */
    lastError: v.optional(v.string()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_enqueued_at", ["businessId", "enqueuedAt"])
    .index("by_business_and_kind", ["businessId", "kind"])
    .index("by_unprocessed", ["processedAt"]),
  // ─── end Service product Sprint 1 (Zernio integration) ────────────────

  // ────────────────────────────────────────────────────────────────────────
  // Service product Wave C — memory-wiki projection table (§ 9.5)
  //
  // The OpenClaw `memory-wiki` plugin owns the per-business knowledge vault
  // on the Fly machine itself; this Convex table is a THIN read-projection
  // for HQ-screen reactivity. We never reimplement the wiki — we mirror page
  // summaries / claims so the UI can subscribe via Convex queries instead of
  // round-tripping to the agent runtime.
  //
  // Cross-tenant: every row carries `businessId`; every read filters
  // `by_business`. There is no global index — Business A can never see
  // Business B's vault projection.
  //
  // Plan-tier: wiki itself is plan-agnostic infrastructure (the plugin loads
  // for every business). Read-access surfacing in HQ varies by tier per
  // § 9.5 ("Plan-tier gating"), enforced in `convex/queries/business/*` —
  // not at this storage layer.
  // ────────────────────────────────────────────────────────────────────────
  wikiProjections: defineTable({
    businessId: v.id("businesses"),
    /**
     * Vault path within the per-business wiki, e.g.
     *   "entities/competitors/joes-hvac"
     *   "concepts/local-positioning"
     *   "syntheses/business-picture-2026-04-27"
     * Persisted exactly as the wiki stores it so `wiki_get(vaultPath)` from
     * the agent and `getProjection(businessId, vaultPath)` from the UI agree.
     */
    vaultPath: v.string(),
    kind: v.union(
      v.literal("entity"),
      v.literal("concept"),
      v.literal("synthesis"),
      v.literal("source"),
      v.literal("report")
    ),
    /**
     * The compiled claim text the wiki materializes for this page. Source
     * of truth lives in the agent's vault; this is the projected summary.
     */
    claim: v.string(),
    /**
     * Provenance pointers (mirror of wiki claim evidence shape per § 9.5
     * "Structured Claims Format"). At least one entry is required for
     * non-report kinds — the citation firewall enforces this on apply.
     */
    provenance: v.array(
      v.object({
        sourceId: v.string(),
        path: v.string(),
        lines: v.optional(v.string()),
        weight: v.optional(v.number()),
        note: v.optional(v.string()),
      })
    ),
    /** 0..1, mirrors the wiki claim's confidence band. */
    confidence: v.number(),
    /**
     * Soft-delete marker. Set by `removeProjection`; queries filter unless
     * the caller explicitly asks for archived rows. This lets us keep the
     * audit trail of what Maya knew without losing reactivity.
     */
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_kind", ["businessId", "kind"])
    .index("by_business_and_path", ["businessId", "vaultPath"]),
  // ─── end Service product Wave C (memory-wiki projection) ──────────────

  // ────────────────────────────────────────────────────────────────────────
  // Service product Wave C.5 — weekly learnings synthesis (north star)
  //
  // Per `project_north_star_outcomes.md`: Maya's only success metric is jobs
  // booked + 5-star reviews. The learnings extractor (Sun 10pm cron, folded
  // into `weekly_review`/`competitor_watch` standing-order prose, NOT a new
  // standing order) reads the prior 7d outcome chain (gbpPosts.engagement
  // Metrics → inboundLeads.originatingActionId → serviceJobs.originatingLeadId,
  // plus reviewRequests.responseRating) and produces patterns ranked by
  // outcome impact. Each row here is one weekly synthesis.
  //
  // The patterns themselves get materialized into the memory-wiki vault
  // under `concepts/what-works/<platform>/*` via `wiki_apply` — that's where
  // the learnings COMPOUND personalization. This table is the Convex
  // projection / audit trail so HQ can show "what Maya learned this week"
  // without round-tripping to the agent runtime.
  //
  // Cross-tenant: `businessId`-indexed; every reader filters. Phantom-pattern
  // guard (no claim with sampleSize < 3) is enforced in the extractor + tests
  // so this table never carries unsupported claims.
  // ────────────────────────────────────────────────────────────────────────
  weeklyLearnings: defineTable({
    businessId: v.id("businesses"),
    /** UTC ms — start of the 7d window (inclusive). */
    weekStartMs: v.number(),
    /** UTC ms — end of the 7d window (exclusive). */
    weekEndMs: v.number(),
    /** UTC ms — when the extractor produced this row. */
    synthesizedAt: v.number(),
    /**
     * Top patterns this week, ranked by outcome impact. Each pattern is a
     * grounded claim with sample size + attribution counts. `wikiVaultPath`
     * pins the materialized wiki page under `concepts/what-works/<...>`.
     * Phantom-pattern guard: extractor refuses to include any pattern with
     * `sampleSize < 3` (enforced server-side + by tests).
     */
    topPatterns: v.array(
      v.object({
        kind: v.union(
          v.literal("hook-text"),
          v.literal("photo-style"),
          v.literal("time-of-day"),
          v.literal("response-latency"),
          v.literal("review-request-channel"),
          v.literal("review-reply-tone"),
          v.literal("local-hook")
        ),
        claim: v.string(),
        sampleSize: v.number(),
        jobsAttributed: v.number(),
        fiveStarsAttributed: v.number(),
        confidence: v.number(),
        wikiVaultPath: v.string(),
      })
    ),
    /**
     * Diff vs the prior week's row. `null` for the very first week.
     * Drives Wave C.7's "Maya is getting smarter" Growth-tab affordance.
     */
    priorWeekDelta: v.optional(
      v.object({
        jobsAttributedDelta: v.number(),
        fiveStarsAttributedDelta: v.number(),
        newPatternCount: v.number(),
        droppedPatternCount: v.number(),
      })
    ),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_week", ["businessId", "weekStartMs"]),
  // ─── end Service product Wave C.5 (weekly learnings) ──────────────────

  // ────────────────────────────────────────────────────────────────────────
  // Service product Wave C.6 — GBP local SEO health score (Maya's judgment)
  //
  // Per `project_north_star_outcomes.md`: "the lever between Maya's actions
  // and jobs/5-stars is GBP local pack ranking." Per the operator directive
  // (2026-04-27, Wave C.6 mid-flight): this score is **Maya's judgment**,
  // not a deterministic weighted-input calculation. Hardcoded rules calcify
  // wrong; LLM judgment + memory-wiki + outcome learnings is the
  // differentiator. The auditor skill takes the operator's full GBP picture
  // (profile + posts + reviews + competitors + Insights) and the relevant
  // wiki pages (`concepts/what-works/gbp/*`) and produces:
  //   - a 0-100 score reflecting Maya's read on local-pack health
  //   - short reasoning prose explaining her score
  //   - the count of nudges she queued this run
  //
  // The HQ Growth tab (Wave C.7) shows score + reasoning as a primary
  // number, NOT a breakdown of inputs. Audit/forensics is via the wiki
  // provenance pointers, not a per-input weights snapshot.
  //
  // Producer: `convex/gbp/computeHealthScore.ts#runGbpHealthAuditForBusiness`
  // — thin orchestration action that fetches the auditor's input bundle,
  // invokes the `maya-service-gbp-seo-auditor` skill, and persists the
  // resulting row. Triggered via prose inside the existing `morning_brief`
  // standing order; standingOrders.ts array length stays locked at 15 per
  // Wave C.5 precedent.
  //
  // Cross-tenant: `businessId`-indexed; every reader filters. No global
  // index. Persistence asserts `businessId` matches before insert.
  //
  // Plan-tier: storage + audit run is plan-agnostic — every business at
  // every tier gets the audit (gating off self-defeating per north star).
  // HQ read-surface gating happens in Wave C.7.
  // ────────────────────────────────────────────────────────────────────────
  gbpHealthScores: defineTable({
    businessId: v.id("businesses"),
    /** UTC ms when the audit ran. */
    scoreAt: v.number(),
    /** Maya's 0-100 score. Higher = healthier. Her judgment, not a formula. */
    compositeScore: v.number(),
    /**
     * Maya's short justification (≤500 chars). Surfaced verbatim on the
     * Growth tab so the operator can see the "why" behind the number.
     */
    reasoning: v.string(),
    /** Count of nudges this run produced + queued for the operator. */
    nudgesPending: v.number(),
    /**
     * Audit-trail metadata. The model + thinking budget are persisted so
     * we can correlate score quality against routing changes over time.
     */
    model: v.string(),
    thinkingBudget: v.string(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_at", ["businessId", "scoreAt"]),
  // ─── end Service product Wave C.6 (GBP health score) ──────────────────

  // ────────────────────────────────────────────────────────────────────────
  // Service product Wave D — beta hardening telemetry
  //
  // The 6 signals the operator wants observability on through beta. Each row
  // is one event. Aggregations live in `convex/queries/business/growth.ts`
  // (`getTelemetrySummary`); this table is append-only.
  //
  // Hard rule (operator directive 2026-04-27): no helper computes a "score"
  // or "rating" or "rank" from telemetry inputs. Counts and aggregations
  // are fine; weighted-composite synthesis is not. Telemetry stores facts;
  // analysis is for Maya's brain or the operator's eyes.
  //
  // The 6 signals:
  //   - "review-request-approval"     (outcome: approved | rejected | edited-then-approved)
  //   - "review-reply-moderation"     (outcome: pass | fail | edited)
  //   - "lead-response-nudge-open"    (outcome: opened | dismissed | acted-on)
  //   - "voice-satisfaction"          (numericValue: 1-5 from post-call rating)
  //   - "ai-cost"                     (numericValue: costUsd; thin wrapper around aiCallLog)
  //   - "crm-webhook-idempotency-hit" (outcome: provider key — jobber|hcp|qbo|nango)
  //
  // Cross-tenant: `businessId`-indexed; every reader filters. Mutations
  // assert `businessId` matches caller's session before insert. No global
  // `by_signal` index — every read is `by_business_and_signal` so a query
  // for one business can never iterate another's signals.
  //
  // Plan-tier: insertion is plan-agnostic (every business emits the
  // signals it generates). Read-surface gating happens in
  // `getTelemetrySummary` — Starter sees null (no audit log); Pro/Studio
  // see counts. Voice-satisfaction signals only ever arrive for Studio
  // (Studio is the dedicated voice tier).
  // ────────────────────────────────────────────────────────────────────────
  serviceTelemetry: defineTable({
    businessId: v.id("businesses"),
    signal: v.union(
      v.literal("review-request-approval"),
      v.literal("review-reply-moderation"),
      v.literal("lead-response-nudge-open"),
      v.literal("voice-satisfaction"),
      v.literal("ai-cost"),
      v.literal("crm-webhook-idempotency-hit")
    ),
    /**
     * Free-form per-signal outcome enum. Validated against the per-signal
     * outcome whitelist in `convex/serviceTelemetry.ts#emit`. Stored as a
     * plain string so future signal kinds can extend without a schema
     * migration.
     */
    outcome: v.string(),
    /**
     * Optional numeric — rating (1-5 for voice-satisfaction), cost (USD for
     * ai-cost), latency ms, etc. Per-signal semantics doc'd in the emitter.
     */
    numericValue: v.optional(v.number()),
    /** Free-form per-signal metadata bag (e.g. Stripe identifier, callId). */
    metadata: v.optional(v.any()),
    ts: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_signal", ["businessId", "signal"])
    .index("by_business_and_ts", ["businessId", "ts"]),
  // ─── end Service product Wave D (beta hardening telemetry) ────────────
  // ─── end Service product Sprint 0 ─────────────────────────────────────
});
