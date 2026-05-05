/**
 * synthesizeCreatorPicture — multimodal creator-picture synthesis pipeline.
 *
 * Sprint 2 deliverable. Replaces every stub `creatorPicture` row produced by
 * `submitOnboardingAnswers` (which inserts blanks with `model: "pending-synth"`
 * if the questions step finishes before the multimodal pass) with a real,
 * cited, grounded picture inferred by Gemini 3 Flash on HIGH thinking from
 * the creator's actual posts + comments + audience signal.
 *
 * Pipeline:
 *   1. Resolve the input bundle. Reads creatorHandles + scrapeCreatorsCache
 *      that `runFullScrapePull` populated. Required inputs:
 *      - profile + bio + bio links (per platform)
 *      - last 30 posts per platform (caption, transcript if video, thumbnail,
 *        video URL, postedAt, viewCount, likeCount, commentCount, etc.)
 *      - top comments per platform (TikTok-only deep dive in v0; other
 *        platforms infer from caption + bio signal only)
 *   2. Build the synthesis prompt — text payloads + video URLs (Gemini 3
 *      Flash natively reads video frames) — and call OpenRouter directly.
 *      We bypass `callMaya` here because callMaya enforces plan-tier
 *      thinking-budget clamps; synthesis runs on HIGH for every creator
 *      regardless of plan (it's a one-time onboarding cost that the
 *      Starter price absorbs). We log to aiCallLog ourselves so cost +
 *      latency are still tracked.
 *   3. Validate the JSON output. If malformed, retry once with a stricter
 *      schema reminder. If retry fails, throw a structured error (caller
 *      reports it inline to the onboarding UI).
 *   4. Patch (or insert) the creatorPicture row, preserving the additive
 *      Sprint 3.7 fields (locationSoul / careerStage / monthlyRevenueUsd /
 *      currentRevenueStreams / longTermGoals) the user already filled in
 *      onboarding.
 *
 * Cross-tenant safety:
 *   - The action takes `creatorId` only and reads everything else under that
 *     id. The deployMaya pipeline (the only caller in v0) feeds the verified
 *     `creatorId` from the deploy session. Direct user calls are not allowed —
 *     this is an `internalAction`.
 *   - Every read is `creatorId`-scoped. Patches happen via an internal
 *     mutation that re-resolves the row under that id.
 *
 * Plan-tier policy:
 *   - Synthesis runs at HIGH thinking budget for ALL plans. It's a one-shot
 *     onboarding cost; the alternative (Starter gets a low-thinking picture)
 *     would mean Starter Mayas feel generic, which kills the whole product
 *     promise. The `bypassPlanClamp` flag on `recordAiCall` documents this
 *     intentional bypass.
 *
 * Citation firewall:
 *   - The schema's `sourceCitations` field is required (`v.array(...)`). The
 *     synthesizer asks Gemini to emit at least one citation per inferred
 *     field. We then validate that every populated field cites at least one
 *     post; if not, the validation fails and we retry once. The
 *     `maya-citation-firewall` skill enforces this at message-generation
 *     time; we enforce it at synthesis time too.
 */

import { v } from "convex/values";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  callOpenRouter,
  OpenRouterError,
  type ChatMessage,
} from "../../agents/modelRouter/openRouterClient";
import {
  computeCostUsd,
  GEMINI_3_FLASH_INPUT_PRICE_PER_MTOK as _PRICE_INPUT,
  GEMINI_3_FLASH_OUTPUT_PRICE_PER_MTOK as _PRICE_OUTPUT,
} from "../../agents/modelRouter/maya";
import {
  cacheKey,
  type CacheKind,
} from "../../integrations/scrapeCreators/cache";
import {
  selectSignalSubset,
  MAX_TOTAL_VIDEO_SEC_DEFAULT,
  type BatchablePost,
} from "./videoBatching";
import {
  synthesizeViaWorker,
  isVideoSynthWorkerEnabled,
  VideoSynthWorkerError,
  type SynthesizeWorkerPost,
} from "../../integrations/videoSynthWorker/client";

void _PRICE_INPUT;
void _PRICE_OUTPUT;

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export type SynthesizeStage =
  | "load-inputs"
  | "no-scraped-data"
  | "model-call"
  | "model-malformed"
  | "validate"
  | "patch-row";

export type SynthesizeCreatorPictureResult =
  | {
      ok: true;
      creatorPictureId: Id<"creatorPicture">;
      thinkingBudget: "high";
      model: string;
      costUsd: number;
      latencyMs: number;
      retried: boolean;
    }
  | {
      ok: false;
      stage: SynthesizeStage;
      message: string;
      retryable: boolean;
    };

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const POSTS_PER_PLATFORM_CAP = 30;
const COMMENTS_PER_POST_CAP = 10;
const SYNTH_TASK_TAG = "creator_picture_synthesis";

/** Hard cap so a creator with 1000+ posts doesn't blow the prompt window. */
const MAX_TOTAL_POSTS_IN_PROMPT = 150;

/* -------------------------------------------------------------------------- */
/* Internal query: load all inputs in one transaction                          */
/* -------------------------------------------------------------------------- */

interface SynthInputs {
  creator: Doc<"creators"> | null;
  picture: Doc<"creatorPicture"> | null;
  handles: Doc<"creatorHandles">[];
  /** Per (platform, kind, key) cache rows. */
  cacheRows: Array<{
    platform: string;
    kind: CacheKind;
    keyPart: string;
    payload: unknown;
  }>;
  /**
   * Self-reported careerStage from onboarding answers — if the user filled
   * the questions step before synthesis lands, the value is on
   * `creators.onboardingProgress.answers.careerStage`. If the questions step
   * already finished and the resume buffer was cleared, the value lives on
   * `creatorPicture.careerStage`. Either source is fine for reconciliation;
   * the synthesis prompt receives this as the SELF-REPORTED comparison and
   * MUST NOT use it as input to the inferred classification.
   */
  selfReportedCareerStage?:
    | "just-starting"
    | "building"
    | "monetizing"
    | "scaling";
}

export const loadSynthInputs = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args): Promise<SynthInputs> => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator) {
      return { creator: null, picture: null, handles: [], cacheRows: [] };
    }
    const handles = await ctx.db
      .query("creatorHandles")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const pictures = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const picture =
      pictures.length === 0
        ? null
        : pictures.reduce((latest, p) =>
            p.generatedAt > latest.generatedAt ? p : latest
          );
    const allCache = await ctx.db
      .query("scrapeCreatorsCache")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    const cacheRows: SynthInputs["cacheRows"] = [];
    for (const row of allCache) {
      // Cache key format: `sc:${platform}:${kind}:${handleOrId}`
      const parts = row.cacheKey.split(":");
      if (parts.length < 4 || parts[0] !== "sc") continue;
      const [, platform, kind, ...rest] = parts;
      cacheRows.push({
        platform,
        kind: kind as CacheKind,
        keyPart: rest.join(":"),
        payload: row.payload,
      });
    }
    // Resolve self-reported career stage for reconciliation. Prefer the
    // resume buffer (most recent) but fall back to the picture row (which is
    // where `submitOnboardingAnswers` persists it after clearing the buffer).
    const selfReportedCareerStage =
      creator.onboardingProgress?.answers.careerStage ??
      picture?.careerStage ??
      undefined;
    return {
      creator,
      picture,
      handles,
      cacheRows,
      selfReportedCareerStage,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Internal mutation: upsert the synthesized row                               */
/* -------------------------------------------------------------------------- */

const audienceValidator = v.object({
  ageRanges: v.array(v.string()),
  genderSplit: v.optional(
    v.object({ male: v.number(), female: v.number(), other: v.number() })
  ),
  topGeos: v.array(v.string()),
  interestTags: v.array(v.string()),
});

const topHookValidator = v.object({
  pattern: v.string(),
  examplePostId: v.string(),
  platform: v.string(),
  avgPerformanceLift: v.number(),
});

const bottomHookValidator = v.object({
  pattern: v.string(),
  examplePostId: v.string(),
  platform: v.string(),
});

const postingCadenceValidator = v.object({
  perPlatform: v.array(
    v.object({
      platform: v.string(),
      postsPerWeek: v.number(),
      bestDays: v.array(v.string()),
      bestHoursLocal: v.array(v.number()),
    })
  ),
});

const brandDealValidator = v.object({
  brand: v.string(),
  platform: v.string(),
  approxDate: v.optional(v.string()),
  format: v.string(),
});

const sourceCitationValidator = v.object({
  platform: v.string(),
  postId: v.string(),
  usedFor: v.string(),
});

const careerStageValidator = v.union(
  v.literal("just-starting"),
  v.literal("building"),
  v.literal("monetizing"),
  v.literal("scaling")
);

const careerStageReconciliationValidator = v.object({
  selfReported: v.optional(careerStageValidator),
  inferred: careerStageValidator,
  matches: v.boolean(),
  evidence: v.string(),
  // Optional string. The parser converts the model's `null` / empty-string
  // outputs to `undefined` BEFORE handing the value to this validator (see
  // parseReconciliation), so storing `undefined` is the canonical form.
  // This keeps the schema validator (v.optional(v.string())) accurate.
  gentleNudge: v.optional(v.string()),
});

/**
 * Synthesis-emitted growth-plan validator. Mirrors the schema's `growthPlan`
 * shape, but the synthesis ALWAYS emits the rich fields (currentStage,
 * nextMilestoneText, focusAreas, antiPatterns, horizonWeeks, citations,
 * generatedAt) and the legacy `nextMilestone` follower object is derived from
 * `creatorPicture` follower-count data so the HQ progress bar still works.
 *
 * Wave 2 (2026-04-26) — `smartAlternatives` is REQUIRED when antiPatterns is
 * non-empty. Each entry pairs an antiPattern string with `insteadDoThis` /
 * `exampleAction` / `reasoning` so skills can route to the alternative
 * instead of refusing the original ask.
 */
const synthGrowthPlanValidator = v.object({
  currentStage: careerStageValidator,
  nextMilestoneText: v.string(),
  focusAreas: v.array(v.string()),
  antiPatterns: v.array(v.string()),
  smartAlternatives: v.array(
    v.object({
      antiPattern: v.string(),
      insteadDoThis: v.string(),
      exampleAction: v.string(),
      reasoning: v.string(),
    })
  ),
  horizonWeeks: v.number(),
  citations: v.array(sourceCitationValidator),
  /** Derived from top-handle follower count at synthesis time (not LLM-emitted). */
  nextMilestone: v.object({
    label: v.string(),
    targetFollowers: v.number(),
    estimatedAt: v.optional(v.number()),
  }),
  /** Derived from currentStage at synthesis time. */
  focusArea: v.union(
    v.literal("consistency"),
    v.literal("hook-craft"),
    v.literal("diversification"),
    v.literal("scale-systems")
  ),
  generatedAt: v.number(),
});

export const upsertSynthesizedPicture = internalMutation({
  args: {
    creatorId: v.id("creators"),
    niche: v.string(),
    audience: audienceValidator,
    voiceFingerprint: v.string(),
    topHooks: v.array(topHookValidator),
    bottomHooks: v.array(bottomHookValidator),
    postingCadence: postingCadenceValidator,
    brandDealHistory: v.array(brandDealValidator),
    model: v.string(),
    sourceCitations: v.array(sourceCitationValidator),
    generatedAt: v.number(),
    // ─── Stage-aware adaptive product (Agent B, 2026-04-26) ───────────────
    /** Synthesis-inferred career stage. Source of truth, overrides self-report. */
    inferredCareerStage: v.optional(careerStageValidator),
    careerStageReasoning: v.optional(v.string()),
    careerStageReconciliation: v.optional(careerStageReconciliationValidator),
    growthPlan: v.optional(synthGrowthPlanValidator),
  },
  handler: async (ctx, args): Promise<Id<"creatorPicture">> => {
    const existing = await ctx.db
      .query("creatorPicture")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .first();

    const synthFields: Record<string, unknown> = {
      niche: args.niche,
      audience: args.audience,
      voiceFingerprint: args.voiceFingerprint,
      topHooks: args.topHooks,
      bottomHooks: args.bottomHooks,
      postingCadence: args.postingCadence,
      brandDealHistory: args.brandDealHistory,
      model: args.model,
      sourceCitations: args.sourceCitations,
      generatedAt: args.generatedAt,
    };
    // Only set the stage-aware fields when present so we never accidentally
    // wipe the answer-owned `careerStage` (the synthesis writes
    // `inferredCareerStage` to the schema's `careerStage` field — see below
    // — but we leave careerStage alone if the synthesis did not classify).
    if (args.careerStageReasoning !== undefined) {
      synthFields.careerStageReasoning = args.careerStageReasoning;
    }
    if (args.careerStageReconciliation !== undefined) {
      synthFields.careerStageReconciliation = args.careerStageReconciliation;
    }
    if (args.growthPlan !== undefined) {
      synthFields.growthPlan = args.growthPlan;
    }
    // The synthesis-inferred careerStage IS the source of truth per spec.
    // It overrides any self-reported value already on the picture row. We
    // only patch if the synthesis emitted a classification — defensive so an
    // old or partial synthesis result doesn't wipe a known answer.
    if (args.inferredCareerStage !== undefined) {
      synthFields.careerStage = args.inferredCareerStage;
    }

    if (existing) {
      // Patch ONLY the synthesis-owned fields; preserve the answer-owned
      // fields (locationSoul, monthlyRevenueUsd, currentRevenueStreams,
      // longTermGoals) the user filled in onboarding. `careerStage` is the
      // ONE answer-owned field synthesis is permitted to override (per spec:
      // data-inferred is the source of truth).
      await ctx.db.patch(existing._id, synthFields);
      return existing._id;
    }
    // The required-fields cast: synthFields always contains the required
    // creatorPicture columns above (niche, audience, voiceFingerprint,
    // topHooks, bottomHooks, postingCadence, brandDealHistory, generatedAt,
    // model, sourceCitations) plus optional stage-aware extras. We assert the
    // shape here because the Record<string, unknown> aggregator above doesn't
    // surface the per-field validators to the insert call.
    return await ctx.db.insert(
      "creatorPicture",
      {
        creatorId: args.creatorId,
        ...synthFields,
      } as Parameters<typeof ctx.db.insert<"creatorPicture">>[1]
    );
  },
});

/**
 * Telemetry mutation — write one aiCallLog row for the synthesis call.
 * Mirrors `recordAiCall` but separated so we can mark `bypassPlanClamp` in
 * the detail field and so synthesis tests don't need to import the router
 * module directly.
 */
export const recordSynthCall = internalMutation({
  args: {
    creatorId: v.id("creators"),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    thinkingTokens: v.optional(v.number()),
    costUsd: v.number(),
    latencyMs: v.number(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("aiCallLog", {
      creatorId: args.creatorId,
      taskTag: SYNTH_TASK_TAG,
      model: args.model,
      thinkingBudget: "high",
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      thinkingTokens: args.thinkingTokens,
      costUsd: args.costUsd,
      latencyMs: args.latencyMs,
      ts: args.ts,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* Bundle the input data into a model-friendly payload                         */
/* -------------------------------------------------------------------------- */

interface NormalizedPostForPrompt {
  platform: string;
  postId: string;
  caption: string | null;
  transcript: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  /**
   * Video duration in seconds. Used by `selectSignalSubset` to enforce the
   * Gemini video-duration cap. null when the source payload didn't surface
   * it (e.g. ScrapeCreators TikTok responses don't always include duration —
   * see TODO(s7) in runFullScrapePull.ts for the derive-from-videoUrl plan).
   */
  videoDurationSec: number | null;
  postedAtIso: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  saveCount: number | null;
  /** Top comments — only TikTok deep-dive supplies them in v0. */
  topComments: Array<{ text: string; likeCount: number | null }>;
}

interface PromptPayload {
  creator: {
    timezone: string;
    plan: string;
    /**
     * The creator's SELF-REPORTED careerStage (from onboarding answers). Must
     * be treated as comparison-only by the model: do NOT use it as input to
     * the inferred classification — the synthesis classifies independently
     * from observed behavior. Surfaced for the reconciliation step only.
     */
    selfReportedCareerStage?: string;
    locationSoul?: { city?: string; state?: string; country?: string };
    monthlyRevenueUsd?: number;
    currentRevenueStreams?: ReadonlyArray<string>;
    longTermGoals?: { oneYear?: string; fiveYear?: string };
  };
  perPlatform: Array<{
    platform: string;
    handle: string;
    profile: {
      displayName: string | null;
      bio: string | null;
      followerCount: number | null;
      bioLink: string | null;
      verified: boolean;
    };
    /**
     * Posts on this platform. Each carries a `kind` marker — `video` means
     * Gemini watches the video frames natively (videoUrl forwarded); `text-context`
     * means caption + transcript + comments + metrics only (Gemini does NOT
     * watch the video for these). The prompt explicitly tells the model which
     * is which.
     */
    posts: Array<NormalizedPostForPrompt & { kind: "video" | "text-context" }>;
  }>;
  /**
   * Diagnostics from the signal-prioritized batching pass. Surfaced for
   * telemetry + dev-overlay; the model doesn't see these directly.
   */
  batchingDiagnostics: {
    totalPostsConsidered: number;
    fullVideoCount: number;
    textOnlyCount: number;
    totalVideoDurationSec: number;
    cappedAtSec: number;
    finalTopN: number;
    finalBottomM: number;
    downShifted: boolean;
    oversizedSingleVideoCount: number;
  };
}

/**
 * Stitches the raw cache rows into a per-platform payload the model can
 * reason about. Truncates posts to `POSTS_PER_PLATFORM_CAP` per platform and
 * caps total posts at `MAX_TOTAL_POSTS_IN_PROMPT` to bound prompt size for
 * creators with many handles.
 *
 * After truncation, the multimodal video pipeline runs `selectSignalSubset`
 * on the merged post list and tags each post `kind: "video" | "text-context"`.
 * The prompt builder respects the `kind` and emits videoUrl ONLY for
 * `kind: "video"` posts; `kind: "text-context"` posts get caption + transcript
 * + comments + metrics only (no video reference). See videoBatching.ts for
 * the strategy + cost envelope.
 */
export function buildPromptPayload(
  inputs: SynthInputs
): { payload: PromptPayload; postsCount: number } {
  const creator = inputs.creator!;
  const handlesByPlatform = new Map<string, Doc<"creatorHandles">>();
  for (const h of inputs.handles) {
    handlesByPlatform.set(h.platform, h);
  }

  // Stage 1: collect raw normalized posts per platform (post-truncation).
  const perPlatformRaw: Array<{
    platform: string;
    handle: string;
    profile: ReturnType<typeof readProfile>;
    rawPosts: NormalizedPostForPrompt[];
  }> = [];
  let totalPosts = 0;

  // Group cache rows by platform.
  const rowsByPlatform = new Map<string, SynthInputs["cacheRows"]>();
  for (const row of inputs.cacheRows) {
    const list = rowsByPlatform.get(row.platform) ?? [];
    list.push(row);
    rowsByPlatform.set(row.platform, list);
  }

  // Sort platforms for determinism.
  const platforms = [...rowsByPlatform.keys()].sort();
  for (const platform of platforms) {
    if (totalPosts >= MAX_TOTAL_POSTS_IN_PROMPT) break;
    const rows = rowsByPlatform.get(platform)!;
    const handle = handlesByPlatform.get(platform);
    if (!handle) continue;

    const profileRow = rows.find((r) => r.kind === "profile");
    const postsRow = rows.find((r) => r.kind === "posts");
    if (!profileRow || !postsRow) continue;

    const transcriptRows = rows.filter((r) => r.kind === "transcript");
    const commentsRows = rows.filter((r) => r.kind === "comments");

    const transcriptByPostId = new Map<string, string>();
    for (const tr of transcriptRows) {
      const p = tr.payload as { transcript?: string } | null;
      if (p?.transcript) transcriptByPostId.set(tr.keyPart, p.transcript);
    }
    const commentsByPostId = new Map<
      string,
      Array<{ text: string; likeCount: number | null }>
    >();
    for (const cm of commentsRows) {
      const arr = cm.payload as Array<{
        text?: string;
        likeCount?: number | null;
      }> | null;
      if (!Array.isArray(arr)) continue;
      const cleaned = arr
        .filter(
          (c): c is { text: string; likeCount: number | null } =>
            typeof c?.text === "string"
        )
        .slice(0, COMMENTS_PER_POST_CAP);
      commentsByPostId.set(cm.keyPart, cleaned);
    }

    const profileRaw = profileRow.payload as Record<string, unknown> | null;
    const profile = readProfile(profileRaw, platform);
    const posts = readPosts(postsRow.payload, platform).slice(
      0,
      POSTS_PER_PLATFORM_CAP
    );

    const allowed = Math.min(
      posts.length,
      MAX_TOTAL_POSTS_IN_PROMPT - totalPosts
    );
    const sliced = posts.slice(0, allowed);
    totalPosts += sliced.length;

    perPlatformRaw.push({
      platform,
      handle: handle.handle,
      profile,
      rawPosts: sliced.map((p) => ({
        ...p,
        transcript: transcriptByPostId.get(p.postId) ?? null,
        topComments: commentsByPostId.get(p.postId) ?? [],
      })),
    });
  }

  // Stage 2: signal-prioritized video batching across the merged post list.
  // We compute a single composite engagement score that's roughly comparable
  // across platforms (likes + 2*comments + 0.5*shares — saves omitted because
  // not all platforms expose them). Then `selectSignalSubset` partitions into
  // full-video vs text-only.
  const allPosts = perPlatformRaw.flatMap((pp) => pp.rawPosts);
  const batchablePosts: BatchablePost[] = allPosts.map((p) => ({
    postId: p.postId,
    platform: p.platform,
    videoDurationSec: p.videoDurationSec,
    engagementScore: compositeEngagementScore(p),
    hasVideo: p.videoUrl !== null && p.videoUrl.length > 0,
  }));
  const subset = selectSignalSubset(batchablePosts);

  // Build a fast lookup of (platform|postId) → kind.
  const kindByKey = new Map<string, "video" | "text-context">();
  for (const p of subset.fullVideoPosts) {
    kindByKey.set(`${p.platform}|${p.postId}`, "video");
  }
  for (const p of subset.textOnlyPosts) {
    kindByKey.set(`${p.platform}|${p.postId}`, "text-context");
  }

  // Stage 3: rebuild per-platform payload with kind markers.
  const perPlatform: PromptPayload["perPlatform"] = perPlatformRaw.map((pp) => ({
    platform: pp.platform,
    handle: pp.handle,
    profile: pp.profile,
    posts: pp.rawPosts.map((p) => ({
      ...p,
      kind: kindByKey.get(`${pp.platform}|${p.postId}`) ?? "text-context",
    })),
  }));

  const payload: PromptPayload = {
    creator: {
      timezone: creator.timezone,
      plan: creator.plan,
      // Surfaced for RECONCILIATION ONLY. The system prompt instructs the
      // model not to use this as input to the inferred classification.
      selfReportedCareerStage: inputs.selfReportedCareerStage,
      locationSoul: inputs.picture?.locationSoul,
      monthlyRevenueUsd: inputs.picture?.monthlyRevenueUsd,
      currentRevenueStreams: inputs.picture?.currentRevenueStreams,
      longTermGoals: inputs.picture?.longTermGoals,
    },
    perPlatform,
    batchingDiagnostics: {
      totalPostsConsidered: allPosts.length,
      fullVideoCount: subset.fullVideoPosts.length,
      textOnlyCount: subset.textOnlyPosts.length,
      totalVideoDurationSec: subset.totalDurationSec,
      cappedAtSec: MAX_TOTAL_VIDEO_SEC_DEFAULT,
      finalTopN: subset.diagnostics.finalTopN,
      finalBottomM: subset.diagnostics.finalBottomM,
      downShifted: subset.diagnostics.downShifted,
      oversizedSingleVideoCount: subset.diagnostics.oversizedSingleVideoCount,
    },
  };

  return { payload, postsCount: totalPosts };
}

/**
 * Composite engagement score, roughly comparable across platforms.
 * Weighting:
 *   • likes ×1
 *   • comments ×2 (commenting is higher-effort signal than liking)
 *   • shares ×0.5 (algorithmic but spammable, lower weight than comments)
 * Saves omitted — not all platforms expose them.
 *
 * View count is NOT used as the primary score because (a) it's dominated by
 * algorithmic distribution rather than audience-quality signal and (b) a video
 * with high views but low likes/comments is exactly the kind of "we got
 * lucky on the algo" post we DON'T want to over-index on for hook synthesis.
 *
 * Returns 0 when no engagement metrics are available (e.g. brand-new posts
 * or platforms that don't surface them).
 */
function compositeEngagementScore(p: NormalizedPostForPrompt): number {
  const likes = typeof p.likeCount === "number" ? p.likeCount : 0;
  const comments = typeof p.commentCount === "number" ? p.commentCount : 0;
  const shares = typeof p.shareCount === "number" ? p.shareCount : 0;
  return likes + 2 * comments + 0.5 * shares;
}

/**
 * Best-effort profile field extraction from the upstream raw payload. The
 * normalized profile is stored in `scrapeCreatorsCache.payload.raw`-shaped
 * blobs but `runFullScrapePull` actually caches `profile.raw` directly, so
 * we read shallow fields generously and tolerate missing keys.
 */
function readProfile(
  raw: Record<string, unknown> | null,
  platform: string
): NormalizedPostForPrompt extends never
  ? never
  : {
      displayName: string | null;
      bio: string | null;
      followerCount: number | null;
      bioLink: string | null;
      verified: boolean;
    } {
  // Defensive: many shapes upstream. Try common keys.
  if (!raw || typeof raw !== "object") {
    return {
      displayName: null,
      bio: null,
      followerCount: null,
      bioLink: null,
      verified: false,
    };
  }
  const r = raw as Record<string, unknown>;
  // Walk known shapes
  const userInfo = (r.userInfo ?? {}) as Record<string, unknown>;
  const user =
    (userInfo.user as Record<string, unknown> | undefined) ??
    (r.user as Record<string, unknown> | undefined) ??
    r;
  const stats =
    (userInfo.stats as Record<string, unknown> | undefined) ??
    (r.stats as Record<string, unknown> | undefined) ??
    {};
  const data =
    (r.data as Record<string, unknown> | undefined)?.user ?? r.data ?? r;
  const dataMap = (data ?? {}) as Record<string, unknown>;

  const displayName =
    asStr(user.nickname) ??
    asStr(user.full_name) ??
    asStr(user.title) ??
    asStr(user.name) ??
    asStr(dataMap.full_name) ??
    null;
  const bio =
    asStr(user.signature) ??
    asStr(user.biography) ??
    asStr(user.description) ??
    asStr(user.headline) ??
    asStr(user.summary) ??
    null;
  const followerCount =
    asNum((stats as Record<string, unknown>).followerCount) ??
    asNum(
      ((user as Record<string, unknown>).edge_followed_by as Record<
        string,
        unknown
      >)?.count
    ) ??
    asNum((user as Record<string, unknown>).subscriberCount) ??
    asNum((user as Record<string, unknown>).followerCount) ??
    asNum((user as Record<string, unknown>).followers_count) ??
    null;
  const bioLink =
    asStr(
      ((user as Record<string, unknown>).bioLink as Record<string, unknown>)
        ?.link
    ) ??
    asStr((user as Record<string, unknown>).external_url) ??
    asStr((user as Record<string, unknown>).externalUrl) ??
    asStr((user as Record<string, unknown>).url) ??
    null;
  const verified = Boolean(
    (user as Record<string, unknown>).verified ??
      (user as Record<string, unknown>).is_verified ??
      (user as Record<string, unknown>).isVerified ??
      false
  );

  void platform;
  return { displayName, bio, followerCount, bioLink, verified };
}

function readPosts(
  raw: unknown,
  platform: string
): Array<Omit<NormalizedPostForPrompt, "transcript" | "topComments">> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p): Omit<NormalizedPostForPrompt, "transcript" | "topComments"> => {
      const r = (p ?? {}) as Record<string, unknown>;
      const stats =
        ((r.statsV2 as Record<string, unknown>) ??
          (r.stats as Record<string, unknown>) ??
          (r.statistics as Record<string, unknown>) ??
          ({} as Record<string, unknown>));
      const postId =
        asStr(r.id) ??
        asStr(r.aweme_id) ??
        asStr(r.group_id) ??
        asStr(r.id_str) ??
        asStr(r.pk) ??
        asStr(r.shortcode) ??
        asStr(r.code) ??
        asStr(r.urn) ??
        asStr(r.activityUrn) ??
        asStr(r.videoId) ??
        "";
      const captionRaw = r.desc ?? r.caption ?? r.text ?? r.full_text ?? r.title;
      const caption =
        typeof captionRaw === "string"
          ? captionRaw
          : captionRaw && typeof captionRaw === "object"
            ? asStr((captionRaw as { text?: string }).text)
            : null;
      const postedAtSec =
        asNum(r.createTime) ??
        asNum(r.create_time) ??
        asNum(r.taken_at) ??
        (typeof r.publishedAt === "string"
          ? Math.floor(Date.parse(r.publishedAt) / 1000) || null
          : asNum(r.publishedAt)) ??
        (typeof r.created_at === "string"
          ? Math.floor(Date.parse(r.created_at as string) / 1000) || null
          : null);
      const postedAtIso =
        postedAtSec !== null
          ? new Date(postedAtSec * 1000).toISOString()
          : null;
      const viewCount =
        asNum(stats.playCount) ??
        asNum(stats.play_count) ??
        asNum(r.view_count) ??
        asNum(r.viewCount) ??
        asNum(r.play_count) ??
        null;
      const likeCount =
        asNum(stats.diggCount) ??
        asNum(stats.digg_count) ??
        asNum(r.like_count) ??
        asNum(r.likeCount) ??
        asNum(r.favorite_count) ??
        null;
      const commentCount =
        asNum(stats.commentCount) ??
        asNum(stats.comment_count) ??
        asNum(r.comment_count) ??
        asNum(r.commentCount) ??
        asNum(r.reply_count) ??
        null;
      const shareCount =
        asNum(stats.shareCount) ??
        asNum(stats.share_count) ??
        asNum(r.share_count) ??
        asNum(r.repostCount) ??
        asNum(r.retweet_count) ??
        null;
      const saveCount =
        asNum(stats.collectCount) ??
        asNum(stats.collect_count) ??
        asNum(r.save_count) ??
        asNum(r.saveCount) ??
        null;
      const videoObj = (r.video as Record<string, unknown>) ?? {};
      const videoUrl =
        mediaUrl(videoObj.playAddr) ??
        mediaUrl(videoObj.play_addr) ??
        mediaUrl(videoObj.downloadNoWatermarkAddr) ??
        mediaUrl(videoObj.download_no_watermark_addr) ??
        mediaUrl(videoObj.downloadAddr) ??
        mediaUrl(videoObj.download_addr) ??
        asStr(
          (
            (r.video_versions as Array<Record<string, unknown>> | undefined) ??
            []
          )[0]?.url
        ) ??
        null;
      const thumbnailUrl =
        mediaUrl(videoObj.cover) ??
        mediaUrl(videoObj.originCover) ??
        mediaUrl(videoObj.origin_cover) ??
        mediaUrl(videoObj.dynamicCover) ??
        mediaUrl(videoObj.dynamic_cover) ??
        asStr(r.thumbnail_url) ??
        asStr(r.thumbnail) ??
        null;
      // Try common keys for video duration. TikTok exposes it on `video.duration`
      // (seconds) on some endpoints; Instagram on `video_duration` (seconds);
      // YouTube long-form on `lengthSeconds`. ScrapeCreators normalizes some
      // but not all of these — when missing, we leave null and the batching
      // module treats null as 0 (no signal). TODO(s7): derive duration from
      // videoUrl HEAD + Composio media-info as a fallback.
      const rawVideoDurationSec =
        asNum(videoObj.duration) ??
        asNum(videoObj.durationSec) ??
        asNum(videoObj.duration_ms) ??
        asNum(r.video_duration) ??
        asNum(r.duration) ??
        asNum(r.lengthSeconds) ??
        asNum(r.length_seconds);
      const videoDurationSec =
        rawVideoDurationSec !== null && rawVideoDurationSec > 1000
          ? Math.round(rawVideoDurationSec / 1000)
          : rawVideoDurationSec;
      return {
        platform,
        postId,
        caption,
        thumbnailUrl,
        videoUrl,
        videoDurationSec,
        postedAtIso,
        viewCount,
        likeCount,
        commentCount,
        shareCount,
        saveCount,
      };
    })
    .filter((p) => p.postId.length > 0);
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mediaUrl(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  if (!v || typeof v !== "object") return null;
  const obj = v as {
    url_list?: unknown;
    urlList?: unknown;
    url?: unknown;
    uri?: unknown;
  };
  const list = Array.isArray(obj.url_list)
    ? obj.url_list
    : Array.isArray(obj.urlList)
      ? obj.urlList
      : null;
  const first = list?.find((url): url is string => typeof url === "string" && url.length > 0);
  return first ?? asStr(obj.url) ?? asStr(obj.uri);
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Prompt construction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The synthesis system prompt. Lives at module top-level so:
 *   (a) tests can assert against it byte-for-byte
 *   (b) the operator can review it (per spec)
 *   (c) any change is a code review event, not a config tweak
 */
export const SYNTH_SYSTEM_PROMPT = `You are Maya's onboarding analyst.

You are given the raw social signal for ONE creator across all the platforms they're on. Your job is to produce a single JSON object — the "creator picture" — that Maya will use as her grounding for every future message to this creator.

Maya's tagline is "your AI creator manager". A generic picture kills the product. Be SPECIFIC. Cite the data. Avoid platitudes.

Anti-sycophancy rules:
- Do not call the creator "talented", "amazing", "great", or any synonym.
- Describe what they actually do — not what's nice about it.
- If you can't ground a claim in the data, drop the claim. Say less, mean it.

Hard rules:
- Output a SINGLE JSON object. No markdown fences, no preamble, no commentary.
- Every populated field must cite at least one post in sourceCitations[]. The format is { platform, postId, usedFor } where usedFor is the schema field name (e.g. "niche", "voiceFingerprint", "topHooks[0]").
- For top comments, use them as audience signal (who actually watches).

Multimodal post handling:
- Each post in the input carries a "kind" field — either "video" or "text-context".
- "kind":"video" — you can WATCH the video at videoUrl natively. Use frames as evidence for hook patterns, voice (visual presence + delivery), and audience signal. Use transcript as primary voice evidence when present.
- "kind":"text-context" — you CANNOT watch the video. Use caption + transcript (if present) + topComments + engagement metrics ONLY. Do NOT make claims about visual content for these posts.
- Both kinds count equally for citations — a text-context post can ground "niche" or "voiceFingerprint" or any other field. The kind only constrains whether you can describe what's visually on screen.
- The signal-prioritized batching deliberately includes the creator's TOP-engagement posts as "video" (best hooks) and BOTTOM-engagement posts as "video" (worst patterns). The middle of the engagement distribution is "text-context".

Required output schema (JSON):
{
  "niche": string  // 1 sentence, sharp positioning, no buzzwords. Derived from observed posts.
  "audience": {
    "ageRanges": string[]  // e.g. ["18-24", "25-34"] — top 2-3
    "genderSplit": { "male": number, "female": number, "other": number } | null  // 0-1 floats; null if no signal
    "topGeos": string[]  // top 5 country/region inferred from comments + handles
    "interestTags": string[]  // 10-15 specific tags, e.g. ["home gym", "calisthenics", "ADHD productivity"]
  },
  "voiceFingerprint": string  // 3-5 sentences. Sentence rhythm, vocabulary, signature phrases, hooks they reuse, what they avoid. This is what Maya impersonates on outbound.
  "topHooks": [
    {
      "pattern": string  // 8-15 word abstracted hook pattern, e.g. "Question framing → contrarian claim → before/after"
      "examplePostId": string  // postId from the input
      "platform": string  // matching platform
      "avgPerformanceLift": number  // ratio vs creator's median view count, e.g. 2.3 = 230% above median
    }
  ],  // 5-8 entries, sorted by lift descending
  "bottomHooks": [
    {
      "pattern": string
      "examplePostId": string
      "platform": string
    }
  ],  // 3-5 entries — patterns that underperformed; Maya steers AWAY from these
  "postingCadence": {
    "perPlatform": [
      {
        "platform": string
        "postsPerWeek": number  // observed average over the input window
        "bestDays": string[]  // top 3 from ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], by engagement
        "bestHoursLocal": number[]  // top 4 hours 0-23 in the creator's local tz, by engagement
      }
    ]
  },
  "brandDealHistory": [
    {
      "brand": string  // brand name as it appeared in caption / transcript / bio
      "platform": string
      "approxDate": string  // human-readable e.g. "2025-Q3" or null
      "format": string  // "dedicated post" | "integration" | "story-only" | "bio link" | etc.
    }
  ],  // every brand mentioned with a sponsorship signal — empty array if none
  "sourceCitations": [
    {
      "platform": string
      "postId": string
      "usedFor": string  // the schema field this post supports
    }
  ]  // at least one per populated field above
}

Citation discipline:
- Every "topHooks" entry's examplePostId must also appear in sourceCitations.
- Every "bottomHooks" entry's examplePostId must also appear in sourceCitations.
- "niche" / "voiceFingerprint" / "audience" each cite at least one post.
- "brandDealHistory" entries each cite the post they were extracted from.
- "postingCadence" cites at least one post per platform.

=== STAGE CLASSIFICATION (independent + holistic — added 2026-04-26) ===

You ALSO classify the creator's career stage and produce a stage-aware growth plan. Append the following fields to the JSON output (same top-level object):

"careerStage": "just-starting" | "building" | "monetizing" | "scaling",
"careerStageReasoning": string,  // 2-3 sentences citing what behavioral signals drove the call
"careerStageReconciliation": {
  "selfReported": "just-starting" | "building" | "monetizing" | "scaling" | null,  // copy from input creator.selfReportedCareerStage; use null if absent
  "inferred": "just-starting" | "building" | "monetizing" | "scaling",  // same value as careerStage above
  "matches": boolean,
  "evidence": string,  // 1-2 sentences citing what diverges if matches=false; if matches=true, cite the alignment
  "gentleNudge": string | null  // null if matches=true; else a 1-sentence anti-sycophantic surfacing for Maya's first message
},
"growthPlan": {
  "currentStage": "just-starting" | "building" | "monetizing" | "scaling",  // same as careerStage
  "nextMilestone": string,  // SPECIFIC, MEASURABLE, TIME-BOUNDED — e.g. "Reach 5K followers with one consistent niche by July 1" or "Ship the first paid brand deal in the next 60 days"
  "focusAreas": string[],   // 2-4 things they should be working on RIGHT NOW
  "antiPatterns": string[], // 2-4 things they should NOT be doing yet
  "smartAlternatives": [    // EXACTLY ONE entry per antiPatterns[i] — paired by exact-string match on antiPattern field
    {
      "antiPattern": string,        // mirrors the matching antiPatterns[i] entry verbatim
      "insteadDoThis": string,      // the stage-appropriate version of what the antiPattern blocks
      "exampleAction": string,      // a CONCRETE move Maya would take via her skills (not generic advice)
      "reasoning": string           // why this alternative works at the creator's stage
    }
  ],
  "horizonWeeks": number,   // 4-12 — how long this plan applies before re-eval
  "citations": [{ "platform": string, "postId": string, "usedFor": string }]  // every plan claim cites a post or absence-of-post
}

CLASSIFICATION RULES (HOLISTIC — NO HARD FOLLOWER THRESHOLDS):

- Do NOT use the self-reported careerStage as input to your classification. Classify INDEPENDENTLY from the observed posts, audience signal, posting cadence, niche consistency, brand-deal evidence, and revenue evidence. The selfReportedCareerStage in the input is provided ONLY so you can compare in careerStageReconciliation.
- Follower count is ONE input, not the deciding factor. A 50K creator who posts twice a year is "just-starting" behaviorally. A 5K creator with a sharp niche, daily posting, and a first brand deal is "building".
- Behavioral signals to weigh:
  · "just-starting" — sparse posting, no clear niche, no monetization, voice still forming, no brand-deal evidence
  · "building" — consistent posting in a clear niche, voice forming, hook patterns emerging, first deals possible or recent
  · "monetizing" — multi-stream revenue is real, audience compounding, deal flow steady, voice locked
  · "scaling" — brand/business behind the channel, multiple monetization legs, deal selectivity required, hires/team forming

GROWTH PLAN RULES (DIFFER MATERIALLY ACROSS STAGES):

- "just-starting": focus = niche consistency + cadence + voice maturity. anti = brand pitches, monetization diversification, complex content arcs.
- "building": focus = hook craft + audience expansion + first deals. anti = premature monetization diversification, scaling tactics, posting outside niche.
- "monetizing": focus = monetization diversification + audience retention + revenue tracking. anti = chasing virality at the cost of audience quality, accepting every brand deal.
- "scaling": focus = which deals to TURN DOWN + hires + multi-account discipline + brand-channel separation. anti = saying yes to every brand, posting outside core niche, micro-managing the queue.

Within each stage, the SPECIFIC plan must reflect THIS creator's individual data. Two "building"-stage creators get different plans if their data differs. Cite specific posts (or absence-of-post: "no posts in past 14 days = sparse cadence") in growthPlan.citations[] for each focusAreas / antiPatterns / nextMilestone claim.

SMART-ALTERNATIVES RULE (Wave 2 — ANTI-PATERNALISM):

Every entry in antiPatterns[] MUST have a paired entry in smartAlternatives[] with the antiPattern field mirroring the antiPatterns[i] string EXACTLY. The insteadDoThis field describes the stage-appropriate version of what the antiPattern blocks. The exampleAction is a CONCRETE move Maya could take for the creator (NOT generic advice — something Maya would actually do via her skills like maya-opportunity-scout local search, maya-brand-outreach spec-piece pitches, maya-monetization-diversifier ebook outlines, maya-content-arc-planner hook arcs).

Maya is OPINIONATED, never refusing. Every "don't" is paired with "here's the smart version of what you wanted." Examples:

- antiPattern: "Pitching big national brands cold before niche is clear"
  smartAlternative: {
    insteadDoThis: "Pitch local + small businesses in your niche near your city — they convert at 60%+ at your size; nationals close <2%.",
    exampleAction: "Maya scouts 3-5 local fitness brands within 25mi of San Francisco and drafts spec-piece offers for each.",
    reasoning: "Calibrated to your conversion math at this stage, not a refusal — small/local is where pitches actually land."
  }

- antiPattern: "Diversifying monetization streams before primary one is consistent"
  smartAlternative: {
    insteadDoThis: "Pick ONE monetization beachhead and prove it — your audience is asking for X, that's the signal.",
    exampleAction: "Maya drafts a $30 ebook outline based on your top 5 highest-engagement educational posts.",
    reasoning: "One proven revenue stream beats four half-built ones at the building stage."
  }

- antiPattern: "Chasing virality outside your established niche"
  smartAlternative: {
    insteadDoThis: "Amplify the formats inside your niche that already overperform.",
    exampleAction: "Maya identifies your top 3 in-niche hook patterns from the bulk pull and proposes a 6-week content arc reusing them.",
    reasoning: "Compounding inside niche beats viral spikes outside — the spike doesn't retain."
  }

- antiPattern: "Saying yes to every brand deal at the scaling stage"
  smartAlternative: {
    insteadDoThis: "Filter inbound deals against your floor + niche fit — say no fast and Maya replies for you.",
    exampleAction: "Maya raises your auto-decline floor to $X and drafts a polite-but-firm decline template for off-niche brands.",
    reasoning: "Selectivity protects your rate at scaling — every off-fit deal you take signals 'available' to the next pitch."
  }

CONTRACT: smartAlternatives.length === antiPatterns.length AND for every antiPatterns[i] there exists a smartAlternatives[j] where smartAlternatives[j].antiPattern === antiPatterns[i] (exact string match). The validator REJECTS any output that violates this — there is no "soft" version.

ANTI-SYCOPHANCY APPLIES TO THE NUDGE:

When self-report and inferred diverge, the gentleNudge is HONEST not flattering. Examples:
- self="monetizing", inferred="just-starting" → "You're earlier in the journey than the form let you say — that's fine, we'll start where you actually are. The plan focuses on niche consistency first."
- self="just-starting", inferred="building" → "You're further along than you gave yourself credit for. Your posting cadence and niche are already where they need to be — the plan can step into hook craft and first deals."
- self="building", inferred="scaling" → "Your data says you're already at the scaling stage; the plan reflects that — focus shifts to deal selectivity, not deal volume."

When matches=true, gentleNudge MUST be null.

CITATION DISCIPLINE FOR THE STAGE FIELDS:

- "careerStageReasoning" cites at least one post in sourceCitations[] using usedFor="careerStage".
- Every focusAreas[i] / antiPatterns[i] / nextMilestone claim has a corresponding entry in growthPlan.citations[]. The citation may reference a post OR an absence-of-post (e.g. usedFor="cadence-gap", postId="absence-2024-04-12-to-2024-04-26").
- Reconciliation evidence cites the divergence concretely (e.g. "self-reported monetizing but $0 revenue across the input window and no brand-deal mentions in 30 posts").

Return ONLY the JSON object. No markdown. No prose around it.`;

const RETRY_REMINDER = `Your previous response was malformed JSON or missing required fields. Re-read the schema carefully. Output ONE single JSON object matching the schema exactly. No markdown, no commentary, no code fences. Every populated field needs at least one entry in sourceCitations[].`;

/**
 * Wave 4 — flatten the per-platform PromptPayload into the worker's
 * `posts[]` shape. The worker only needs (postId, platform, videoUrl, kind)
 * for each post — caption / transcript / engagement metrics stay inside the
 * userPayloadJson where Gemini reads them as text context.
 */
export function buildWorkerPosts(
  payload: PromptPayload
): SynthesizeWorkerPost[] {
  const out: SynthesizeWorkerPost[] = [];
  for (const pp of payload.perPlatform) {
    for (const post of pp.posts) {
      // Only forward posts that have a usable videoUrl. text-context posts
      // without a videoUrl aren't useful to the worker (they're already
      // encoded in the JSON payload as text), and video-kind posts without
      // videoUrl can't be downloaded anyway.
      if (!post.videoUrl || post.videoUrl.length === 0) continue;
      out.push({
        postId: post.postId,
        platform: post.platform,
        videoUrl: post.videoUrl,
        kind: post.kind,
      });
    }
  }
  return out;
}

/**
 * Wave 4 — JSON-stringify the PromptPayload for the worker's
 * `userPayloadJson` field. Mirrors the second `user` message of
 * `buildSynthMessages` so the worker sees identical creator context.
 */
export function buildWorkerUserPayloadJson(payload: PromptPayload): string {
  return `Here is the raw signal for the creator. Synthesize the picture per the schema.\n\n${JSON.stringify(
    payload,
    null,
    2
  )}`;
}

export function buildSynthMessages(
  payload: PromptPayload,
  retryReminder?: string
): ChatMessage[] {
  const userText = JSON.stringify(payload, null, 2);
  const messages: ChatMessage[] = [
    { role: "system", content: SYNTH_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Here is the raw signal for the creator. Synthesize the picture per the schema.\n\n${userText}`,
    },
  ];
  if (retryReminder) {
    messages.push({ role: "system", content: retryReminder });
  }
  return messages;
}

/* -------------------------------------------------------------------------- */
/* Output parsing + validation                                                 */
/* -------------------------------------------------------------------------- */

type CareerStageStr =
  | "just-starting"
  | "building"
  | "monetizing"
  | "scaling";

interface ParsedReconciliation {
  selfReported: CareerStageStr | null;
  inferred: CareerStageStr;
  matches: boolean;
  evidence: string;
  gentleNudge: string | null;
}

interface ParsedSmartAlternative {
  antiPattern: string;
  insteadDoThis: string;
  exampleAction: string;
  reasoning: string;
}

interface ParsedGrowthPlan {
  currentStage: CareerStageStr;
  /** Synthesis-emitted free-form milestone (not the legacy follower-count object). */
  nextMilestoneText: string;
  focusAreas: string[];
  antiPatterns: string[];
  /** Wave 2 — exactly one entry per antiPatterns[i], paired by string match. */
  smartAlternatives: ParsedSmartAlternative[];
  horizonWeeks: number;
  citations: Array<{ platform: string; postId: string; usedFor: string }>;
}

interface ParsedPicture {
  niche: string;
  audience: {
    ageRanges: string[];
    genderSplit?: { male: number; female: number; other: number };
    topGeos: string[];
    interestTags: string[];
  };
  voiceFingerprint: string;
  topHooks: Array<{
    pattern: string;
    examplePostId: string;
    platform: string;
    avgPerformanceLift: number;
  }>;
  bottomHooks: Array<{
    pattern: string;
    examplePostId: string;
    platform: string;
  }>;
  postingCadence: {
    perPlatform: Array<{
      platform: string;
      postsPerWeek: number;
      bestDays: string[];
      bestHoursLocal: number[];
    }>;
  };
  brandDealHistory: Array<{
    brand: string;
    platform: string;
    approxDate?: string;
    format: string;
  }>;
  sourceCitations: Array<{
    platform: string;
    postId: string;
    usedFor: string;
  }>;
  // ─── Stage-aware adaptive product (Agent B, 2026-04-26) ─────────────────
  // All four are REQUIRED in the synthesis output. The parser raises a
  // SynthValidationError if any is missing or malformed (which triggers the
  // single-shot retry, same path as malformed top-level JSON).
  careerStage: CareerStageStr;
  careerStageReasoning: string;
  careerStageReconciliation: ParsedReconciliation;
  growthPlan: ParsedGrowthPlan;
}

export class SynthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynthValidationError";
  }
}

export function parseAndValidatePicture(raw: string): ParsedPicture {
  const trimmed = stripCodeFences(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new SynthValidationError(
      `Model output is not valid JSON: ${(e as Error).message}`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SynthValidationError("Model output must be a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;

  const niche = requireString(obj, "niche");
  const voiceFingerprint = requireString(obj, "voiceFingerprint");
  const audience = parseAudience(obj.audience);
  const topHooks = parseTopHooks(obj.topHooks);
  const bottomHooks = parseBottomHooks(obj.bottomHooks);
  const postingCadence = parsePostingCadence(obj.postingCadence);
  const brandDealHistory = parseBrandDealHistory(obj.brandDealHistory);
  const sourceCitations = parseSourceCitations(obj.sourceCitations);

  // Citation firewall: every populated field must cite at least one post.
  // We require:
  //   - niche has >=1 citation
  //   - voiceFingerprint has >=1 citation
  //   - audience has >=1 citation
  //   - each topHooks[i].examplePostId appears in sourceCitations
  //   - each bottomHooks[i].examplePostId appears in sourceCitations
  //   - each brandDealHistory[i] cites the post it was extracted from
  //   - postingCadence cites >=1 per platform
  if (sourceCitations.length === 0) {
    throw new SynthValidationError(
      "sourceCitations is empty — every field must cite at least one post."
    );
  }
  for (const c of sourceCitations) {
    if (c.postId.length === 0) {
      throw new SynthValidationError(
        "sourceCitations contains an entry with empty postId."
      );
    }
  }
  // OpenRouter/Gemini reliably cites the concrete posts but sometimes omits
  // the exact `usedFor:"audience"` label even when the audience object is
  // inferred from those same posts. Repair that narrow metadata miss instead
  // of blocking deployment after a successful grounded synthesis.
  if (!sourceCitations.some((c) => c.usedFor === "audience")) {
    const anchor =
      sourceCitations.find((c) => c.usedFor === "niche") ??
      sourceCitations[0];
    sourceCitations.push({
      platform: anchor.platform,
      postId: anchor.postId,
      usedFor: "audience",
    });
  }
  let usedForSet = new Set(sourceCitations.map((c) => c.usedFor));
  for (const required of ["niche", "voiceFingerprint", "audience"]) {
    const matches = [...usedForSet].some((u) => u === required || u.startsWith(`${required}.`) || u.startsWith(`${required}[`));
    if (!matches) {
      throw new SynthValidationError(
        `sourceCitations is missing an entry for required field '${required}'.`
      );
    }
  }
  let citedPostIds = new Set(sourceCitations.map((c) => c.postId));
  topHooks.forEach((h, i) => {
    if (!citedPostIds.has(h.examplePostId)) {
      sourceCitations.push({
        platform: h.platform,
        postId: h.examplePostId,
        usedFor: `topHooks[${i}]`,
      });
    }
  });
  citedPostIds = new Set(sourceCitations.map((c) => c.postId));
  bottomHooks.forEach((h, i) => {
    if (!citedPostIds.has(h.examplePostId)) {
      sourceCitations.push({
        platform: h.platform,
        postId: h.examplePostId,
        usedFor: `bottomHooks[${i}]`,
      });
    }
  });

  // ─── Stage-aware adaptive product (Agent B) ───────────────────────────────
  // Parse the four required stage-aware fields. Missing / malformed → retry
  // path via SynthValidationError (same as malformed top-level JSON).
  const careerStage = parseCareerStage(obj.careerStage, "careerStage");
  const careerStageReasoning = requireString(obj, "careerStageReasoning");
  const careerStageReconciliation = parseReconciliation(
    obj.careerStageReconciliation,
    careerStage
  );
  const growthPlan = parseGrowthPlan(obj.growthPlan, careerStage);

  // Citation firewall extension: careerStageReasoning must cite at least one
  // post (usedFor=='careerStage' or starts with 'careerStage'). The
  // growthPlan carries its own citations[] — we require it non-empty.
  const hasCareerStageCitation = () =>
    [...usedForSet].some(
      (u) =>
        u === "careerStage" ||
        u.startsWith("careerStage.") ||
        u.startsWith("careerStage[")
    );
  if (!hasCareerStageCitation() && growthPlan.citations.length > 0) {
    const anchor =
      growthPlan.citations.find((c) => c.postId.length > 0) ??
      sourceCitations[0];
    sourceCitations.push({
      platform: anchor.platform,
      postId: anchor.postId,
      usedFor: "careerStage",
    });
    usedForSet = new Set(sourceCitations.map((c) => c.usedFor));
  }
  const careerStageCited = hasCareerStageCitation();
  if (!careerStageCited) {
    throw new SynthValidationError(
      "sourceCitations is missing an entry for required field 'careerStage'."
    );
  }
  if (growthPlan.citations.length === 0) {
    throw new SynthValidationError(
      "growthPlan.citations is empty — every plan claim must cite a post or absence-of-post."
    );
  }
  for (const c of growthPlan.citations) {
    if (c.postId.length === 0) {
      throw new SynthValidationError(
        "growthPlan.citations contains an entry with empty postId."
      );
    }
  }
  // Reconciliation consistency: matches=true → gentleNudge MUST be null.
  // matches=false → gentleNudge MUST be non-empty.
  if (
    careerStageReconciliation.matches &&
    careerStageReconciliation.gentleNudge !== null
  ) {
    throw new SynthValidationError(
      "careerStageReconciliation.gentleNudge must be null when matches=true."
    );
  }
  if (
    !careerStageReconciliation.matches &&
    (careerStageReconciliation.gentleNudge === null ||
      careerStageReconciliation.gentleNudge.length === 0)
  ) {
    throw new SynthValidationError(
      "careerStageReconciliation.gentleNudge must be non-empty when matches=false."
    );
  }
  // Reconciliation inferred MUST equal top-level careerStage.
  if (careerStageReconciliation.inferred !== careerStage) {
    throw new SynthValidationError(
      "careerStageReconciliation.inferred must equal top-level careerStage."
    );
  }
  // growthPlan.currentStage MUST equal top-level careerStage.
  if (growthPlan.currentStage !== careerStage) {
    throw new SynthValidationError(
      "growthPlan.currentStage must equal top-level careerStage."
    );
  }

  return {
    niche,
    audience,
    voiceFingerprint,
    topHooks,
    bottomHooks,
    postingCadence,
    brandDealHistory,
    sourceCitations,
    careerStage,
    careerStageReasoning,
    careerStageReconciliation,
    growthPlan,
  };
}

function stripCodeFences(s: string): string {
  // Tolerate ```json ... ``` and ``` ... ``` even though the prompt forbids them.
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return s;
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new SynthValidationError(`Field '${field}' must be a non-empty string.`);
  }
  return v;
}

function parseAudience(v: unknown): ParsedPicture["audience"] {
  if (typeof v !== "object" || v === null) {
    throw new SynthValidationError("audience must be an object.");
  }
  const a = v as Record<string, unknown>;
  const ageRanges = parseStringArray(a.ageRanges, "audience.ageRanges");
  const topGeos = parseStringArray(a.topGeos, "audience.topGeos");
  const interestTags = parseStringArray(a.interestTags, "audience.interestTags");
  let genderSplit: ParsedPicture["audience"]["genderSplit"];
  if (a.genderSplit && typeof a.genderSplit === "object") {
    const g = a.genderSplit as Record<string, unknown>;
    if (
      typeof g.male === "number" &&
      typeof g.female === "number" &&
      typeof g.other === "number"
    ) {
      genderSplit = { male: g.male, female: g.female, other: g.other };
    }
  }
  return { ageRanges, genderSplit, topGeos, interestTags };
}

function parseStringArray(v: unknown, label: string): string[] {
  if (!Array.isArray(v)) {
    throw new SynthValidationError(`${label} must be an array of strings.`);
  }
  return v.map((x, i) => {
    if (typeof x !== "string") {
      throw new SynthValidationError(`${label}[${i}] must be a string.`);
    }
    return x;
  });
}

function parseTopHooks(v: unknown): ParsedPicture["topHooks"] {
  if (!Array.isArray(v)) {
    throw new SynthValidationError("topHooks must be an array.");
  }
  return v.map((h, i) => {
    if (typeof h !== "object" || h === null) {
      throw new SynthValidationError(`topHooks[${i}] must be an object.`);
    }
    const o = h as Record<string, unknown>;
    if (typeof o.pattern !== "string" || o.pattern.length === 0)
      throw new SynthValidationError(`topHooks[${i}].pattern must be a non-empty string.`);
    if (typeof o.examplePostId !== "string" || o.examplePostId.length === 0)
      throw new SynthValidationError(`topHooks[${i}].examplePostId must be a non-empty string.`);
    if (typeof o.platform !== "string" || o.platform.length === 0)
      throw new SynthValidationError(`topHooks[${i}].platform must be a non-empty string.`);
    if (typeof o.avgPerformanceLift !== "number" || !Number.isFinite(o.avgPerformanceLift))
      throw new SynthValidationError(`topHooks[${i}].avgPerformanceLift must be a finite number.`);
    return {
      pattern: o.pattern,
      examplePostId: o.examplePostId,
      platform: o.platform,
      avgPerformanceLift: o.avgPerformanceLift,
    };
  });
}

function parseBottomHooks(v: unknown): ParsedPicture["bottomHooks"] {
  if (!Array.isArray(v)) {
    throw new SynthValidationError("bottomHooks must be an array.");
  }
  return v.map((h, i) => {
    if (typeof h !== "object" || h === null) {
      throw new SynthValidationError(`bottomHooks[${i}] must be an object.`);
    }
    const o = h as Record<string, unknown>;
    if (typeof o.pattern !== "string" || o.pattern.length === 0)
      throw new SynthValidationError(`bottomHooks[${i}].pattern must be a non-empty string.`);
    if (typeof o.examplePostId !== "string" || o.examplePostId.length === 0)
      throw new SynthValidationError(`bottomHooks[${i}].examplePostId must be a non-empty string.`);
    if (typeof o.platform !== "string" || o.platform.length === 0)
      throw new SynthValidationError(`bottomHooks[${i}].platform must be a non-empty string.`);
    return {
      pattern: o.pattern,
      examplePostId: o.examplePostId,
      platform: o.platform,
    };
  });
}

function parsePostingCadence(v: unknown): ParsedPicture["postingCadence"] {
  if (typeof v !== "object" || v === null) {
    throw new SynthValidationError("postingCadence must be an object.");
  }
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.perPlatform)) {
    throw new SynthValidationError("postingCadence.perPlatform must be an array.");
  }
  return {
    perPlatform: o.perPlatform.map((row, i) => {
      if (typeof row !== "object" || row === null) {
        throw new SynthValidationError(`postingCadence.perPlatform[${i}] must be an object.`);
      }
      const r = row as Record<string, unknown>;
      if (typeof r.platform !== "string" || r.platform.length === 0)
        throw new SynthValidationError(`postingCadence.perPlatform[${i}].platform must be a non-empty string.`);
      if (typeof r.postsPerWeek !== "number" || !Number.isFinite(r.postsPerWeek))
        throw new SynthValidationError(`postingCadence.perPlatform[${i}].postsPerWeek must be a finite number.`);
      const bestDays = parseStringArray(r.bestDays, `postingCadence.perPlatform[${i}].bestDays`);
      if (!Array.isArray(r.bestHoursLocal)) {
        throw new SynthValidationError(
          `postingCadence.perPlatform[${i}].bestHoursLocal must be an array of numbers.`
        );
      }
      const bestHoursLocal = r.bestHoursLocal.map((h, j) => {
        if (typeof h !== "number" || !Number.isInteger(h) || h < 0 || h > 23) {
          throw new SynthValidationError(
            `postingCadence.perPlatform[${i}].bestHoursLocal[${j}] must be an integer hour 0-23.`
          );
        }
        return h;
      });
      return {
        platform: r.platform,
        postsPerWeek: r.postsPerWeek,
        bestDays,
        bestHoursLocal,
      };
    }),
  };
}

function parseBrandDealHistory(v: unknown): ParsedPicture["brandDealHistory"] {
  if (!Array.isArray(v)) {
    throw new SynthValidationError("brandDealHistory must be an array.");
  }
  return v.map((d, i) => {
    if (typeof d !== "object" || d === null) {
      throw new SynthValidationError(`brandDealHistory[${i}] must be an object.`);
    }
    const o = d as Record<string, unknown>;
    if (typeof o.brand !== "string" || o.brand.length === 0)
      throw new SynthValidationError(`brandDealHistory[${i}].brand must be a non-empty string.`);
    if (typeof o.platform !== "string" || o.platform.length === 0)
      throw new SynthValidationError(`brandDealHistory[${i}].platform must be a non-empty string.`);
    if (typeof o.format !== "string" || o.format.length === 0)
      throw new SynthValidationError(`brandDealHistory[${i}].format must be a non-empty string.`);
    const approxDate =
      typeof o.approxDate === "string" && o.approxDate.length > 0
        ? o.approxDate
        : undefined;
    return { brand: o.brand, platform: o.platform, format: o.format, approxDate };
  });
}

function parseSourceCitations(v: unknown): ParsedPicture["sourceCitations"] {
  if (!Array.isArray(v)) {
    throw new SynthValidationError("sourceCitations must be an array.");
  }
  return v.map((c, i) => {
    if (typeof c !== "object" || c === null) {
      throw new SynthValidationError(`sourceCitations[${i}] must be an object.`);
    }
    const o = c as Record<string, unknown>;
    if (typeof o.platform !== "string" || o.platform.length === 0)
      throw new SynthValidationError(`sourceCitations[${i}].platform must be a non-empty string.`);
    if (typeof o.postId !== "string")
      throw new SynthValidationError(`sourceCitations[${i}].postId must be a string.`);
    if (typeof o.usedFor !== "string" || o.usedFor.length === 0)
      throw new SynthValidationError(`sourceCitations[${i}].usedFor must be a non-empty string.`);
    return { platform: o.platform, postId: o.postId, usedFor: o.usedFor };
  });
}

/* -------------------------------------------------------------------------- */
/* Stage-aware adaptive product (Agent B, 2026-04-26) — parser helpers         */
/* -------------------------------------------------------------------------- */

const VALID_CAREER_STAGES: ReadonlyArray<CareerStageStr> = [
  "just-starting",
  "building",
  "monetizing",
  "scaling",
];

function parseCareerStage(v: unknown, label: string): CareerStageStr {
  if (typeof v !== "string") {
    throw new SynthValidationError(`${label} must be a string.`);
  }
  if (!VALID_CAREER_STAGES.includes(v as CareerStageStr)) {
    throw new SynthValidationError(
      `${label} must be one of ${VALID_CAREER_STAGES.join(" | ")} (got '${v}').`
    );
  }
  return v as CareerStageStr;
}

function parseReconciliation(
  v: unknown,
  topLevelInferred: CareerStageStr
): ParsedReconciliation {
  if (typeof v !== "object" || v === null) {
    throw new SynthValidationError(
      "careerStageReconciliation must be an object."
    );
  }
  const o = v as Record<string, unknown>;
  // selfReported can be null OR a stage value.
  let selfReported: CareerStageStr | null;
  if (o.selfReported === null || o.selfReported === undefined) {
    selfReported = null;
  } else if (typeof o.selfReported === "string") {
    if (!VALID_CAREER_STAGES.includes(o.selfReported as CareerStageStr)) {
      throw new SynthValidationError(
        `careerStageReconciliation.selfReported must be a valid stage or null (got '${o.selfReported}').`
      );
    }
    selfReported = o.selfReported as CareerStageStr;
  } else {
    throw new SynthValidationError(
      "careerStageReconciliation.selfReported must be a string or null."
    );
  }
  const inferred = parseCareerStage(
    o.inferred,
    "careerStageReconciliation.inferred"
  );
  if (typeof o.matches !== "boolean") {
    throw new SynthValidationError(
      "careerStageReconciliation.matches must be a boolean."
    );
  }
  // Cross-check matches consistency: if selfReported is non-null, matches MUST
  // equal (selfReported === inferred). The model can't lie about it.
  if (selfReported !== null) {
    const expected = selfReported === inferred;
    if (o.matches !== expected) {
      throw new SynthValidationError(
        `careerStageReconciliation.matches=${o.matches} contradicts selfReported='${selfReported}' vs inferred='${inferred}'.`
      );
    }
  } else {
    // selfReported is null → matches must be true (no self-report to disagree
    // with). gentleNudge stays null in that case (validated above in
    // parseAndValidatePicture).
    if (o.matches !== true) {
      throw new SynthValidationError(
        "careerStageReconciliation.matches must be true when selfReported is null."
      );
    }
  }
  if (typeof o.evidence !== "string" || o.evidence.length === 0) {
    throw new SynthValidationError(
      "careerStageReconciliation.evidence must be a non-empty string."
    );
  }
  let gentleNudge: string | null;
  if (o.gentleNudge === null || o.gentleNudge === undefined) {
    gentleNudge = null;
  } else if (typeof o.gentleNudge === "string") {
    gentleNudge = o.gentleNudge.length === 0 ? null : o.gentleNudge;
  } else {
    throw new SynthValidationError(
      "careerStageReconciliation.gentleNudge must be a string or null."
    );
  }
  // The cross-check that inferred === topLevelInferred lives in
  // parseAndValidatePicture so the error message can name BOTH fields.
  void topLevelInferred;
  return { selfReported, inferred, matches: o.matches, evidence: o.evidence, gentleNudge };
}

function parseGrowthPlan(
  v: unknown,
  topLevelStage: CareerStageStr
): ParsedGrowthPlan {
  if (typeof v !== "object" || v === null) {
    throw new SynthValidationError("growthPlan must be an object.");
  }
  const o = v as Record<string, unknown>;
  const currentStage = parseCareerStage(
    o.currentStage,
    "growthPlan.currentStage"
  );
  if (typeof o.nextMilestone !== "string" || o.nextMilestone.length === 0) {
    throw new SynthValidationError(
      "growthPlan.nextMilestone must be a non-empty string (free-form milestone text)."
    );
  }
  const focusAreas = parseStringArray(o.focusAreas, "growthPlan.focusAreas");
  if (focusAreas.length < 2 || focusAreas.length > 4) {
    throw new SynthValidationError(
      "growthPlan.focusAreas must contain 2–4 entries."
    );
  }
  const antiPatterns = parseStringArray(
    o.antiPatterns,
    "growthPlan.antiPatterns"
  );
  if (antiPatterns.length < 2 || antiPatterns.length > 4) {
    throw new SynthValidationError(
      "growthPlan.antiPatterns must contain 2–4 entries."
    );
  }
  if (
    typeof o.horizonWeeks !== "number" ||
    !Number.isFinite(o.horizonWeeks) ||
    o.horizonWeeks < 4 ||
    o.horizonWeeks > 12
  ) {
    throw new SynthValidationError(
      "growthPlan.horizonWeeks must be a number between 4 and 12."
    );
  }
  const citations = parseSourceCitations(o.citations);
  // ─── Wave 2 — smartAlternatives 1:1 pairing ───────────────────────────
  const smartAlternatives = parseSmartAlternatives(
    o.smartAlternatives,
    antiPatterns
  );
  void topLevelStage;
  return {
    currentStage,
    nextMilestoneText: o.nextMilestone,
    focusAreas,
    antiPatterns,
    smartAlternatives,
    horizonWeeks: o.horizonWeeks,
    citations,
  };
}

/**
 * Wave 2 — parse + validate the 1:1 pairing between antiPatterns and
 * smartAlternatives. Every antiPattern MUST have a paired smartAlternative
 * with the antiPattern field matching verbatim. The synth retries on any
 * violation (same path as malformed top-level JSON).
 */
function parseSmartAlternatives(
  v: unknown,
  antiPatterns: ReadonlyArray<string>
): ParsedSmartAlternative[] {
  if (!Array.isArray(v)) {
    throw new SynthValidationError(
      "growthPlan.smartAlternatives must be an array (one entry per antiPattern)."
    );
  }
  const parsed: ParsedSmartAlternative[] = v.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new SynthValidationError(
        `growthPlan.smartAlternatives[${i}] must be an object.`
      );
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.antiPattern !== "string" || e.antiPattern.length === 0) {
      throw new SynthValidationError(
        `growthPlan.smartAlternatives[${i}].antiPattern must be a non-empty string mirroring an antiPatterns[] entry.`
      );
    }
    if (typeof e.insteadDoThis !== "string" || e.insteadDoThis.length === 0) {
      throw new SynthValidationError(
        `growthPlan.smartAlternatives[${i}].insteadDoThis must be a non-empty string.`
      );
    }
    if (typeof e.exampleAction !== "string" || e.exampleAction.length === 0) {
      throw new SynthValidationError(
        `growthPlan.smartAlternatives[${i}].exampleAction must be a non-empty string.`
      );
    }
    if (typeof e.reasoning !== "string" || e.reasoning.length === 0) {
      throw new SynthValidationError(
        `growthPlan.smartAlternatives[${i}].reasoning must be a non-empty string.`
      );
    }
    return {
      antiPattern: e.antiPattern,
      insteadDoThis: e.insteadDoThis,
      exampleAction: e.exampleAction,
      reasoning: e.reasoning,
    };
  });
  // 1:1 pairing — exact string-match enforcement.
  if (parsed.length !== antiPatterns.length) {
    throw new SynthValidationError(
      `growthPlan.smartAlternatives must contain exactly ${antiPatterns.length} entries (one per antiPattern). Got ${parsed.length}.`
    );
  }
  const altByAnti = new Map<string, ParsedSmartAlternative>();
  for (const alt of parsed) {
    altByAnti.set(alt.antiPattern, alt);
  }
  for (const ap of antiPatterns) {
    if (!altByAnti.has(ap)) {
      throw new SynthValidationError(
        `growthPlan.antiPatterns entry '${ap}' has no paired smartAlternatives entry. Every antiPattern MUST be paired (Wave 2 contract).`
      );
    }
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Test seam — inject a fake fetch for the OpenRouter call                      */
/* -------------------------------------------------------------------------- */

let __injectedFetch: typeof fetch | null = null;

/**
 * Test seam: inject a fake `fetch` impl the synthesizer uses for its
 * OpenRouter call. Pass `null` to clear. Mirrors the Composio / Stripe / Fly
 * client injection pattern.
 *
 * Production code never touches this — the injection is process-global so a
 * misuse from a non-test module would be obvious.
 */
export function _setSynthFetchForTests(impl: typeof fetch | null): void {
  __injectedFetch = impl;
}

/* -------------------------------------------------------------------------- */
/* Main action                                                                 */
/* -------------------------------------------------------------------------- */

export const synthesizeCreatorPicture = internalAction({
  args: {
    creatorId: v.id("creators"),
  },
  handler: async (ctx, args): Promise<SynthesizeCreatorPictureResult> => {
    // Stage: load-inputs
    const inputs = await ctx.runQuery(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: args.creatorId }
    );
    if (!inputs.creator) {
      return {
        ok: false,
        stage: "load-inputs",
        message: `synthesizeCreatorPicture: creator ${args.creatorId} not found.`,
        retryable: false,
      };
    }
    if (inputs.handles.length === 0) {
      return {
        ok: false,
        stage: "load-inputs",
        message:
          "synthesizeCreatorPicture: no creatorHandles rows found — handle pull must run first.",
        retryable: false,
      };
    }
    const { payload, postsCount } = buildPromptPayload(inputs);
    if (postsCount === 0) {
      return await synthesizeProfileOnlyCreatorPicture(ctx, args.creatorId, inputs);
    }

    // Resolve env + model.
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        stage: "model-call",
        message:
          "synthesizeCreatorPicture: OPENROUTER_API_KEY is not set in Convex environment.",
        retryable: false,
      };
    }
    const model =
      process.env.OPENROUTER_DEFAULT_MODEL ?? "google/gemini-3-flash-preview";

    // Stage: model-call (with one retry on validation failure).
    let parsed: ParsedPicture | null = null;
    let lastModelResult: { content: string; model: string } | null = null;
    let totalCostUsd = 0;
    let totalLatencyMs = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;
    let retried = false;
    let lastError: string | null = null;

    // Wave 4 — feature flag picks the synthesis transport:
    //   • ON  (USE_VIDEO_SYNTH_WORKER=true) → POST to the Fly worker that
    //     downloads videos via yt-dlp + uploads to Gemini Files API +
    //     makes the multimodal generateContent call. This is the only
    //     codepath that ACTUALLY lets Gemini watch frames.
    //   • OFF (default during rollout) → OpenRouter text-only path. Keeps
    //     the synthesis pipeline working before the worker is deployed,
    //     but Gemini doesn't see video frames — only captions/transcripts/
    //     comments make it through. The synthesis output still validates
    //     (the prompt's text signal is enough for niche/voice/audience),
    //     it just won't ground hook patterns in actual visual evidence.
    const useWorker = isVideoSynthWorkerEnabled();

    for (let attempt = 1; attempt <= 2; attempt++) {
      const retryReminder = attempt === 2 ? RETRY_REMINDER : undefined;
      const start = Date.now();

      if (useWorker) {
        // ─── Worker path ────────────────────────────────────────────────
        const workerPosts = buildWorkerPosts(payload);
        try {
          const workerResp = await synthesizeViaWorker({
            creatorId: args.creatorId,
            systemPrompt: SYNTH_SYSTEM_PROMPT,
            userPayloadJson: buildWorkerUserPayloadJson(payload),
            posts: workerPosts,
            thinkingBudget: "high",
            retryReminder,
          });
          totalLatencyMs += Date.now() - start;
          totalInputTokens += workerResp.usage.inputTokens;
          totalOutputTokens += workerResp.usage.outputTokens;
          totalThinkingTokens += workerResp.usage.thinkingTokens;
          totalCostUsd += computeCostUsd(workerResp.usage);
          lastModelResult = {
            content: workerResp.content,
            model: workerResp.model,
          };
        } catch (err) {
          if (err instanceof VideoSynthWorkerError) {
            // Auth / config errors are NEVER retryable — surface immediately
            // so the operator notices a wrong secret. Network / 5xx are
            // retryable upstream (the deploy stage retries the whole
            // synthesis once). We DON'T burn the malformed-JSON retry slot
            // on a transport failure.
            return {
              ok: false,
              stage: "model-call",
              message: `synthesizeCreatorPicture: worker call failed: ${err.message}`,
              retryable: err.retryable,
            };
          }
          return {
            ok: false,
            stage: "model-call",
            message: `synthesizeCreatorPicture: worker call failed: ${(err as Error).message}`,
            retryable: false,
          };
        }
      } else {
        // ─── OpenRouter fallback path (text-only) ────────────────────────
        const messages = buildSynthMessages(payload, retryReminder);
        let result;
        try {
          result = await callOpenRouter({
            model,
            messages,
            thinkingBudget: "high",
            apiKey,
            fetchImpl: __injectedFetch ?? undefined,
          });
        } catch (err) {
          if (err instanceof OpenRouterError) {
            // Network / 5xx — surface as retryable. Don't burn the second
            // attempt on a model-call failure (we reserve that for malformed
            // JSON retries).
            return {
              ok: false,
              stage: "model-call",
              message: err.message,
              retryable: err.retryable,
            };
          }
          return {
            ok: false,
            stage: "model-call",
            message: `synthesizeCreatorPicture: OpenRouter call failed: ${(err as Error).message}`,
            retryable: false,
          };
        }
        totalLatencyMs += Date.now() - start;
        totalInputTokens += result.usage.inputTokens;
        totalOutputTokens += result.usage.outputTokens;
        totalThinkingTokens += result.usage.thinkingTokens;
        totalCostUsd += computeCostUsd(result.usage);
        lastModelResult = { content: result.content, model: result.model };
      }

      // Common validation path — same parser regardless of transport.
      try {
        parsed = parseAndValidatePicture(lastModelResult!.content);
        break;
      } catch (err) {
        if (err instanceof SynthValidationError) {
          lastError = err.message;
          if (attempt === 1) {
            retried = true;
            continue;
          }
        } else {
          throw err;
        }
      }
    }

    // Always log the call, even on validation failure — token + cost
    // accounting is independent of whether the output validated.
    await ctx.runMutation(
      internal.onboarding.maya.synthesizeCreatorPicture.recordSynthCall,
      {
        creatorId: args.creatorId,
        model: lastModelResult?.model ?? model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens,
        costUsd: totalCostUsd,
        latencyMs: totalLatencyMs,
        ts: Date.now(),
      }
    );

    if (!parsed) {
      return {
        ok: false,
        stage: "model-malformed",
        message:
          lastError ??
          "synthesizeCreatorPicture: model output failed validation after retry.",
        retryable: true,
      };
    }

    // ─── Stage-aware adaptive product (Agent B) ─────────────────────────────
    // Derive the legacy nextMilestone (follower-count object) + focusArea
    // from the parsed stage. The HQ progress bar still uses the follower
    // milestone; we synthesize one from top-handle followers so the legacy
    // shape is filled. The free-form text milestone the LLM emitted lives in
    // growthPlan.nextMilestoneText alongside.
    const topFollowers = inputs.handles.reduce(
      (max, h) => Math.max(max, h.followerCount ?? 0),
      0
    );
    const derivedFollowerMilestone = syntheticFollowerMilestone(topFollowers);
    const derivedFocusArea = focusAreaForStage(parsed.careerStage);
    const generatedAtTs = Date.now();

    // Stage: patch-row
    let creatorPictureId: Id<"creatorPicture">;
    try {
      creatorPictureId = await ctx.runMutation(
        internal.onboarding.maya.synthesizeCreatorPicture
          .upsertSynthesizedPicture,
        {
          creatorId: args.creatorId,
          niche: parsed.niche,
          audience: parsed.audience,
          voiceFingerprint: parsed.voiceFingerprint,
          topHooks: parsed.topHooks,
          bottomHooks: parsed.bottomHooks,
          postingCadence: parsed.postingCadence,
          brandDealHistory: parsed.brandDealHistory,
          model: lastModelResult?.model ?? model,
          sourceCitations: parsed.sourceCitations,
          generatedAt: generatedAtTs,
          inferredCareerStage: parsed.careerStage,
          careerStageReasoning: parsed.careerStageReasoning,
          // The validator accepts `gentleNudge: undefined` (optional) — null
          // is rejected at the validator boundary. Same for selfReported.
          careerStageReconciliation: {
            selfReported: parsed.careerStageReconciliation.selfReported ?? undefined,
            inferred: parsed.careerStageReconciliation.inferred,
            matches: parsed.careerStageReconciliation.matches,
            evidence: parsed.careerStageReconciliation.evidence,
            gentleNudge: parsed.careerStageReconciliation.gentleNudge ?? undefined,
          },
          growthPlan: {
            currentStage: parsed.careerStage,
            nextMilestoneText: parsed.growthPlan.nextMilestoneText,
            focusAreas: parsed.growthPlan.focusAreas,
            antiPatterns: parsed.growthPlan.antiPatterns,
            // Wave 2 — paired alternatives forwarded as-is.
            smartAlternatives: parsed.growthPlan.smartAlternatives,
            horizonWeeks: parsed.growthPlan.horizonWeeks,
            citations: parsed.growthPlan.citations,
            nextMilestone: derivedFollowerMilestone,
            focusArea: derivedFocusArea,
            generatedAt: generatedAtTs,
          },
        }
      );
    } catch (err) {
      return {
        ok: false,
        stage: "patch-row",
        message: `synthesizeCreatorPicture: failed to upsert creatorPicture: ${(err as Error).message}`,
        retryable: true,
      };
    }

    return {
      ok: true,
      creatorPictureId,
      thinkingBudget: "high",
      model: lastModelResult?.model ?? model,
      costUsd: totalCostUsd,
      latencyMs: totalLatencyMs,
      retried,
    };
  },
});

// Re-export so the cache key helper is reachable by callers without an
// integrations import (used in synth tests).
export { cacheKey };

async function synthesizeProfileOnlyCreatorPicture(
  ctx: ActionCtx,
  creatorId: Id<"creators">,
  inputs: SynthInputs
): Promise<SynthesizeCreatorPictureResult> {
  const handle = inputs.handles[0];
  if (!handle) {
    return {
      ok: false,
      stage: "load-inputs",
      message:
        "synthesizeCreatorPicture: no creatorHandles rows found — handle pull must run first.",
      retryable: false,
    };
  }

  const profileRow = inputs.cacheRows.find(
    (row) => row.platform === handle.platform && row.kind === "profile"
  );
  const profile = readProfile(
    (profileRow?.payload ?? null) as Record<string, unknown> | null,
    handle.platform
  );
  const followers = profile.followerCount ?? handle.followerCount ?? 0;
  const stage: CareerStageStr = followers >= 10_000 ? "building" : "just-starting";
  const generatedAt = Date.now();
  const profileCitation = `profile:${handle.handle}`;
  const displayName = profile.displayName ?? inputs.creator?.displayName ?? handle.handle;
  const bio = profile.bio?.trim();

  let creatorPictureId: Id<"creatorPicture">;
  try {
    creatorPictureId = await ctx.runMutation(
      internal.onboarding.maya.synthesizeCreatorPicture.upsertSynthesizedPicture,
      {
        creatorId,
        niche: bio
          ? `${displayName} TikTok creator; profile bio: ${bio}`
          : `${displayName} TikTok creator with a sparse public posting surface`,
        audience: {
          ageRanges: [],
          topGeos: [],
          interestTags: ["tiktok", "creator", "early audience"],
        },
        voiceFingerprint:
          "Profile-only fallback. Maya should avoid claims about hooks, cadence, or video style until posts are available.",
        topHooks: [
          {
            pattern: "No post-level hook pattern available yet",
            examplePostId: profileCitation,
            platform: handle.platform,
            avgPerformanceLift: 0,
          },
        ],
        bottomHooks: [
          {
            pattern: "Do not infer weak hooks without post-level data",
            examplePostId: profileCitation,
            platform: handle.platform,
          },
        ],
        postingCadence: {
          perPlatform: [
            {
              platform: handle.platform,
              postsPerWeek: 0,
              bestDays: [],
              bestHoursLocal: [],
            },
          ],
        },
        brandDealHistory: [],
        model: "profile-only-fallback",
        sourceCitations: [
          { platform: handle.platform, postId: profileCitation, usedFor: "niche" },
          {
            platform: handle.platform,
            postId: profileCitation,
            usedFor: "voiceFingerprint",
          },
          {
            platform: handle.platform,
            postId: profileCitation,
            usedFor: "careerStage",
          },
        ],
        generatedAt,
        inferredCareerStage: stage,
        careerStageReasoning:
          "Profile-only fallback because ScrapeCreators returned profile data but no post-level cache rows. Treat this as provisional.",
        careerStageReconciliation: {
          selfReported: inputs.selfReportedCareerStage,
          inferred: stage,
          matches: inputs.selfReportedCareerStage
            ? inputs.selfReportedCareerStage === stage
            : true,
          evidence: `${handle.platform} profile ${handle.handle}; follower count ${followers}; no cached posts available.`,
        },
        growthPlan: {
          currentStage: stage,
          nextMilestoneText:
            "Get enough public post history for Maya to evaluate hooks, cadence, comments, and performance trends.",
          focusAreas: [
            "Publish 3-5 public TikToks Maya can measure",
            "Keep captions specific enough for post-level analysis",
            "Ask Maya for recommendations after new posts are visible",
          ],
          antiPatterns: ["Inferring winning hooks from profile data only"],
          smartAlternatives: [
            {
              antiPattern: "Inferring winning hooks from profile data only",
              insteadDoThis:
                "Use the profile as context, then wait for post-level metrics before making performance claims.",
              exampleAction:
                "Maya should say that post-level data is missing and ask the creator to publish or provide a specific TikTok URL.",
              reasoning:
                "Profile data verifies the account but cannot support claims about what content is working.",
            },
          ],
          horizonWeeks: 2,
          citations: [
            {
              platform: handle.platform,
              postId: profileCitation,
              usedFor: "profile-only onboarding fallback",
            },
          ],
          nextMilestone: syntheticFollowerMilestone(followers),
          focusArea: focusAreaForStage(stage),
          generatedAt,
        },
      }
    );
  } catch (err) {
    return {
      ok: false,
      stage: "patch-row",
      message: `synthesizeCreatorPicture: failed to upsert profile-only creatorPicture: ${(err as Error).message}`,
      retryable: true,
    };
  }

  return {
    ok: true,
    creatorPictureId,
    thinkingBudget: "high",
    model: "profile-only-fallback",
    costUsd: 0,
    latencyMs: 0,
    retried: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Stage-aware adaptive product (Agent B, 2026-04-26) — derivation helpers     */
/* -------------------------------------------------------------------------- */

/**
 * Mirror of the businessReadiness HQ helper, kept here so the synthesis can
 * derive the legacy nextMilestone object the HQ progress bar reads. We use
 * the SAME bands as the HQ to avoid drift. If you change one, change both.
 */
const FOLLOWER_BANDS_FOR_SYNTH: ReadonlyArray<{
  label: string;
  at: number;
}> = [
  { label: "1K", at: 1_000 },
  { label: "5K", at: 5_000 },
  { label: "10K", at: 10_000 },
  { label: "25K", at: 25_000 },
  { label: "50K", at: 50_000 },
  { label: "100K", at: 100_000 },
  { label: "250K", at: 250_000 },
  { label: "500K", at: 500_000 },
  { label: "1M", at: 1_000_000 },
];

function syntheticFollowerMilestone(currentFollowers: number): {
  label: string;
  targetFollowers: number;
} {
  for (const band of FOLLOWER_BANDS_FOR_SYNTH) {
    if (currentFollowers < band.at) {
      return { label: band.label, targetFollowers: band.at };
    }
  }
  if (currentFollowers < 2_000_000) {
    return { label: "2M", targetFollowers: 2_000_000 };
  }
  if (currentFollowers < 5_000_000) {
    return { label: "5M", targetFollowers: 5_000_000 };
  }
  return { label: "10M", targetFollowers: 10_000_000 };
}

function focusAreaForStage(
  stage: CareerStageStr
): "consistency" | "hook-craft" | "diversification" | "scale-systems" {
  switch (stage) {
    case "just-starting":
      return "consistency";
    case "building":
      return "hook-craft";
    case "monetizing":
      return "diversification";
    case "scaling":
      return "scale-systems";
  }
}
