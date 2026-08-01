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

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 4 — Today + Performance UI source-of-truth tables.
  // Every table here carries `creatorId` and a `by_creator` index so the
  // sibling-file scan in tests/sprint1Acceptance.test.ts stays green and the
  // cross-tenant gate is enforceable from a single helper. Annotations live
  // on the rows themselves (e.g. `posts.mayaAnnotation`) so the UI never has
  // to JOIN to render Maya's read.
  // ────────────────────────────────────────────────────────────────────────

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

  // ─── end Service product Sprint 1 (Zernio integration) ────────────────

  // ─── end Service product Wave C (memory-wiki projection) ──────────────

  // ─── end Service product Wave C.5 (weekly learnings) ──────────────────

  // ─── end Service product Wave C.6 (GBP health score) ──────────────────

  // ─── end Service product Wave D (beta hardening telemetry) ────────────
  // ─── end Service product Sprint 0 ─────────────────────────────────────

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
    // 2026-07-07 — per-agent override for the all-day discovery_pulse cron.
    // Beats the deployment-wide MAYA_GTM_PULSE_ENABLED env var at deploy time
    // (unset → env decides). Exists so ONE dogfood agent can cost-soak the
    // pulse before any fleet rollout. Takes effect on the agent's next
    // (re)deploy — jobs.json is rendered into the workspace at deploy.
    pulseEnabledOverride: v.optional(v.boolean()),
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
    // PR 1 (2026-07-15) — gateway auth token (per-agent, DISTINCT from
    // hookToken: OpenClaw refuses to boot when hooks.token matches the
    // gateway auth token — live crash-loop on clawlaunch-ws799yk4). Used by
    // Convex to call the gateway's OpenAI-compatible endpoint so founder DMs
    // run inside the durable `agent:main:main` session. Injected on the
    // machine as OPENCLAW_GATEWAY_TOKEN at deploy.
    gatewayToken: v.optional(v.string()),
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
    // v2 §5.1 — the morning-plan "day-plan" (JSON-on-row, NO new table). JSON:
    // { planDate:"YYYY-MM-DD", posture:string, originalPost?:{channel,angle,
    //   needsCreative}, funnelBudget:{tier1:"hunt"|number, tier2:number,
    //   tier3:number}, productMentionRatio:number, watchFor:[string],
    //   generatedAt:number }. The morning-plan cron compiles it; the heartbeat
    //   reads it for direction (hunt intent first, then build credibility).
    dayPlanJson: v.optional(v.string()),
    // v2 §7.6/§7.7 — the cold-strike QUEUE the daily Telegram digest drains
    // (JSON-on-row, NO new table). JSON: { candidates:[{threadId, platform,
    //   title, url, matchedPhrase, priorityScore, ageMinutes, tier, addedAt}],
    //   lastDigestSentAt?:number }. The heartbeat enqueues tap-channel strikes;
    //   the digest cron drains the top `coldStrikesPerDay` into one message.
    coldStrikeQueueJson: v.optional(v.string()),
    // Single-tier plan state (gtm99). JSON: {tier, status, connectedChannelCap,
    // autoPostChannelCap, videoCreditsMonth, xUrlPostsSoftCapMonth, periodStart,
    // usage:{autoPostsThisPeriod, xUrlPostsThisPeriod, videosThisPeriod}}.
    // Parsed by planFeaturesGtm; ONLY Stripe webhook handlers write it.
    gtmPlanJson: v.optional(v.string()),
    // ─── Cancellation lifecycle (accountLifecycle.ts) ───────────────────────
    // Stamped when the founder cancels (Stripe cancel_at_period_end:true). The
    // plan stays ACTIVE until period end (Stripe keeps emitting status:"active"
    // until customer.subscription.deleted lapses it to none), then the machine
    // is torn down to stop COGS while DATA is retained for resume. The 30-day
    // retention purge (crons.ts → accountLifecycle.sweepCanceledRetention) hard-
    // purges accounts whose plan is `none` AND were canceled >30d ago. Cleared
    // (set to undefined-via-omit semantics: we patch it back to 0/clear) on
    // resume so a resubscribe is never swept. `gtmCanceledPeriodEndMs` records
    // the Stripe period end so the UI can show "active until <date>, then paused".
    gtmCanceledAt: v.optional(v.number()),
    gtmCanceledPeriodEndMs: v.optional(v.number()),
    // W2 — founder's autonomous-vs-confirm posting preference, layered INSIDE
    // the plan ceiling (planFeaturesGtm.canAutoPost) and the ban-safety floor
    // (Reddit/TikTok always confirm). Only ever tightens the AUTO channels
    // (X/LI/IG/YT). Default confirm_first_week (trust ramp). Absent = fail-closed
    // to confirm. `autonomousSince` starts the ramp clock; `confirmedPostCount`
    // counts founder one-tap confirms toward graduation (3 posts OR 7 days).
    autonomousPosting: v.optional(
      v.union(
        v.literal("confirm_each"),
        v.literal("confirm_first_week"),
        v.literal("autonomous")
      )
    ),
    autonomousSince: v.optional(v.number()),
    confirmedPostCount: v.optional(v.number()),
    // Unix-ms Maya ASKED the founder about going autonomous (the ramp milestone
    // triggers her offer, never a silent grant). Null = not asked yet; reset
    // alongside the ramp when re-entering confirm_first_week.
    autonomyAskAt: v.optional(v.number()),
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
    // Unix-ms the foundation RESEARCH first completed (buyer map + ≥1 competitor
    // + ≥1 channel scorecard). DURABLE marker — once stamped, research is "done"
    // forever even if rows later move. This DECOUPLES engage-start from strategy
    // DELIVERY: steady-state engagement gates on `engagementReady` (= research
    // done), so a flaked synthesis send no longer leaves the agent idle. The
    // synthesis-once + onboarding-complete semantics still gate on
    // strategyDeliveredAt below (unchanged).
    researchCompletedAt: v.optional(v.number()),
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
    // ─── Explicit lifecycle state machine (the enum refactor) ────────────────
    // The SINGLE authority for "where is this agent." Replaces inferring state
    // from ~6 scalar flags (which conflated "Maya's work done" with "the user
    // received it" and produced the delivery-failure re-synthesis loop). States:
    //   fresh        — deployed, no work yet.
    //   researching  — the bounded foundation pass (research + plan generation).
    //                  The ONLY heavy-work state; lease + acquire-cap apply here.
    //   plan_ready   — the plan is GENERATED + cached. Maya's work is DONE; she
    //                  goes idle. Delivery (push the cached plan) + approval +
    //                  account-connect are now EVENTS, never work she spins on.
    //   active       — approved AND ≥1 account connected → the daily engage loop.
    // Optional for back-compat: legacy agents have undefined → computeAgentLife-
    // cycle derives + write-repairs it from durable evidence each read.
    lifecycleState: v.optional(
      v.union(
        v.literal("fresh"),
        v.literal("researching"),
        v.literal("plan_ready"),
        v.literal("active")
      )
    ),
    // Unix-ms the synthesis plan was GENERATED (the agent composed it and the
    // send_update handler claimed/cached it). This — NOT delivery — is the
    // "Maya's work is done" marker: foundationComplete flips on it, so the
    // watchdog stops the moment the plan exists, whether or not the send landed.
    // Doubles as the atomic synthesis CLAIM token (only one session stamps it).
    planGeneratedAt: v.optional(v.number()),
    // The exact synthesis plan text, cached so Convex can RE-PUSH it on the
    // channel-connected event (deliver-on-connect) without the agent ever
    // re-generating. This is what makes a failed/again send cheap (cents to
    // re-push) instead of a full strategy rebuild (dollars), killing the loop.
    cachedSynthesisText: v.optional(v.string()),
    // PLAN_APPROVAL_LOOP_V1 §2 — the plan as a STRUCTURED, VERSIONED object
    // (JSON string per the 138-table TS ceiling: read/goal/moves/notDoing/
    // week/asks/amendments/version/status). cachedSynthesisText stays the
    // prose she delivers in chat; this is what the web approval screen
    // renders and what amendments diff against. Written via save_plan_doc.
    planDocJson: v.optional(v.string()),
    // Bounded delivery-retry counter. Each Convex push attempt of the cached
    // plan increments it; past the cap the agent stays dormant (plan held) and
    // we alert, rather than retry a dead channel forever.
    planDeliveryAttempts: v.optional(v.number()),
    // ─── Spend THROTTLE (runaway-burn backstop — degrade, never destroy) ─────
    // RULE: a cost ceiling THROTTLES, it never destroys a user's agent. When
    // ROLLING-window spend crosses a ceiling ($3/hr velocity OR $6/24h
    // sustained, defaults in spendKill.ts, env-overridable), the agent is
    // stamped with a 24h throttle: its expensive discretionary work (the
    // discovery/research pulse) self-pauses to monitoring-only (the discovery
    // gate reads spendThrottledUntil), while the Fly machine KEEPS RUNNING
    // indefinitely and the agent still answers the user. Rolling windows (not
    // lifetime) so a normal ~$2/day driver never trips it.
    //   spendKillCapUsd — OPTIONAL per-agent override of the 24h ceiling.
    //   spendThrottledUntil — epoch-ms; while > now the agent is throttled
    //     (discovery paused). Auto-clears; the sweep re-stamps if still over.
    //   spendThrottledAt / spendThrottleReason — when/why it last fired.
    //   killedAt / killReason — reserved for EXPLICIT cancellation
    //     (accountLifecycle), NEVER a spend cap; a killed agent is skipped.
    spendKillCapUsd: v.optional(v.number()),
    spendThrottledUntil: v.optional(v.number()),
    spendThrottledAt: v.optional(v.number()),
    spendThrottleReason: v.optional(v.string()),
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
      v.literal("log_message"),
      // W1.2 — founder corrects a product fact in chat; persisted to gtmApps.
      v.literal("update_product_fact"),
      // Real-time operator Phase-1 — founder steering directive idempotency
      // lane (Maya's save_steering_directive tool POSTs with this kind).
      v.literal("save_steering_directive"),
      // Real-time operator Phase-3 — discovery-pulse channel watermark advance
      // idempotency lane (the advance_watermark tool POSTs with this kind).
      v.literal("advance_watermark")
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
    // Phase 2 ⑤ — discovery-budget tagging. `discovery: true` marks spend from
    // the continuous hunt loop (read-API scans + cheap-model scoring) so the
    // per-hour/per-day discovery budget gate can sum it independently of
    // research/foundation/operational spend. `lane` records which watch lane
    // (buyer_intent / switch_intent / competitor / own_perf / go_time) drove it.
    discovery: v.optional(v.boolean()),
    lane: v.optional(v.string()),
    // Creative-budget tagging. `creative: true` marks a paid render (Creatify
    // UGC / video / image) so creativeBudgetGate can sum monthly creative-credit
    // spend independently of discovery + operational spend. Mirrors `discovery`.
    creative: v.optional(v.boolean()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_research_job", ["researchJobId"])
    .index("by_account_and_provider", ["accountId", "provider"])
    // Phase 2 — time-windowed sums (discovery budget gate, hourly/daily caps).
    .index("by_account_and_created", ["accountId", "createdAt"])
    .index("by_account_discovery_created", ["accountId", "discovery", "createdAt"])
    // Creative budget gate — billing-period-windowed sums of creative spend.
    .index("by_account_creative_created", ["accountId", "creative", "createdAt"]),

  // Phase 2 ④ — per-channel read watermark. Bounds delta-only reads so the
  // hunt loop never re-pulls history: each (account, channel) records the
  // newest item already seen (timestamp + opaque cursor/id), and the next read
  // asks only for items past it. Per channel because each read API cursors
  // differently.
  gtmChannelWatermarks: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    channel: v.string(),
    lastObservedAtMs: v.optional(v.number()),
    lastSeenId: v.optional(v.string()),
    cursor: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_channel", ["accountId", "channel"])
    .index("by_agent", ["agentId"]),

  // Phase 2 ④ — rotating watch-lane scheduler state. The pulse rotates across
  // lanes rather than sweeping all every tick; this tracks when each lane last
  // ran + its next-due time so the engine round-robins without re-scanning.
  gtmWatchLaneState: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    lane: v.string(),
    lastRunAtMs: v.optional(v.number()),
    nextDueAtMs: v.optional(v.number()),
    consecutiveDryRuns: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_lane", ["accountId", "lane"])
    .index("by_agent", ["agentId"]),

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
    // v2 §1.1 — funnel-tier reasoning/audit. The tier value itself reuses the
    // EXISTING `tier` field below (T1 hot buying-intent → T4 trash). This records
    // WHY it was judged that tier + who/when, so the digest can explain itself.
    tierJudgment: v.optional(
      v.object({
        tier: v.string(),
        reason: v.string(),
        judgedAt: v.number(),
        judgedBy: v.string(),
      })
    ),
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
    /** PLAN_APPROVAL_LOOP_V1 §6 — why this action: why this thread, why this
     *  angle, expected outcome. Set at save_draft; rendered on Queue cards. */
    rationale: v.optional(v.string()),
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
    // Optional since 2026-07: founder-confirmed publishes stamp the dedup
    // ledger even when no gtmDraftedContent row exists for the reply.
    draftId: v.optional(v.id("gtmDraftedContent")),
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

  // ─── Thinking decision-timeline — raw tool-call trace ─────────────────
  // The literal record of Maya (and her subagents) DECIDING: every tool
  // call she makes, its key args, and the outcome — emitted automatically
  // by a wrapper around the maya-gtm-tools plugin (NOT model-narrated, so
  // it can't be skipped or embellished). This is the data behind the
  // dashboard "Thinking" page's live decision timeline: the operator watches
  // their manager actually work (read Reddit → judge fit → draft → validate
  // → post), grounded in real calls rather than the sparse, optional
  // post_activity self-narration in gtmAgentActivity.
  //
  // Capture path: the plugin's withTrace() wrapper POSTs one row per tool
  // call to /lc_gtm/log_trace (token-derived agentId), best-effort — a
  // trace failure NEVER blocks the underlying tool. The logging/transport
  // tools themselves are excluded so the feed never logs itself.
  //
  // Grouping: turnId is model-passed and absent on most tools, so rows are
  // NOT grouped at write time; the read layer buckets by time-gap "work
  // sessions". toolCallId is the runtime's unique per-call id (dedup).
  //
  // Tenant isolation: accountId === Id<"creators">; all reads scope by it.
  gtmAgentTrace: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Tool name as registered in the plugin (e.g. "research_reddit"). */
    tool: v.string(),
    /** Coarse bucket for the UI icon/lane — derived plugin-side from tool. */
    category: v.union(
      v.literal("research"), // read the market (research_*, search_*, scrape_*)
      v.literal("draft"), // produced content (save_draft, *_voice_match, slide)
      v.literal("publish"), // pushed live / queued (post_to_channel, publish_*)
      v.literal("foundation"), // saved strategy (save_foundation_*, set_*)
      v.literal("read"), // read own state (get_my_*)
      v.literal("other") // everything else not worth a dedicated lane
    ),
    /** Compact one-line summary of the call's key args (capped at write). */
    argsSummary: v.optional(v.string()),
    /** Compact summary of the result string postLc/getLc returned (capped). */
    resultSummary: v.optional(v.string()),
    /** Outcome derived from the result prefix (OK / BLOCKED / FAILED / ERROR). */
    status: v.union(
      v.literal("ok"),
      v.literal("blocked"),
      v.literal("failed"),
      v.literal("error")
    ),
    /** Wall-clock the call took, plugin-side. */
    latencyMs: v.optional(v.number()),
    /** Runtime's unique per-call id — dedup key (best-effort idempotency). */
    toolCallId: v.optional(v.string()),
    /** True when emitted by a research subagent rather than the main brain. */
    isSubagent: v.optional(v.boolean()),
    ts: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_ts", ["accountId", "ts"])
    .index("by_agent", ["agentId"])
    .index("by_toolCallId", ["toolCallId"]),

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

  // ─── Real-time operator — founder steering directives ─────────────────
  // When the founder texts Maya a directive ("focus more on LinkedIn",
  // "stop posting on X", "go harder on the pricing angle"), it is captured
  // as a DURABLE steering row that future engine code (heartbeat/pulse) and
  // Maya's prompts read to bias channel/angle selection. Additive + minimal:
  // it never mutates strategy tables — it is an operator-intent overlay the
  // engine consults. Captured from the inbound founder-text path (a
  // lightweight deterministic classifier, no hot-path LLM call) and/or via
  // the `save_steering_directive` typed tool when Maya parses one explicitly.
  gtmSteeringDirectives: defineTable({
    accountId: v.id("creators"),
    agentId: v.id("gtmAgents"),
    /** Verbatim founder directive text (capped at capture time). */
    directive: v.string(),
    /** Lowercased channel/angle hints the classifier (or Maya) extracted,
     *  e.g. ["linkedin", "pricing"]. Engine reads these to bias selection. */
    laneHints: v.optional(v.array(v.string())),
    /** Coarse parsed intent — what the founder is asking for. */
    intent: v.optional(
      v.union(
        v.literal("focus"),
        v.literal("avoid"),
        v.literal("angle"),
        v.literal("pace"),
        v.literal("other")
      )
    ),
    /** How this row was captured. */
    source: v.union(
      v.literal("founder"),
      v.literal("maya_tool")
    ),
    /** turnId of the inbound message this came from (if captured inline). */
    turnId: v.optional(v.string()),
    /** Active until explicitly superseded by a later contradicting directive
     *  or by the founder. The engine reads only active rows. */
    active: v.boolean(),
    supersededAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_and_active", ["accountId", "active"])
    .index("by_agent", ["agentId"]),

  // ─── end ClawLaunch / Maya GTM product ────────────────────────────────

  /* ══════════════════════════════════════════════════════════════════════ */
  /* convex/maya/ — the clean-sheet product (§3.4)                          */
  /*                                                                        */
  /* Nine per-customer tables plus two deliberately-shared ones. If a tenth  */
  /* per-customer table looks necessary, something in the design is wrong.   */
  /*                                                                        */
  /* Structured blobs are stored as JSON strings rather than nested         */
  /* validators — the schema sits near TypeScript's instantiation ceiling,  */
  /* and deep nesting is what pushes it over (it already regressed          */
  /* `db.get()` narrowing once).                                            */
  /* ══════════════════════════════════════════════════════════════════════ */

  /** The slowly-changing facts about one customer. */
  customers: defineTable({
    /** The auth + billing row. Clerk identity and the Stripe customer already
     *  hang off `creators`, so the new module points at it rather than
     *  forking a second identity. */
    accountId: v.id("creators"),
    /** Routes a customer between the frozen `gtmMaya` agent and the new one.
     *  Migration is per-customer, not a flag day. */
    agentVersion: v.union(v.literal("v1"), v.literal("v2")),
    /** MVP ships ONE tier at $149 with everything unlocked (§17.2.5). Tiers
     *  return post-PMF as BUDGETS, never booleans — so this is a union with
     *  one member today and more later, not a set of capability flags. */
    plan: v.union(v.literal("mvp")),
    /** `paused` and `cancelled` both stop publishing; neither deletes data.
     *  Trial expiry without a card lands here, not in a purge (§17.x). */
    state: v.union(
      v.literal("onboarding"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("cancelled")
    ),
    timezone: v.string(),
    /** What the product actually is and does — the grounding for every claim
     *  she makes. JSON. */
    productTruthJson: v.optional(v.string()),
    /** Who buys it: segments, the complaint list, where they gather. JSON. */
    buyerJson: v.optional(v.string()),
    /** Learned from the founder's real posts and their edits to drafts. JSON. */
    voiceProfileJson: v.optional(v.string()),
    /** Colors, fonts, logo refs, on-brand/off-brand examples. JSON. */
    brandKitJson: v.optional(v.string()),
    /** Where she texts them. Absent until Telegram pairing completes. */
    telegramChatId: v.optional(v.string()),
    /**
     * SHA-256 of the agent's bearer token — the credential her runtime presents
     * on every tool call.
     *
     * Hashed, never plaintext: a leaked database read shouldn't hand over the
     * ability to act as any customer's agent. And it's what the tool surface
     * resolves tenancy FROM — no hook accepts a customerId in its body, so a
     * confused or compromised agent cannot name a tenant it isn't.
     */
    agentTokenHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_telegram_chat", ["telegramChatId"])
    .index("by_state", ["state"])
    .index("by_agent_version", ["agentVersion"])
    .index("by_agent_token", ["agentTokenHash"]),

  /** One row per connected channel. */
  channels: defineTable({
    customerId: v.id("customers"),
    channel: v.union(
      v.literal("tiktok"),
      v.literal("instagram"),
      v.literal("youtube"),
      v.literal("x")
    ),
    /** THE switch (§17.85). On `just_go`, exactly one function decides
     *  publish-or-hold, and nothing else may hold a publish — no ramp, no
     *  trust score, no "this one seems sensitive". The old system had ten
     *  ANDed gates, which is why "post it" did nothing. */
    postingMode: v.union(v.literal("show_me_first"), v.literal("just_go")),
    /** `dormant` is an over-cap channel after a downgrade: OAuth preserved,
     *  reactivates instantly. Never deleted. */
    status: v.union(
      v.literal("connected"),
      v.literal("dormant"),
      v.literal("disconnected"),
      v.literal("error")
    ),
    /** Zernio holds the OAuth grant; we hold its id. Raw platform tokens are
     *  never stored here — we never hold a customer's passwords or session. */
    zernioAccountId: v.optional(v.string()),
    handle: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_channel", ["customerId", "channel"])
    .index("by_customer_and_status", ["customerId", "status"]),

  /**
   * Every rule the founder ever gave — APPEND-ONLY, stored VERBATIM (§10.2).
   *
   * Rows are never edited. Superseding writes a NEW row pointing at the old
   * one, so "why is LinkedIn quiet?" is answered with what they actually said
   * on the day they said it, not a paraphrase. This single behavior does more
   * for trust than the entire dashboard.
   */
  directives: defineTable({
    customerId: v.id("customers"),
    kind: v.union(
      v.literal("posting_mode"),
      v.literal("channel_toggle"),
      v.literal("cadence"),
      v.literal("timing_window"),
      v.literal("topic"),
      v.literal("phrase_ban"),
      v.literal("voice"),
      v.literal("entity_rule"),
      v.literal("approved_claim"),
      v.literal("product_truth"),
      v.literal("icp_correction"),
      v.literal("notification_pref"),
      v.literal("pause"),
      v.literal("escalation"),
      v.literal("standing_task"),
      v.literal("campaign"),
      v.literal("other")
    ),
    /** EXACTLY what they typed. Never cleaned up, never summarized. */
    verbatim: v.string(),
    /** Our reading of it. Separate field so the quote stays pristine. */
    interpretationJson: v.optional(v.string()),
    active: v.boolean(),
    /** The older row this one overrides. Recency wins, but never silently —
     *  the superseded rule gets named in a clause when it matters. */
    supersedesId: v.optional(v.id("directives")),
    supersededAt: v.optional(v.number()),
    /** The inbound message it came from, for provenance. */
    sourceMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_active", ["customerId", "active"])
    .index("by_customer_and_kind", ["customerId", "kind"]),

  /** The idea bank — angles with evidence behind them (§7.4). */
  ideas: defineTable({
    customerId: v.id("customers"),
    angle: v.string(),
    /** What makes this worth writing: the thread, the complaint, the trend.
     *  An idea with no evidence is a guess, and guesses don't get published. */
    evidenceJson: v.optional(v.string()),
    score: v.optional(v.number()),
    status: v.union(
      v.literal("bank"),
      v.literal("used"),
      v.literal("discarded")
    ),
    sourceKind: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_status", ["customerId", "status"]),

  /** Threads and posts worth engaging. Deduped, freshness-scored. */
  targets: defineTable({
    customerId: v.id("customers"),
    channel: v.string(),
    url: v.string(),
    kind: v.union(
      v.literal("thread"),
      v.literal("post"),
      v.literal("comment"),
      v.literal("mention")
    ),
    /** Stable across sweeps so the same thread isn't re-surfaced every hour. */
    dedupeKey: v.string(),
    freshnessScore: v.optional(v.number()),
    status: v.union(
      v.literal("open"),
      v.literal("engaged"),
      v.literal("skipped"),
      v.literal("expired")
    ),
    snippet: v.optional(v.string()),
    seenAt: v.number(),
    /** Every non-terminal state needs a timeout and an owner — no state may
     *  be silently permanent (invariant 8). */
    expiresAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_status", ["customerId", "status"])
    .index("by_customer_and_dedupe", ["customerId", "dedupeKey"]),

  /**
   * Written content, SNAPSHOTTED at propose time (invariant 2).
   *
   * What the founder approved is what publishes — never a regeneration. The
   * `outcome` + `editDiff` pair is also the voice training signal: what they
   * changed is what the voice profile learns from.
   */
  drafts: defineTable({
    customerId: v.id("customers"),
    ideaId: v.optional(v.id("ideas")),
    channel: v.string(),
    kind: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("cold_reply")
    ),
    /** The exact text shown to the founder. Publishing reads THIS. */
    snapshotText: v.string(),
    mediaAssetIdsJson: v.optional(v.string()),
    outcome: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("edited"),
      v.literal("rejected"),
      v.literal("expired")
    ),
    /** What they changed, when they edited rather than approved. */
    editDiff: v.optional(v.string()),
    proposedAt: v.number(),
    decidedAt: v.optional(v.number()),
    /** Invariant 8 again: a pending draft cannot sit forever. */
    expiresAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_outcome", ["customerId", "outcome"]),

  /**
   * Everything that went live — the unit of results AND the archive spine.
   *
   * `snapshotText` survives the platform deleting the post, which is what
   * makes results provable months later. Text-search indexed (§16.8.2).
   */
  placements: defineTable({
    customerId: v.id("customers"),
    kind: v.union(
      v.literal("post"),
      v.literal("reply"),
      v.literal("cold_reply")
    ),
    channel: v.string(),
    /** Invariant 1: a live URL, or an explicit unknown. Never an assumption. */
    url: v.optional(v.string()),
    linkStatus: v.union(
      v.literal("live"),
      v.literal("gone"),
      v.literal("unknown")
    ),
    publishedAt: v.number(),
    snapshotText: v.string(),
    mediaAssetIdsJson: v.optional(v.string()),
    metricsJson: v.optional(v.string()),
    /** Freshness stamp — metrics without one are a number with no date, which
     *  is how dashboards start lying. */
    metricsAsOf: v.optional(v.number()),
    /** The provenance chain (§16.8.4): which draft, which idea, which format. */
    draftId: v.optional(v.id("drafts")),
    ideaId: v.optional(v.id("ideas")),
    formatCardId: v.optional(v.string()),
    /** Invariant 4: every publish carries one. */
    idempotencyKey: v.string(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_publishedAt", ["customerId", "publishedAt"])
    .index("by_idempotency_key", ["idempotencyKey"])
    .searchIndex("search_snapshot_text", {
      searchField: "snapshotText",
      filterFields: ["customerId", "channel"],
    }),

  /** Every message in and out, including proactive. Both surfaces read this. */
  messages: defineTable({
    customerId: v.id("customers"),
    direction: v.union(v.literal("in"), v.literal("out")),
    surface: v.union(
      v.literal("telegram"),
      v.literal("web"),
      v.literal("system")
    ),
    body: v.string(),
    /** Invariant 6: every outbound message has one, so a retry or a double
     *  trigger can't say the same thing twice. */
    dedupeKey: v.optional(v.string()),
    /** She started this one, rather than replying. */
    proactive: v.optional(v.boolean()),
    /** Groups a turn across the inbound message and everything it caused. */
    turnId: v.optional(v.string()),
    /** Invariant 5: at most one open question at a time — this marks it. */
    awaitingAnswer: v.optional(v.boolean()),
    /**
     * When it actually reached them.
     *
     * A row in this table means "we wrote it", NOT "they got it". Conflating
     * those is how the old system produced eaten replies: the transcript
     * showed a message the founder never received, so every later decision was
     * made against a conversation that only existed on our side. Outbound rows
     * are undelivered until proven otherwise.
     */
    deliveredAt: v.optional(v.number()),
    /** Why delivery failed, in plain language. Never silently dropped. */
    deliveryError: v.optional(v.string()),
    ts: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_customer_and_ts", ["customerId", "ts"])
    // Dedupe is a PER-CUSTOMER guarantee. A global lookup on `dedupeKey`
    // suppressed every customer's brief after the first one each day, because
    // `brief:<date>` is identical across the fleet.
    .index("by_customer_and_dedupe", ["customerId", "dedupeKey"])
    .index("by_customer_and_awaiting", ["customerId", "awaitingAnswer"])
    .index("by_delivery", ["direction", "deliveredAt"]),

  /**
   * The work queue.
   *
   * Idempotency key, attempts, status, deadline — nothing fails silently
   * (principle 5), and nothing runs twice on a retry.
   */
  jobs: defineTable({
    /** Absent for fleet-wide work like the vendor smoke suite. */
    customerId: v.optional(v.id("customers")),
    kind: v.string(),
    /** Claiming is keyed on this, so the same work enqueued twice runs once. */
    idempotencyKey: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("dead")
    ),
    attempts: v.number(),
    maxAttempts: v.number(),
    payloadJson: v.optional(v.string()),
    /** Backoff: not eligible to run before this. */
    runAfter: v.number(),
    /** Invariant 8: past this, a `running` job is reaped, not left hanging. */
    deadlineAt: v.number(),
    /** A named failure that can reach the user — never a silent drop. */
    lastError: v.optional(v.string()),
    /**
     * What this job actually spent, in USD.
     *
     * §8.1: budgets are "rows the server draws down, not instructions". Daily
     * spend is therefore DERIVED by summing this across a customer's jobs
     * rather than kept in a counter — a counter can drift, and a drifted spend
     * counter either throttles someone who spent nothing or fails to throttle
     * a runaway.
     */
    costUsd: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_customer_and_createdAt", ["customerId", "createdAt"])
    .index("by_status_and_runAfter", ["status", "runAfter"])
    .index("by_customer", ["customerId"])
    .index("by_status_and_deadline", ["status", "deadlineAt"]),

  /**
   * SHARED ACROSS TENANTS, deliberately (§17.35.3).
   *
   * Trends, format cards, comment-mined ideas and benchmarks are identical for
   * every customer in a niche, so paying for them per-tenant is paying N times
   * for one answer. This is what makes the perception layer affordable, and it
   * has to exist from the start — retrofitting a shared cache onto per-tenant
   * rows is painful.
   *
   * Invariant 9 carve-out: because it is shared, it contains NO
   * customer-identifying data. Nothing here may be traceable to one customer.
   */
  nicheCache: defineTable({
    /** Hash of the niche descriptor — the sharing key. Never a customer id. */
    nicheFingerprint: v.string(),
    kind: v.string(),
    payloadJson: v.string(),
    fetchedAt: v.number(),
    ttlSec: v.number(),
    /** Which vendor call produced it, for cost attribution and invalidation. */
    sourceKind: v.optional(v.string()),
  })
    .index("by_fingerprint_and_kind", ["nicheFingerprint", "kind"])
    .index("by_kind_and_fetchedAt", ["kind", "fetchedAt"]),

  /**
   * Vendor smoke suite results (§18.0.5).
   *
   * FLEET-level, not per-tenant: this is "is Zernio's contract still what we
   * think it is", not "is this customer's account connected" (that's
   * `gtmConnectionHealth`). Deliberately has no `accountId` — a vendor
   * changing its response shape is everyone's problem at once.
   *
   * A row per check per run. Shape drift is an incident, not a test failure
   * someone notices on Monday, so these rows are what the operator view reads.
   */
  vendorHealth: defineTable({
    vendor: v.union(
      v.literal("zernio"),
      v.literal("scrapecreators"),
      v.literal("twitterapiio"),
      v.literal("creatify"),
      v.literal("openrouter"),
      v.literal("r2"),
      v.literal("gemini")
    ),
    /** 1 = reachability (hourly, free) · 2 = shape (daily, cents) ·
     *  3 = round-trip (weekly + pre-deploy, real money). */
    tier: v.union(v.literal(1), v.literal(2), v.literal(3)),
    /** The wrapped endpoint under test, e.g. `tiktok.user/audience`.
     *  Vendor-level tier-1 checks use the vendor name. */
    check: v.string(),
    /** `skipped` is first-class and must stay visible: a suite that silently
     *  skips every check because a key is missing is a green suite that
     *  proves nothing. The operator view surfaces skips as unverified. */
    status: v.union(
      v.literal("pass"),
      v.literal("fail"),
      v.literal("skipped")
    ),
    /** Why it failed or was skipped — the alert body. */
    detail: v.optional(v.string()),
    /** Classified drift paths, e.g. `unexpected:platformResults`. Empty on a
     *  pass. This is what tells you WHAT the vendor changed. */
    drifts: v.optional(v.array(v.string())),
    latencyMs: v.optional(v.number()),
    /** What this check actually cost, for the suite-wide budget cap. */
    costUsd: v.optional(v.number()),
    /** Groups every check in one invocation, so a run can be read whole. */
    runId: v.string(),
    ranAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_vendor_and_ranAt", ["vendor", "ranAt"])
    .index("by_status_and_ranAt", ["status", "ranAt"])
    .index("by_vendor_and_check", ["vendor", "check"]),
});
