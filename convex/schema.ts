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
    quietHours: v.object({ start: v.string(), end: v.string() }), // "22:00" / "07:00" local
    tone: v.union(v.literal("coach"), v.literal("friend"), v.literal("blunt")),
    mode: v.union(v.literal("full"), v.literal("thin"), v.literal("newCreator")),
    dossier: v.optional(v.any()), // Dossier (§14.1), zod-validated at write time
    dossierVersion: v.number(),
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
    affinities: v.array(
      v.object({ key: v.string(), kind: v.union(v.literal("format"), v.literal("topic")), score: v.number(), n: v.number() }),
    ),
    experiments: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        proposedAt: v.number(),
        verdictAt: v.optional(v.number()),
        result: v.optional(v.union(v.literal("held"), v.literal("failed"), v.literal("unknown"))),
      }),
    ),
    channel: v.object({
      telegramChatId: v.optional(v.string()),
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
      founding: v.boolean(),
    }),
    firstWeek: v.optional(v.object({ startedAt: v.number(), stepsDone: v.array(v.string()) })),
    openQuestionId: v.optional(v.id("messages")), // at most one open question
    createdAt: v.number(),
  })
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_telegramChatId", ["channel.telegramChatId"])
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
    transcript: v.optional(v.string()),
    sample: v.optional(v.array(v.string())), // top | weak | recent | outlier | history
  })
    .index("by_creator", ["creatorId", "createTime"])
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
    createdAt: v.number(),
  }).index("by_creator", ["creatorId", "start"]),

  // --------------------------------------------------------------- connections
  connections: defineTable({
    creatorId: v.id("creators"),
    provider: v.union(v.literal("google_calendar"), v.literal("zernio")),
    status: v.union(v.literal("connected"), v.literal("attention"), v.literal("needs_reconnect"), v.literal("disconnected")),
    // google calendar
    calendarIds: v.optional(v.array(v.string())),
    watchChannels: v.optional(v.array(v.object({ channelId: v.string(), resourceId: v.string(), expiresAt: v.number() }))),
    syncToken: v.optional(v.string()),
    // zernio
    zernioProfileId: v.optional(v.string()),
    zernioAccounts: v.optional(v.array(v.object({ accountId: v.string(), platform, canFetchAnalytics: v.boolean(), needsReconnect: v.boolean() }))),
    // secrets live in Convex env / encrypted fields, never plain
    tokenRef: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_creator", ["creatorId", "provider"]),

  // ---------------------------------------------------------------- directives
  directives: defineTable({
    creatorId: v.id("creators"),
    text: v.string(), // verbatim, never edited
    source: v.union(v.literal("chat"), v.literal("settings"), v.literal("correction"), v.literal("default")),
    codeEnforced: v.optional(v.string()), // which code rule mirrors it, if any
    createdAt: v.number(),
    tombstonedAt: v.optional(v.number()),
  }).index("by_creator", ["creatorId", "createdAt"]),

  // ------------------------------------------------------------------ messages
  messages: defineTable({
    creatorId: v.id("creators"),
    direction: v.union(v.literal("in"), v.literal("out")),
    kind: v.string(), // first_read | scout | worth_seeing | calendar_idea | checklist | feedback | review | status | reply | inbound
    text: v.string(),
    dedupeKey: v.optional(v.string()), // required on every outbound
    telegramMessageId: v.optional(v.string()),
    telegramUpdateId: v.optional(v.number()),
    buttons: v.optional(v.array(v.object({ id: v.string(), label: v.string() }))),
    links: v.optional(v.array(v.string())),
    isQuestion: v.optional(v.boolean()),
    answeredAt: v.optional(v.number()),
    ideaId: v.optional(v.id("ideas")),
    reaction: v.optional(v.string()),
    delivery: v.optional(v.object({ status: v.string(), attempts: v.number(), lastError: v.optional(v.string()) })),
    criticSkipped: v.optional(v.boolean()),
    produced: v.optional(produced),
    createdAt: v.number(),
  })
    .index("by_creator", ["creatorId", "createdAt"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_telegramUpdateId", ["telegramUpdateId"]),

  // ---------------------------------------------------------------------- jobs
  jobs: defineTable({
    kind: v.string(),
    creatorId: v.optional(v.id("creators")),
    idempotencyKey: v.string(),
    payload: v.any(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("dead")),
    attempts: v.number(),
    maxAttempts: v.number(),
    runAfter: v.number(),
    deadline: v.number(),
    priority: v.number(), // lower runs first; first-read sample = 0
    lastError: v.optional(v.string()),
    result: v.optional(v.any()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_status_runAfter", ["status", "runAfter"])
    .index("by_creator_kind", ["creatorId", "kind", "createdAt"]),

  // ------------------------------------------------------------------- budgets
  budgets: defineTable({
    creatorId: v.id("creators"),
    day: v.string(), // YYYY-MM-DD in the creator's timezone
    screenerTokens: v.number(),
    writerTokens: v.number(),
    watches: v.number(),
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
    open: v.boolean(),
    openedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    failures: v.number(),
    updatedAt: v.number(),
  }).index("by_vendor", ["vendor"]),
});
