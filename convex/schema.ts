import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The data model from docs/CREATOR_SPRINT_PLAN.md §5. Eighteen tables, from zero.
// Invariants (§5): idempotency keys on jobs, dedupe keys on messages, at most one open
// question per creator, no permanent non-terminal state, every model turn bound to one
// creatorId, costUsd is vendor-reported or endpoint-table + reconciled.

const platform = v.union(v.literal("tiktok"), v.literal("instagram"));
const produced = v.object({
  skillVersion: v.string(),
  model: v.string(),
  thresholdsVersion: v.string(),
});

export default defineSchema({
  // ---------------------------------------------------------------- creators
  creators: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    phoneVerifiedAt: v.optional(v.number()),
    handles: v.object({
      tiktok: v.optional(v.string()),
      instagram: v.optional(v.string()),
    }),
    ownership: v.union(v.literal("unverified"), v.literal("verified")),
    niche: v.string(), // their one sentence, verbatim
    timezone: v.string(),
    quietHours: v.object({ start: v.string(), end: v.string() }),
    preferredSendHour: v.optional(v.number()), // §13.10 (5) cadence: the local hour they tend to reply in, learned nightly // "22:00" / "07:00" local
    tone: v.union(v.literal("coach"), v.literal("friend"), v.literal("blunt")),
    mode: v.union(v.literal("full"), v.literal("thin"), v.literal("newCreator")),
    dossier: v.optional(v.any()), // Dossier (§14.1), zod-validated at write time
    dossierVersion: v.number(),
    dossierPrevious: v.optional(v.any()), // §15.7: the version before the last rewrite
    dossierDiff: v.optional(v.object({ version: v.number(), at: v.number(), changed: v.array(v.string()) })),
    notes: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        kind: v.union(v.literal("fact"), v.literal("bit"), v.literal("life")),
        sourceMessageId: v.optional(v.id("messages")),
        at: v.number(),
        expiresHint: v.optional(v.number()),
        confirmedAt: v.optional(v.number()),
        tombstonedAt: v.optional(v.number()),
      }),
    ),
    // §13.10: computed from tasteEvents, decayed, never written by a model
    affinities: v.array(
      v.object({ key: v.string(), kind: v.string(), score: v.number(), n: v.number(), updatedAt: v.optional(v.number()) }),
    ),
    // §13.10 (4): the taste profile in prose, weekly rewrite, previous kept
    taste: v.optional(v.object({ text: v.string(), version: v.number(), updatedAt: v.number(), previous: v.optional(v.string()), eventsSeen: v.number() })),
    experiments: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        proposedAt: v.number(),
        verdictAt: v.optional(v.number()),
        result: v.optional(v.union(v.literal("held"), v.literal("failed"), v.literal("unknown"))),
      }),
    ),
    telegramChatId: v.optional(v.string()), // set by pairing; the only key inbound routes by
    pairingToken: v.optional(v.string()),
    pairingExpiresAt: v.optional(v.number()),
    channel: v.object({
      paired: v.boolean(),
      pairedAt: v.optional(v.number()),
      broken: v.optional(v.boolean()),
    }),
    plan: v.object({
      status: v.union(
        v.literal("onboarding"),
        v.literal("trialing"),
        v.literal("active"),
        v.literal("past_due"),
        v.literal("paused"),
        v.literal("canceled"),
        v.literal("comped"),
        v.literal("deleting"),
      ),
      trialEndsAt: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
      stripeCustomerId: v.optional(v.string()),
      stripeSubscriptionId: v.optional(v.string()),
      pastDueSince: v.optional(v.number()), // §19.3: three days of grace for proactive, then it pauses
      lastEventAt: v.optional(v.number()), // the Stripe event time last applied; older events change nothing
      founding: v.boolean(),
    }),
    firstWeek: v.optional(v.object({ startedAt: v.number(), stepsDone: v.array(v.string()) })),
    openQuestionId: v.optional(v.id("messages")), // at most one open question
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_stripe_customer", ["plan.stripeCustomerId"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_telegram_chat", ["telegramChatId"])
    .index("by_pairing_token", ["pairingToken"])
    .index("by_tiktok", ["handles.tiktok"])
    .index("by_instagram", ["handles.instagram"]),

  // ---------------------------------------------------------- tracked accounts
  trackedAccounts: defineTable({
    creatorId: v.id("creators"),
    platform,
    handle: v.string(),
    platformUserId: v.optional(v.string()),
    addedBy: v.union(v.literal("creator"), v.literal("suggested"), v.literal("maya")),
    why: v.optional(v.string()),
    transfer: v.optional(v.union(v.literal("high"), v.literal("partial"), v.literal("low"))),
    medianPace24h: v.optional(v.number()), // account baseline (§13.2); undefined = unknown
    baselineN: v.number(),
    lastSampledAt: v.optional(v.number()),
    lastPostedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("private"), v.literal("gone"), v.literal("removed")),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_handle", ["platform", "handle"]),

  // -------------------------------------------------------------- observations
  // Other people's posts with metrics, one row per sample (velocity is computed from repeats).
  observations: defineTable({
    platform,
    postId: v.string(),
    authorHandle: v.string(),
    url: v.string(),
    createTime: v.number(),
    sampledAt: v.number(),
    ageHours: v.number(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
    saves: v.optional(v.number()),
    clipId: v.optional(v.string()), // the sound, when the platform exposes one (§13.4 sound signals)
    keywords: v.array(v.string()), // which lane keywords surfaced it
    source: v.string(), // read kind that produced it
    paidPromotion: v.optional(v.boolean()),
  })
    .index("by_post", ["platform", "postId", "sampledAt"])
    .index("by_author", ["platform", "authorHandle", "sampledAt"])
    .index("by_sampledAt", ["sampledAt"]),

  // ----------------------------------------------------------------- readCache
  // Every vendor read, keyed by kind + normalized params. Shared across tenants. No PII.
  readCache: defineTable({
    kind: v.string(),
    key: v.string(),
    params: v.any(),
    value: v.optional(v.any()),
    fetchedAt: v.optional(v.number()),
    expiresAt: v.number(),
    inFlightSince: v.optional(v.number()),
    error: v.optional(v.string()),
    credits: v.optional(v.number()),
    fixture: v.optional(v.union(v.literal("recorded"), v.literal("spec-example"))),
  })
    .index("by_key", ["kind", "key"])
    .index("by_expiresAt", ["expiresAt"]),

  // ------------------------------------------------------------------ ownPosts
  ownPosts: defineTable({
    creatorId: v.id("creators"),
    platform,
    postId: v.string(),
    url: v.string(),
    crossPostOf: v.optional(v.id("ownPosts")),
    createTime: v.number(),
    contentType: v.union(v.literal("video"), v.literal("carousel"), v.literal("photo")),
    durationSec: v.optional(v.number()),
    caption: v.string(),
    hashtags: v.array(v.string()),
    soundClipId: v.optional(v.string()),
    metrics: v.object({
      views: v.number(),
      likes: v.number(),
      comments: v.number(),
      shares: v.number(),
      saves: v.optional(v.number()),
      avgWatchTimeMs: v.optional(v.number()),
      skipRate: v.optional(v.number()),
    }),
    metricsAsOf: v.number(),
    source: v.union(v.literal("scrape"), v.literal("zernio"), v.literal("official"), v.literal("screenshot")),
    multiple: v.optional(v.number()), // views / creator baseline at capture
    matchCheckedAt: v.optional(v.number()), // §13.5: match-post has judged this post against recent ideas
    transcript: v.optional(v.string()),
    sample: v.optional(v.array(v.string())), // top | weak | recent | outlier | history
  })
    .index("by_creator", ["creatorId", "createTime"])
    .index("by_creator_post", ["creatorId", "platform", "postId"])
    .index("by_post", ["platform", "postId"]),

  // -------------------------------------------------------------- ownPostReads
  ownPostReads: defineTable({
    creatorId: v.id("creators"),
    ownPostId: v.id("ownPosts"),
    card: v.any(), // FormatCard + OwnPostExtension (§14.2)
    depth: v.union(v.literal("read"), v.literal("watch")),
    benchmark: v.optional(v.any()),
    rung: v.optional(v.union(v.literal("L0"), v.literal("L1"), v.literal("L2"), v.literal("healthy"), v.literal("unknown"))),
    hypothesis: v.optional(v.string()),
    modelOverride: v.optional(v.object({ rung: v.string(), why: v.string() })),
    produced,
    createdAt: v.number(),
  }).index("by_creator", ["creatorId", "createdAt"]),

  // ------------------------------------------------------------------- signals
  signals: defineTable({
    creatorId: v.id("creators"),
    /**
     * ⚠️ The post's URL, set at detection and NEVER overwritten.
     *
     * This used to be parsed back out of `why` by splitting the sentence on "; ". Then
     * recording a verdict patches `why` with the model's reason, which destroyed the URL
     * permanently — so a re-judged signal produced a scout message with no link for the
     * creator to open. Found by the eval gate's `has_link` check on 2026-09-03.
     */
    url: v.optional(v.string()),
    kind: v.union(
      v.literal("breakout"),
      v.literal("shape"),
      v.literal("sound"),
      v.literal("calendar"),
      v.literal("worth_seeing"),
      v.literal("win"),
    ),
    sourcePostIds: v.array(v.string()),
    trackedAccountId: v.optional(v.id("trackedAccounts")),
    clipId: v.optional(v.string()),
    calendarEventId: v.optional(v.string()),
    score: v.number(),
    corroboration: v.object({ accounts: v.number(), soundRising: v.boolean() }),
    formatFingerprint: v.optional(v.string()),
    // §13.11: the trace of what she looked up before judging, and what it cost
    investigation: v.optional(v.array(v.object({ tool: v.string(), params: v.any(), why: v.string(), credits: v.optional(v.number()), ms: v.number(), ok: v.boolean(), detail: v.optional(v.string()) }))),
    verdict: v.union(v.literal("pending"), v.literal("sent"), v.literal("held"), v.literal("dropped")),
    why: v.string(),
    thresholdsVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId", "createdAt"])
    .index("by_creator_verdict", ["creatorId", "verdict"]),

  // --------------------------------------------------------------------- ideas
  ideas: defineTable({
    creatorId: v.id("creators"),
    signalId: v.optional(v.id("signals")),
    evidenceLinks: v.array(v.string()),
    rhymesWithOwnPostId: v.optional(v.id("ownPosts")),
    ridesEventId: v.optional(v.string()),
    fit: v.union(v.literal("yes"), v.literal("maybe"), v.literal("no")),
    fitWhy: v.string(),
    version: v.any(), // Idea.version (§14.4)
    messageText: v.string(),
    messageId: v.optional(v.id("messages")),
    sentAt: v.optional(v.number()),
    reaction: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    matchedPostId: v.optional(v.id("ownPosts")),
    matchConfidence: v.optional(v.union(v.literal("certain"), v.literal("likely"), v.literal("unsure"), v.literal("no"))),
    status: v.union(v.literal("sent"), v.literal("hearted"), v.literal("posted"), v.literal("passed"), v.literal("expired")),
    formatFingerprint: v.optional(v.string()),
    // §13.10 (2): named by the writer in the same call that wrote the idea
    features: v.optional(v.object({ format: v.string(), topics: v.array(v.string()), tone: v.string(), lengthBucket: v.string(), sound: v.string(), source: v.string(), account: v.optional(v.string()) })),
    newForYou: v.optional(v.boolean()),
    savedAt: v.optional(v.number()), // the swipe file (§11.3 save): kept, filterable, never expires
    produced,
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId", "createdAt"])
    .index("by_creator_status", ["creatorId", "status"]),

  // --------------------------------------------------------------- predictions
  predictions: defineTable({
    creatorId: v.id("creators"),
    subject: v.object({ ownPostId: v.optional(v.id("ownPosts")), draftFileId: v.optional(v.id("_storage")), url: v.optional(v.string()) }),
    confidence: v.union(v.literal("strong"), v.literal("solid"), v.literal("fine"), v.literal("weak"), v.literal("broken")),
    expectedMultiple: v.number(),
    opinion: v.any(), // Opinion (§14.6)
    outcomeMultiple: v.optional(v.number()),
    scoredAt: v.optional(v.number()),
    produced,
    createdAt: v.number(),
  }).index("by_creator", ["creatorId", "createdAt"]),

  // ------------------------------------------------------------ calendarBlocks
  calendarBlocks: defineTable({
    creatorId: v.id("creators"),
    kind: v.union(v.literal("film"), v.literal("edit"), v.literal("post")),
    start: v.number(),
    end: v.number(),
    title: v.string(),
    ideaId: v.optional(v.id("ideas")),
    status: v.union(v.literal("proposed"), v.literal("confirmed"), v.literal("moved"), v.literal("deleted")),
    consentAt: v.optional(v.number()), // required before any external write
    externalEventId: v.optional(v.string()),
    calendarId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_creator", ["creatorId", "start"]),

  // ----------------------------------------------------------- calendarEvents
  // What we keep from a calendar (§12.5): title, bounds, all-day flag, calendar id and
  // our class. Never description, attendees, location. A `private` event keeps no title.
  calendarEvents: defineTable({
    creatorId: v.id("creators"),
    calendarId: v.string(),
    externalId: v.string(),
    title: v.string(),
    htmlLink: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    allDay: v.boolean(),
    recurring: v.boolean(),
    class: v.union(v.literal("filmable"), v.literal("private"), v.literal("routine"), v.literal("unknown")),
    classifiedBy: v.union(v.literal("code"), v.literal("model")),
    status: v.union(v.literal("active"), v.literal("cancelled")),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_creator_start", ["creatorId", "start"])
    .index("by_creator_external", ["creatorId", "externalId"]),

  // -------------------------------------------------------------- tasteEvents
  // §13.10 (1): one row per signal about an idea, written by code the moment it happens.
  tasteEvents: defineTable({
    creatorId: v.id("creators"),
    ideaId: v.optional(v.id("ideas")),
    messageId: v.optional(v.id("messages")),
    kind: v.string(), // posted | blocked | shotlist | heart | save | reply_pos | reply_neg | idea_only | ignored | thumbs_down | notme | unlinked
    weight: v.number(),
    features: v.array(v.string()), // "format:skit", "account:@x", "source:breakout", …
    at: v.number(),
  }).index("by_creator", ["creatorId", "at"]),

  // ------------------------------------------------------- stripeWebhookEvents
  // §19.3: every event once; replays are audited as rows and change nothing.
  stripeWebhookEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    livemode: v.boolean(),
    status: v.union(v.literal("processed"), v.literal("replay_dropped"), v.literal("skipped"), v.literal("errored")),
    detail: v.optional(v.string()),
    customerId: v.optional(v.string()),
    receivedAt: v.number(),
  }).index("by_event_id", ["eventId"]),

  // ------------------------------------------------------------------ memories
  // §15.7 (4): retrieval on demand. Saved ideas, notes and the swipe file, embedded once.
  memories: defineTable({
    creatorId: v.id("creators"),
    kind: v.union(v.literal("idea"), v.literal("note"), v.literal("swipe")),
    refId: v.string(), // the idea id or note id
    text: v.string(),
    embedding: v.array(v.float64()),
    at: v.number(),
  })
    .index("by_creator_ref", ["creatorId", "refId"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 768, filterFields: ["creatorId"] }),

  // ------------------------------------------------------------------ evalRuns
  // Sprint 3c: one row per evaluated message; the checks are code, the judge is a second family.
  /**
   * A frozen reading of the eval suite, to compare later runs against (§18 gate 9).
   * Without one, "the new prompt is better" is an anecdote. I shipped a voice change on
   * 2026-09-02 claiming an improvement from two hand-picked examples and no measurement,
   * which is exactly the failure this table exists to prevent.
   */
  evalBaselines: defineTable({
    suite: v.string(),
    /** The ruler this reading was taken with; a run measured differently is not comparable. */
    rubricVersion: v.optional(v.string()),
    gitSha: v.string(),
    note: v.string(),
    n: v.number(),              // total dry runs behind the numbers
    scenarios: v.array(v.string()),
    passRate: v.number(),       // 0..1
    sent: v.number(),           // how often she chose to say anything at all
    judged: v.optional(v.number()), // how many a judge actually scored; zero means the judge dims are meaningless
    judge: v.object({ corny: v.number(), generic: v.number(), specific: v.number(), wouldSend: v.number(), soundsLikeThem: v.number() }),
    at: v.number(),
  }).index("by_suite_at", ["suite", "at"]),

  evalRuns: defineTable({
    suite: v.string(), // recent | scout | manual
    skill: v.string(),
    creatorId: v.optional(v.id("creators")),
    messageId: v.optional(v.id("messages")),
    text: v.string(),
    checks: v.array(v.object({ name: v.string(), pass: v.boolean(), detail: v.string() })),
    judge: v.optional(v.object({ corny: v.number(), generic: v.number(), flattering: v.number(), toolSpeak: v.number(), specific: v.number(), wouldSend: v.number(), soundsLikeThem: v.optional(v.number()), note: v.string(), model: v.string() })),
    pass: v.boolean(),
    trace: v.optional(v.any()),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_suite_at", ["suite", "at"]),

  // ---------------------------------------------------------------- evalLabels
  // Sprint 3c: the operator's word, one row per label; these become the golden sets (§17.3).
  evalLabels: defineTable({
    messageId: v.optional(v.id("messages")),
    evalRunId: v.optional(v.id("evalRuns")),
    creatorId: v.optional(v.id("creators")),
    skill: v.string(),
    label: v.union(v.literal("good"), v.literal("bad")),
    reason: v.string(),
    by: v.string(),
    at: v.number(),
  }).index("by_at", ["at"]),

  // -------------------------------------------------------------- oauthStates
  // Single-use, 15-minute state tokens for OAuth round trips; the token is the auth.
  oauthStates: defineTable({
    creatorId: v.id("creators"),
    provider: v.literal("google"),
    token: v.string(),
    returnTo: v.optional(v.string()), // where to land after the round trip (onboarding step 5, or Settings)
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // --------------------------------------------------------------- connections
  connections: defineTable({
    creatorId: v.id("creators"),
    provider: v.union(v.literal("google_calendar"), v.literal("zernio")),
    status: v.union(v.literal("connected"), v.literal("attention"), v.literal("needs_reconnect"), v.literal("disconnected")),
    // google calendar
    calendarIds: v.optional(v.array(v.string())),
    watchChannels: v.optional(v.array(v.object({ channelId: v.string(), resourceId: v.string(), expiresAt: v.number() }))),
    syncToken: v.optional(v.string()),
    calendars: v.optional(v.array(v.object({ id: v.string(), name: v.string(), selected: v.boolean() }))),
    lastSyncedAt: v.optional(v.number()),
    detail: v.optional(v.string()), // plain-language reason for attention / needs_reconnect
    // zernio
    zernioProfileId: v.optional(v.string()),
    zernioAccounts: v.optional(v.array(v.object({ accountId: v.string(), platform, username: v.optional(v.string()), canFetchAnalytics: v.boolean(), needsReconnect: v.boolean() }))),
    // secrets live in Convex env / encrypted fields, never plain
    tokenRef: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_creator", ["creatorId", "provider"]),

  // ---------------------------------------------------------------- directives
  directives: defineTable({
    creatorId: v.id("creators"),
    // Kinds are the ported ledger's vocabulary for now; the creator-specific set (§15.2) lands with Sprint 3.
    kind: v.string(),
    verbatim: v.string(), // never edited
    interpretationJson: v.optional(v.string()),
    active: v.boolean(),
    supersedesId: v.optional(v.id("directives")),
    supersededAt: v.optional(v.number()),
    sourceMessageId: v.optional(v.id("messages")),
    source: v.optional(v.union(v.literal("chat"), v.literal("settings"), v.literal("correction"), v.literal("default"))),
    codeEnforced: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_and_active", ["creatorId", "active"])
    .index("by_creator_and_kind", ["creatorId", "kind"]),

  // ------------------------------------------------------------------ messages
  messages: defineTable({
    creatorId: v.id("creators"),
    direction: v.union(v.literal("in"), v.literal("out")),
    surface: v.union(v.literal("telegram"), v.literal("web"), v.literal("system")),
    kind: v.optional(v.string()), // first_read | scout | worth_seeing | calendar_idea | checklist | feedback | review | status | reply | inbound
    body: v.string(),
    dedupeKey: v.optional(v.string()), // required on every proactive outbound; enforced in messages.ts
    proactive: v.optional(v.boolean()),
    turnId: v.optional(v.string()),
    awaitingAnswer: v.optional(v.boolean()), // the one open question
    deliveredAt: v.optional(v.number()),
    deliveryError: v.optional(v.string()),
    telegramMessageId: v.optional(v.string()),
    telegramUpdateId: v.optional(v.number()),
    fileId: v.optional(v.id("_storage")), // an inbound file, stored for the classifier (§15.3)
    fileMime: v.optional(v.string()),
    fileUniqueId: v.optional(v.string()),
    buttons: v.optional(v.array(v.object({ id: v.string(), label: v.string() }))),
    links: v.optional(v.array(v.string())),
    ideaId: v.optional(v.id("ideas")),
    reaction: v.optional(v.string()),
    criticSkipped: v.optional(v.boolean()),
    produced: v.optional(produced),
    ts: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_creator_tg_message", ["creatorId", "telegramMessageId"])
    .index("by_creator_and_ts", ["creatorId", "ts"])
    .index("by_creator_and_dedupe", ["creatorId", "dedupeKey"])
    .index("by_creator_and_awaiting", ["creatorId", "awaitingAnswer"])
    .index("by_delivery", ["direction", "deliveredAt"])
    .index("by_telegramUpdateId", ["telegramUpdateId"]),

  // ---------------------------------------------------------------------- jobs
  jobs: defineTable({
    creatorId: v.optional(v.id("creators")),
    kind: v.string(),
    idempotencyKey: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("dead")),
    attempts: v.number(),
    maxAttempts: v.number(),
    payloadJson: v.optional(v.string()),
    runAfter: v.number(),
    deadlineAt: v.number(),
    priority: v.optional(v.number()), // lower runs first; the first-read sample is 0 (plan §3.75)
    lastError: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    result: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_creator_and_createdAt", ["creatorId", "createdAt"])
    .index("by_status_and_runAfter", ["status", "runAfter"])
    .index("by_creator", ["creatorId"])
    .index("by_status_and_deadline", ["status", "deadlineAt"])
    .index("by_creator_kind", ["creatorId", "kind", "createdAt"]),

  // ------------------------------------------------------------------- budgets
  budgets: defineTable({
    creatorId: v.id("creators"),
    day: v.string(), // YYYY-MM-DD in the creator's timezone
    screenerTokens: v.number(),
    writerTokens: v.number(),
    watches: v.number(),
    /**
     * The one-time catalogue watch, counted APART from `watches`. Onboarding watches up to
     * 40 of their own posts; the daily operating cap is 8. Counted together, every new
     * creator's first day was guaranteed to hit the budget rail and get no idea at all —
     * the worst possible day to be silent. Optional: rows written before this existed.
     */
    onboardingWatches: v.optional(v.number()),
    marginalCredits: v.number(),
    messages: v.number(),
    spentUsd: v.number(),
  }).index("by_creator_day", ["creatorId", "day"]),

  // ---------------------------------------------------------------- costEvents
  costEvents: defineTable({
    creatorId: v.optional(v.id("creators")),
    vendor: v.union(v.literal("scrapecreators"), v.literal("gemini"), v.literal("openrouter"), v.literal("zernio"), v.literal("groq"), v.literal("telegram")),
    kind: v.string(),
    units: v.number(), // credits or tokens
    costUsd: v.number(),
    costSource: v.union(v.literal("vendor_reported"), v.literal("endpoint_table"), v.literal("tier_table")),
    environment: v.string(),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_creator_at", ["creatorId", "at"]),

  // -------------------------------------------------------------- vendorHealth
  vendorHealth: defineTable({
    vendor: v.string(),
    check: v.string(),
    ok: v.boolean(),
    detail: v.optional(v.any()),
    at: v.number(),
  }).index("by_vendor_at", ["vendor", "at"]),

  vendorBreaker: defineTable({
    vendor: v.string(),
    // The credit-balance breaker (ported): a verdict from the last balance check.
    verdict: v.union(v.literal("ok"), v.literal("low"), v.literal("critical")),
    balance: v.number(),
    detail: v.string(),
    checkedAt: v.number(),
    // Failure breaker (plan §16.2): opened on consecutive vendor failures.
    open: v.optional(v.boolean()),
    openedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    failures: v.optional(v.number()),
  }).index("by_vendor", ["vendor"]),
});
