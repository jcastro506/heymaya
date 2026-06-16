import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  creators: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    primaryHandle: v.optional(v.string()),
    /**
     * Coach/Manager rewrite (2026-05-04) — display name captured during the
     * single-screen onboarding (step 2 of 3: handle, name, phone). Pre-filled
     * from the ScrapeCreators verify response for the creator's handle and
     * editable by the creator before submit. Used downstream by the soul.md
     * generator and Maya's introductory iMessage.
     */
    displayName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    channelPreference: v.union(
      v.literal("imessage"),
      v.literal("whatsapp"),
      v.literal("sms"),
      v.literal("telegram"),
      v.literal("web")
    ),
    timezone: v.string(),
    status: v.union(
      v.literal("onboarding"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("churned"),
      // Mission Control account-delete = reversible soft-delete (set here).
      // Hard purge of all rows is a follow-up background job.
      v.literal("deleted")
    ),
    plan: v.union(
      v.literal("coach"),
      v.literal("manager")
    ),
    trialEndsAt: v.optional(v.number()),
    mayaFlyAppId: v.optional(v.string()),
    mayaConfigVersion: v.optional(v.number()),
    /**
     * Per-creator Claw Messenger identity. The shared `CLAW_MESSENGER_API_KEY`
     * env var is single-tenant: every Maya that connects with it shares one
     * relay account, so a second concurrent creator's Maya steals the socket
     * and inbound routes to the wrong creator (observed 2026-05-16). True
     * isolation requires one emotion-machine tenant + key + phone route per
     * creator, provisioned at onboarding via the relay's `/api/tenants`,
     * `/api/keys`, `/api/routes` REST API. When `clawMessengerApiKey` is set,
     * `configGeneratorMaya` stamps it into that creator's bootstrap instead of
     * the shared env key. `clawMessengerTenantId` + `clawMessengerNumber` are
     * kept for lifecycle (revoke key / release route on account deletion) and
     * the "save my number as Maya" UX. Absent ⇒ falls back to the shared key
     * (single-tenant smoke path).
     */
    clawMessengerApiKey: v.optional(v.string()),
    clawMessengerTenantId: v.optional(v.string()),
    clawMessengerNumber: v.optional(v.string()),
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
      v.union(
        v.literal("creator"),
        v.literal("service-business"),
        v.literal("growth-agent"),
        v.literal("gtm-agent")
      )
    ),
    /** Pointer to the operator's business row. Only set when accountType = "service-business". */
    businessId: v.optional(v.id("businesses")),
    // ─── end Service product Sprint 0 ─────────────────────────────────────
    // ─── Creator usage analytics — added 2026-05-04 ───────────────────────
    // Denormalized scoreboard columns maintained by `convex/lib/usageEvents.ts`.
    // Updated on every `logUsageEvent` write so the operator can sort the
    // top-creators-by-engagement query without scanning the full usageEvents
    // table. All three are optional — creators with no events yet have
    // undefined values and the queries treat that as "no data".
    /** Last creator-driven activity (chat_turn_in / reaction_received / explicit_feedback / action_taken). Maya-driven kinds do NOT bump this. */
    lastEngagedAt: v.optional(v.number()),
    /** 0-100 derived rollup over the last 7 days. */
    engagementScore7d: v.optional(v.number()),
    /** Most-fired cron/event label across the last 7 days. */
    topSkillLast7d: v.optional(v.string()),
    // ─── First-boot introduction ──────────────────────────────────────────
    // Maya's first-message-on-boot sequence: greet + cited insight → 3
    // opening questions → Gmail/Calendar OAuth deep-links → first weekly
    // plan. Three flags gate the sequence so it fires exactly once.
    //   - `firstBootCompletedAt`  — set when Maya finishes the intro arc.
    //   - `openingAnswersAt`      — stamped by `POST /lc_maya/submit_opening_answers`
    //     when the creator's 3 answers are parsed + persisted to
    //     `creatorPicture.openingAnswers`. The `first_weekly_plan` standing
    //     order keys off this.
    //   - `firstWeeklyPlanSentAt` — set after the first proactive weekly plan ships.
    //   - `pictureLockedAt`        — Sprint 6 stamp the moment creatorPicture
    //     synthesis lands AND any operator-required verification has cleared.
    //     This is the trigger for Sprint 7 Slice D's `first_proactive_ping`
    //     standing order — the Day 1 first-touch ping fires 15-30 min later.
    //   - `firstProactivePingSentAt` — set after Slice D's Day 1 ping ships.
    //     Idempotency cursor: if `pictureLockedAt` somehow re-stamps (re-lock
    //     after manual verification flip), the ping does NOT re-fire.
    firstBootCompletedAt: v.optional(v.number()),
    openingAnswersAt: v.optional(v.number()),
    firstWeeklyPlanSentAt: v.optional(v.number()),
    // Sprint 6 — onboarding flow redesign. Stamped by
    // `POST /lc_maya/lock_picture` after the creator confirms (or corrects)
    // the synthesized picture against any `needsVerification[]` items.
    // Standing-order `first_weekly_plan` triggers off this — NOT
    // `openingAnswersAt` — so the plan never reads unverified picture data.
    pictureLockedAt: v.optional(v.number()),
    // Sprint 7 Slice D — Day 1 first-proactive-ping idempotency cursor.
    // Stamped after the ping fires (or is skipped on empty trend+idea).
    // If `pictureLockedAt` re-stamps, the ping does NOT re-fire.
    firstProactivePingSentAt: v.optional(v.number()),
    // ─── Sprint C.5 — first-week calendar bootstrap idempotency cursor ──
    // Stamped after `first_week_calendar_bootstrap` standing order
    // successfully populates the rest of this week + next week of calendar
    // events for the creator. The event-driven standing order fires ONCE
    // post-calendar OAuth completion when this cursor is undefined; the
    // Sunday `weekly_content_plan` cron takes over for ongoing weeks.
    // Subsequent calendar reconnects (or session restarts that re-emit the
    // calendar-connected event) do NOT re-fire because the cursor stays
    // stamped. UTC ms epoch. Schema additive; no migration impact.
    firstWeekCalendarBootstrappedAt: v.optional(v.number()),
    // ─── Sprint 9 — admin-flagged comp accounts ───────────────────────────
    // Operator-set flag. When true, the creator gets full Manager features
    // without a Stripe subscription. Used to onboard friend-cohort beta
    // testers without making them swipe a card. Flipped via the
    // `admin.compCreator` internal mutation, gated by ADMIN_TOKEN. The
    // `subscriptionActive(creator)` helper in `convex/lib/planFeatures.ts`
    // short-circuits to "active" when this is true; gated entry points
    // either consult that helper directly or read `creator.compedByAdmin`
    // alongside their existing Stripe subscription check. See also:
    // `convex/admin.ts` for the comp/uncomp mutations.
    compedByAdmin: v.optional(v.boolean()),
    // ─── end Sprint 9 ──────────────────────────────────────────────────────
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
      v.literal("hunter"),
      v.literal("linkedin"),
      v.literal("twitter")
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

  /**
   * Sprint 9.8 Workstream B — Apple iCloud Calendar via CalDAV +
   * app-specific password. Separate table from `connectedAccounts` because
   * the auth model is fundamentally different: not OAuth, no refresh
   * tokens, no Composio mediation. The user pastes an app-specific
   * password in iMessage; we encrypt and store it; subsequent CalDAV
   * calls use HTTP Basic with Apple ID + decrypted password.
   *
   * Apple has signaled they may deprecate app-specific passwords in
   * favor of Sign in with Apple + 2FA. This integration is borrowed
   * time. Watch Apple Developer Forums + iCloud release notes.
   */
  appleCalendarConnections: defineTable({
    creatorId: v.id("creators"),
    /** Apple ID email (the email the user logs into iCloud with). Plaintext
     *  — not a secret on its own, only useful with the password. */
    appleId: v.string(),
    /** Encrypted (AES-256-GCM, random IV) — see convex/lib/encryption.ts. */
    encryptedAppPassword: v.string(),
    /** SHA-256 hash of the plaintext password, hex. Same dedupe pattern as
     *  composioAccountIdHash. Lets us detect "user pasted the same password
     *  twice" without decrypting. */
    appPasswordHash: v.optional(v.string()),
    /** Discovered CalDAV principal URL — set on connect, used to short-
     *  circuit the discovery dance on subsequent calls. */
    principalUrl: v.optional(v.string()),
    /** Default calendar URL Maya writes to unless told otherwise. Set to
     *  the user's primary calendar at connect time; user can override
     *  later via Profile screen. */
    defaultCalendarUrl: v.optional(v.string()),
    /** "active" — credentials work; "revoked" — last call returned 401
     *  (user revoked the app password from appleid.apple.com) */
    status: v.union(v.literal("active"), v.literal("revoked")),
    connectedAt: v.number(),
    /** Timestamp of last successful CalDAV call. Useful for "is the
     *  connection alive?" checks. */
    lastValidatedAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_password_hash", ["appPasswordHash"]),

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
    /**
     * Optional boundary anchors the creator surfaces during onboarding (anti-
     * niches, off-limits topics, brand categories they refuse). Read by:
     *   - `maya-thumbnail-maker` (avoids generating overlay text on banned topics)
     *   - `maya-clip-editor` (thumbnail-overlay path filters banned-topic frames)
     *   - `maya-trend-watcher` (adversarial guard — drops trend cards intersecting the list)
     *   - any future skill that needs a "do-not-go-there" list
     *
     * Sprint 8 Slice A added the field; synthesis emits it from the creator's
     * anti-niche answer when present. The field stays optional so old picture
     * rows pre-S8 keep loading; skills must null-coalesce to the empty list.
     */
    boundaries: v.optional(
      v.object({
        banned_topics: v.optional(v.array(v.string())),
        // Forward room: future bounding categories (banned-brands,
        // banned-formats, banned-cohosts) extend this object. Adding fields
        // is non-breaking because every member is optional.
      })
    ),
    /**
     * Sprint 10 — multimodal picture fields. Populated when synthesis
     * actually WATCHED the creator's videos via the video-synth-worker
     * (Gemini Files API). In text-only fallback mode (worker disabled OR
     * all video downloads failed), object fields are null and array fields
     * are empty. Skills consume these to write content that sounds like a
     * friend who already loves the creator's content, not an analytics
     * dashboard. See `agents/skills/maya-platform/playbook.md` § Voice for
     * the warmthMaterial usage rules — the confidence field is load-bearing
     * (safe-to-use → verbatim paraphrase; check-with-creator → phrased as
     * a question).
     */
    voiceAndPersonality: v.optional(
      v.union(
        v.object({
          humorType: v.string(),
          energyLevel: v.string(),
          onCameraPersona: v.string(),
          dryWittyEarnest: v.string(),
          signaturePhrases: v.array(v.string()),
        }),
        v.null()
      )
    ),
    visualStyle: v.optional(
      v.union(
        v.object({
          framing: v.string(),
          aesthetic: v.array(v.string()),
          settingsSeen: v.array(v.string()),
          strengths: v.array(v.string()),
          weaknesses: v.array(v.string()),
        }),
        v.null()
      )
    ),
    recurringElements: v.optional(
      v.array(
        v.object({
          kind: v.union(
            v.literal("person"),
            v.literal("pet"),
            v.literal("location"),
            v.literal("prop"),
            v.literal("format")
          ),
          name: v.string(),
          appearancesIn: v.array(v.string()),
          roleSummary: v.string(),
          // Sprint 12 Phase 1A — parallel to `appearancesIn`, ISO date strings
          // (YYYY-MM-DD) per appearance. Same length and order as
          // `appearancesIn`. Optional so pre-Sprint-12 rows continue to load.
          // Lets USER.md surface ranges like "London landmarks (3 posts,
          // Feb 4-13)" so Maya reads time, not just count.
          appearanceDates: v.optional(v.array(v.string())),
        })
      )
    ),
    warmthMaterial: v.optional(
      v.array(
        v.object({
          kind: v.union(
            v.literal("compliment"),
            v.literal("recurring-element-callout"),
            v.literal("specific-moment")
          ),
          text: v.string(),
          confidence: v.union(
            v.literal("safe-to-use"),
            v.literal("check-with-creator")
          ),
          citationPostIds: v.array(v.string()),
          // Sprint 12 Phase 1A — parallel to `citationPostIds`, ISO date
          // strings (YYYY-MM-DD), one per cited post. Same length and order.
          // Optional so pre-Sprint-12 rows continue to load. Lets Maya cite
          // posts by date in chat ("your Feb 4 London clip…") instead of
          // bare reference ("your London clip…").
          citationPostDates: v.optional(v.array(v.string())),
        })
      )
    ),
    /**
     * Sprint 12 Phase 1A — days between the creator's most recent post (across
     * any platform) and `generatedAt`. The synth computes this from the input
     * post timestamps; USER.md surfaces it in the integrated-picture summary
     * so Maya naturally reads cadence gaps without hardcoded thresholds.
     *
     * Optional. When absent (no datable posts in the cache), USER.md skips
     * the line. Re-syntheses overwrite. Skills MUST NOT branch on a
     * threshold here — they read it alongside `openingAnswers.targetPostsPerWeek`
     * and let Maya respond like a person.
     */
    daysSinceLastPost: v.optional(v.number()),
    /**
     * The 3 opening answers Maya parses out of the creator's first reply in
     * iMessage — captured by `POST /lc_maya/submit_opening_answers` (see
     * `convex/lcMaya/lcMayaHttp.ts`). This is the lightweight first-boot
     * variant of `submitOnboardingAnswers`: Maya only asks goal / tone /
     * brand-deal floor over text. The full Wave-2 dynamic onboarding
     * (careerStage, location, revenue streams, etc.) runs in the web flow
     * and writes the same picture row via `submitOnboardingAnswers`.
     *
     * Cross-product note: when both flows have run, the values can diverge
     * (web flow typically more complete). Synthesis treats this slot as
     * the conversational source — leans on `tone` to seed the soul.md
     * tone slider when no `tonePreference` is set on the `creators` row.
     *
     * Optional. Top-level `creators.openingAnswersAt` is the canonical
     * "has Maya gotten the answers" timestamp; this slot is the payload.
     */
    openingAnswers: v.optional(
      v.object({
        goal: v.string(),
        tone: v.union(
          v.literal("supportive"),
          v.literal("strategic"),
          v.literal("tough-love")
        ),
        brandDealFloorUsd: v.optional(v.number()),
        submittedAt: v.number(),
        // ─── Sprint 6 — six anchor questions (onboarding redesign) ──────────
        // All optional so partial answers never break boot. The 6-question
        // playbook (`agents/skills/maya-platform/playbook.md § 4.5`) collects
        // these one at a time over iMessage; Maya POSTs whichever subset she
        // has via `submit_opening_answers`. The synthesis pipeline reads
        // these BEFORE the model call and injects them as constraints — see
        // `convex/onboarding/maya/synthesizeCreatorPicture.ts` ANCHOR_REMINDER.
        //
        // 1. Where based? — fixes the London-bug (NYC self-report + heavy
        //    London footage in last 30 posts must surface a verification
        //    question, not silently overwrite).
        locationCity: v.optional(v.string()),
        locationState: v.optional(v.string()),
        locationCountry: v.optional(v.string()),
        timezone: v.optional(v.string()),
        // 2. Niche in your own words? ("I don't know yet" valid → empty/short)
        nicheInOwnWords: v.optional(v.string()),
        // 3. 3-month goals — free-form so the model can interpret
        //    (e.g. "10K followers + first paid deal").
        goals3Mo: v.optional(v.string()),
        // 4. Full-time / day job?
        jobStatus: v.optional(
          v.union(
            v.literal("full-time-creator"),
            v.literal("transitioning-full-time"),
            v.literal("side-hustle"),
            v.literal("hobby")
          )
        ),
        // 5. Brand deals — interested + rough floor?
        dealsInterest: v.optional(
          v.union(
            v.literal("yes"),
            v.literal("maybe"),
            v.literal("no")
          )
        ),
        dealsFloorUsd: v.optional(v.number()),
        // 6. Anti-patterns — anything tried that didn't work, or shouldn't push toward.
        antiNiches: v.optional(v.array(v.string())),
        // Sprint 12 Phase 1A — creator's stated target posting cadence,
        // posts-per-week. Captured by the Phase 1B onboarding question
        // folded into Q3 (3-month goals). Optional — pre-Phase-1B creators
        // and creators who decline the question land here with `undefined`.
        // USER.md surfaces this as the cadence anchor; Maya reads it
        // alongside `daysSinceLastPost` to read gaps naturally.
        targetPostsPerWeek: v.optional(v.number()),
      })
    ),
    /**
     * Sprint 6 — synth-emitted reconciliation queue. Generalized from
     * `careerStageReconciliation` (which stays for back-compat). Each entry
     * is a claim where the creator's self-reported anchor (`openingAnswers`)
     * diverges from the observed signal in the last 30 posts. The synth
     * does NOT silently overwrite anchors — it surfaces the divergence here
     * so Maya can ask the creator before locking via `lock_picture`.
     *
     * Severities:
     *   - `blocker` — picture cannot be locked without explicit confirmation
     *     or correction (e.g. London-bug location mismatch).
     *   - `soft`    — Maya asks, but the creator can wave it through.
     */
    needsVerification: v.optional(
      v.array(
        v.object({
          field: v.string(),
          selfReported: v.optional(v.any()),
          observedSignal: v.optional(v.any()),
          evidence: v.array(v.string()),
          question: v.string(),
          severity: v.union(v.literal("blocker"), v.literal("soft")),
        })
      )
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
    /**
     * Sprint A.2 — multimodal editing fingerprint. Populated by
     * `convex/onboarding/maya/extractEditingFingerprint.ts` in parallel with
     * the voice/visual synthesis pass. Captures the creator's pacing /
     * opening / transition / caption / audio / framing patterns + signature
     * moves, so Maya can mimic THEIR editing style from day one when she
     * drafts cut-lists, hook proposals, or co-edits a piece.
     *
     * Optional: undefined when fewer than 3 posts in the synthesis input
     * had a usable videoUrl (too thin to fingerprint — downstream skills
     * MUST teach Maya to ASK the creator about preferences rather than
     * forcing a style on them). All fields qualitative — the model
     * DESCRIBES patterns, it does not precision-measure them.
     *
     * Citation rule (enforced in skill prompts, not at insert time):
     *   any Maya claim about the creator's editing style cites a postId
     *   from `citedPostIds`.
     */
    editingFingerprint: v.optional(
      v.object({
        pacing: v.object({
          /** Typical cut frequency in seconds (e.g. 0.8, 2.5, 4.0). */
          avgCutEverySec: v.number(),
          /** Qualitative rhythm — model describes, doesn't measure. */
          consistency: v.union(
            v.literal("tight"),
            v.literal("loose"),
            v.literal("mixed")
          ),
          /** Where in the first 1500ms the hook beat lands. */
          hookLandsAtMs: v.number(),
          pacingCurve: v.union(
            v.literal("fast-throughout"),
            v.literal("slow-burn"),
            v.literal("fast-to-slow"),
            v.literal("building"),
            v.literal("irregular")
          ),
        }),
        opening: v.union(
          v.literal("face-on"),
          v.literal("motion-shot"),
          v.literal("text-card"),
          v.literal("b-roll"),
          v.literal("voice-over-still"),
          v.literal("mixed")
        ),
        transitions: v.union(
          v.literal("hard-cut"),
          v.literal("zoom"),
          v.literal("whip-pan"),
          v.literal("jump-cut"),
          v.literal("dissolve"),
          v.literal("mixed")
        ),
        captions: v.object({
          style: v.union(
            v.literal("burned-in"),
            /** Relies on TikTok's native captions. */
            v.literal("auto"),
            v.literal("none"),
            v.literal("mixed")
          ),
          position: v.union(
            v.literal("top"),
            v.literal("center"),
            v.literal("bottom"),
            v.literal("varies"),
            v.literal("not-applicable")
          ),
          cadence: v.union(
            v.literal("word-by-word"),
            v.literal("phrase"),
            v.literal("sentence"),
            v.literal("not-applicable")
          ),
          /** Free-text: "bold white sans-serif with black stroke, slight bounce on emphasis". */
          visualDescription: v.string(),
        }),
        audio: v.union(
          v.literal("original-voice"),
          v.literal("music-driven"),
          v.literal("trending-sound"),
          v.literal("voiceover"),
          v.literal("mixed")
        ),
        framing: v.union(
          v.literal("fully-vertical-9-16"),
          v.literal("horizontal-letterboxed"),
          v.literal("square"),
          v.literal("mixed")
        ),
        /**
         * Recurring beats that make this creator's content recognizable
         * (e.g. "opens with a sip of coffee", "always ends on a stare").
         */
        signatureMoves: v.array(v.string()),
        /** 0-1. Low when sample is thin or styles vary widely. */
        confidence: v.number(),
        /** How many posts informed this fingerprint. */
        sampleSize: v.number(),
        /** Platform post ids — citation firewall for any style claim. */
        citedPostIds: v.array(v.string()),
        /** ms epoch. */
        extractedAt: v.number(),
      })
    ),
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

  // Sprint C.6 (2026-05-13) — firewall telemetry. Every call to
  // /lc_maya/validate_outbound_send + /lc_maya/validate_trend_citation
  // writes one row here for audit. Lets us measure (a) hit rate of the
  // wire-level firewall, (b) which regex patterns actually catch confab
  // vs cause false positives, (c) whether trend-grounding tools + AGENTS.md
  // teaching make the firewall less necessary over time.
  //
  // Per the operator-locked feedback rule "trust LLM judgment, no hardcoded
  // rules": the regex firewall is band-aid territory. Before deciding whether
  // to keep / tighten / remove it, we need data on its real catch-rate vs
  // false-positive rate. This table is the data plane for that decision.
  //
  // Schema is intentionally lean — message bodies are tenant data; we keep
  // them for a week then trim via a sweeper (future sprint). Cross-tenant
  // gating: every row indexed by_creator + by_creator_and_observedAt.
  firewallEvents: defineTable({
    creatorId: v.id("creators"),
    /** The original message that hit the firewall. Tenant data — trimmed by sweeper after 7d. */
    message: v.string(),
    verdict: v.union(v.literal("ok"), v.literal("blocked")),
    /** Source endpoint — which firewall surface fired. */
    source: v.union(
      v.literal("validate_outbound_send"),
      v.literal("validate_trend_citation")
    ),
    /** Trend-shape regex match (if any). null when no trend-shape detected OR when verdict=ok and no trend-shape claim. */
    matchedTrendPattern: v.optional(v.string()),
    /** Which format checks tripped (markdown-bold / numbered-list / etc.) — only on validate_outbound_send. */
    formatCategoriesTripped: v.optional(v.array(v.string())),
    /** Combined block reasons returned to caller. */
    blockedReasons: v.optional(v.array(v.string())),
    /** Platform-post URLs found in the message (if any). */
    urlsFound: v.optional(v.array(v.string())),
    observedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_observedAt", ["creatorId", "observedAt"])
    .index("by_observedAt", ["observedAt"]),

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

  // Sprint 4 — append-only follower-count snapshots so USER.md can show a
  // 30-day delta on every fresh bulk pull. One row per (creator, platform,
  // handle, scrapedAt). The bulk-pull pipeline writes a snapshot whenever
  // `runFullScrapePull` lands a profile result. The 30-day window is derived
  // at read time by `generateUserMd`, NOT pre-computed — keeps the schema
  // history-of-truth and lets future windows (7d / 90d) come for free.
  creatorFollowerSnapshots: defineTable({
    creatorId: v.id("creators"),
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin"),
      v.literal("x")
    ),
    handle: v.string(),
    followerCount: v.number(),
    /** Snapshot timestamp (ms). Equal to the runFullScrapePull `finishedAt`. */
    capturedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_platform", ["creatorId", "platform"])
    .index("by_creator_platform_and_capturedAt", [
      "creatorId",
      "platform",
      "capturedAt",
    ]),

  // Sprint 4 — credit-expensive ScrapeCreators endpoint audit. Today the only
  // expensive endpoint is `/v1/tiktok/user/audience` (26 credits/call); future
  // expensive endpoints get appended to this table. Operator monitors total
  // credit burn here without scanning the cache (which is dominated by 1-credit
  // calls). `aiCallLog` is for OpenRouter token spend; this is the parallel
  // for ScrapeCreators credit spend — different vendor, different bucket.
  scrapeCreatorsCreditAudit: defineTable({
    creatorId: v.id("creators"),
    platform: v.string(),
    /** Cache-kind ("audience" / "following" / etc). Mirrors `CacheKind`. */
    kind: v.string(),
    /** Endpoint path so future skim-by-route reports work. */
    endpoint: v.string(),
    /** Credit cost as documented by ScrapeCreators (audience=26, others=1). */
    credits: v.number(),
    /** Whether the call ran. False = skipped (e.g. <5K followers gating). */
    called: v.boolean(),
    /** Reason for skip (or "called" when ran). Free-form audit string. */
    reason: v.string(),
    handle: v.string(),
    ts: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_ts", ["creatorId", "ts"])
    .index("by_kind", ["kind"]),

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
    // SHARED platform-algorithm intelligence. Rows with creatorId undefined are
    // the SHARED monthly intelligence (one per platform) refreshed centrally by
    // the Convex `platform-algo-refresh` cron — every Maya reads them so the
    // research runs ONCE, not once per customer. (creatorId-scoped rows are the
    // legacy creator-product per-creator cache.)
    creatorId: v.optional(v.id("creators")),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("linkedin")
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
  //
  // Sprint 3 Slice 2 additions (additive — pre-existing rows lack these
  // fields, all optional):
  //   - `tickKind` — 'cron' | 'event' | 'heartbeat' | 'on-demand'. Lets
  //     the dashboard slice tick decisions by source.
  //   - `pushed` — did this firing send a creator-facing message?
  //     HEARTBEAT.md states "max 1 push per tick"; this is the field
  //     that proves it.
  //   - `engagedAt` — backfilled when the creator demonstrably engaged
  //     with what Maya pushed (replied to the message, tapped the
  //     surfaced card, marked an idea approved). Lets us measure whether
  //     proactive pushes earn their keep.
  //   - `outcome` adds `skipped_cooldown` — heartbeat checks honor
  //     skip-if-recent windows; the suppression is logged so operators
  //     can see what Maya chose NOT to do.
  mayaActionLog: defineTable({
    creatorId: v.id("creators"),
    entryId: v.string(),
    outcome: v.union(
      v.literal("ran"),
      v.literal("skipped_plan_disabled"),
      v.literal("skipped_condition_unmet"),
      v.literal("skipped_dependency_missing"),
      v.literal("skipped_cooldown"),
      v.literal("retried"),
      v.literal("failed")
    ),
    detail: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    ts: v.number(),
    tickKind: v.optional(
      v.union(
        v.literal("cron"),
        v.literal("event"),
        v.literal("heartbeat"),
        v.literal("on-demand")
      )
    ),
    pushed: v.optional(v.boolean()),
    engagedAt: v.optional(v.number()),
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
    // Sprint 11 — lead provenance for cap accounting. Optional for
    // back-compat with rows written before the cap system. Cold cap
    // (5/day, 30/wk, 30d warmup → 10/day) only counts rows where
    // `coldOrWarm === "cold"`. Warm follow-ups are unbounded.
    leadSource: v.optional(
      v.union(
        v.literal("inbox-warm"),
        v.literal("llm-target"),
        v.literal("apollo"),
        v.literal("hunter"),
        v.literal("marketplace"),
        v.literal("manual")
      )
    ),
    coldOrWarm: v.optional(v.union(v.literal("cold"), v.literal("warm"))),
    brandContactId: v.optional(v.id("brandContacts")),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"])
    .index("by_creator_and_brand", ["creatorId", "brand"])
    .index("by_creator_and_sentAt", ["creatorId", "sentAt"]),

  // Sprint 11 — discovered brand contacts (warm + cold sources).
  // Layer 4 (inbox warm-mining via direct Gmail OAuth) writes "warm"
  // rows when the creator already has a thread with the brand. Layer 1
  // (LLM niche → target list) writes "cool" rows with no contact email
  // yet. Layer 2 (Apollo / Hunter, behind flag) enriches "cool" → "cold"
  // with a verified email. Layer 3 (marketplace scout) is deferred to
  // phase 1.5. Manager-tier outreach pulls from this table warm-first.
  brandContacts: defineTable({
    creatorId: v.id("creators"),
    brand: v.string(),
    contactName: v.optional(v.string()),
    contactRole: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    emailVerifiedAt: v.optional(v.number()),
    source: v.union(
      v.literal("inbox-warm"),
      v.literal("llm-target"),
      v.literal("apollo"),
      v.literal("hunter"),
      v.literal("marketplace"),
      v.literal("manual")
    ),
    sourceRef: v.optional(v.string()),
    warmth: v.union(
      v.literal("hot"),
      v.literal("warm"),
      v.literal("cool"),
      v.literal("cold")
    ),
    lastInboundAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    dedupeKey: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("dnc"),
      v.literal("bounced"),
      v.literal("unsubscribed")
    ),
    discoveredAt: v.number(),
    lastEnrichedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_warmth", ["creatorId", "warmth"])
    .index("by_creator_and_brand", ["creatorId", "brand"])
    .index("by_dedupe", ["dedupeKey"]),

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
  // Sprint 5 — Trends screen read-only projections of the memory-wiki vault.
  //
  // Sprint 8 Slice B (memory-wiki adoption, 2026-05-06): these tables are
  // DOWNGRADED to read-only projections. Source of truth for compiled
  // claims is OpenClaw's native memory-wiki on the per-creator Fly machine
  // (`/data/memory-wiki/<topic>.md`). The high-frequency learning skills
  // (`maya-platform-algo-researcher`, `maya-pre-post-scorer`,
  // `maya-collab-matchmaker`, `maya-industry-intel`,
  // `maya-opportunity-scout`, plus the trend-watcher cron behavior) emit
  // `wiki_apply` calls in their turn output instead of writing here
  // directly. A future dreaming-pass / wiki sync cron (queued for Sprint
  // 8.5) mirrors compiled wiki claims back into these tables so the
  // existing HQ Trends screen + heartbeat skim continue to work without a
  // round-trip to the agent runtime. `mirroredAt` marks the last sync.
  //
  // `trendObservations` covers the daily niche scan (6pm) + industry-intel
  // daily push (7:30am) + platform-wide trend watcher (9am) — `source`
  // disambiguates so the UI can tab them.
  //
  // `competitorObservations` covers the per-creator named-peer watch (9am).
  //
  // Both carry `creatorId` + `by_creator(*)` indexes so the cross-tenant
  // gate is enforceable from the same `getCurrentCreator` helper that
  // Today/Performance already use. New writes from the legacy
  // `lc_maya.log_trend` / `lc_maya.log_competitor_observation` HTTP
  // endpoints continue working during the wiki-mirror migration window;
  // those endpoints will be removed once the Sprint 8.5 sync cron lands.
  // ────────────────────────────────────────────────────────────────────────

  trendObservations: defineTable({
    creatorId: v.id("creators"),
    source: v.union(
      v.literal("niche-scan"),
      v.literal("platform-wide"),
      v.literal("industry-intel"),
      v.literal("competitor-watch"),
      // Sprint 12.7 Phase 1 — chat-time live fetch via `fetchTrendsLiveHttp`.
      // Maya promotes candidates from a live ScrapeCreators trending pull into
      // grounded observations she ships in chat. Lets the integrated-read pre-check
      // distinguish "fresh on-demand" from cron-driven niche-scan.
      v.literal("chat-on-demand")
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
    /**
     * Sprint 8 Slice B — UTC ms when the wiki-mirror sync last touched
     * this row. `undefined` = legacy row written directly by the
     * `lc_maya.log_trend` HTTP endpoint before the wiki adoption migration.
     * Set by the Sprint-8.5 dreaming-pass / wiki-mirror cron when it
     * projects a compiled `niche/<niche>/trend-pattern` or
     * `creator/<creatorId>/industry-intel/<topic>` wiki claim into this
     * table. Readers (HQ Trends, heartbeat) treat older `observedAt` rows
     * with a missing `mirroredAt` as legacy-but-valid. Sprint 8.5 also
     * uses `mirroredAt` as the idempotency key — the mirror dedupes on
     * (creatorId, wikiVaultPath) so the same wiki entry never round-trips
     * into a duplicate row. `wikiVaultPath` (when set) pins the source
     * page on the Fly-side vault so HQ can offer a "see Maya's notes" link.
     */
    mirroredAt: v.optional(v.number()),
    wikiVaultPath: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_observedAt", ["creatorId", "observedAt"])
    .index("by_creator_and_source", ["creatorId", "source"])
    .index("by_creator_and_vault_path", ["creatorId", "wikiVaultPath"]),

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
    /**
     * Sprint 8 Slice B — UTC ms when the wiki-mirror sync last touched
     * this row. `undefined` = legacy row written directly by the
     * `lc_maya.log_competitor_observation` HTTP endpoint before the wiki
     * adoption migration. Set by the Sprint-8.5 dreaming-pass /
     * wiki-mirror cron when it projects a compiled
     * `competitor/<creatorId>/<peerHandle>/observation` wiki claim into
     * this table. See `trendObservations.mirroredAt` for the full
     * idempotency / dedupe contract.
     */
    mirroredAt: v.optional(v.number()),
    wikiVaultPath: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_peer", ["creatorId", "peerHandle"])
    .index("by_creator_and_observedAt", ["creatorId", "observedAt"])
    .index("by_creator_and_vault_path", ["creatorId", "wikiVaultPath"]),

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 8.5 — creator-side weekly learnings projection.
  //
  // Mirrors the service-product `weeklyLearnings` table (see § Wave C.5)
  // but with `creatorId` instead of `businessId`. Same shape rationale:
  // Maya's per-week synthesis of "what worked across the whole creator
  // surface" gets materialized into the wiki under
  // `concepts/what-works/<platform>/*` AND projected here so the Growth /
  // Performance HQ tabs can render "what Maya learned this week" without
  // a runtime round-trip.
  //
  // Cross-tenant: `creatorId`-indexed; every read filters. Mirror sync is
  // idempotent on (creatorId, weekStartMs) — the sync endpoint dedupes.
  // Phantom-pattern guard: the extractor refuses sampleSize<3 patterns so
  // this table never carries unsupported claims (mirrors § Wave C.5).
  // ────────────────────────────────────────────────────────────────────────
  weeklyLearningsCreator: defineTable({
    creatorId: v.id("creators"),
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
     */
    topPatterns: v.array(
      v.object({
        kind: v.union(
          v.literal("hook-text"),
          v.literal("posting-time"),
          v.literal("format"),
          v.literal("topic"),
          v.literal("brand-tone"),
          v.literal("collab-pattern")
        ),
        claim: v.string(),
        sampleSize: v.number(),
        engagementLift: v.optional(v.number()),
        confidence: v.number(),
        wikiVaultPath: v.string(),
      })
    ),
    /**
     * Diff vs the prior week's row. `null` for the very first week.
     * Drives the Growth tab's "Maya is getting smarter" affordance.
     */
    priorWeekDelta: v.optional(
      v.object({
        newPatternCount: v.number(),
        droppedPatternCount: v.number(),
        confidenceShift: v.number(),
      })
    ),
    /** Sprint 8.5 — wiki mirror sync timestamp (idempotency key). */
    mirroredAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_week", ["creatorId", "weekStartMs"]),

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
      v.literal("sms"),
      v.literal("telegram")
    ),
    // Channel-native identifier as a string. For imessage/whatsapp/sms this is
    // E.164 phone (e.g. "+15551234567"). For telegram it's "tg:<chat_id>" or
    // "tg:pending" while the pair is in flight (chat_id is only known after
    // the user DMs the bot and OpenClaw approves the pair). Field name kept
    // for backward compatibility with existing rows; semantics widened.
    phoneNumber: v.string(),
    externalPairingId: v.string(), // OpenClaw-side pair request id
    externalIdentifier: v.optional(v.string()), // OpenClaw final channel id (telegram chat_id or @username)
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
    .index("by_channel_and_phone", ["channel", "phoneNumber"])
    .index("by_external_pairing_id", ["externalPairingId"]),

  accountDeletionRequests: defineTable({
    creatorId: v.id("creators"),
    source: v.union(v.literal("web"), v.literal("imessage")),
    confirmationPhrase: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
    requestedAt: v.number(),
    expiresAt: v.number(),
    confirmedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"]),

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
  // Creator Maya v0 — TikTok-first, iMessage-only, calendar-aware reset.
  //
  // These additive tables intentionally sit beside the older broad creator
  // manager tables. They give the new MVP a clean data contract without
  // deleting or rewriting existing product surfaces.
  // ────────────────────────────────────────────────────────────────────────

  creatorMayaV0Onboarding: defineTable({
    creatorId: v.id("creators"),
    tiktokConnected: v.boolean(),
    metadataPulled: v.boolean(),
    videoSamplesAnalyzed: v.boolean(),
    calendarConnected: v.boolean(),
    interviewComplete: v.boolean(),
    readbackConfirmed: v.boolean(),
    creatorPictureReady: v.boolean(),
    imessagePaired: v.boolean(),
    mayaDeployed: v.boolean(),
    // Tracks whether Maya has sent her first activation iMessage/Telegram
    // after OpenClaw came online. Optional because pre-bridge rows don't
    // have it, and the post-deploy activation pipeline (which writes it)
    // lives in the operator's stashed in-flight work on
    // codex/openclaw-weekly-calendar-brand-research.
    firstTextSent: v.optional(v.boolean()),
    currentStep: v.string(),
    progressPercent: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_step", ["creatorId", "currentStep"]),

  creatorMayaV0TiktokAccounts: defineTable({
    creatorId: v.id("creators"),
    handle: v.string(),
    displayName: v.string(),
    followerCount: v.number(),
    bio: v.string(),
    avatarUrl: v.optional(v.string()),
    verifiedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_handle", ["handle"]),

  creatorMayaV0TiktokPosts: defineTable({
    creatorId: v.id("creators"),
    tiktokPostId: v.string(),
    caption: v.string(),
    thumbnailUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    publishedAt: v.number(),
    viewCount: v.number(),
    likeCount: v.number(),
    commentCount: v.number(),
    shareCount: v.number(),
    formatKey: v.optional(v.string()),
    selectedForAnalysis: v.optional(v.boolean()),
    watchMode: v.optional(
      v.union(
        v.literal("metadata_only"),
        v.literal("first_3_seconds"),
        v.literal("sampled_frames"),
        v.literal("full_video")
      )
    ),
    sampleReasons: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_published", ["creatorId", "publishedAt"])
    .index("by_creator_and_tiktok_post", ["creatorId", "tiktokPostId"]),

  creatorMayaV0CalendarConnections: defineTable({
    creatorId: v.id("creators"),
    provider: v.union(v.literal("google"), v.literal("apple"), v.literal("mock")),
    providerMode: v.optional(
      v.union(
        v.literal("google_api"),
        v.literal("apple_phone_api"),
        v.literal("mock")
      )
    ),
    externalAccountId: v.optional(v.string()),
    oauthAccessToken: v.optional(v.string()),
    oauthRefreshToken: v.optional(v.string()),
    oauthExpiresAt: v.optional(v.number()),
    oauthTokenType: v.optional(v.string()),
    oauthScope: v.optional(v.string()),
    timezone: v.string(),
    scopes: v.array(v.string()),
    canCreateHolds: v.boolean(),
    connectedAt: v.number(),
    lastSyncedAt: v.optional(v.number()),
    lookaheadDays: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired")
    ),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_provider", ["creatorId", "provider"]),

  creatorMayaV0CalendarEvents: defineTable({
    creatorId: v.id("creators"),
    providerEventId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    startMs: v.number(),
    endMs: v.number(),
    createdBy: v.union(
      v.literal("maya"),
      v.literal("creator"),
      v.literal("external")
    ),
    mayaOwnerKey: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    classification: v.optional(
      v.union(
        v.literal("creator_relevant"),
        v.literal("creator_shoot"),
        v.literal("work_meeting"),
        v.literal("recurring_noise"),
        v.literal("personal_private")
      )
    ),
    contentArc: v.optional(v.array(v.any())),
    privacyRedacted: v.optional(v.boolean()),
    source: v.union(
      v.literal("availability"),
      v.literal("context"),
      v.literal("content_hold"),
      v.literal("brand_call")
    ),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_start", ["creatorId", "startMs"])
    .index("by_creator_and_idempotency", ["creatorId", "idempotencyKey"]),

  creatorMayaV0Intake: defineTable({
    creatorId: v.id("creators"),
    answers: v.any(),
    inferredSignals: v.any(),
    readback: v.any(),
    correctedReadback: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"]),

  creatorMayaV0CreatorPictures: defineTable({
    creatorId: v.id("creators"),
    stage: v.string(),
    goal: v.string(),
    niche: v.string(),
    audience: v.string(),
    voiceFingerprint: v.string(),
    contentPillars: v.array(v.string()),
    workingHooks: v.array(v.string()),
    weakHooks: v.array(v.string()),
    scheduleConstraints: v.array(v.string()),
    doNotSuggest: v.array(v.string()),
    confidence: v.number(),
    sourceCitations: v.array(v.any()),
    generatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"]),

  creatorMayaV0DailyBriefs: defineTable({
    creatorId: v.id("creators"),
    localDate: v.string(),
    shouldSend: v.boolean(),
    message: v.optional(v.string()),
    noSendReason: v.optional(v.string()),
    proposedWorkStartMs: v.optional(v.number()),
    proposedWorkEndMs: v.optional(v.number()),
    citations: v.array(v.any()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_date", ["creatorId", "localDate"])
    .index("by_creator_and_created", ["creatorId", "createdAt"]),

  creatorMayaV0ActionLog: defineTable({
    creatorId: v.id("creators"),
    action: v.string(),
    status: v.union(v.literal("ok"), v.literal("skipped"), v.literal("failed")),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_created", ["creatorId", "createdAt"]),

  creatorMayaV0OpenClawDeployments: defineTable({
    creatorId: v.id("creators"),
    mode: v.union(v.literal("mock"), v.literal("live_test"), v.literal("production")),
    status: v.union(
      v.literal("blocked"),
      v.literal("deployed"),
      v.literal("failed")
    ),
    deployLabel: v.optional(v.string()),
    flyAppId: v.optional(v.string()),
    machineId: v.optional(v.string()),
    blockers: v.optional(v.array(v.string())),
    workspaceFiles: v.optional(v.any()),
    // Activation pipeline state — set after the Fly machine boots and the
    // OpenClaw gateway reports ready. Tracks the first-text-sent → online
    // transition described in CREATOR_MAYA_GO_LIVE_CHECKLIST.md. Optional
    // because pre-bridge rows (and mock-mode rows) don't have it. The
    // matching mutations live in the operator's stashed in-flight work.
    activationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("activating"),
        v.literal("online"),
        v.literal("failed")
      )
    ),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_created", ["creatorId", "createdAt"]),

  creatorMayaV0BrandTargets: defineTable({
    creatorId: v.id("creators"),
    brandName: v.string(),
    category: v.string(),
    score: v.number(),
    reasons: v.array(v.string()),
    contactProvenance: v.optional(v.string()),
    status: v.union(
      v.literal("researched"),
      v.literal("queued"),
      v.literal("approved"),
      v.literal("sent"),
      v.literal("suppressed")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"]),

  creatorMayaV0MediaAssets: defineTable({
    creatorId: v.id("creators"),
    storageId: v.optional(v.id("_storage")),
    storageUrl: v.optional(v.string()),
    storageBytes: v.number(),
    mimeType: v.string(),
    mediaKind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("other")
    ),
    source: v.union(
      v.literal("imessage"),
      v.literal("web_upload"),
      v.literal("openclaw_attachment"),
      v.literal("rendered_variant"),
      v.literal("seedance_reference")
    ),
    sourceMessageId: v.optional(v.string()),
    sourceChannel: v.optional(v.string()),
    sourcePhoneNumber: v.optional(v.string()),
    filename: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    contentHash: v.string(),
    consent: v.object({
      usage: v.union(
        v.literal("unknown"),
        v.literal("approved_for_this_request"),
        v.literal("approved_for_reuse"),
        v.literal("rejected")
      ),
      requestedAt: v.optional(v.number()),
      approvedAt: v.optional(v.number()),
      text: v.optional(v.string()),
    }),
    catalog: v.object({
      primarySubject: v.string(),
      visualQuality: v.union(
        v.literal("unknown"),
        v.literal("poor"),
        v.literal("fair"),
        v.literal("good"),
        v.literal("excellent")
      ),
      creatorRelevance: v.string(),
      sceneSummary: v.optional(v.string()),
      styleNotes: v.optional(v.string()),
      safetyNotes: v.optional(v.string()),
      detectedText: v.optional(v.array(v.string())),
      transcript: v.optional(v.string()),
      retrievalTags: v.optional(v.array(v.string())),
      musicCue: v.optional(v.string()),
      suggestedUses: v.array(v.string()),
      captionDraft: v.optional(v.string()),
      catalogedAt: v.number(),
      catalogModel: v.string(),
      catalogCostUsd: v.number(),
      analysisVersion: v.optional(v.string()),
    }),
    derivedFromAssetIds: v.optional(v.array(v.id("creatorMayaV0MediaAssets"))),
    usageHistory: v.array(
      v.object({
        platform: v.union(
          v.literal("tiktok"),
          v.literal("instagram"),
          v.literal("youtube"),
          v.literal("other")
        ),
        postId: v.optional(v.string()),
        purpose: v.string(),
        usedAt: v.number(),
      })
    ),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_created", ["creatorId", "createdAt"])
    .index("by_creator_and_content_hash", ["creatorId", "contentHash"])
    .index("by_creator_and_source", ["creatorId", "source"]),

  creatorMayaV0EditRequests: defineTable({
    creatorId: v.id("creators"),
    sourceAssetIds: v.array(v.id("creatorMayaV0MediaAssets")),
    renderedAssetId: v.optional(v.id("creatorMayaV0MediaAssets")),
    requestText: v.string(),
    targetPlatform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("other")
    ),
    status: v.union(
      v.literal("drafting"),
      v.literal("queued_for_approval"),
      v.literal("rendering"),
      v.literal("rendered"),
      v.literal("ready_for_creator_draft"),
      v.literal("sent_to_creator"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("failed")
    ),
    editPlan: v.optional(v.any()),
    tiktokHandoff: v.optional(
      v.object({
        mode: v.union(
          v.literal("download_link"),
          v.literal("tiktok_inbox_upload")
        ),
        caption: v.string(),
        suggestedMusic: v.array(v.string()),
        instructions: v.string(),
        tiktokPublishId: v.optional(v.string()),
        status: v.union(
          v.literal("not_started"),
          v.literal("sent_to_tiktok_inbox"),
          v.literal("download_sent"),
          v.literal("creator_posted"),
          v.literal("failed")
        ),
        sentAt: v.optional(v.number()),
        failureReason: v.optional(v.string()),
      })
    ),
    approvalMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"])
    .index("by_creator_and_created", ["creatorId", "createdAt"]),

  // ─── Sprint B.2 — continuous-learning loop for editingFingerprint ─────
  //
  // Append-only audit-style observations of "what the creator actually
  // published" vs "what Maya rendered / what the rolling fingerprint
  // predicted." Sprint A.2 seeds the fingerprint at onboarding from the
  // last 30 posts; this table closes the loop — every shipped post
  // sharpens the fingerprint via `applyObservationsToFingerprint`.
  //
  // Schema decision (per Sprint B.2 spec): a NEW additive table rather
  // than extending `creatorPicture.editingFingerprint`. The fingerprint
  // remains the rolling synthesis (still mutated additively only); these
  // rows are append-only deltas that drive the next synthesis pass.
  //
  // Each row captures qualitative deltas (model-described, not
  // frame-accurate) for the specific axes the fingerprint covers. When a
  // rendered variant is linked, the diff is "published vs Maya's render";
  // otherwise it's "published vs current fingerprint."
  editingFingerprintObservations: defineTable({
    creatorId: v.id("creators"),
    /** Platform post id (e.g. TikTok video id). Idempotency key candidate. */
    publishedPostId: v.string(),
    /** Canonical URL — citation source for any narrative Maya later emits. */
    publishedPostUrl: v.string(),
    /**
     * The Maya-rendered variant this published post derived from. Optional —
     * sometimes the creator publishes without Maya's render (manual edits).
     * When set, deltas describe published-vs-rendered; when absent, deltas
     * describe published-vs-current-fingerprint.
     */
    renderedMediaAssetId: v.optional(v.id("creatorMayaV0MediaAssets")),
    observedAt: v.number(),
    /** Actual published duration in ms. */
    durationMs: v.number(),
    /**
     * Per-axis deltas vs the creator's current editingFingerprint (or vs the
     * Maya-rendered variant when one is linked). Each item names the field
     * and describes the observed-vs-expected difference qualitatively. Maya
     * synthesizes these via Gemini multimodal against the published video.
     */
    deltas: v.array(
      v.object({
        field: v.union(
          v.literal("pacing.avgCutEverySec"),
          v.literal("pacing.consistency"),
          v.literal("pacing.hookLandsAtMs"),
          v.literal("pacing.pacingCurve"),
          v.literal("opening"),
          v.literal("transitions"),
          v.literal("captions.style"),
          v.literal("captions.position"),
          v.literal("captions.cadence"),
          v.literal("captions.visualDescription"),
          v.literal("audio"),
          v.literal("framing"),
          v.literal("signatureMoves")
        ),
        /** Free-text: "0:11 setup beat" / "deadpan stare opener". */
        observed: v.string(),
        /** What the fingerprint or Maya's render had. */
        expected: v.string(),
        /** Model's one-sentence explanation. */
        reason: v.string(),
      })
    ),
    /**
     * Whether this observation has been folded into the rolling fingerprint.
     * Unset = unapplied; set to a ms timestamp once `applyObservationsToFingerprint`
     * folds the row into `creatorPicture.editingFingerprint`.
     */
    appliedToFingerprintAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_observedAt", ["creatorId", "observedAt"])
    .index("by_creator_and_published_post", [
      "creatorId",
      "publishedPostId",
    ]),

  // ────────────────────────────────────────────────────────────────────────
  // Sprint C.1 — Maya-authored Google Calendar events.
  //
  // Tracks the calendar events Maya proactively populates (taxonomy of 9
  // kinds — trend-strike / content-block / edit-block / post-publish /
  // niche-scroll / comment-window / brand-outbox / weekly-review /
  // brain-break). Sibling
  // to `creatorMayaV0CalendarEvents` (which tracks every observed event,
  // including external ones, for the read/classifier pipeline). This table
  // is narrower — Maya-authored only — and carries the rich-cited body
  // metadata + nudge fire stamps so heartbeat scans are cheap indexed
  // queries (no Google round-trip per tick).
  //
  // Cited refs are MANDATORY when `actionable=true` (a no-cite event
  // breaks Principle 3 "grounded or silent"). Body version + edit stamps
  // enable diff-on-rerender so Maya can rewrite an event when context
  // changes (e.g. trend cools, schedule shifts).
  // ────────────────────────────────────────────────────────────────────────
  mayaCalendarEvents: defineTable({
    creatorId: v.id("creators"),
    googleEventId: v.string(),
    kind: v.union(
      v.literal("trend-strike"),
      v.literal("content-block"),
      v.literal("post-publish"),
      v.literal("niche-scroll"),
      v.literal("comment-window"),
      v.literal("brand-outbox"),
      v.literal("weekly-review"),
      v.literal("brain-break"),
      v.literal("edit-block"),
    ),
    citedRefs: v.array(
      v.object({
        kind: v.union(
          v.literal("trend"),
          v.literal("post"),
          v.literal("peer"),
          v.literal("email"),
          v.literal("brand-deal"),
        ),
        ref: v.string(),
        label: v.string(),
      }),
    ),
    bodyVersion: v.number(),
    lastEditedByMaya: v.number(),
    lastEditedByCreator: v.optional(v.number()),
    actionable: v.boolean(),
    sourceStandingOrderId: v.optional(v.string()),
    // Denormalized timestamps so heartbeat scan is a cheap indexed query
    // (avoid round-tripping to Google API every tick).
    startTimeMs: v.number(),
    endTimeMs: v.number(),
    // Nudge fire stamps — one-ping-max enforcement.
    preEventNudgeSentAt: v.optional(v.number()),
    postEventCheckInSentAt: v.optional(v.number()),
    preEventNudgeWaiveReason: v.optional(v.string()),
    postEventCheckInWaiveReason: v.optional(v.string()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_start", ["creatorId", "startTimeMs"])
    .index("by_creator_and_google_event", ["creatorId", "googleEventId"]),

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

  businessMayaV0Intake: defineTable({
    businessId: v.id("businesses"),
    businessType: v.string(),
    offer: v.string(),
    targetCustomer: v.string(),
    market: v.optional(v.string()),
    topMarketingGoal: v.string(),
    channels: v.array(v.string()),
    phoneNumber: v.optional(v.string()),
    timezone: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_updated", ["businessId", "updatedAt"]),

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
    /**
     * CRITICAL: never auto-posted on GBP per Google ReviewReplyState moderation.
     *
     * Lifecycle: drafted → approved → posted | rejected | rejected-by-google
     *
     * `rejected-by-google` is a silent-failure mode added 2026-04-27. Zernio's
     * API surface does NOT pass through Google's `ReviewReplyState`
     * rejection signal — confirmed via the Zernio capability audit at
     * `docs/spikes/zernio-capability-audit.md`. So a reply can appear
     * "posted" via Zernio's success response while Google silently strips
     * it on moderation grounds (AI-flavored language, promotional content,
     * policy violations). The 24h passive verifier in
     * `convex/outcomes/reviewReplyVerifier.ts` re-fetches the review one
     * day after `posted` and flips this status to `rejected-by-google`
     * if the reply is no longer attached. Distinguishing this from
     * operator-issued `rejected` matters for telemetry and operator
     * surfacing (operator can see "Google moderation flagged this — try
     * different language" rather than thinking they rejected it).
     */
    replyStatus: v.optional(
      v.union(
        v.literal("drafted"),
        v.literal("approved"),
        v.literal("posted"),
        v.literal("rejected"),
        v.literal("rejected-by-google")
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
      // [DEPRECATED 2026-04-27 — never fires in v0]
      // Google Business Messages was sunset 2024-07-31. There is no
      // GBP messaging API for Zernio (or anyone) to surface as an
      // inbound-lead source. The enum value stays for additive-schema
      // safety; no code path inserts rows with this source. UI surfaces
      // that list lead sources should not show "GBP message" — see
      // docs/spikes/zernio-capability-audit.md.
      // Source: https://support.google.com/business/answer/14919056
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
    /**
     * Convex storage id (preferred backend in v0). Production paths populate
     * this on ingest via `ctx.storage.store()`. Fetch a URL on demand via
     * `ctx.storage.getUrl(storageId)` — returns a ~1h-valid URL the cataloger
     * (Gemini Files API) can fetch.
     *
     * R2 migration path (parked at `convex/integrations/r2/`): when egress
     * overage on Convex Pro exceeds ~$50/mo (around 200-300 ops scale), swap
     * the ingest layer to upload to R2 instead and populate `storageUrl`
     * with the R2 URL. The schema retains both fields so the migration is
     * a backend swap, not a schema change.
     */
    storageId: v.optional(v.id("_storage")),
    /**
     * Legacy R2 URL slot — populated only if a future R2 migration writes
     * here. v0 production paths leave this empty and use `storageId`. Tests
     * may pre-populate this directly to skip the storage round-trip.
     * At least one of `storageId` or `storageUrl` is always present (enforced
     * at the ingest mutation layer).
     */
    storageUrl: v.optional(v.string()),
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
    /**
     * Sprint 8 Slice B — UTC ms when the wiki-mirror sync last touched
     * this row. The extractor materializes patterns into the memory-wiki
     * vault under `concepts/what-works/<platform>/*` via `wiki_apply` and
     * stamps `mirroredAt` so HQ readers can distinguish a fresh wiki
     * round-trip from a legacy direct insert. `undefined` for rows
     * created before the slice landed; non-null after the extractor's
     * `wiki_apply` cycle for a given week completes.
     */
    mirroredAt: v.optional(v.number()),
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

  // ─── Growth product (Riley) — added 2026-04-28 on heymaya/growth-v0 ────
  // Single-user growth-agent product. One operator (Josh), one Riley
  // deployed to Fly. Tables here are ADDITIVE to the existing creator +
  // service tables; growth-agent creators carry `accountType: "growth-agent"`
  // (additive enum value alongside "creator" + "service-business").

  growthAgents: defineTable({
    /** Pointer back to the `creators` row that owns this agent. One per creator. */
    accountId: v.id("creators"),
    /** Operator-supplied product context — what Riley is building hype for. */
    productContext: v.optional(
      v.object({
        productName: v.string(),
        oneLiner: v.string(),
        targetAudience: v.string(),
        /** Optional URL — landing page, GitHub repo, etc. */
        primaryUrl: v.optional(v.string()),
        /** Free-form: what does Riley focus on? Themes, topics, angles. */
        focus: v.string(),
      })
    ),
    /**
     * Voice samples — pasted-in posts from the operator's existing
     * LinkedIn and X accounts. Riley uses these as ground truth for
     * voice-fitting.
     */
    voiceSamples: v.optional(
      v.object({
        linkedin: v.array(v.string()),
        twitter: v.array(v.string()),
      })
    ),
    /**
     * Composio connected-account ids for LinkedIn + X. Set when the
     * operator completes the Composio OAuth dashboard flow. We store
     * the (encrypted) ids here so the deploy can pass them as Fly
     * secrets. Mirror the `connectedAccounts` table's encryption shape:
     * `composioAccountId` is encrypted; `*Hash` is sha256 for lookup
     * uniqueness.
     */
    linkedinConnection: v.optional(
      v.object({
        composioAccountId: v.string(),
        composioAccountIdHash: v.string(),
        connectedAt: v.number(),
      })
    ),
    twitterConnection: v.optional(
      v.object({
        composioAccountId: v.string(),
        composioAccountIdHash: v.string(),
        connectedAt: v.number(),
      })
    ),
    /** Onboarding flow progress — which step the operator is on. */
    onboardingStep: v.union(
      v.literal("connect-linkedin"),
      v.literal("connect-twitter"),
      v.literal("product-context"),
      v.literal("voice-samples"),
      v.literal("deploy"),
      v.literal("complete")
    ),
    /** Per-operator Fly machine app id (parallel to creators.mayaFlyAppId). */
    rileyFlyAppId: v.optional(v.string()),
    /** Last successful deploy timestamp. */
    deployedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_fly_app", ["rileyFlyAppId"]),

  // Riley's drafted + published posts. Source-of-truth for the dashboard
  // "pending approval" + "published" surfaces.
  growthPosts: defineTable({
    accountId: v.id("creators"),
    platform: v.union(v.literal("linkedin"), v.literal("twitter")),
    status: v.union(
      v.literal("drafted"),
      v.literal("approved"),
      v.literal("published"),
      v.literal("rejected"),
      v.literal("failed")
    ),
    /** Riley's draft body. Per-platform char limits enforced on approve. */
    body: v.string(),
    /** Optional Brave-search citations + reasoning Riley used. */
    citations: v.optional(v.array(v.string())),
    reasoning: v.optional(v.string()),
    /** External post id once published (LinkedIn URN or X tweet id). */
    externalPostId: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    /** Operator's optional edit before approval — what we actually published. */
    finalBody: v.optional(v.string()),
    /** Engagement counts polled post-publish via Composio. */
    engagement: v.optional(
      v.object({
        likes: v.optional(v.number()),
        comments: v.optional(v.number()),
        impressions: v.optional(v.number()),
        lastRefreshedAt: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_status", ["accountId", "status"])
    .index("by_account_and_platform", ["accountId", "platform"]),

  // Sprint 12.3 — HeyMaya's own product waitlist. Distinct from
  // `growthWaitlist` (which is per-creator Riley signups for THEIR products).
  // This table is for emails captured on heymaya.com when LANDING_MODE=
  // waitlist (production, pre-launch creator product). De-duplicated by
  // lower-cased email; latest signup wins.
  mayaProductWaitlist: defineTable({
    email: v.string(),
    /** Optional name field if the form ever asks for it; unused in v0. */
    name: v.optional(v.string()),
    /** Free-form referrer / UTM source. "homepage" is the default. */
    source: v.string(),
    signedUpAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_signed_up", ["signedUpAt"]),

  // Waitlist signups Riley tracks for the operator's product. Provenance
  // tells the operator which post / outreach drove each signup.
  growthWaitlist: defineTable({
    accountId: v.id("creators"),
    email: v.string(),
    name: v.optional(v.string()),
    /** Where the signup came from. Free-form so future channels work. */
    source: v.string(),
    /** Optional pointer to the growthPosts row that drove this signup. */
    sourcePostId: v.optional(v.id("growthPosts")),
    notes: v.optional(v.string()),
    signedUpAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_signed_up", ["accountId", "signedUpAt"]),
  // ─── end Growth product (Riley) ────────────────────────────────────────

  // ─── Creator usage analytics — added 2026-05-04 ─────────────────────────
  // Per-creator usage event log. Single source of truth for "how creators
  // use Maya, what they use most, and whether they like it." Internal-only;
  // no public HTTP surface, no client-side queries — operator runs admin
  // queries via `npx convex run queries:admin:usage:*`.
  //
  // Cross-tenant isolation: every row carries `creatorId`; every query +
  // mutation that reads `usageEvents` filters by creatorId or scans by
  // (label, ts) / (kind, ts) for global rollups (which carry no creator
  // data leak risk because aggregates are by label/kind only).
  //
  // Idempotency: the helper inserts unconditionally — duplicate writes are
  // treated as separate events on purpose (a real retry IS a real second
  // attempt to deliver to the creator). Avoid double-firing at the call-site,
  // not in this helper.
  //
  // The 8 `kind` values encode the four flow directions:
  //   - cron_fired / event_fired       — Maya did something proactively
  //   - chat_turn_in / chat_turn_out   — message exchange
  //   - reaction_received / explicit_feedback — creator reacted to Maya
  //   - action_taken / action_ignored  — creator did/didn't act on a draft
  usageEvents: defineTable({
    creatorId: v.id("creators"),
    /**
     * What kind of interaction this was. See `convex/lib/usageEvents.ts`
     * for the directionality matrix (which kinds are creator-driven for
     * `lastEngagedAt` purposes).
     */
    kind: v.union(
      v.literal("cron_fired"),
      v.literal("event_fired"),
      v.literal("chat_turn_in"),
      v.literal("chat_turn_out"),
      v.literal("reaction_received"),
      v.literal("explicit_feedback"),
      v.literal("action_taken"),
      v.literal("action_ignored")
    ),
    /**
     * Skill/program/behavior label, e.g. "morning_brief",
     * "brand_email_triage", "trends_watcher", "content_arc_planner". For
     * chat turns the inferred topic from a small LLM classifier (or
     * "unclassified" if not classified yet — TODO(s7): wire the classifier).
     */
    label: v.optional(v.string()),
    /**
     * Sentiment / reaction signal. Polymorphic by `kind`:
     *   - reaction_received: "love" | "like" | "dislike" | "laugh" | "emphasize" | "question"
     *   - explicit_feedback: "approve" | "reject" | "ignore" | "stop"
     *   - action_taken / action_ignored: action type ("draft_posted", "reply_sent", ...)
     * Free-form string keeps the schema permissive while the catalog stabilizes.
     */
    signal: v.optional(v.string()),
    /** Free-form metadata: latency_ms, message_id, draft_id, etc. */
    meta: v.optional(v.any()),
    /** Unix ms when the event happened. Defaulted to Date.now() in the helper. */
    ts: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_ts", ["creatorId", "ts"])
    .index("by_kind_and_ts", ["kind", "ts"])
    .index("by_label_and_ts", ["label", "ts"])
    .index("by_creator_and_kind_and_ts", ["creatorId", "kind", "ts"]),
  // ─── end Creator usage analytics ────────────────────────────────────────

  // ─── Cron heartbeat — added 2026-05-06 (Wave 0b) ────────────────────────
  // Append-only audit log proving OpenClaw cron actually fires for a given
  // creator. Written via the `lc_maya/cron_heartbeat` HTTP endpoint that
  // Maya can hit from a `cron.heartbeat` standing order. Read by:
  //   - the real-OpenClaw smoke harness (waits 90s, expects ≥1 row)
  //   - the operator at `npx convex run admin:cronHeartbeats:latest`
  //
  // Cross-tenant isolation: every row carries `creatorId`. The HTTP
  // endpoint validates the shared webhook secret + binds the row to the
  // exact creatorId in the body — Maya cannot write a heartbeat for
  // another creator's machine.
  //
  // NOT a re-implementation of cron — OpenClaw still owns the scheduler.
  // This table only records that we OBSERVED a fire, so we can prove
  // end-to-end liveness from the smoke test side.
  cronHeartbeat: defineTable({
    creatorId: v.id("creators"),
    /** Standing-order id ("morning_brief", "smoke_minute_heartbeat", …). */
    jobName: v.string(),
    /** Unix ms when OpenClaw fired the cron entry. Set client-side. */
    firedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_firedAt", ["creatorId", "firedAt"])
    .index("by_jobName_and_firedAt", ["jobName", "firedAt"]),
  // ─── end Cron heartbeat ─────────────────────────────────────────────────

  // ─── Sprint 7 Slice B — iMessage-tap OAuth state tokens ─────────────────
  // Single-use, short-TTL (15 min) handoff tokens for the iMessage Calendar
  // OAuth flow. Maya texts a creator a connect link; the operator taps it on
  // their phone — there's no Clerk session in that browser. The state token
  // is the only way the callback re-resolves which creator just authorized.
  //
  // Cleanup: lazy on lookup (the callback deletes the row after consuming
  // it; expired rows are filtered out and rejected). No background cron is
  // needed — the table churns at the rate of human OAuth taps, which is
  // tiny. If volume ever forces it, a daily sweep mutation can be added.
  oauthStateTokens: defineTable({
    /** Random UUID — unguessable handoff identifier. */
    stateToken: v.string(),
    creatorId: v.id("creators"),
    /**
     * Which OAuth flow this token belongs to. Today only `google_calendar`
     * needs this surface (the iMessage path was greenlit in Sprint 6 for
     * Calendar; Gmail/etc. use Composio's hosted callback). Keeping the
     * field as a literal-union makes future providers explicit.
     */
    provider: v.union(v.literal("google_calendar")),
    /** Unix ms — issued time. */
    createdAtMs: v.number(),
    /**
     * Unix ms — `createdAtMs + ttlMs`. The callback rejects rows where
     * `Date.now() > expiresAtMs`. Stored materialized so the lookup query
     * doesn't need to read TTL config.
     */
    expiresAtMs: v.number(),
  })
    .index("by_state_token", ["stateToken"])
    .index("by_creator", ["creatorId"]),
  // ─── end OAuth state tokens ─────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 7 Slice D — Day 1 first-proactive-ping queue.
  //
  // After `creators.pictureLockedAt` is stamped (Sprint 6's verification
  // gate), `firePictureLockedEvent` schedules a +15-30min Convex action that
  // composes the Day 1 first-touch content (1 cited trend + 1 grounded idea
  // + Gmail/Calendar connect offers) and writes a row into this table for
  // Maya the agent to pick up on her next heartbeat. Convex doesn't talk to
  // claw-messenger directly — the agent runtime does — so the bridge is this
  // queue table + Maya's standing-order entry pointing at it.
  //
  // Idempotency: `creators.firstProactivePingSentAt` is the cursor; the row
  // here is a write-once artifact. A second-fire on a re-stamped
  // `pictureLockedAt` is a silent no-op.
  //
  // Status semantics:
  //   - "queued"  — composer ran, content ready, agent has not yet sent.
  //   - "sent"    — agent read the row and pushed to creator's primary
  //                 channel. Stamps `firstProactivePingSentAt` on creators
  //                 row at the same time.
  //   - "skipped" — composer ran but BOTH trend + idea were empty. Per
  //                 Slice D's locked precedence rule: silent no-op > bad
  //                 first impression. Stamps `firstProactivePingSentAt` so
  //                 the event doesn't re-fire on the next heartbeat.
  // ────────────────────────────────────────────────────────────────────────
  firstProactivePings: defineTable({
    creatorId: v.id("creators"),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("skipped")
    ),
    /**
     * Composed iMessage body. Empty string when status === "skipped".
     */
    body: v.string(),
    /**
     * Provenance for the citation firewall + sibling-file scan. The empty
     * field shape is preserved (rather than dropping the prop) so test
     * assertions against the row shape are stable.
     */
    citations: v.object({
      trendRef: v.optional(v.string()),
      ideaPostIds: v.array(v.string()),
    }),
    /**
     * Empty-input precedence trace. One of:
     *   - "trend+idea" — both present, full ping.
     *   - "trend-only" — idea generator was empty.
     *   - "idea-only"  — trend watcher was empty.
     *   - "skip-empty" — both empty; status === "skipped".
     */
    precedence: v.union(
      v.literal("trend+idea"),
      v.literal("trend-only"),
      v.literal("idea-only"),
      v.literal("skip-empty")
    ),
    composedAt: v.number(),
    /** Set when status flips to "sent". */
    sentAt: v.optional(v.number()),
    /**
     * Convex scheduler id of the composer action. Captured at schedule time
     * by `firePictureLockedEvent` so tests + ops can confirm the 15-30 min
     * jitter actually applied.
     */
    scheduledFireAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_status", ["creatorId", "status"]),

  // ─── ClawLaunch / Maya GTM product — added 2026-05-22 ────────────────
  //
  // GTM Maya is a separate product namespace inside the shared platform repo.
  // These tables intentionally do not reuse creator/service/Riley domain
  // tables. Shared infra (auth, connectedAccounts, aiCallLog,
  // scrapeCreatorsCache, Fly/OpenClaw deploy) is reused through adapters.
  gtmAgents: defineTable({
    accountId: v.id("creators"),
    appId: v.optional(v.id("gtmApps")),
    onboardingStep: v.union(
      v.literal("intake"),
      v.literal("connect-calendar"),
      v.literal("connect-channel"),
      v.literal("researching"),
      v.literal("plan-review"),
      v.literal("active")
    ),
    channelPreference: v.union(
      v.literal("whatsapp"),
      v.literal("imessage"),
      v.literal("web"),
      v.literal("telegram")
    ),
    timezone: v.string(),
    // Verification/test-only flag. When true, the generated workspace carries a
    // labeled "exercise ALL platforms" directive (overrides the normal focus
    // rule) so a dogfood deploy exercises every platform's research + tools +
    // video-watch end-to-end. NOT product behavior — real agents stay focused.
    verifyAllPlatforms: v.optional(v.boolean()),
    openClawFlyAppId: v.optional(v.string()),
    deployedAt: v.optional(v.number()),
    // Sprint 15 (D1) — Telegram is the default ClawLaunch channel because
    // WhatsApp is QR-only and iMessage requires a macOS host. Populated by
    // claimPairingToken when the user taps the deep link in onboarding.
    telegramChatId: v.optional(v.string()),
    telegramUsername: v.optional(v.string()),
    telegramPairedAt: v.optional(v.number()),
    // Sprint 2.26 — per-operator Telegram bot. Multi-tenant architecture:
    // each operator creates their own bot via BotFather, pastes the token
    // here during onboarding. Bot is wired to THEIR Fly machine's
    // /telegram-webhook URL. Without this, every Maya shares a single
    // bot (testing convenience only — hard pre-launch blocker for prod).
    //   telegramBotToken: encrypted (lib/encryption.encrypt) — NEVER store
    //     plaintext. Decrypt at deploy time when setting as Fly secret.
    //   telegramBotUsername: the @handle of the bot (e.g. "mayagtm_jsmith_bot")
    //     used for the pairing deep link https://t.me/<username>?start=pair_<token>
    //   telegramBotIdentityCheckedAt: unix ms of last getMe() validation —
    //     so we can detect revoked tokens before deploy.
    telegramBotToken: v.optional(v.string()),
    telegramBotUsername: v.optional(v.string()),
    telegramBotIdentityCheckedAt: v.optional(v.number()),
    // Sprint 16 — hook bridge auth token (per-agent shared secret used by
    // Convex actions when POSTing to the Fly machine's /hooks/agent and
    // /hooks/wake endpoints, and by the machine when calling back into
    // /lc_gtm/* HTTP actions). Provisioned at deploy.
    hookToken: v.optional(v.string()),
    // Sprint 2.14a.6 — trace whether the Sprint 2.11 deploy-time hello
    // actually fired. Live 2026-05-25 deploy showed diagnostic ping
    // landing fine but the deploy-time hello did NOT. Without these
    // fields we have no way to tell whether the code path was reached,
    // failed firewall, hit Telegram API error, etc. Populated by
    // deployMayaGtm.ts immediately after sendDirectTelegramMessage.
    deployTimeHelloAttemptedAt: v.optional(v.number()),
    deployTimeHelloResult: v.optional(v.string()), // "sent" | "firewall_blocked" | "missing_credentials" | "telegram_<status>" | "exception:<msg>"
    deployTimeHelloMessageId: v.optional(v.number()),
    // Slideshow cluster — Maya's per-agent media library, stored as a JSON
    // string (NOT a dedicated table or a typed array field). This is a
    // DELIBERATE encoding choice: the schema sits exactly at TypeScript's
    // DataModel instantiation ceiling, so adding a 139th table (or a richly-
    // typed array field) regresses `db.get()` narrowing project-wide. A plain
    // string adds zero type complexity. The value is a JSON array of
    // GtmMediaEntry objects (see convex/gtmMaya/mediaAssets.ts):
    //   { storageId, kind, source, mimeType, storageBytes, label?, sha256?,
    //     referenceStorageIds?, meta?, archivedAt?, createdAt }
    // Each entry's identity is its Convex storageId. Per-agent the library is
    // small (dozens of screenshots + generated slides), always loaded with the
    // agent row, and search/dedupe run in JS over the parsed array.
    mediaLibraryJson: v.optional(v.string()),
    // Studio-tier video jobs (Creatify). JSON-on-row (NO new table — schema is
    // at the TS DataModel ceiling). JSON array of in-flight + finished jobs:
    //   { jobId, mode('ad_clone'|'url_to_video'), creatifyId, status, attempts,
    //     mediaStorageId?, creditsUsed?, costUsd?, refUrl?, productUrl?,
    //     failedReason?, createdAt, updatedAt }
    // The durable poll loop (creatifyVideo.pollVideoJob) reads/patches it; the
    // finished video also lands in mediaLibraryJson as a kind:"video" entry.
    creatifyJobsJson: v.optional(v.string()),
    // Ideal-product pillar 1 (VOICE) — the founder's voice fingerprint, built
    // at onboarding by pulling their own accounts (watch media + read text).
    // JSON string (same JSON-on-row pattern as mediaLibraryJson — NO new table,
    // schema is at the table-count ceiling). Shape: { builtAt, sources[],
    // features{avgSentenceLen,burstiness,contractionUse,emojiFreq,register,
    // openings[],signoffs[],characteristicPhrases[],emDashHabit}, perPlatform,
    // verbatimSamples[], confidence:'high'|'medium'|'low'|'none' }.
    voiceProfileJson: v.optional(v.string()),
    // Pillar 4 (WARMUP, generalized to all 6 channels) — per-channel warmth map
    // the daily/weekly crons read + advance. JSON string keyed by channel:
    // { reddit:{state,accountAgeDays,baseline,warmTargetMs,lastUpdatedMs}, ... }.
    // state reuses tiktokWarmupState values + 'warm'; (warm|ready) = skip warmup.
    // tiktokWarmupState stays as a back-compat alias mirrored into .tiktok.
    channelWarmthJson: v.optional(v.string()),
    // ─── Maya v2 Zernio auto-post (additive, JSON-on-row — schema is at the TS
    //     DataModel ceiling, so NO new tables) ────────────────────────────────
    // The founder's Zernio profile id (created at first connect). All Zernio
    // calls for this agent are scoped to it for cross-tenant isolation.
    zernioProfileId: v.optional(v.string()),
    // Registered webhook id + its signing secret (encrypted via lib/encryption,
    // exactly like telegramBotToken — NEVER store plaintext).
    zernioWebhookId: v.optional(v.string()),
    zernioWebhookSecret: v.optional(v.string()),
    // JSON array of connected accounts:
    // [{accountId, platform, username, displayName, isActive, needsReconnect,
    //   connectedAt}]. Maya reads this to know which channels are live
    // (auto-post) vs which need a reconnect (deep-link fallback).
    connectedAccountsJson: v.optional(v.string()),
    // Sprint 5 — experiment registry (JSON-on-row, NO new table). JSON array of
    // {id, hypothesis, dimension, arms:[label], metric, status('running'|'concluded'),
    // createdAt, verdict?}. save_experiment appends; assign_arm reads to allocate;
    // the weekly review concludes. ≤2 'running' dimensions enforced at write.
    experimentsJson: v.optional(v.string()),
    // Sprint 6 — strategic-diagnosis state (JSON-on-row, NO new table). JSON:
    // { current?: {category, tier, reason, observedAt, weeksPersisted},
    //   history:[{category,tier,observedAt}], lastHardTruthPingAt?,
    //   lastPmfSurveyAt?, lastPricingTestAt? }. Drives the ≥2-week-persistence +
    //   throttled hard-truth ping and the survey-proposal throttles.
    strategicDiagnosisJson: v.optional(v.string()),
    // Sprint 7 — real-time intent-strike watchlist (JSON-on-row, NO new table).
    // JSON: { phrases:[string], channels:[string], dailyStrikeBudget:number,
    //   strikesToday:number, strikeDayStamp:string(YYYY-MM-DD), seenThreadIds:[string],
    //   lastPolledAt?:number }. Compiled from gtmBuyerMap.intentPhrases + bet
    //   channels. The Convex-owned poller reads it; the dedup + budget live here.
    intentWatchJson: v.optional(v.string()),
    // Single-tier plan state (gtm99). JSON: {tier, status, connectedChannelCap,
    // autoPostChannelCap, videoCreditsMonth, xUrlPostsSoftCapMonth, periodStart,
    // usage:{autoPostsThisPeriod, xUrlPostsThisPeriod, videosThisPeriod}}.
    // Parsed by planFeaturesGtm; ONLY Stripe webhook handlers write it.
    gtmPlanJson: v.optional(v.string()),
    // Off-by-default toggle: also mirror the day's plan to Google Calendar.
    // The Google flood retired; the web Today view is the primary surface.
    googleCalendarMirrorEnabled: v.optional(v.boolean()),
    // ─── Maya v2 (#15) DURABLE agent lifecycle state ────────────────────────
    // The agent's lifecycle markers MUST live in Convex, not in MEMORY.md.
    // MEMORY.md is a file on the EPHEMERAL Fly machine — wiped on every
    // redeploy/restart (bootstrap re-extracts the bundle tar over /data) — so
    // markers stored there vanish, and the 5-min foundation watchdog re-ran the
    // WHOLE onboarding pipeline forever (the live "re-doing loop": 42 drafts,
    // 9 day-1 events, fabricated multi-day history). These scalar fields are the
    // durable source of truth; the agent reads them via `get_agent_lifecycle`
    // and gates BOOT/HEARTBEAT on them instead of MEMORY.md (scratchpad only).
    //   helloSentAt — first intro fired (idempotency for the boot + safety-net).
    //   foundationStartedAt / foundationCompletedAt — onboarding pass bounds.
    //   lastMorningBriefAt — last 7am brief, for missed-cadence recovery.
    //   foundationLeaseUntil — a check-and-set lease (acquireFoundationLease) so
    //     only ONE heartbeat/machine runs the foundation pass at a time.
    helloSentAt: v.optional(v.number()),
    foundationStartedAt: v.optional(v.number()),
    foundationCompletedAt: v.optional(v.number()),
    // Unix-ms the synthesis/strategy plan was actually DELIVERED to the founder
    // (stamped server-side when a strategic send_update succeeds). onboarding is
    // NOT complete until this is set — the live dogfood marked foundation_complete
    // and went idle WITHOUT ever sending the plan ("she never sent me the plan").
    // markFoundationComplete refuses, and the rows-complete backstop also requires
    // this, so completion can never happen on an undelivered plan.
    strategyDeliveredAt: v.optional(v.number()),
    lastMorningBriefAt: v.optional(v.number()),
    // Liveness/dark-day watchdog dedup. Stamped when the liveness sweep alerts
    // the operator that a live agent went silent (stale morning brief) or blind
    // (zero operational spend while alive past onboarding) — so we alert once per
    // dedup window, not every sweep. See convex/gtmMaya/livenessWatch.ts.
    livenessAlertedAt: v.optional(v.number()),
    foundationLeaseUntil: v.optional(v.number()),
    // How many times the foundation lease has been acquired. The watchdog
    // re-acquires it each tick to resume the pass — but a weak brain that never
    // finishes would re-run (and re-spawn the whole research fleet) forever
    // (observed live: 283 subagent sessions on one onboarding). This is the HARD
    // server-side cap: past FOUNDATION_MAX_LEASE_ACQUIRES with foundation still
    // incomplete, the lease is DENIED so the agent physically cannot re-run it.
    foundationLeaseAcquireCount: v.optional(v.number()),
    // ─── Hard spend kill-switch (runaway-burn backstop) ─────────────────────
    // The throttle caps in costCap.ts (hour/day/month) assume the agent honors
    // a 403 and stops. A runaway loop (observed: an old-model agent burned
    // ~$30 in 7h) does NOT. These fields back a HARD kill: when ROLLING-window
    // spend crosses a ceiling ($3/hr velocity OR $6/24h sustained, defaults in
    // spendKill.ts, env-overridable), the agent's Fly machine is DESTROYED
    // (billing physically stops), its hookToken rotated, and these stamped.
    // Rolling windows (not lifetime) so a long-lived daily driver under normal
    // ~$2/day spend is never killed — only a runaway trips it.
    //   spendKillCapUsd — OPTIONAL per-agent override of the 24h kill ceiling,
    //     for one-off watched tests that want a tighter bound than the default.
    //   killedAt / killReason — stamped when the kill fires; a killed agent is
    //     skipped by the sweep + telemetry enforcer (idempotent).
    spendKillCapUsd: v.optional(v.number()),
    killedAt: v.optional(v.number()),
    killReason: v.optional(v.string()),
    // Deterministic synthesis safety-net (#1 onboarding deliverable). The plan
    // ("who buys / where I post / what to post / connect ask") is normally
    // composed + sent by the agent's LLM. When that turn flakes and the user
    // never gets a plan, a Convex watchdog assembles it from stored research
    // and sends it directly. Stamped when the watchdog fires (idempotency +
    // observability); the happy path never sets it. See
    // convex/gtmMaya/synthesisDelivery.ts.
    synthesisSafetyNetFiredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_app", ["appId"])
    .index("by_fly_app", ["openClawFlyAppId"])
    .index("by_telegram_chat", ["telegramChatId"])
    // Zernio webhook routing: a single shared Zernio account fans `account.*`
    // deliveries through one endpoint; we resolve the owning agent by the
    // per-agent Zernio profile id carried in the payload.
    .index("by_zernio_profile", ["zernioProfileId"]),

  // Sprint 15 — short-lived single-use Telegram pairing tokens. Generated
  // when the user clicks "Open Maya in Telegram" in onboarding; consumed
  // by the bot when they tap the deep link. Atomic claim semantics: claim
  // sets `claimedAt` + `chatId` and any subsequent claim attempt for the
  // same token throws (one-to-one binding).
  gtmTelegramPairingTokens: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    token: v.string(),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    claimedChatId: v.optional(v.string()),
    claimedUsername: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"]),

  // Sprint 9 — GTM-account-scoped Google Calendar connection. Mirrors
  // creatorMayaV0CalendarConnections (same encryption + refresh pattern)
  // but indexed by gtmAgents.accountId. One row per GTM account (1:1
  // with creators where accountType="gtm-agent"). Tokens encrypted via
  // convex/lib/encryption (AES-256-GCM, ENCRYPTION_KEY env).
  gtmCalendarConnections: defineTable({
    accountId: v.id("creators"),
    provider: v.literal("google"),
    externalAccountId: v.optional(v.string()),
    oauthAccessToken: v.optional(v.string()),   // encrypted base64(iv||ciphertext+tag)
    oauthRefreshToken: v.optional(v.string()),  // encrypted
    oauthExpiresAt: v.optional(v.number()),
    oauthTokenType: v.optional(v.string()),
    oauthScope: v.optional(v.string()),
    timezone: v.string(),
    scopes: v.array(v.string()),
    connectedAt: v.number(),
    lastSyncedAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired")
    ),
  })
    .index("by_account", ["accountId"]),

  // Sprint 9 — Maya-owned calendar events written by /lc_gtm/
  // calendar_proposal. Tagged with createdBy="maya" so updates/deletes
  // never accidentally touch the user's other calendar entries.
  gtmCalendarEvents: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    // Sprint 2.22 — providerEventId now OPTIONAL. Draft events (status
    // "draft") are stored before Google Calendar push, so they don't
    // have a Google event id yet. After operator approval, the push
    // succeeds and providerEventId is filled + status flips to
    // "scheduled".
    providerEventId: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    startsAtMs: v.number(),
    endsAtMs: v.number(),
    timezone: v.optional(v.string()),
    // Sprint 1.2 — typed event kind so the heartbeat calendar-due task
    // can distinguish a "warm up your TikTok account by scrolling for 20
    // min" from a "post your hero draft" event. Optional for backwards
    // compat with rows created before this enum existed; new writes
    // should always set it.
    kind: v.optional(
      v.union(
        v.literal("warmup_block"),
        v.literal("engagement_block"),
        v.literal("soft_launch_post"),
        v.literal("hard_launch_anchor"),
        v.literal("reply_window"),
        v.literal("weekly_review"),
        v.literal("first_50_dms")
      )
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("completed"),
      v.literal("cancelled"),
      // Maya v2 auto-post lifecycle (additive). 'queued' = Maya's internal
      // scheduled, NOT on any external calendar (distinct from 'scheduled'
      // which kept its Google-mirror meaning). 'published' is set ONLY by the
      // 24h confirmEventLanded re-poll, never off the optimistic POST 200.
      // 'needs_confirm' = Reddit/TikTok awaiting the founder's one-tap.
      v.literal("queued"),
      v.literal("posting"),
      v.literal("published"),
      v.literal("failed"),
      v.literal("needs_confirm")
    ),
    createdBy: v.literal("maya"),
    // ─── Evidence-vault fields — additive, optional for back-compat ─────
    // Explicit citation of the cards that justified scheduling this event.
    evidenceCardIds: v.optional(v.array(v.id("gtmEvidenceCards"))),
    // What success looks like for this task (e.g., "5 replies, 1 DM").
    successMetric: v.optional(v.string()),
    // ─── end evidence-vault fields ──────────────────────────────────────
    // Turn-key payload (pillar 4) — so the founder just taps and posts. openUrl
    // = the one-click deep link (the thread/composer/submit URL); draftText =
    // the verbatim copy-paste reply/post in the founder's voice; sourceNote =
    // the cited "why this / where it came from". successMetric above carries the
    // target. Additive/optional for back-compat.
    openUrl: v.optional(v.string()),
    draftText: v.optional(v.string()),
    sourceNote: v.optional(v.string()),
    // Maya v2 auto-post execution state (JSON-on-row, no new table):
    // {channel, zernioAccountId, zernioPostId, mode:'auto'|'manual_confirm',
    //  scheduledForIso, publishConfirmedAt, platformPostUrl, lastError}.
    // providerEventId stays Google-only; zernioPostId lives here. The 24h
    // re-poll iterates by_agent + status, so no Zernio-id index is needed.
    autoPostJson: v.optional(v.string()),
    // #15 idempotency — stable dedupe identity so a re-run of the foundation /
    // morning pass UPSERTS instead of appending duplicate events (the live
    // deploy produced 9 day-1 events from watchdog re-entry). Optional for
    // back-compat; when set, persistGtmCalendarEventDraft returns the existing
    // row for (agentId, dedupeKey) instead of inserting a second. Stable keys:
    // "day1_first_move" for the single onboarding move; "<channel>:<isoDay>:<threadId>"
    // for a daily event tied to a thread.
    dedupeKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_provider_event", ["providerEventId"])
    .index("by_agent_dedupe", ["agentId", "dedupeKey"]),

  // Sprint 19 — audit log of workspace mutations. Each row records a
  // re-generation of APP.md / GTM.md / MEMORY.md content driven by a
  // research-job completion or weekly-review trigger. The actual Fly
  // push happens on operator-triggered redeploy (the workspace bundle
  // generator reads from gtmResearchJobs + gtmChannelScores to produce
  // the new content); this table is the audit trail + change log.
  gtmWorkspaceMutations: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    triggeredBy: v.union(
      v.literal("research_complete"),
      v.literal("weekly_review"),
      v.literal("operator_manual"),
      v.literal("memory_append")
    ),
    sourceResearchJobId: v.optional(v.id("gtmResearchJobs")),
    /** Newline-delimited list of file paths that changed (e.g. "APP.md"). */
    changedFiles: v.array(v.string()),
    /** Short human-readable diff summary. */
    summary: v.string(),
    /** Pre-mutation backup blob — stored compressed by serializing the
     *  pre-state of all changed files. Used for rollback within 7 days. */
    backupBlobJson: v.optional(v.string()),
    /** Whether the agent's Fly machine has actually been re-deployed
     *  with this content. operator-triggered redeploy flips this true. */
    deployed: v.boolean(),
    /** ms timestamp of operator-triggered redeploy. null until pushed. */
    deployedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_research_job", ["sourceResearchJobId"]),

  // Sprint 9 — single-use Google OAuth state tokens for the GTM flow.
  // 15-min TTL, atomic claim by the callback. Separate from
  // oauthStateTokens (creator-side) so a leak doesn't cross-tenant.
  gtmOauthStateTokens: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    token: v.string(),
    // 'zernio' added for the Maya v2 social-connect flow (signed-state binding
    // so a public callback can never bind one founder's account to another).
    provider: v.union(v.literal("google"), v.literal("zernio")),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_account", ["accountId"]),

  // Sprint 16 — idempotency + audit log for Maya → Convex callbacks.
  // Every callback (research/approval/calendar) includes an idempotency
  // key the agent mints per logical op. Convex stamps it here on first
  // receipt; subsequent posts with the same key short-circuit to "ok
  // (replay)". Cross-tenant isolation: token-authenticated agentId must
  // match this row's agentId.
  gtmHookCallbacks: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: v.union(
      v.literal("research_callback"),
      v.literal("approval_decision"),
      v.literal("calendar_proposal"),
      // Sprint 2.22 — operator-approved Google Calendar push.
      v.literal("calendar_approval"),
      // Sprint 2.2 — deep-research subagents POST these callback kinds
      // when they surface target-list artifacts (threads / accounts /
      // drafts). Inbound HTTP handler in convex/gtmMaya/openclaw/
      // inboundCallback.ts routes on this enum.
      v.literal("target_thread"),
      v.literal("target_account"),
      v.literal("drafted_content"),
      // Sprint 2.17 Phase A — manager-mode callbacks. Each new write
      // surface gets its own kind so idempotency keys are scoped
      // per-endpoint. Handlers live in managerCallbacks.ts.
      v.literal("foundation_buyer_map"),
      v.literal("foundation_competitor"),
      v.literal("foundation_channel_scorecard"),
      v.literal("foundation_content_angle"),
      v.literal("foundation_relationship_target"),
      v.literal("competitor_move"),
      v.literal("niche_pulse_signal"),
      v.literal("action_logged"),
      v.literal("learning_extracted"),
      // Sprint 2.29 — Maya posts here after writing to memory/YYYY-MM-DD.md
      // or DREAMS.md on Fly disk, so the operator UI can ledger writes.
      v.literal("memory_written"),
      // Sprint B — Maya persists the proposed/approved North Star + entry mode.
      v.literal("set_north_star"),
      // Sprint B — Maya records the strategy approval state.
      v.literal("set_strategy_approval"),
      // Sprint C — conversion (signup/demo/feedback) self-report or pixel.
      v.literal("record_conversion"),
      // Sprint J — proposed improvement to a shared skill (Layer 2, governed).
      v.literal("propose_skill_improvement"),
      // Mission Control — agent activity feed entry.
      v.literal("post_activity"),
      // Data-collection sprint — inbound user message capture. Maya's
      // runtime POSTs one row per inbound user turn so the conversation
      // transcript persists to Convex (not just the ephemeral Fly disk).
      v.literal("log_message")
    ),
    idempotencyKey: v.string(),
    receivedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_idempotency_key", ["idempotencyKey"]),

  // Sprint 14 — OpenClaw POSTs here when a cron job's announce delivery
  // fails (channel unavailable, recipient blocked the bot, etc.). Mission
  // board surfaces these so failures don't vanish into the gateway log.
  gtmDeliveryFailures: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    cronJobId: v.string(),
    channel: v.string(),
    recipient: v.string(),
    errorClass: v.string(),
    errorMessage: v.optional(v.string()),
    attemptCount: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    retryAfterMs: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_cron_job", ["agentId", "cronJobId"]),

  gtmApps: defineTable({
    accountId: v.id("creators"),
    name: v.optional(v.string()),
    url: v.string(),
    founderWhy: v.optional(v.string()),
    // Founder's own "what it does + what's different" — the differentiator,
    // captured at onboarding so Maya never guesses it (renders into APP.md).
    differentiator: v.optional(v.string()),
    stage: v.union(
      v.literal("idea"),
      v.literal("live-beta"),
      v.literal("paid"),
      v.literal("unknown")
    ),
    weekGoal: v.union(
      v.literal("feedback"),
      v.literal("signups"),
      v.literal("demos"),
      v.literal("revenue"),
      v.literal("unknown")
    ),
    // Ground-truth traction band — keys Maya's stage-adaptive strategy
    // (pre-launch earns authority first; traction pushes the product).
    // Optional for back-compat with rows created before this field.
    userCountBand: v.optional(
      v.union(
        v.literal("none"),
        v.literal("1-100"),
        v.literal("100-1k"),
        v.literal("1k+"),
        v.literal("unknown")
      )
    ),
    canRecordScreen: v.boolean(),
    canShowFace: v.boolean(),
    canRecordVoice: v.optional(v.boolean()),
    canProvideScreenshots: v.optional(v.boolean()),
    canPostTikTokManually: v.optional(v.boolean()),
    canPostInstagramManually: v.optional(v.boolean()),
    existingTikTokUrl: v.optional(v.string()),
    existingInstagramUrl: v.optional(v.string()),
    existingYoutubeUrl: v.optional(v.string()),
    existingLinkedinUrl: v.optional(v.string()),
    // W4 — X (Twitter) handle for Phase-0 voice grounding (a primary channel).
    existingXUrl: v.optional(v.string()),
    tiktokWarmupState: v.optional(
      v.union(
        v.literal("unknown"),
        v.literal("new_needs_warmup"),
        v.literal("warming"),
        v.literal("ready"),
        v.literal("restricted")
      )
    ),
    tiktokAccountAgeDays: v.optional(v.number()),
    tiktokAccountStatusChecked: v.optional(v.boolean()),
    openToUgcCreators: v.optional(v.boolean()),
    creatorBudgetMonthlyUsd: v.optional(v.number()),
    maxWeeklyVisualPosts: v.optional(v.number()),
    excludedAudiences: v.array(v.string()),
    // Sprint B — journey-stage fork. "launch" = pre-launch, run the full
    // GTM arc (warmup→launch→compound). "manager" = already-launched, skip
    // launch theater, ingest existing accounts, open straight into the
    // ongoing daily engine. Optional for back-compat; resolved at onboarding
    // from `stage` + whether ingested accounts show real audience/history.
    entryMode: v.optional(
      v.union(v.literal("launch"), v.literal("manager"))
    ),
    // Sprint B — North Star contract. The one tracked outcome, adaptive to
    // entryMode (launch: "100 signups by Day 30"; manager: a growth/cadence
    // target). Maya proposes it at synthesis; operator approves. Metric is a
    // free string (Maya-proposed, e.g. "signups", "signups/week", "waitlist").
    northStarMetric: v.optional(v.string()),
    northStarTarget: v.optional(v.number()),
    northStarDeadlineMs: v.optional(v.number()),
    // Sprint G — app archetype (Maya proposes at synthesis; free string, e.g.
    // "dev-tool", "consumer-mobile", "b2b-saas", "creator-tool"). Cheap to
    // capture at MVP; it's the index for the cross-tenant data moat — the
    // per-archetype outcome-grounded playbook that warm-starts new customers.
    archetype: v.optional(v.string()),
    // Slideshow cluster — web-vs-mobile fork captured at onboarding. Mobile
    // apps live in an App Store / Play listing (screenshots are the asset
    // Maya grounds slideshows in); web apps have only a site URL. Optional
    // for back-compat with rows created before the toggle existed; absent =
    // "web" (the historical default, since `url` was always a site URL).
    appType: v.optional(v.union(v.literal("web"), v.literal("mobile"))),
    appStoreUrl: v.optional(v.string()),
    playStoreUrl: v.optional(v.string()),
    // Conversion instrumentation — closes the attribution loop on the SIGNUP
    // side (clicks are already 100% ours). conversionKind = what counts as a
    // win for this founder (free string, e.g. "signup"/"install"/"waitlist"/
    // "demo"); signupUrl = where a conversion lands (Maya wraps links to it by
    // default so clicks→signups can join); conversionPixelInstalledAt is set
    // the first time a `source:"pixel"` conversion arrives (so Maya knows the
    // automatic path is live and can stop asking for self-reports). All
    // optional for back-compat with rows created before the loop existed.
    conversionKind: v.optional(v.string()),
    signupUrl: v.optional(v.string()),
    conversionPixelInstalledAt: v.optional(v.number()),
    diagnosis: v.optional(v.any()),
    // Sprint 1.1 — cached LLM-driven keyword expansion. Maps the founder's
    // product description into semantic keywords + audience pain phrases the
    // research query builder can search on. Empty product names like
    // "ModelHub" (which collides with adult content) become
    // {productCategoryKeywords: ["local LLM Mac UI", "Ollama dashboard",
    // "MLX manager", ...], icpPainPhrases: ["managing local LLMs across
    // Ollama/MLX/LM Studio is fragmented", ...]}. Cached on the app row so
    // subsequent research jobs don't re-spend on the same expansion.
    keywordExpansion: v.optional(
      v.object({
        productCategoryKeywords: v.array(v.string()),
        icpPainPhrases: v.array(v.string()),
        version: v.string(),
        modelUsed: v.string(),
        createdAt: v.number(),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_url", ["accountId", "url"]),

  // NOTE: the slideshow-cluster media library is NOT a table — it lives as
  // `gtmAgents.mediaLibraryJson` (a JSON string). See that field's comment:
  // the schema is at TypeScript's DataModel instantiation ceiling and a 139th
  // table regresses db.get() narrowing project-wide.

  gtmResearchJobs: defineTable({
    accountId: v.id("creators"),
    appId: v.id("gtmApps"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("needs_more_evidence"),
      v.literal("ready_for_review"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    phase: v.union(
      v.literal("app_inspection"),
      v.literal("icp_hypotheses"),
      v.literal("channel_research"),
      v.literal("strategy_judge"),
      v.literal("calendar_build"),
      v.literal("complete")
    ),
    budgetUsd: v.number(),
    spentUsd: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    // Sprint B — strategy approval gate. Maya proposes the strategy (POV +
    // North Star + channel bets) and sets "proposed"; the operator approves
    // ("approved") or asks for changes ("iterating") before she executes
    // (builds the calendar + drafts). Undefined = pre-proposal.
    strategyApprovalState: v.optional(
      v.union(
        v.literal("proposed"),
        v.literal("approved"),
        v.literal("iterating")
      )
    ),
    // Sprint 16 — Maya posts /lc_gtm/research_callback with a per-phase
    // note. Surfaced in mission board so the operator can see what Maya
    // is thinking without reading the OpenClaw session log.
    lastAgentNote: v.optional(v.string()),
    // Sprint 2.14a.4 — LLM-pipeline degradation tracking. cards*Count
    // captures how thoroughly the LLM scorer + miner ran. When ratio is
    // <0.5, downstream channel-judge has been operating on engagement-
    // derived placeholder scores rather than LLM pain-language match
    // — output quality is degraded even if decisions look right.
    // Surfaced via analyze* admin queries + (eventually) Maya's
    // boot_kickoff so the operator sees pipeline health, not just
    // completion. Optional fields so pre-2.14a.4 jobs still load.
    cardsScoredCount: v.optional(v.number()),
    cardsExpectedCount: v.optional(v.number()),
    commentsMinedCount: v.optional(v.number()),
    commentsAttemptedCount: v.optional(v.number()),
    // Sprint 2.14a.10 — event-driven boot phase 2 triggering. Phase 1
    // announces how many subagents it spawned via
    // /lc_gtm/phase_1_announce. Each subagent POSTs
    // /lc_gtm/subagent_complete when done. When completed >= expected,
    // Convex triggers phase 2 IMMEDIATELY via OpenClaw's runAgentTurn
    // hook — no waiting for an arbitrary +60min timer. phase2TriggeredAt
    // is the idempotency key so the safety-net cron at +2hr exits
    // early if event-driven path already fired.
    subagentsExpected: v.optional(v.number()),
    subagentsCompleted: v.optional(v.number()),
    phase2TriggeredAt: v.optional(v.number()),
    phase2TriggerSource: v.optional(v.string()), // "subagent_complete" | "safety_net_cron"
    // Sprint 2.15.4 — aggregated USD cost of all LLM calls in this
    // research run (keyword expansion + card scorer + comment miner
    // + channel judge). Separate from spentUsd which tracks
    // scraping API costs only. Populated from OpenRouter's
    // usage.cost field on each call. Null if OpenRouter didn't
    // return cost (BYOK paths).
    spentUsdLlm: v.optional(v.number()),
    spentUsdLlmByStage: v.optional(
      v.object({
        keywordExpansion: v.optional(v.number()),
        cardScorer: v.optional(v.number()),
        commentMiner: v.optional(v.number()),
        channelJudge: v.optional(v.number()),
        formatIntel: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_status", ["accountId", "status"])
    .index("by_app", ["appId"]),

  gtmWalkthroughUploads: defineTable({
    accountId: v.id("creators"),
    appId: v.id("gtmApps"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("analyzing"),
      v.literal("succeeded"),
      v.literal("failed")
    ),
    diagnosis: v.optional(v.any()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_app", ["appId"])
    .index("by_account_and_status", ["accountId", "status"]),

  gtmEvidenceCards: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.id("gtmResearchJobs"),
    source: v.union(
      v.literal("app"),
      v.literal("google"),
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("competitor")
    ),
    url: v.string(),
    title: v.optional(v.string()),
    snippet: v.string(),
    authorOrCommunity: v.optional(v.string()),
    observedAt: v.number(),
    recency: v.union(
      v.literal("fresh"),
      v.literal("recent"),
      v.literal("old"),
      v.literal("unknown")
    ),
    engagement: v.optional(
      v.object({
        likes: v.optional(v.number()),
        comments: v.optional(v.number()),
        shares: v.optional(v.number()),
        views: v.optional(v.number()),
      })
    ),
    painMatch: v.number(),
    buyerMatch: v.number(),
    channelFit: v.number(),
    // Sprint 2.13a — one-sentence LLM-emitted reason for the above
    // scores. Optional so cards inserted before 2.13a still load.
    // Populated by judgeCardsBatch.scoreAllCardsForProduct.
    painLanguageReason: v.optional(v.string()),
    // Sprint 2.14a — comment-tree insights for high-pain cards.
    // After first-pass LLM scoring, the top N reddit cards by
    // painMatch get their comment trees scraped + LLM-summarized:
    // additional pain expressions surfaced in replies, top
    // buyer-quality commenters with their stated context. Lets
    // the channel-judge and Maya's per-platform subagents reason
    // about the full conversation, not just the OP. Optional so
    // pre-2.14a cards still load.
    commentInsights: v.optional(
      v.object({
        // ≤5 distinct pain expressions found in replies (LLM-quoted)
        extractedPains: v.array(v.string()),
        // Up to 3 high-buyer-quality commenters
        topCommenters: v.array(
          v.object({
            author: v.string(),
            stance: v.string(),
            buyerQuality: v.number(),
          })
        ),
        // One-paragraph summary of the conversation shape
        summary: v.string(),
        commentCount: v.number(),
      })
    ),
    promotionRisk: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("unknown")
    ),
    recommendedUse: v.union(
      v.literal("strategy"),
      v.literal("reply"),
      v.literal("content_format"),
      v.literal("avoid"),
      v.literal("competitor")
    ),
    extractedClaims: v.array(v.string()),
    rawRef: v.optional(v.string()),
    // ─── Evidence-vault fields — additive, optional for back-compat ─────
    // SHA-256 hex of `canonicalUrl + snippet`, used for cross-job dedup.
    contentHash: v.optional(v.string()),
    // Normalized URL (lowercase host, strip query params except meaningful
    // ones, no trailing slash). Distinct from `url` which is the raw URL.
    canonicalUrl: v.optional(v.string()),
    // Explicit retrieval timestamp ms (separate from existing `observedAt`).
    retrievedAt: v.optional(v.number()),
    // Source publish time ms if available.
    publishedAt: v.optional(v.number()),
    // Semantic freshness for vault reads (distinct from the existing
    // bucketed `recency` enum which includes "unknown").
    freshnessStatus: v.optional(
      v.union(
        v.literal("fresh"),
        v.literal("recent"),
        v.literal("stale")
      )
    ),
    // Cross-job memory — did a prior job keep, reject, or supersede this card?
    previousVerdict: v.optional(
      v.union(
        v.literal("kept"),
        v.literal("rejected"),
        v.literal("superseded")
      )
    ),
    // ─── end evidence-vault fields ──────────────────────────────────────
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_source", ["accountId", "source"])
    .index("by_account_and_use", ["accountId", "recommendedUse"])
    .index("by_account_platform_canonicalUrl", ["accountId", "source", "canonicalUrl"]),

  // Evidence-vault sibling — synthesized buyer-segment summaries derived
  // from a research job's evidence cards. One row per (researchJob, segment).
  // Cited via `evidenceCardIds` for grounded skill consumption.
  gtmBuyerSegments: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.id("gtmResearchJobs"),
    segmentName: v.string(),
    pains: v.array(v.string()),
    jobsToBeDone: v.array(v.string()),
    buyingTriggers: v.array(v.string()),
    likelyChannels: v.array(v.string()),
    confidence: v.number(), // 0-1
    evidenceCardIds: v.optional(v.array(v.id("gtmEvidenceCards"))),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"]),

  gtmPlatformBriefs: defineTable({
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("x"),
      v.literal("reddit"),
      v.literal("linkedin")
    ),
    version: v.number(),
    whatWorksNow: v.array(v.string()),
    audienceBehavior: v.array(v.string()),
    formatPatterns: v.array(v.string()),
    publishingLimits: v.array(v.string()),
    apiAccess: v.array(v.string()),
    policyRisks: v.array(v.string()),
    measurementModel: v.array(v.string()),
    recommendedUseCases: v.array(v.string()),
    avoidFor: v.array(v.string()),
    claimIds: v.array(v.id("gtmPlatformClaims")),
    lastReviewedAt: v.number(),
    expiresAt: v.number(),
    confidence: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_platform", ["platform"])
    .index("by_platform_and_version", ["platform", "version"])
    .index("by_expires_at", ["expiresAt"]),

  gtmPlatformClaims: defineTable({
    platform: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("x"),
      v.literal("reddit"),
      v.literal("linkedin")
    ),
    claimType: v.union(
      v.literal("what_works_now"),
      v.literal("format_pattern"),
      v.literal("audience_behavior"),
      v.literal("publishing_limit"),
      v.literal("api_access"),
      v.literal("policy_risk"),
      v.literal("measurement_model"),
      v.literal("avoid_for")
    ),
    claim: v.string(),
    sourceKind: v.union(
      v.literal("official_doc"),
      v.literal("scrapecreators"),
      v.literal("web_search"),
      v.literal("user_account"),
      v.literal("third_party_analysis")
    ),
    sourceUrl: v.string(),
    retrievedAt: v.number(),
    publishedAt: v.optional(v.number()),
    expiresAt: v.number(),
    confidence: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    createdAt: v.number(),
  })
    .index("by_platform", ["platform"])
    .index("by_platform_and_type", ["platform", "claimType"])
    .index("by_expires_at", ["expiresAt"]),

  gtmPlatformRefreshRuns: defineTable({
    platform: v.optional(
      v.union(
        v.literal("tiktok"),
        v.literal("instagram"),
        v.literal("x"),
        v.literal("reddit"),
        v.literal("linkedin")
      )
    ),
    cadence: v.union(
      v.literal("onboarding"),
      v.literal("weekly"),
      v.literal("monthly")
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    sourceBudgetUsd: v.number(),
    scrapeCreatorsCreditBudget: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    deltaSummary: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_platform", ["platform"])
    .index("by_status", ["status"])
    .index("by_cadence", ["cadence"]),

  gtmChannelScores: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.id("gtmResearchJobs"),
    // Live scored/surfaced channels are reddit/x/hn/linkedin/tiktok (see
    // judgeChannel.ts). `youtube` and `product_hunt` are NO LONGER
    // scored or surfaced in the onboarding picker (vestigial — no native
    // slideshow / not in the product vision). They are kept in this
    // union ONLY for backward compat with historical rows written before
    // they were dropped; do not re-introduce them at the scoring/picker
    // layer.
    channel: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("product_hunt")
    ),
    score: v.number(),
    decision: v.union(
      v.literal("primary"),
      v.literal("secondary"),
      v.literal("parked"),
      v.literal("blocked")
    ),
    confidence: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    reasons: v.array(v.string()),
    risks: v.array(v.string()),
    evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
    firstWeekTest: v.optional(v.string()),
    qualityGate: v.object({
      passed: v.boolean(),
      failures: v.array(v.string()),
    }),
    // Format intelligence ("what's working in the niche") for the visual
    // channels — JSON array of WorkingFormat {formatName, description,
    // whyItWorks, exemplarUrl, exemplarHook, engagementSignal} extracted from
    // the top-ENGAGEMENT posts (ranked by views/likes, distinct from the
    // pain-ranked comment miner). Grounds "how to post" in winning formats.
    // See convex/gtmMaya/formatIntel.ts. Absent on non-video channels.
    workingFormatsJson: v.optional(v.string()),
    // S3 — operator's channel-selection decision. When the operator confirms
    // or overrides the agent's recommendation in onboarding, `decision` is
    // patched to their pick and this is stamped so the deploy + GTM.md know
    // the channel mix is operator-confirmed, not just auto-scored.
    operatorConfirmedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_channel", ["accountId", "channel"]),

  gtmDistributionMotions: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.id("gtmResearchJobs"),
    motion: v.union(
      v.literal("reddit_helpful_reply"),
      v.literal("x_founder_led"),
      v.literal("linkedin_founder_led"),
      v.literal("tiktok_faceless_demo"),
      v.literal("tiktok_founder_talking_head"),
      v.literal("tiktok_slideshow_carousel"),
      v.literal("instagram_reels_reuse"),
      v.literal("instagram_carousel_reuse"),
      v.literal("ugc_creator_test"),
      v.literal("paid_ads_later"),
      v.literal("influencer_later")
    ),
    status: v.union(
      v.literal("test_now"),
      v.literal("test_later"),
      v.literal("parked"),
      v.literal("blocked")
    ),
    rationale: v.array(v.string()),
    risks: v.array(v.string()),
    evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
    minimumCadence: v.string(),
    stopCriteria: v.string(),
    doubleDownCriteria: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_motion", ["accountId", "motion"]),

  gtmFormatExperiments: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    motionId: v.optional(v.id("gtmDistributionMotions")),
    motion: v.union(
      v.literal("reddit_helpful_reply"),
      v.literal("x_founder_led"),
      v.literal("linkedin_founder_led"),
      v.literal("tiktok_faceless_demo"),
      v.literal("tiktok_founder_talking_head"),
      v.literal("tiktok_slideshow_carousel"),
      v.literal("instagram_reels_reuse"),
      v.literal("instagram_carousel_reuse"),
      v.literal("ugc_creator_test"),
      v.literal("paid_ads_later"),
      v.literal("influencer_later")
    ),
    hypothesis: v.string(),
    variants: v.array(
      v.object({
        hook: v.string(),
        demoMoment: v.optional(v.string()),
        cta: v.string(),
        formatSkeleton: v.string(),
      })
    ),
    successMetric: v.union(
      v.literal("qualified_replies"),
      v.literal("signups"),
      v.literal("installs"),
      v.literal("trials"),
      v.literal("creator_applicants")
    ),
    scaleDecision: v.union(
      v.literal("keep_testing"),
      v.literal("double_down"),
      v.literal("revise"),
      v.literal("park")
    ),
    resultSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_motion", ["motionId"])
    .index("by_account_and_decision", ["accountId", "scaleDecision"]),

  gtmContentBankItems: defineTable({
    accountId: v.id("creators"),
    experimentId: v.optional(v.id("gtmFormatExperiments")),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    motion: v.union(
      v.literal("reddit_helpful_reply"),
      v.literal("x_founder_led"),
      v.literal("linkedin_founder_led"),
      v.literal("tiktok_faceless_demo"),
      v.literal("tiktok_founder_talking_head"),
      v.literal("tiktok_slideshow_carousel"),
      v.literal("instagram_reels_reuse"),
      v.literal("instagram_carousel_reuse"),
      v.literal("ugc_creator_test"),
      v.literal("paid_ads_later"),
      v.literal("influencer_later")
    ),
    formatSkeleton: v.string(),
    hook: v.string(),
    cta: v.string(),
    demoMoment: v.optional(v.string()),
    outcome: v.union(
      v.literal("winner"),
      v.literal("loser"),
      v.literal("inconclusive")
    ),
    evidence: v.array(v.string()),
    promotedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_experiment", ["experimentId"])
    .index("by_account_and_outcome", ["accountId", "outcome"]),

  gtmCostLedger: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    provider: v.union(
      v.literal("scrapecreators"),
      v.literal("gemini"),
      v.literal("openrouter"),
      v.literal("composio"),
      v.literal("x_api"),
      v.literal("openclaw"),
      // Maya v2: Zernio per-account fees + X $0.20/url-post metering record
      // under their own provider so margin erosion is detectable per founder.
      v.literal("zernio"),
      // Studio-tier Creatify video COGS — recorded for visibility, excluded
      // from the operational caps + spend-kill (own videoCreditsMonth budget).
      v.literal("creatify"),
      v.literal("other")
    ),
    operation: v.string(),
    reason: v.string(),
    costUsd: v.number(),
    units: v.optional(v.number()),
    cacheStatus: v.union(
      v.literal("hit"),
      v.literal("miss"),
      v.literal("called"),
      v.literal("skipped"),
      v.literal("failed")
    ),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_provider", ["accountId", "provider"]),

  gtmToolCallLog: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    toolName: v.string(),
    provider: v.union(
      v.literal("scrapecreators"),
      v.literal("gemini"),
      v.literal("openrouter"),
      v.literal("composio"),
      v.literal("x_api"),
      v.literal("openclaw"),
      v.literal("google"),
      v.literal("other")
    ),
    purpose: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("called"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    model: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    scrapeCredits: v.optional(v.number()),
    error: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_tool", ["accountId", "toolName"])
    .index("by_account_and_provider", ["accountId", "provider"]),

  gtmContentDrafts: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    status: v.union(
      v.literal("drafted"),
      v.literal("approved"),
      v.literal("published"),
      v.literal("rejected"),
      v.literal("failed")
    ),
    body: v.string(),
    evidenceCardIds: v.array(v.id("gtmEvidenceCards")),
    finalBody: v.optional(v.string()),
    approvalMessageId: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    externalPostId: v.optional(v.string()),
    publishedUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_status", ["accountId", "status"])
    .index("by_account_and_platform", ["accountId", "platform"]),

  gtmResultSnapshots: defineTable({
    accountId: v.id("creators"),
    draftId: v.id("gtmContentDrafts"),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("linkedin"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    replies: v.optional(v.number()),
    clicks: v.optional(v.number()),
    signups: v.optional(v.number()),
    demos: v.optional(v.number()),
    feedbackItems: v.optional(v.number()),
    raw: v.optional(v.any()),
    capturedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_draft", ["draftId"])
    .index("by_account_and_platform", ["accountId", "platform"]),

  gtmSafetyStates: defineTable({
    accountId: v.id("creators"),
    adminDisabled: v.boolean(),
    disabledReason: v.optional(v.string()),
    dailyCostLimitUsd: v.number(),
    monthlyCostLimitUsd: v.number(),
    dailyApiCallLimit: v.number(),
    updatedAt: v.number(),
  }).index("by_account", ["accountId"]),

  gtmAuditEvents: defineTable({
    accountId: v.id("creators"),
    actor: v.union(
      v.literal("maya"),
      v.literal("system"),
      v.literal("admin"),
      v.literal("user")
    ),
    eventType: v.string(),
    severity: v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    message: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_type", ["accountId", "eventType"]),

  gtmConnectionHealth: defineTable({
    accountId: v.id("creators"),
    provider: v.union(
      v.literal("whatsapp"),
      v.literal("imessage"),
      v.literal("google_calendar"),
      v.literal("reddit"),
      v.literal("x"),
      v.literal("linkedin"),
      v.literal("composio"),
      v.literal("openclaw")
    ),
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("reconnect_required"),
      v.literal("error")
    ),
    failureReason: v.optional(v.string()),
    lastCheckedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_provider", ["accountId", "provider"]),

  gtmMachineHealth: defineTable({
    accountId: v.id("creators"),
    flyAppId: v.string(),
    status: v.union(
      v.literal("healthy"),
      v.literal("unhealthy"),
      v.literal("restarting"),
      v.literal("unknown")
    ),
    lastPingAt: v.optional(v.number()),
    restartCount: v.number(),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_fly_app", ["flyAppId"]),

  gtmBetaCohort: defineTable({
    accountId: v.id("creators"),
    cohortName: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("removed")
    ),
    requiredAppUrlLive: v.boolean(),
    startedAt: v.number(),
    endsAt: v.number(),
    retentionIntent: v.optional(
      v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
        v.literal("unknown")
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_cohort", ["cohortName"]),

  gtmHumanPlanReviews: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    reviewer: v.string(),
    specificityScore: v.number(),
    usefulnessScore: v.number(),
    notes: v.string(),
    reviewedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"]),

  gtmUserReportedSignals: defineTable({
    accountId: v.id("creators"),
    kind: v.union(
      v.literal("reply"),
      v.literal("signup"),
      v.literal("demo"),
      v.literal("feedback"),
      v.literal("retention")
    ),
    message: v.string(),
    retentionIntent: v.optional(
      v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
        v.literal("unknown")
      )
    ),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_kind", ["accountId", "kind"]),

  gtmUgcReadinessReports: defineTable({
    accountId: v.id("creators"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    readiness: v.union(
      v.literal("premature"),
      v.literal("useful_soon"),
      v.literal("ready")
    ),
    reasons: v.array(v.string()),
    requiredProof: v.array(v.string()),
    creatorProfile: v.optional(v.string()),
    briefTemplate: v.optional(v.string()),
    trainingOutline: v.optional(v.array(v.string())),
    managementCadence: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_readiness", ["accountId", "readiness"]),

  // Sprint 2.2 — target list: specific threads, accounts, and drafts surfaced
  // by the deep-research subagents (Sprint 2.1). The three tables form the
  // structured artifact the subagents write into; the mission board reads
  // from them; the slop-critic / approval workflow (Sprint 2.10 / 2.3) walks
  // gtmDraftedContent.approvalState. researchJobId is OPTIONAL on every row
  // because subagents may surface targets outside a specific research job
  // (e.g. daily heartbeat scans in Sprint 2.6 refresh metrics on threads
  // first seen in an older job, and ad-hoc operator prompts may produce
  // targets with no job at all).

  // Specific Reddit / X / HN / LinkedIn / IG / TikTok threads where the
  // operator's product fits as a natural reply. One row = one targeted
  // thread; dedupe key is (accountId, platform, externalId).
  gtmTargetThreads: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    url: v.string(),
    /** Platform's own ID — reddit post ID, tweet ID, HN objectID, etc. Used
     *  as the dedupe key together with (accountId, platform) so a second
     *  subagent surfacing the same thread updates rather than double-inserts. */
    externalId: v.string(),
    title: v.optional(v.string()),
    /** Snippet of the OP, up to ~500 chars. Truncated by the subagent before write. */
    excerpt: v.optional(v.string()),
    author: v.optional(v.string()),
    /** e.g. "r/LocalLLaMA" — community handle when the platform has one. */
    subredditOrCommunity: v.optional(v.string()),
    /** Snapshot at time of surfacing; refreshed by Sprint 2.6 daily heartbeat. */
    currentMetrics: v.object({
      upvotes: v.optional(v.number()),
      comments: v.optional(v.number()),
      likes: v.optional(v.number()),
      shares: v.optional(v.number()),
      views: v.optional(v.number()),
    }),
    lastSeenMetricsAtMs: v.number(),
    /** Subagent's plain-language reasoning for surfacing this thread (1-3
     *  sentences). Never reference skill slugs or pipeline jargon — this
     *  text gets shown to the operator in the mission board. */
    whyItFits: v.string(),
    recommendedAction: v.union(
      v.literal("reply"),
      v.literal("lurk"),
      v.literal("upvote_only"),
      v.literal("avoid")
    ),
    /** Linked draft, if one's been created for this thread. */
    draftedReplyId: v.optional(v.id("gtmDraftedContent")),
    /** "expired" means the thread is too old to be a useful reply target now. */
    status: v.union(
      v.literal("queued"),
      v.literal("replied"),
      v.literal("dropped"),
      v.literal("expired")
    ),
    /** 0-1; subagent's confidence this is a strong target. */
    priorityScore: v.number(),
    // Sprint 2.17 Phase A — manager-mode depth fields. All optional so
    // existing rows continue to validate. Subagents in 2.17+ are
    // expected to populate every one; Maya's output critic drops T4 and
    // surfaces T1/T2 in the morning brief.
    /** Verbatim quote from the post body that proves the buyer signal.
     *  Anchors the "grounded or silent" rule — never null on new rows. */
    painQuote: v.optional(v.string()),
    /** Grounding gate (computed at save): true iff painQuote is present AND
     *  distinct from the title — i.e. a real verbatim buyer-pain phrase, not a
     *  URL-only or title-echo stub. The SURFACING layer requires this so an
     *  ungrounded thread is never shown to the founder as a "buyer thread" —
     *  without a hard SAVE-time reject (which caused 8-retry bounce loops, see
     *  saveTargetThreadHttp). Permissive save + grounded-surface = trust without
     *  the reliability cost. */
    grounded: v.optional(v.boolean()),
    /** Original post timestamp (ms epoch). Drives freshness gate + velocity. */
    postedAt: v.optional(v.number()),
    /** Likes-per-hour (or platform-equivalent) at time of surfacing. */
    velocityScore: v.optional(v.number()),
    /** Author context to confirm real-buyer vs bot/meme. */
    authorContext: v.optional(
      v.object({
        followerCount: v.optional(v.number()),
        accountAgeMs: v.optional(v.number()),
        recentPostSummary: v.optional(v.string()),
      })
    ),
    /** Top replies + whether OP is engaging. Drives "alive vs dead"
     *  judgment. Sprint 2.30 enrichment: `mineableComments[]` carries
     *  per-comment intel (reply targets, pain restatements, competitor
     *  mentions, OP rejections, high-velocity threads). Maya's workers
     *  populate this in addition to `topComments` so the morning_brief
     *  can lead with the BEST comment-anchored reply target, not just
     *  the OP. */
    commentTreeSummary: v.optional(
      v.object({
        topComments: v.array(v.string()),
        opIsReplying: v.optional(v.boolean()),
        /** Sprint 2.30 — per-comment mining intel. Each entry is one
         *  comment the worker judged actionable. `kind` carries WHY it
         *  matters; the morning_brief weighs T1/T2 partly on whether
         *  any `buyer_intent` comments exist. */
        mineableComments: v.optional(
          v.array(
            v.object({
              commentId: v.string(),
              author: v.optional(v.string()),
              body: v.string(),
              score: v.optional(v.number()),
              postedAtMs: v.optional(v.number()),
              kind: v.union(
                v.literal("buyer_intent"),
                v.literal("pain_restatement"),
                v.literal("competitor_mention"),
                v.literal("op_rejection"),
                v.literal("high_velocity")
              ),
              /** When kind=competitor_mention, the named competitor. */
              competitorName: v.optional(v.string()),
              /** Maya's note on WHY this comment is mineable. */
              whyMineable: v.optional(v.string()),
            })
          )
        ),
      })
    ),
    /** Subreddit subscribers / community member count / followers count. */
    audienceSize: v.optional(v.number()),
    /** Maya's drafted reply text (when recommendedAction === "reply"). */
    draftReply: v.optional(v.string()),
    /** Maya's classification — T1 hot strike → T4 trash. T4 still persists
     *  for learning purposes but never surfaces in the morning brief. */
    tier: v.optional(
      v.union(
        v.literal("T1"),
        v.literal("T2"),
        v.literal("T3"),
        v.literal("T4")
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_status", ["accountId", "status"])
    .index("by_account_and_platform", ["accountId", "platform"]),

  // Specific people / accounts on each platform to follow + engage with
  // (e.g. @sabeshbharathi on X, a Reddit user who posts frequently in
  // r/LocalLLaMA). Dedupe key is (accountId, platform, handle).
  gtmTargetAccounts: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    /** The @ handle or username (no leading @, normalized to lowercase by
     *  the persistence layer for stable dedupe). */
    handle: v.string(),
    profileUrl: v.string(),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    followerCount: v.optional(v.number()),
    /** Subagent's notes on this person's posting style / voice / recent
     *  themes — used downstream by the draft generator (Sprint 2.4) to
     *  match the room's tone when crafting replies. */
    voiceAnalysis: v.optional(v.string()),
    /** Plain-language reasoning, same rules as gtmTargetThreads.whyItFits. */
    whyItFits: v.string(),
    recommendedAction: v.union(
      v.literal("follow_and_engage"),
      v.literal("lurk"),
      v.literal("dm"),
      v.literal("avoid")
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("following"),
      v.literal("dropped")
    ),
    priorityScore: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_platform", ["accountId", "platform"]),

  // Drafts of replies, posts, threads, comments, DMs. Pre-slop-critic-cleared
  // content the operator can tap-and-post. Never dedupes — multiple drafts
  // per target are allowed (the operator can ask for a rewrite; revisions
  // create a new row tied to the same targetThreadId / targetAccountId).
  gtmDraftedContent: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    researchJobId: v.optional(v.id("gtmResearchJobs")),
    kind: v.union(
      v.literal("reply"),
      v.literal("thread"),
      v.literal("post"),
      v.literal("comment"),
      v.literal("dm")
    ),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    /** For reply / comment kinds — links back to the thread this is targeting. */
    targetThreadId: v.optional(v.id("gtmTargetThreads")),
    /** For dm / specific-account engagement kinds. */
    targetAccountId: v.optional(v.id("gtmTargetAccounts")),
    draftText: v.string(),
    /** For thread kind — one tweet / post per segment. */
    draftSegments: v.optional(v.array(v.string())),
    // Sprint C — content-attribute tags (Maya's own judgment, free strings —
    // no fixed taxonomy, per the no-heuristics rule). The results-reviewer
    // correlates these → outcomes so the loop learns what SPECIFICALLY works
    // for this founder ("punchy 0-3s hooks convert 4x explainer intros"), not
    // just which coarse format wins. All optional.
    attributes: v.optional(
      v.object({
        hookType: v.optional(v.string()),
        format: v.optional(v.string()),
        tone: v.optional(v.string()),
        lengthBucket: v.optional(v.string()),
        hasFace: v.optional(v.boolean()),
        captionStyle: v.optional(v.string()),
        postingWindow: v.optional(v.string()),
        // Sprint 5 — when this draft is an arm in a registered experiment, the
        // allocator stamps which experiment + arm it belongs to so the verdict
        // join (getAttributeOutcomes / experiment registry) can attribute it.
        experimentId: v.optional(v.string()),
        armLabel: v.optional(v.string()),
      })
    ),
    /** 0-1; how well this matches operator's voice. Sprint 2.4 populates. */
    voiceMatchScore: v.optional(v.number()),
    /** Sprint 2.10 slop-critic gate; default false until checked. */
    slopCriticPassed: v.boolean(),
    /** Reasons if slop-critic failed; null/undefined when not yet checked
     *  or when passed. */
    slopCriticFailures: v.optional(v.array(v.string())),
    approvalState: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("published"),
      v.literal("needs_revision")
    ),
    /** When approvalState is "rejected" or "needs_revision", the operator's
     *  edit instruction. Feeds the rewrite path in Sprint 2.4. */
    userFeedback: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    /** URL or platform-side ID of the published version, when applicable. */
    providerPostId: v.optional(v.string()),
    // ─── Evidence-vault field — additive, optional for back-compat ──────
    // Explicit citation of the cards that justified this draft.
    evidenceCardIds: v.optional(v.array(v.id("gtmEvidenceCards"))),
    // ─── end evidence-vault field ───────────────────────────────────────
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_target_thread", ["targetThreadId"])
    .index("by_account_and_state", ["accountId", "approvalState"]),

  // Sprint 2.6 — daily heartbeat results scan. For each published
  // gtmDraftedContent row, a heartbeat task fetches latest metrics from
  // the source platform every 6h and persists a snapshot here. Lets the
  // weekly review compute deltas + surface what worked / didn't.
  // Significant changes (5x baseline) also fire an opportunistic
  // Telegram nudge from the heartbeat task.
  gtmPostResults: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    draftId: v.id("gtmDraftedContent"),
    snapshotAtMs: v.number(),
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube")
    ),
    providerPostId: v.string(),
    metrics: v.object({
      likes: v.optional(v.number()),
      comments: v.optional(v.number()),
      shares: v.optional(v.number()),
      views: v.optional(v.number()),
      upvotes: v.optional(v.number()),
      downvotes: v.optional(v.number()),
    }),
    // Sprint 2.6 — populated when the heartbeat task decided this
    // snapshot represents a significant change from prior baseline
    // and surfaced a Telegram nudge. Mission-board surfaces use this
    // to show "Maya pinged the operator about this one".
    surfacedToOperator: v.boolean(),
    notes: v.optional(v.string()),
    // Maya v2 (S3) engagement-ledger dedup — keys this published record to
    // EXACTLY what we replied to, so the publish gate can refuse a second
    // reply to the same thread/comment. targetExternalId = the platform's own
    // post/thread id; targetCommentId = the specific comment within it (the
    // operator chose per-comment granularity 2026-06-02). intentionalFollowUp
    // records that a repeat reply was a deliberate override, not a dedup miss.
    // No new index: the check scans by_agent + filters platform/targetExternalId
    // (mirrors the gtmTargetThreads dedupe-scan pattern).
    targetExternalId: v.optional(v.string()),
    targetCommentId: v.optional(v.string()),
    intentionalFollowUp: v.optional(v.boolean()),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_draft", ["draftId"])
    .index("by_account_and_snapshot", ["accountId", "snapshotAtMs"]),

  // ─── Sprint C — Attribution (the moat foundation) ─────────────────────
  // Our own link instrumentation. Maya wraps every product link she drafts;
  // the redirect logs a click then 302s to the destination (+ UTM). Needs
  // ZERO platform OAuth — the redirect + UTM are our own infra. Turning a
  // click into a known SIGNUP needs the destination (the user's app) to
  // report back: either a pixel POST or the operator's structured self-report.

  /** A wrapped product link. `token` is the short path Maya hands out
   *  (e.g. $CONVEX_SITE_URL/r/<token>). Dedupe is by token (unique). */
  gtmLinkWraps: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    token: v.string(),
    destinationUrl: v.string(),
    platform: v.optional(v.string()),
    draftId: v.optional(v.id("gtmDraftedContent")),
    // UTM appended to the destination on redirect so the user's own
    // analytics also attributes the visit.
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_token", ["token"]),

  /** One row per click on a wrapped link (logged by the public redirect). */
  gtmLinkClicks: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    linkWrapId: v.id("gtmLinkWraps"),
    platform: v.optional(v.string()),
    clickedAt: v.number(),
    userAgent: v.optional(v.string()),
    referrer: v.optional(v.string()),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_link_wrap", ["linkWrapId"]),

  /** Conversions (signups/demos/feedback). `source` = how we learned:
   *  "self_report" (operator told Maya — no app instrumentation needed) or
   *  "pixel" (the user's app POSTed a conversion event). Optionally tied to a
   *  wrapped link for per-post attribution. */
  gtmConversions: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: v.union(
      v.literal("signup"),
      v.literal("demo"),
      v.literal("feedback"),
      v.literal("revenue"),
      // Sprint 3 (top-tier): a signed-up user who came BACK / reached value.
      // Lets Maya own outcomes (a customer who stuck), not just first-touch signups.
      v.literal("activated")
    ),
    count: v.number(),
    source: v.union(v.literal("self_report"), v.literal("pixel")),
    linkWrapId: v.optional(v.id("gtmLinkWraps")),
    occurredAt: v.number(),
    note: v.optional(v.string()),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_kind", ["agentId", "kind"]),

  // ─── Sprint G — the data moat: cross-tenant archetype playbook ─────────
  /** Privacy-safe, outcome-grounded learnings aggregated ACROSS tenants by app
   *  archetype ("for a dev tool like yours: HN + r/LocalLLaMA, founder-story
   *  angle converts 3x, Show HN week 3"). NO per-tenant PII / no creatorId —
   *  only the archetype + the pattern + how many tenants/outcomes back it.
   *  Warm-starts new customers of the same archetype. Populated by a post-MVP
   *  cross-tenant aggregation job (needs corpus + attribution); read at
   *  onboarding as a prior. The flywheel: more customers → more outcome data →
   *  better per-archetype playbooks → better results → more customers. */
  gtmArchetypeLearnings: defineTable({
    /** App archetype this learning is indexed by (e.g. "dev-tool"). */
    archetype: v.string(),
    /** What kind of learning — channel/venue/angle/format/timing/launch. */
    kind: v.string(),
    /** The learning, in plain language. No tenant-identifying detail. */
    learning: v.string(),
    /** How many distinct tenants' outcomes support this (the corpus depth). */
    supportingTenantCount: v.number(),
    /** How many outcome events (conversions/posts) back it. */
    evidenceCount: v.number(),
    /** 0-1 aggregate confidence. */
    confidence: v.number(),
    updatedAt: v.number(),
  })
    .index("by_archetype", ["archetype"])
    .index("by_archetype_and_kind", ["archetype", "kind"]),

  // ─── Sprint J — self-improving skills (Layer 2, governed) ──────────────
  /** Proposed improvements to the SHARED skills, emitted by agents and grounded
   *  in a real outcome. Agents NEVER edit shared skills directly — they propose
   *  here; the platform aggregates cross-tenant, A/B-verifies, and gated-merges.
   *  Core contracts (firewall / evidence / safety gates) are out of scope and
   *  never self-editable. Privacy-safe: agentId for provenance/dedupe, but the
   *  proposal itself carries no operator PII. The aggregation + merge job is
   *  post-MVP; this captures the proposals so the loop can start. */
  gtmSkillImprovementProposals: defineTable({
    agentId: v.id("gtmAgents"),
    /** Which shared skill the proposal targets (slug), e.g.
     *  "maya-reddit-demand-researcher". Never a core-contract file. */
    targetSkill: v.string(),
    /** Optional archetype this is most relevant to (ties to the data moat). */
    archetype: v.optional(v.string()),
    /** The proposed change, in plain language. No operator PII. */
    proposal: v.string(),
    /** The outcome that grounds it (why Maya thinks this helps). */
    groundedInOutcome: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("under_review"),
      v.literal("ab_testing"),
      v.literal("merged"),
      v.literal("rejected")
    ),
    createdAt: v.number(),
  })
    .index("by_target_skill", ["targetSkill"])
    .index("by_status", ["status"])
    .index("by_archetype", ["archetype"]),

  // ─── Mission Control — the autonomous-update activity feed ─────────────
  /** The live "what ClawLaunch is doing / thinking / what changed" feed that
   *  drives the web UI's Today tab. OpenClaw POSTs here as it works (research
   *  progress, plan regenerated, new hot target, North-Star status shift, a
   *  draft ready), and the UI subscribes via Convex live queries → real-time,
   *  agent-driven. Operator-facing text (voice-contract clean). */
  gtmAgentActivity: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: v.union(
      v.literal("researching"), // mid-research progress
      v.literal("found"), // surfaced a new target / opportunity
      v.literal("drafted"), // a post/reply is ready
      v.literal("plan_changed"), // regenerated/re-weighted the plan
      v.literal("posted"), // operator posted / result came in
      v.literal("thinking"), // a hunch / strategic note
      v.literal("status") // generic heartbeat-worthy status
    ),
    /** One operator-facing line — manager voice, no infra leak. */
    summary: v.string(),
    /** Optional longer detail (markdown ok) for the activity-detail view. */
    detail: v.optional(v.string()),
    /** Optional pointer to what this is about (a thread/draft url or id). */
    linkedRef: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_account_and_created", ["accountId", "createdAt"]),

  // ─── Data-collection sprint — conversation transcript ─────────────────
  // Every user↔Maya turn, persisted plaintext + tenant-isolated. Before
  // this table, inbound user messages lived only on the ephemeral OpenClaw
  // Fly machine and Maya's replies went straight to Telegram — neither
  // reached Convex, so "what users say to their Maya" was unrecoverable.
  //
  // Capture paths:
  //   - role:"maya"  — written from /lc_gtm/send_update (we own that path).
  //   - role:"user"  — written from /lc_gtm/log_message, which Maya's
  //     runtime calls as the first action of every inbound turn.
  // `turnId` groups a user message with the reply(s) it produced so the
  // quality grader (Wave 4) can score a turn as a unit. The optional
  // telemetry fields are populated by Wave 2 (per-turn LLM cost/tokens).
  //
  // Tenant isolation: accountId === Id<"creators">; all reads scope by it.
  // Privacy: plaintext is intentional (operator-locked) so the founder
  // dashboard + LLM grader can read content directly. Body is capped at
  // capture time (see conversationCapture.ts MAX_BODY_CHARS).
  mayaMessages: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    role: v.union(v.literal("user"), v.literal("maya")),
    /** Plaintext message body (capped/truncated at capture time). */
    body: v.string(),
    channel: v.union(
      v.literal("telegram"),
      v.literal("claw-messenger"),
      v.literal("sms"),
      v.literal("web"),
      v.literal("unknown")
    ),
    /** Groups one user turn with the Maya reply(s) it produced. */
    turnId: v.string(),
    ts: v.number(),
    // ── maya-role classification (from send_update) ──────────────────────
    /** "strategic" | "tactical" — Maya's self-declared message class. */
    messageClass: v.optional(v.string()),
    /** Whether Maya declared the 5-gate output critic passed. */
    criticPassed: v.optional(v.boolean()),
    // ── Wave 2 per-turn LLM telemetry (optional, backfilled by turnId) ───
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    thinkingBudget: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_ts", ["accountId", "ts"])
    .index("by_agent", ["agentId"])
    .index("by_turn", ["turnId"]),

  // ─── Sprint 2.17 — Manager-mode foundation tables ─────────────────────
  // The five outputs of the foundation-research pass (onboarding +
  // monthly refresh). Each is its own table because:
  //   - cardinality differs (buyer_map is 1-per-agent, the others are
  //     N-per-agent)
  //   - update cadences differ at the row level
  //   - read paths in skills are scoped per-output ("read buyer map" vs
  //     "scan competitive map")
  // All carry agentId + accountId for tenant scoping; populated only by
  // /lc_gtm/foundation_* endpoints (token-derived agentId).

  /** Singleton-per-agent ICP definition + buyer journey + language.
   *  Refreshed monthly. The whole row is overwritten each pass — we
   *  don't try to merge with prior. Foundation research is a fresh
   *  re-synthesis each time. */
  gtmBuyerMap: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** 1-3 paragraph ICP description in plain language. */
    icpDescription: v.string(),
    /** Buyer journey stages — where they hang out, what language signals
     *  high intent at each stage. */
    buyerJourneyStages: v.array(
      v.object({
        stage: v.string(),
        whereTheyHangOut: v.string(),
        intentLanguage: v.string(),
        // Pillar 2 — per-stage native style + complaints captured during
        // research, so the daily cron can ground drafts in real buyer words.
        nativeStyleExemplars: v.optional(v.array(v.string())),
        complaints: v.optional(v.array(v.string())),
      })
    ),
    /** Search phrases / post titles / DM openers that signal a buyer in-market. */
    intentPhrases: v.array(v.string()),
    /** People (influencers, podcasters, account-leaders) the ICP trusts. */
    trustedVoices: v.array(
      v.object({
        handle: v.string(),
        platform: v.string(),
        whyTrusted: v.string(),
      })
    ),
    synthesizedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"]),

  /** Multi-row per agent — one per competitor / adjacent tool /
   *  substitute behavior we want to track. Dedupe key:
   *  (agentId, competitorKey). competitorKey is lowercased competitor
   *  name OR substitute-behavior slug. */
  gtmCompetitiveMap: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Lowercased, kebab-or-snake-cased name. Stable dedupe handle. */
    competitorKey: v.string(),
    /** Display-cased name. */
    competitorName: v.string(),
    kind: v.union(
      v.literal("direct"),
      v.literal("adjacent"),
      v.literal("substitute")
    ),
    url: v.optional(v.string()),
    pricing: v.optional(v.string()),
    positioning: v.string(),
    /** Customer complaints quoted from real threads. Grounding. */
    complaints: v.array(
      v.object({
        quote: v.string(),
        sourceUrl: v.string(),
      })
    ),
    vulnerabilities: v.array(v.string()),
    synthesizedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_key", ["agentId", "competitorKey"])
    .index("by_agent_and_kind", ["agentId", "kind"]),

  /** Per-channel scorecard. Dedupe key: (agentId, channel). */
  gtmChannelScorecard: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    // Sprint 2.18 #46 — YouTube removed from PRODUCT surface (operator
    // scoped out). Kept in schema enum for backward compat with rows
    // written before #46 — endpoint validator (managerCallbacks.ts +
    // managerStore.ts) blocks new YouTube POSTs.
    channel: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("youtube"),
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("threads"),
      v.literal("podcasts"),
      v.literal("newsletters"),
      v.literal("discord"),
      v.literal("blog")
    ),
    /** 0-1: how well does the buyer live on this channel. */
    audienceFit: v.number(),
    /** 0-1: does the founder have bandwidth to feed this channel. */
    cadenceFit: v.number(),
    /** Plain-language description of what this channel uniquely does. */
    uniqueUnlock: v.string(),
    /** Top 2-3 channels Maya bets on each get bet=true. */
    bet: v.boolean(),
    notes: v.optional(v.string()),
    // Pillar 2 (ICP knowledge, per channel) — the daily cron reads this so the
    // research pays off every morning instead of decaying after onboarding.
    // JSON string: { venues:[{name,kind,url?,whyHere}], watch:string[],
    // complaints:[{quote,sourceUrl}], topics:string[], nativeStyle:{...} }.
    icpKnowledge: v.optional(v.string()),
    // 5-10 verbatim native posts per channel — voice/register anchors for
    // maya-voice-matcher (Anchor B). JSON: [{platform,community,verbatim,why,
    // capturedAt}].
    styleExemplarsJson: v.optional(v.string()),
    synthesizedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_channel", ["agentId", "channel"])
    .index("by_agent_and_bet", ["agentId", "bet"]),

  /** Multi-row per agent — 20-30 narrative angles + hook variants. */
  gtmContentAngles: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Stable slug for dedupe — kebab-cased short name. */
    angleKey: v.string(),
    /** The angle in plain language. */
    angle: v.string(),
    /** Grounding citation — quote + source URL. */
    painCitation: v.object({
      quote: v.string(),
      sourceUrl: v.string(),
    }),
    /** 3-5 hook openers in founder's voice. */
    hookVariants: v.array(v.string()),
    /** Free-text on tone/voice match for the founder. */
    voiceCheck: v.optional(v.string()),
    /** How many times Maya has used this angle in drafts. */
    usageCount: v.number(),
    lastUsedAt: v.optional(v.number()),
    synthesizedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_key", ["agentId", "angleKey"]),

  /** 20-50 specific accounts to build relationships with. Dedupe key:
   *  (agentId, platform, lowercased handle). */
  gtmRelationshipTargets: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    // Sprint 2.18 #46 — YouTube kept in schema enum for backward compat
    // with rows written before #46. Endpoint validator blocks new POSTs.
    platform: v.union(
      v.literal("reddit"),
      v.literal("x"),
      v.literal("hn"),
      v.literal("linkedin"),
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube"),
      v.literal("threads")
    ),
    /** Always lowercased before write. */
    handle: v.string(),
    displayName: v.optional(v.string()),
    profileUrl: v.optional(v.string()),
    /** Why this person matters — audience overlap, voice fit, etc. */
    whyThem: v.string(),
    /** Maya's plan for building with them. */
    engagementPlan: v.string(),
    cadence: v.union(
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("as_they_post")
    ),
    status: v.union(
      v.literal("prospect"),
      v.literal("warming"),
      v.literal("engaged"),
      v.literal("reciprocal"),
      v.literal("dropped")
    ),
    lastTouchAt: v.optional(v.number()),
    synthesizedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_platform", ["agentId", "platform"])
    .index("by_agent_and_status", ["agentId", "status"]),

  // ─── Sprint 2.17 — Manager-mode continuous tables ─────────────────────

  /** Competitor moves observed in the wild. Dedupe key:
   *  (agentId, competitiveMapId, sourceUrl). */
  gtmCompetitorMoves: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Soft link — competitiveMapId may be null if the move is from a
     *  competitor not yet in the map. Maya can backfill. */
    competitiveMapId: v.optional(v.id("gtmCompetitiveMap")),
    competitorName: v.string(),
    moveKind: v.union(
      v.literal("feature_ship"),
      v.literal("campaign"),
      v.literal("milestone"),
      v.literal("pricing_change"),
      v.literal("partnership"),
      v.literal("incident")
    ),
    summary: v.string(),
    sourceUrl: v.string(),
    observedAt: v.number(),
    /** Maya's proposed counter-move. */
    recommendedCounter: v.optional(v.string()),
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_observed", ["agentId", "observedAt"])
    .index("by_competitive_map", ["competitiveMapId"]),

  /** Emerging communities, accounts, keywords, or topics. */
  gtmNichePulse: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    pulseKind: v.union(
      v.literal("new_community"),
      v.literal("rising_account"),
      v.literal("rising_keyword"),
      v.literal("rising_topic"),
      v.literal("declining_signal")
    ),
    name: v.string(),
    platform: v.optional(v.string()),
    evidenceUrl: v.string(),
    momentumSignal: v.string(),
    observedAt: v.number(),
    /** Maya's grade — does this matter enough to act on. */
    relevance: v.union(
      v.literal("act_now"),
      v.literal("monitor"),
      v.literal("noise")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_observed", ["agentId", "observedAt"])
    .index("by_agent_and_relevance", ["agentId", "relevance"]),

  /** Every Maya output → one row. Drives the feedback loop. */
  gtmActionLog: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    kind: v.union(
      v.literal("morning_brief"),
      v.literal("evening_recap"),
      v.literal("weekly_review"),
      v.literal("monthly_reset"),
      v.literal("hot_alert"),
      v.literal("inbound_triage"),
      v.literal("calendar_event_created"),
      v.literal("draft_proposed"),
      v.literal("foundation_complete"),
      v.literal("competitor_move_alert"),
      v.literal("niche_pulse_alert"),
      v.literal("other")
    ),
    summary: v.string(),
    /** Soft references — we don't enforce FK because rows may be deleted
     *  or live in different tables. Maya populates the kind so consumers
     *  know what to look up. */
    linkedEntities: v.optional(
      v.array(
        v.object({
          entityKind: v.string(),
          entityId: v.string(),
        })
      )
    ),
    sentAt: v.number(),
    /** Maya updates this as feedback arrives — operator replied, did the
     *  thing, ignored, etc. */
    userResponse: v.union(
      v.literal("pending"),
      v.literal("acknowledged"),
      v.literal("acted"),
      v.literal("ignored"),
      v.literal("dismissed")
    ),
    outcomeNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_sent", ["agentId", "sentAt"])
    .index("by_agent_and_kind", ["agentId", "kind"]),

  /** Sprint 2.29 — Maya's audit trail of writes to her Fly-mounted
   *  workspace memory files: memory/YYYY-MM-DD.md (daily working memory)
   *  and DREAMS.md (longer-horizon hypotheses). The actual content lives
   *  on Fly disk; this table captures WHEN/WHERE/HOW-MUCH so the
   *  operator HQ can surface "Maya wrote to memory at 7:02am" + cost
   *  attribution flows through it.
   *  Dedupe key: idempotencyKey (matching gtmHookCallbacks pattern). */
  gtmMemoryWrites: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Idempotency for retries — same uuid will resolve to the same row. */
    idempotencyKey: v.string(),
    /** Which file got written. */
    target: v.union(
      v.literal("daily_memory"),       // memory/YYYY-MM-DD.md
      v.literal("dreams"),              // DREAMS.md
      v.literal("memory_index")         // MEMORY.md
    ),
    /** ISO-8601 date string YYYY-MM-DD when target is daily_memory; null otherwise. */
    dateSlot: v.optional(v.string()),
    /** What action was logged on the target — append/replace/strike. */
    op: v.union(
      v.literal("append"),
      v.literal("replace_section"),
      v.literal("strike")
    ),
    /** Optional section name within the file. */
    section: v.optional(v.string()),
    /** Bytes written (approximate, for cost transparency). */
    bytes: v.optional(v.number()),
    /** Short human-readable summary of what got written, for the
     *  operator UI ("Maya wrote: 2 new hypotheses, 1 retired"). */
    summary: v.optional(v.string()),
    /** Which skill triggered the write (morning_brief / evening_recap /
     *  weekly_review / monthly_reset / inbound_triage). */
    triggeredBy: v.string(),
    writtenAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_agent_and_written", ["agentId", "writtenAt"])
    .index("by_agent_and_target", ["agentId", "target"])
    .index("by_idempotency", ["idempotencyKey"])
    // S7 — uniform account-scoped purge in accountDeletion's cascade.
    .index("by_account", ["accountId"]),

  /** What Maya has learned about this niche over time. The compounding
   *  surface — week 4 brief reads this to weight what surfaces.
   *  Dedupe key: (agentId, learningKey). */
  gtmNicheLearnings: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Stable slug. */
    learningKey: v.string(),
    learningKind: v.union(
      v.literal("timing"),
      v.literal("channel_priority"),
      v.literal("voice_angle"),
      v.literal("community_quality"),
      v.literal("format_preference"),
      v.literal("hook_pattern"),
      v.literal("other")
    ),
    learning: v.string(),
    /** Number of data points supporting this learning. */
    evidenceCount: v.number(),
    /** 0-1: how confident Maya is in this learning. */
    confidenceScore: v.number(),
    firstObservedAt: v.number(),
    lastReinforcedAt: v.number(),
    /** Set when the learning is contradicted by newer evidence. Maya
     *  may revive a retired learning if it re-emerges. */
    retired: v.boolean(),
    // Sprint 8 — structured, AGGREGATABLE form of this learning (free text is
    // un-rollupable). JSON: {venue?, hook?, format?, timeBucket?, outcome?}. The
    // monthly cross-tenant rollup reads this to build the archetype playbook.
    structuredJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_agent", ["agentId"])
    .index("by_agent_and_key", ["agentId", "learningKey"])
    .index("by_agent_and_kind", ["agentId", "learningKind"])
    .index("by_agent_and_retired", ["agentId", "retired"]),

  // ─── end ClawLaunch / Maya GTM product ────────────────────────────────
});
