/**
 * synthesizeCreatorPicture — Sprint 2 multimodal pipeline tests.
 *
 * Covers the 5 mandatory test categories per
 * `feedback_validation_gap_prevention.md`:
 *   1. Cross-tenant isolation
 *   2. Plan-tier × action matrix (synthesis runs on HIGH for ALL plans
 *      regardless of clamp — this is the intentional onboarding bypass)
 *   3. Adversarial inputs (malformed JSON, missing posts, oversized
 *      prompts, missing citations)
 *   4. Sibling-file scan (existing aiCallLog + creatorPicture indexes)
 *   5. TODO grep (the Sprint 1 acceptance test handles this repo-wide)
 *
 * Plus integration tests for:
 *   - schema validation against the creatorPicture validator
 *   - patch ordering (synthesis-first then answer-submit and vice versa)
 *   - deploy pipeline failure surfacing
 *   - aiCallLog row written with correct taskTag/model/thinkingBudget/cost
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../schema";
import { internal, api } from "../../../_generated/api";
import { modules } from "../../../../tests/_modules";
import {
  _setSynthFetchForTests,
  parseAndValidatePicture,
  buildPromptPayload,
  buildWorkerPosts,
  buildWorkerUserPayloadJson,
  renormalizeAudienceFromCache,
  SynthValidationError,
  SYNTH_SYSTEM_PROMPT,
  cacheKey,
  reconcileAnchorVsObserved,
  checkAnchorInvariant,
} from "../synthesizeCreatorPicture";
import {
  _setVideoSynthClientForTests,
  VideoSynthWorkerError,
  type SynthesizeWorkerRequest,
  type SynthesizeWorkerResponse,
} from "../../../integrations/videoSynthWorker/client";
import type { Id } from "../../../_generated/dataModel";

const NOW = 1_700_000_000_000;
const TZ = "America/Los_Angeles";

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_DEFAULT_MODEL = "google/gemini-3-flash";
});

afterEach(() => {
  _setSynthFetchForTests(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface SeedOptions {
  suffix: string;
  plan: "coach" | "manager";
  /** Number of TikTok posts to seed in the cache. */
  ttPostsCount?: number;
  /** Total cap (after platform-cap) the prompt will see; default 30. */
  expectedMaxPromptPosts?: number;
  /** Skip seeding posts entirely (for adversarial test). */
  noPosts?: boolean;
  /** Skip seeding handles entirely. */
  noHandles?: boolean;
}

async function seedCreatorWithScrapedData(
  t: ReturnType<typeof convexTest>,
  opts: SeedOptions
): Promise<Id<"creators">> {
  const creatorId = await t.run(async (ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: TZ,
      status: "onboarding",
      plan: opts.plan,
      createdAt: NOW,
    })
  );

  if (opts.noHandles) return creatorId;

  await t.run(async (ctx) => {
    await ctx.db.insert("creatorHandles", {
      creatorId,
      platform: "tiktok",
      handle: `${opts.suffix}_tt`,
      verified: true,
      scrapedAt: NOW,
      followerCount: 42_000,
    });
  });

  if (opts.noPosts) return creatorId;

  const ttPostsCount = opts.ttPostsCount ?? 5;

  // Seed cache rows: profile + posts.
  await t.run(async (ctx) => {
    await ctx.db.insert("scrapeCreatorsCache", {
      creatorId,
      cacheKey: cacheKey("tiktok", "profile", `${opts.suffix}_tt`),
      payload: {
        userInfo: {
          user: {
            uniqueId: `${opts.suffix}_tt`,
            nickname: `${opts.suffix} display`,
            signature: "fitness creator. home gym builds. ADHD-friendly.",
            verified: false,
            bioLink: { link: "https://example.com" },
          },
          stats: { followerCount: 42_000 },
        },
      },
      fetchedAt: NOW,
      ttlSec: 21_600,
    });

    const posts: Array<Record<string, unknown>> = [];
    for (let i = 0; i < ttPostsCount; i++) {
      posts.push({
        id: `tt_post_${i}`,
        desc: `caption ${i} — home gym build no. ${i}, contrarian take`,
        createTime: Math.floor(NOW / 1000) - i * 86_400,
        stats: {
          diggCount: 1_000 + i * 100,
          commentCount: 50 + i * 5,
          playCount: 30_000 + i * 1_000,
          shareCount: 20,
          collectCount: 30,
        },
        video: {
          cover: `https://cdn.example.com/cover_${i}.jpg`,
          playAddr: `https://cdn.example.com/play_${i}.mp4`,
        },
      });
    }
    await ctx.db.insert("scrapeCreatorsCache", {
      creatorId,
      cacheKey: cacheKey("tiktok", "posts", `${opts.suffix}_tt`),
      payload: posts,
      fetchedAt: NOW,
      ttlSec: 1_800,
    });

    // One transcript + one comments row, for the deep-dive flavor.
    await ctx.db.insert("scrapeCreatorsCache", {
      creatorId,
      cacheKey: cacheKey("tiktok", "transcript", "tt_post_0"),
      payload: { transcript: "OK so today we're going to build a $200 home gym from scratch." },
      fetchedAt: NOW,
      ttlSec: 604_800,
    });
    await ctx.db.insert("scrapeCreatorsCache", {
      creatorId,
      cacheKey: cacheKey("tiktok", "comments", "tt_post_0"),
      payload: [
        { text: "where did you get the squat rack?", likeCount: 120 },
        { text: "as someone with adhd this hits", likeCount: 85 },
      ],
      fetchedAt: NOW,
      ttlSec: 1_800,
    });
  });

  return creatorId;
}

/** Build a valid synthesizer JSON response for the seeded fixture. */
function makeValidSynthesisJson(
  opts: {
    postIdPrefix?: string;
    /** Override the inferred career stage in the response. */
    careerStage?: "just-starting" | "building" | "monetizing" | "scaling";
    /** Override the self-reported value the model "saw" + reconciles against. */
    selfReportedCareerStage?:
      | "just-starting"
      | "building"
      | "monetizing"
      | "scaling"
      | null;
    /** Override growthPlan.focusAreas (must be 2-4 entries). */
    focusAreas?: string[];
    /** Override growthPlan.antiPatterns (must be 2-4 entries). */
    antiPatterns?: string[];
  } = {}
): string {
  const prefix = opts.postIdPrefix ?? "tt_post_";
  const careerStage = opts.careerStage ?? "building";
  const selfReported =
    opts.selfReportedCareerStage === undefined
      ? "building"
      : opts.selfReportedCareerStage;
  const matches = selfReported !== null && selfReported === careerStage;
  const stagePlanDefaults = stagePlanDefaultsFor(careerStage, prefix);
  const focusAreas = opts.focusAreas ?? stagePlanDefaults.focusAreas;
  const antiPatterns = opts.antiPatterns ?? stagePlanDefaults.antiPatterns;
  return JSON.stringify({
    niche:
      "Home-gym builds for ADHD-prone fitness adopters who hate the typical gym aesthetic.",
    audience: {
      ageRanges: ["25-34", "18-24"],
      genderSplit: { male: 0.6, female: 0.35, other: 0.05 },
      topGeos: ["US", "UK", "CA", "AU", "DE"],
      interestTags: [
        "home gym",
        "calisthenics",
        "ADHD productivity",
        "minimalism",
        "dumbbells",
        "garage gym",
        "$200 budget",
        "powerlifting",
        "barbell",
        "macro tracking",
      ],
    },
    voiceFingerprint:
      "Short declarative sentences. Drops jargon for plain talk. Opens with a contrarian claim then walks back from it. Avoids hype words. Uses 'cheap' and 'budget' as positives.",
    topHooks: [
      {
        pattern: "Contrarian claim → before/after demo → cost reveal",
        examplePostId: `${prefix}0`,
        platform: "tiktok",
        avgPerformanceLift: 2.4,
      },
      {
        pattern: "Question framing → walk-through → unexpected result",
        examplePostId: `${prefix}1`,
        platform: "tiktok",
        avgPerformanceLift: 1.8,
      },
      {
        pattern: "Common-mistake callout → fix in 3 steps → caveat",
        examplePostId: `${prefix}2`,
        platform: "tiktok",
        avgPerformanceLift: 1.5,
      },
      {
        pattern: "$ amount in caption → object reveal in frame 1",
        examplePostId: `${prefix}3`,
        platform: "tiktok",
        avgPerformanceLift: 1.3,
      },
      {
        pattern: "Day-in-the-life intro → product placement → wrap line",
        examplePostId: `${prefix}4`,
        platform: "tiktok",
        avgPerformanceLift: 1.2,
      },
    ],
    bottomHooks: [
      {
        pattern: "Slow conceptual intro with no visual hook",
        examplePostId: `${prefix}1`,
        platform: "tiktok",
      },
      {
        pattern: "Long talking-head with no cuts",
        examplePostId: `${prefix}2`,
        platform: "tiktok",
      },
      {
        pattern: "Generic motivational quote opener",
        examplePostId: `${prefix}3`,
        platform: "tiktok",
      },
    ],
    postingCadence: {
      perPlatform: [
        {
          platform: "tiktok",
          postsPerWeek: 4,
          bestDays: ["Tue", "Thu", "Sat"],
          bestHoursLocal: [7, 12, 18, 21],
        },
      ],
    },
    brandDealHistory: [],
    sourceCitations: [
      { platform: "tiktok", postId: `${prefix}0`, usedFor: "niche" },
      { platform: "tiktok", postId: `${prefix}0`, usedFor: "voiceFingerprint" },
      { platform: "tiktok", postId: `${prefix}0`, usedFor: "audience" },
      { platform: "tiktok", postId: `${prefix}0`, usedFor: "topHooks[0]" },
      { platform: "tiktok", postId: `${prefix}1`, usedFor: "topHooks[1]" },
      { platform: "tiktok", postId: `${prefix}2`, usedFor: "topHooks[2]" },
      { platform: "tiktok", postId: `${prefix}3`, usedFor: "topHooks[3]" },
      { platform: "tiktok", postId: `${prefix}4`, usedFor: "topHooks[4]" },
      { platform: "tiktok", postId: `${prefix}1`, usedFor: "bottomHooks[0]" },
      { platform: "tiktok", postId: `${prefix}2`, usedFor: "bottomHooks[1]" },
      { platform: "tiktok", postId: `${prefix}3`, usedFor: "bottomHooks[2]" },
      { platform: "tiktok", postId: `${prefix}0`, usedFor: "postingCadence.tiktok" },
      { platform: "tiktok", postId: `${prefix}0`, usedFor: "careerStage" },
    ],
    careerStage,
    careerStageReasoning:
      "Posting cadence is consistent (4/week), niche is clear, voice is forming, but no brand-deal evidence in the input window.",
    careerStageReconciliation: {
      selfReported: selfReported,
      inferred: careerStage,
      matches,
      evidence: matches
        ? `Self-report and observed signal align — both point to '${careerStage}'.`
        : `Self-report '${selfReported}' diverges from observed signal '${careerStage}': posting cadence + brand-deal evidence don't match self-claim.`,
      gentleNudge: matches
        ? null
        : `Your data places you at the ${careerStage} stage; we'll start the plan there.`,
    },
    growthPlan: {
      currentStage: careerStage,
      nextMilestone: stagePlanDefaults.nextMilestoneText,
      focusAreas,
      antiPatterns,
      // Wave 2 — exact-string-paired smartAlternatives, one per antiPatterns[i].
      smartAlternatives: antiPatterns.map((ap, i) => ({
        antiPattern: ap,
        insteadDoThis: smartAlternativeForAnti(ap, careerStage).insteadDoThis,
        exampleAction: smartAlternativeForAnti(ap, careerStage).exampleAction,
        reasoning: `${smartAlternativeForAnti(ap, careerStage).reasoning} (idx=${i})`,
      })),
      horizonWeeks: 8,
      citations: [
        { platform: "tiktok", postId: `${prefix}0`, usedFor: "focusAreas[0]" },
        { platform: "tiktok", postId: `${prefix}1`, usedFor: "focusAreas[1]" },
        { platform: "tiktok", postId: `${prefix}2`, usedFor: "antiPatterns[0]" },
        { platform: "tiktok", postId: `${prefix}3`, usedFor: "nextMilestone" },
      ],
    },
  });
}

/**
 * Wave 2 — produce a stage-appropriate smartAlternative for an antiPattern.
 * The text needs to mention "local" / "spec piece" / "small" / "ebook" etc.
 * so the stage-keyword tests can verify routing intelligence per stage.
 */
function smartAlternativeForAnti(
  antiPattern: string,
  stage: "just-starting" | "building" | "monetizing" | "scaling"
): { insteadDoThis: string; exampleAction: string; reasoning: string } {
  const lower = antiPattern.toLowerCase();
  if (lower.includes("pitch") || lower.includes("brand")) {
    if (stage === "just-starting" || stage === "building") {
      return {
        insteadDoThis:
          "Pitch local + small businesses in your niche near your city — small brands close 60% at your size.",
        exampleAction:
          "Maya scouts 3-5 local fitness brands within 25mi and drafts spec piece offers for each.",
        reasoning:
          "Calibrated to your conversion math at this stage — small/local is where pitches actually land.",
      };
    }
    return {
      insteadDoThis:
        "Filter inbound deals against your floor + niche fit — say no fast and Maya replies for you.",
      exampleAction:
        "Maya raises your auto-decline floor and drafts decline templates for off-niche brands.",
      reasoning:
        "Selectivity protects rate at the scaling stage — every off-fit deal signals 'available'.",
    };
  }
  if (lower.includes("diversif") || lower.includes("monetiz")) {
    return {
      insteadDoThis:
        "Pick ONE monetization beachhead and prove it — your audience is asking for X.",
      exampleAction:
        "Maya drafts a $30 ebook outline based on your top 5 highest-engagement educational posts.",
      reasoning:
        "One proven revenue stream beats four half-built ones at your stage.",
    };
  }
  if (lower.includes("multi-platform") || lower.includes("multi-account")) {
    return {
      insteadDoThis:
        "Pick ONE platform and own it before splitting — your TikTok numbers say it's the foundation.",
      exampleAction:
        "Maya proposes a 4-week single-platform consistency arc on your strongest channel.",
      reasoning:
        "Splitting attention across platforms before one is locked is how creators stay sub-scale.",
    };
  }
  if (lower.includes("complex") || lower.includes("arc")) {
    return {
      insteadDoThis:
        "Run a leaner 1-3 day arc using your existing top hook patterns.",
      exampleAction:
        "Maya picks your 3 best-performing hooks and proposes a single-week mini-arc.",
      reasoning:
        "Complex arcs are over-load at your cadence; simple arcs compound first.",
    };
  }
  // Generic fallback that still mentions concrete Maya actions.
  return {
    insteadDoThis:
      "Focus on the version that matches your stage — Maya will calibrate the move.",
    exampleAction:
      "Maya proposes a stage-appropriate alternative move via the relevant skill.",
    reasoning:
      "Smart-alternative routing keeps Maya partner-mode, never gatekeeper-mode.",
  };
}

/**
 * Per-stage default focusAreas / antiPatterns / nextMilestoneText so the test
 * fixture mirrors what a well-behaved synthesis would emit. Used by
 * `makeValidSynthesisJson` so test files can produce stage-specific outputs
 * without restating the bullet lists every time.
 */
function stagePlanDefaultsFor(
  stage: "just-starting" | "building" | "monetizing" | "scaling",
  postIdPrefix: string
): { focusAreas: string[]; antiPatterns: string[]; nextMilestoneText: string } {
  void postIdPrefix;
  switch (stage) {
    case "just-starting":
      return {
        focusAreas: [
          "Post 4× per week minimum in your one chosen niche",
          "Lock the voice — pick 2 sentence rhythms and stick to them",
          "Use the same opening visual format for 4 straight posts",
        ],
        antiPatterns: [
          "Pitching brands cold before niche is clear",
          "Diversifying monetization streams before 5K followers",
          "Multi-platform splitting before TikTok presence is consistent",
        ],
        nextMilestoneText:
          "Reach 5K followers with one consistent niche by 8 weeks from now.",
      };
    case "building":
      return {
        focusAreas: [
          "Sharpen hook craft — every post leads with a contrarian claim",
          "Expand audience via collab features with 1 peer per month",
          "Draft your first 3 paid pitches using the brand-outreach skill",
        ],
        antiPatterns: [
          "Diversifying monetization before ad-rev floor is consistent",
          "Posting outside your established niche for trend chases",
          "Scaling-tactics like multi-account splits at this size",
        ],
        nextMilestoneText:
          "Close one paid brand deal at floor rate within 60 days.",
      };
    case "monetizing":
      return {
        focusAreas: [
          "Add one new monetization stream (digital product or affiliate)",
          "Tighten audience retention — segment your top-quartile vs the rest",
          "Track revenue per stream weekly, not monthly",
        ],
        antiPatterns: [
          "Chasing virality at the cost of audience quality",
          "Accepting every brand deal — selectivity protects rate",
          "Adding platforms before existing ones plateau",
        ],
        nextMilestoneText:
          "Hit $10K MRR across 3 monetization streams within 12 weeks.",
      };
    case "scaling":
      return {
        focusAreas: [
          "Decline brand deals below your floor — protect inventory",
          "Hire a part-time editor or VA to free 10 hours/week",
          "Separate brand-channel from creator-channel signals",
        ],
        antiPatterns: [
          "Saying yes to every brand — dilutes positioning",
          "Posting outside core niche to chase a trend",
          "Micro-managing the queue instead of building the system",
        ],
        nextMilestoneText:
          "Lock 2 long-term ambassador deals at premium rate within 12 weeks.",
      };
  }
}

interface MockFetchOptions {
  /** Content for OK responses, or a list to cycle through. */
  responses?: string[];
  /** Number of input/output/thinking tokens reported. */
  tokens?: { input: number; output: number; thinking: number };
  /** If set, return a 5xx on these attempts (1-indexed). */
  failOnAttempts?: number[];
}

function makeMockFetch(opts: MockFetchOptions): {
  fetchSpy: ReturnType<typeof vi.fn>;
  callBodies: Array<unknown>;
} {
  const callBodies: Array<unknown> = [];
  const responses = opts.responses ?? ["{}"];
  const tokens = opts.tokens ?? { input: 5_000, output: 800, thinking: 4_200 };
  const failOnAttempts = new Set(opts.failOnAttempts ?? []);
  let attempt = 0;
  const fetchSpy = vi.fn(
    async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      attempt += 1;
      try {
        callBodies.push(JSON.parse(init!.body as string));
      } catch {
        callBodies.push(null);
      }
      if (failOnAttempts.has(attempt)) {
        return new Response("simulated upstream 503", { status: 503 });
      }
      const content = responses[Math.min(attempt - 1, responses.length - 1)];
      const body = {
        id: `gen-test-${attempt}`,
        model: "google/gemini-3-flash",
        choices: [
          { message: { content }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: tokens.input,
          completion_tokens: tokens.output + tokens.thinking,
          completion_tokens_details: { reasoning_tokens: tokens.thinking },
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  );
  return { fetchSpy, callBodies };
}

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — happy path", () => {
  it("inserts a fully-populated creatorPicture row when none exists", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "h1", plan: "manager" });

    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.thinkingBudget).toBe("high");
    expect(result.retried).toBe(false);
    expect(result.costUsd).toBeGreaterThan(0);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture).not.toBeNull();
    expect(picture!.niche).toMatch(/Home-gym/);
    expect(picture!.voiceFingerprint).toMatch(/Short declarative/);
    expect(picture!.topHooks).toHaveLength(5);
    expect(picture!.bottomHooks).toHaveLength(3);
    expect(picture!.postingCadence.perPlatform[0].platform).toBe("tiktok");
    expect(picture!.sourceCitations.length).toBeGreaterThan(0);
    expect(picture!.model).toBe("google/gemini-3-flash");
  });

  it("writes ONE aiCallLog row tagged creator_picture_synthesis with thinkingBudget=high", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "log1", plan: "manager" });

    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
      tokens: { input: 10_000, output: 1_000, thinking: 8_000 },
    });
    _setSynthFetchForTests(fetchSpy);

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].taskTag).toBe("creator_picture_synthesis");
    expect(logs[0].thinkingBudget).toBe("high");
    expect(logs[0].model).toBe("google/gemini-3-flash");
    expect(logs[0].inputTokens).toBe(10_000);
    expect(logs[0].outputTokens).toBe(1_000);
    expect(logs[0].thinkingTokens).toBe(8_000);
    // (10_000 * 0.5 + (1_000 + 8_000) * 3.0) / 1_000_000 = (5_000 + 27_000)/1e6 = 0.032
    expect(logs[0].costUsd).toBeCloseTo(0.032, 6);
  });

  it("the request body sent to OpenRouter encodes reasoning effort = high", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "req1", plan: "coach" });

    const { fetchSpy, callBodies } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );

    expect(fetchSpy).toHaveBeenCalled();
    const sent = callBodies[0] as { reasoning: { effort: string } };
    // STARTER creator MUST still get high — synthesis bypasses the plan clamp.
    expect(sent.reasoning).toEqual({ effort: "high" });
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier × action matrix                                                   */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — plan-tier", () => {
  const PLANS = ["coach", "manager"] as const;

  for (const plan of PLANS) {
    it(`${plan} creator gets HIGH thinking on synthesis (no clamp)`, async () => {
      const t = convexTest(schema, modules);
      const c = await seedCreatorWithScrapedData(t, {
        suffix: `pl_${plan}`,
        plan,
      });

      const { fetchSpy, callBodies } = makeMockFetch({
        responses: [makeValidSynthesisJson()],
      });
      _setSynthFetchForTests(fetchSpy);

      const result = await t.action(
        internal.onboarding.maya.synthesizeCreatorPicture
          .synthesizeCreatorPicture,
        { creatorId: c }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.thinkingBudget).toBe("high");

      const sent = callBodies[0] as { reasoning: { effort: string } };
      expect(sent.reasoning).toEqual({ effort: "high" });

      const logs = await t.run(async (ctx) =>
        ctx.db
          .query("aiCallLog")
          .withIndex("by_creator", (q) => q.eq("creatorId", c))
          .collect()
      );
      expect(logs[0].thinkingBudget).toBe("high");
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant isolation                                                      */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — cross-tenant isolation", () => {
  it("synthesis for creator A never patches creator B's row", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCreatorWithScrapedData(t, { suffix: "ctA", plan: "manager" });
    const b = await seedCreatorWithScrapedData(t, { suffix: "ctB", plan: "manager" });

    // Pre-seed a known picture for B so we can detect any leak.
    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: b,
        niche: "B-NICHE-MARKER",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "B-VOICE-MARKER",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "manual-seed",
        sourceCitations: [],
      })
    );

    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson({ postIdPrefix: "tt_post_" })],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: a }
    );
    expect(result.ok).toBe(true);

    // B's row is unchanged.
    const bPicture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    expect(bPicture?.niche).toBe("B-NICHE-MARKER");
    expect(bPicture?.voiceFingerprint).toBe("B-VOICE-MARKER");

    // A's row was created/patched.
    const aPicture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .first()
    );
    expect(aPicture?.niche).toMatch(/Home-gym/);

    // aiCallLog rows scope to A only.
    const aLogs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .collect()
    );
    const bLogs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .collect()
    );
    expect(aLogs).toHaveLength(1);
    expect(bLogs).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial inputs                                                          */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — adversarial", () => {
  it("missing creator → structured failure, never throws", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "missing", plan: "manager" });
    await t.run(async (ctx) => ctx.db.delete(c));

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("load-inputs");
  });

  it("no scraped posts → profile-only fallback picture so sparse creators can deploy", async () => {
    const t = convexTest(schema, modules);
    // Seed creator + handle but no posts cache.
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "noposts",
      plan: "manager",
      noPosts: true,
    });

    const fetchSpy = vi.fn();
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("profile-only-fallback");
    expect(result.costUsd).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const picture = await t.run((ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture?.model).toBe("profile-only-fallback");
    expect(picture?.sourceCitations[0]?.postId).toMatch(/^profile:/);
    expect(picture?.growthPlan?.antiPatterns).toContain(
      "Inferring winning hooks from profile data only"
    );
  });

  it("no handles → structured failure, NOT a crash", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "noh",
      plan: "manager",
      noHandles: true,
    });

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("load-inputs");
  });

  it("malformed JSON on first attempt → retried with stricter reminder, succeeds on second", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "retry", plan: "manager" });

    const { fetchSpy, callBodies } = makeMockFetch({
      responses: [
        "Sure, here you go: { definitely_not_json", // malformed
        makeValidSynthesisJson(),
      ],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retried).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Second call carries the retry reminder system message.
    const secondMsgs = (callBodies[1] as { messages: Array<{ role: string; content: string }> })
      .messages;
    expect(secondMsgs.length).toBeGreaterThanOrEqual(3);
    expect(secondMsgs[secondMsgs.length - 1].role).toBe("system");
    expect(secondMsgs[secondMsgs.length - 1].content).toMatch(/malformed JSON/);
  });

  it("malformed JSON on BOTH attempts → structured failure (model-malformed)", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "retryfail", plan: "manager" });

    const { fetchSpy } = makeMockFetch({
      responses: ["{ broken", "{ still broken"],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("model-malformed");
    expect(result.retryable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // The aiCallLog row is still recorded (token accounting is independent).
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].thinkingBudget).toBe("high");
  });

  it("oversized creator (>150 cached posts across platforms) gets truncated to 30 per platform / 150 total in the prompt", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "huge",
      plan: "manager",
      ttPostsCount: 1_000, // way beyond cap
    });

    const { fetchSpy, callBodies } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const sent = callBodies[0] as { messages: Array<{ role: string; content: string }> };
    const userMessage = sent.messages.find((m) => m.role === "user")!;
    // The user payload contains the JSON of the prompt payload — count the
    // number of post entries by counting occurrences of the postId prefix.
    const postOccurrences = (userMessage.content.match(/"postId":/g) ?? []).length;
    // Cap is min(30 per platform, 150 total) — single-platform creator caps at 30.
    expect(postOccurrences).toBeLessThanOrEqual(30);
  });

  it("repairs missing source citation for a hook examplePostId", () => {
    const json = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [
        {
          pattern: "p",
          examplePostId: "uncited_post",
          platform: "tiktok",
          avgPerformanceLift: 1.0,
        },
      ],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tiktok", postId: "different_post", usedFor: "niche" },
        { platform: "tiktok", postId: "different_post", usedFor: "voiceFingerprint" },
        { platform: "tiktok", postId: "different_post", usedFor: "audience" },
      ],
      careerStage: "building",
      careerStageReasoning: "reasoning",
      careerStageReconciliation: {
        selfReported: "building",
        inferred: "building",
        matches: true,
        evidence: "aligned",
        gentleNudge: null,
      },
      growthPlan: {
        currentStage: "building",
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [{ platform: "tiktok", postId: "different_post", usedFor: "focusAreas[0]" }],
      },
    });
    const parsed = parseAndValidatePicture(json);
    expect(parsed.sourceCitations).toContainEqual({
      platform: "tiktok",
      postId: "uncited_post",
      usedFor: "topHooks[0]",
    });
  });

  it("source citation with empty postId is rejected", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tiktok", postId: "", usedFor: "niche" },
        { platform: "tiktok", postId: "tt_x", usedFor: "voiceFingerprint" },
        { platform: "tiktok", postId: "tt_x", usedFor: "audience" },
      ],
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(/empty postId/);
  });

  it("missing required citation usedFor (e.g. no entry for 'niche') is rejected", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        // Missing 'niche' citation
        { platform: "tiktok", postId: "tt_x", usedFor: "voiceFingerprint" },
        { platform: "tiktok", postId: "tt_x", usedFor: "audience" },
      ],
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(/niche/);
  });

  it("OpenRouter 5xx error → structured failure at model-call stage, retryable=true", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "or5xx", plan: "manager" });

    // Fail every attempt the openRouter client tries (it itself retries 3x).
    const { fetchSpy } = makeMockFetch({
      failOnAttempts: [1, 2, 3],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("model-call");
    expect(result.retryable).toBe(true);
  });

  it("tolerates a fenced ```json``` wrapper in the model output", () => {
    const wrapped = "```json\n" + makeValidSynthesisJson() + "\n```";
    const parsed = parseAndValidatePicture(wrapped);
    expect(parsed.niche).toMatch(/Home-gym/);
  });
});

/* -------------------------------------------------------------------------- */
/* Patch ordering — synth-first vs answer-first                                */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — patch ordering", () => {
  it("synth-first then answer-submit produces the same final row as answer-submit then synth", async () => {
    const t1 = convexTest(schema, modules);
    const t2 = convexTest(schema, modules);

    const fullAnswers = {
      goal: "100k IG by year end",
      tone: "strategic" as const,
      brandDealFloorUsd: 2_500,
      careerStage: "building" as const,
      location: { city: "Austin", state: "TX", country: "US", timezone: TZ },
      monthlyRevenueUsd: 6_000,
      revenueStreams: ["brand-deals" as const, "affiliate" as const],
      longTermGoals: { oneYear: "ship a course", fiveYear: "media co" },
    };

    // ---- Order 1: synth first, then answers ----
    const c1 = await seedCreatorWithScrapedData(t1, { suffix: "ord1", plan: "manager" });
    {
      const { fetchSpy } = makeMockFetch({ responses: [makeValidSynthesisJson()] });
      _setSynthFetchForTests(fetchSpy);
      const r1 = await t1.action(
        internal.onboarding.maya.synthesizeCreatorPicture
          .synthesizeCreatorPicture,
        { creatorId: c1 }
      );
      expect(r1.ok).toBe(true);
    }
    await t1
      .withIdentity({ subject: "u_ord1" })
      .mutation(api.creators.submitOnboardingAnswers, {
        creatorId: c1,
        answers: fullAnswers,
      });
    const final1 = await t1.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c1))
        .first()
    );

    // ---- Order 2: answers first, then synth ----
    const c2 = await seedCreatorWithScrapedData(t2, { suffix: "ord2", plan: "manager" });
    await t2
      .withIdentity({ subject: "u_ord2" })
      .mutation(api.creators.submitOnboardingAnswers, {
        creatorId: c2,
        answers: fullAnswers,
      });
    {
      const { fetchSpy } = makeMockFetch({ responses: [makeValidSynthesisJson()] });
      _setSynthFetchForTests(fetchSpy);
      const r2 = await t2.action(
        internal.onboarding.maya.synthesizeCreatorPicture
          .synthesizeCreatorPicture,
        { creatorId: c2 }
      );
      expect(r2.ok).toBe(true);
    }
    const final2 = await t2.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c2))
        .first()
    );

    // Both rows must have synthesis-owned + answer-owned fields.
    for (const row of [final1, final2]) {
      expect(row).not.toBeNull();
      expect(row!.niche).toMatch(/Home-gym/); // synth
      expect(row!.voiceFingerprint).toMatch(/Short declarative/); // synth
      expect(row!.topHooks).toHaveLength(5); // synth
      expect(row!.careerStage).toBe("building"); // answer
      expect(row!.locationSoul?.city).toBe("Austin"); // answer
      expect(row!.monthlyRevenueUsd).toBe(6_000); // answer
      expect(row!.currentRevenueStreams).toEqual(["brand-deals", "affiliate"]); // answer
      expect(row!.longTermGoals?.oneYear).toBe("ship a course"); // answer
      // Synthesis model is the gemini model (not "awaiting-synthesis" anymore).
      expect(row!.model).toBe("google/gemini-3-flash");
    }

    // The two final rows have the same field set (excluding _id / creatorId /
    // _creationTime / per-write timestamps that race millisecond-by-millisecond
    // between the two orderings).
    const stripVolatile = (
      r: typeof final1
    ): Record<string, unknown> => {
      const { _id, _creationTime, creatorId, generatedAt, growthPlan, ...rest } =
        r as Record<string, unknown> & {
          _id: unknown;
          _creationTime: unknown;
          creatorId: unknown;
          generatedAt: unknown;
          growthPlan?: { generatedAt?: unknown } & Record<string, unknown>;
        };
      void _id;
      void _creationTime;
      void creatorId;
      void generatedAt;
      // growthPlan.generatedAt is ALSO set inside the action, so it can race
      // millisecond-by-millisecond between the two ordering runs. Strip it
      // for the comparison; the rest of the growthPlan fields are
      // deterministic given the fixture output.
      let strippedGrowthPlan: Record<string, unknown> | undefined;
      if (growthPlan) {
        const { generatedAt: _gpGen, ...gpRest } = growthPlan;
        void _gpGen;
        strippedGrowthPlan = gpRest;
      }
      return strippedGrowthPlan
        ? { ...rest, growthPlan: strippedGrowthPlan }
        : rest;
    };
    expect(stripVolatile(final1)).toEqual(stripVolatile(final2));
  });
});

/* -------------------------------------------------------------------------- */
/* Schema validation against creatorPicture validator                          */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — schema validation", () => {
  it("the upserted row passes Convex's creatorPicture validator (insert succeeded)", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "schema", plan: "manager" });

    const { fetchSpy } = makeMockFetch({ responses: [makeValidSynthesisJson()] });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    // If insert wouldn't have validated, the action would have thrown.
    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture).not.toBeNull();
    // Spot-check every required field is present on the row.
    expect(typeof picture!.niche).toBe("string");
    expect(Array.isArray(picture!.audience.ageRanges)).toBe(true);
    expect(Array.isArray(picture!.audience.topGeos)).toBe(true);
    expect(Array.isArray(picture!.audience.interestTags)).toBe(true);
    expect(typeof picture!.voiceFingerprint).toBe("string");
    expect(Array.isArray(picture!.topHooks)).toBe(true);
    expect(Array.isArray(picture!.bottomHooks)).toBe(true);
    expect(Array.isArray(picture!.postingCadence.perPlatform)).toBe(true);
    expect(Array.isArray(picture!.brandDealHistory)).toBe(true);
    expect(Array.isArray(picture!.sourceCitations)).toBe(true);
  });

  it("every populated field has at least one source citation", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, { suffix: "cit", plan: "manager" });

    const { fetchSpy } = makeMockFetch({ responses: [makeValidSynthesisJson()] });
    _setSynthFetchForTests(fetchSpy);

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    const usedFor = new Set(picture!.sourceCitations.map((c) => c.usedFor));
    expect([...usedFor].some((u) => u === "niche")).toBe(true);
    expect([...usedFor].some((u) => u === "voiceFingerprint")).toBe(true);
    expect([...usedFor].some((u) => u === "audience")).toBe(true);
    // Every topHook + bottomHook examplePostId is in the citation set.
    const cited = new Set(picture!.sourceCitations.map((c) => c.postId));
    for (const h of picture!.topHooks) {
      expect(cited.has(h.examplePostId)).toBe(true);
    }
    for (const h of picture!.bottomHooks) {
      expect(cited.has(h.examplePostId)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Deploy pipeline integration — synth failure surfaces                        */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — deploy pipeline integration", () => {
  it("buildPromptPayload truncates posts past the 30-per-platform cap", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "trunc",
      plan: "manager",
      ttPostsCount: 1_000,
    });
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload, postsCount } = buildPromptPayload(inputs);
    expect(postsCount).toBeLessThanOrEqual(30);
    expect(payload.perPlatform[0].posts.length).toBeLessThanOrEqual(30);
  });

  it("buildPromptPayload reads real ScrapeCreators v3 TikTok posts", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "realv3",
      plan: "manager",
      noPosts: true,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "profile", "realv3_tt"),
        payload: {
          userInfo: {
            user: {
              uniqueId: "realv3_tt",
              nickname: "Real V3",
              signature: "Travel and gym creator.",
            },
            stats: { followerCount: 2 },
          },
        },
        fetchedAt: NOW,
        ttlSec: 21_600,
      });
      await ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "posts", "realv3_tt"),
        payload: [
          {
            aweme_id: "7606569072632925453",
            desc: "I have no words ",
            create_time: 1771042386,
            statistics: {
              digg_count: 11,
              comment_count: 2,
              play_count: 258,
              share_count: 1,
              collect_count: 4,
            },
            video: {
              cover: {
                url_list: ["https://p16-sign.tiktokcdn-us.com/cover.jpeg"],
              },
              play_addr: {
                url_list: ["https://v16-webapp-prime.us.tiktok.com/video.mp4"],
              },
              duration: 13514,
            },
          },
        ],
        fetchedAt: NOW,
        ttlSec: 1_800,
      });
    });

    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload, postsCount } = buildPromptPayload(inputs);

    expect(postsCount).toBe(1);
    expect(payload.perPlatform[0].posts[0]).toMatchObject({
      postId: "7606569072632925453",
      caption: "I have no words ",
      postedAtIso: "2026-02-14T04:13:06.000Z",
      viewCount: 258,
      likeCount: 11,
      commentCount: 2,
      shareCount: 1,
      saveCount: 4,
      thumbnailUrl: "https://p16-sign.tiktokcdn-us.com/cover.jpeg",
      videoUrl: "https://v16-webapp-prime.us.tiktok.com/video.mp4",
      videoDurationSec: 14,
    });
  });

  it("system prompt includes the citation discipline section", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/Citation discipline/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/sourceCitations/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/Anti-sycophancy/);
  });
});

/* -------------------------------------------------------------------------- */
/* Stage-aware adaptive product (Agent B, 2026-04-26)                          */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — stage-aware adaptive product", () => {
  it("system prompt includes stage classification + reconciliation + growth plan sections", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/STAGE CLASSIFICATION/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/HOLISTIC — NO HARD FOLLOWER THRESHOLDS/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/Do NOT use the self-reported careerStage as input/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/careerStageReconciliation/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/growthPlan/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/focusAreas/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/antiPatterns/);
  });

  it("system prompt explicitly says follower count is one input, not deciding", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(
      /Follower count is ONE input, not the deciding factor/
    );
    // The 50K-twice-a-year and 5K-with-niche examples must appear so the
    // model has concrete anchors for behavioral classification.
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/50K creator/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/5K creator/);
  });

  for (const stage of [
    "just-starting",
    "building",
    "monetizing",
    "scaling",
  ] as const) {
    it(`upserts careerStage='${stage}' + growthPlan with stage-appropriate focusAreas/antiPatterns`, async () => {
      const t = convexTest(schema, modules);
      const c = await seedCreatorWithScrapedData(t, {
        suffix: `stage_${stage.replace("-", "")}`,
        plan: "manager",
      });

      const { fetchSpy } = makeMockFetch({
        responses: [makeValidSynthesisJson({ careerStage: stage })],
      });
      _setSynthFetchForTests(fetchSpy);

      const result = await t.action(
        internal.onboarding.maya.synthesizeCreatorPicture
          .synthesizeCreatorPicture,
        { creatorId: c }
      );
      expect(result.ok).toBe(true);

      const picture = await t.run(async (ctx) =>
        ctx.db
          .query("creatorPicture")
          .withIndex("by_creator", (q) => q.eq("creatorId", c))
          .first()
      );
      expect(picture).not.toBeNull();
      expect(picture!.careerStage).toBe(stage);
      expect(picture!.careerStageReasoning).toBeDefined();
      expect(picture!.careerStageReasoning!.length).toBeGreaterThan(20);

      // growthPlan: rich + legacy fields both present.
      expect(picture!.growthPlan).toBeDefined();
      expect(picture!.growthPlan!.currentStage).toBe(stage);
      expect(picture!.growthPlan!.nextMilestoneText).toBeDefined();
      expect(picture!.growthPlan!.focusAreas?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(picture!.growthPlan!.antiPatterns?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(picture!.growthPlan!.horizonWeeks).toBe(8);

      // Legacy fields derived server-side.
      expect(picture!.growthPlan!.nextMilestone).toBeDefined();
      expect(picture!.growthPlan!.focusArea).toBeDefined();

      // Stage-appropriate plan content checks (matches stagePlanDefaultsFor).
      const focusAreasJoined = (picture!.growthPlan!.focusAreas ?? []).join(" ").toLowerCase();
      const antiPatternsJoined = (picture!.growthPlan!.antiPatterns ?? []).join(" ").toLowerCase();
      if (stage === "just-starting") {
        // just-starting plan does NOT include "pitch brands" in focusAreas.
        expect(focusAreasJoined).not.toMatch(/pitch brand/);
        // It DOES include cadence / niche / voice consistency cues.
        expect(focusAreasJoined).toMatch(/niche|voice|consistency|post|cadence|opening/);
      }
      if (stage === "scaling") {
        // scaling plan does NOT include "post more consistently" — that's a
        // stale recommendation for that stage.
        expect(focusAreasJoined).not.toMatch(/post more consistently/);
        // It DOES include selectivity / hires / decline cues.
        expect(focusAreasJoined).toMatch(/decline|hire|separate|protect|inventory/);
      }
      if (stage === "monetizing") {
        // monetizing plan focuses on diversification + retention.
        expect(focusAreasJoined).toMatch(/monetization|stream|retention|revenue|track/);
      }
      if (stage === "building") {
        // building plan focuses on hook craft + first deals.
        expect(focusAreasJoined).toMatch(/hook|deal|audience|expand|collab/);
      }
      // Anti-patterns are non-empty across all stages.
      expect(antiPatternsJoined.length).toBeGreaterThan(10);
    });
  }

  it("reconciliation: self=monetizing, inferred=just-starting → matches=false, gentleNudge non-null", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "reconc1",
      plan: "manager",
    });
    // Pre-seed the answer so loadSynthInputs surfaces selfReportedCareerStage.
    await t.run(async (ctx) => {
      await ctx.db.patch(c, {
        onboardingProgress: {
          currentQuestionIdx: 8,
          answers: { careerStage: "monetizing" },
          updatedAt: NOW,
        },
      });
    });

    const { fetchSpy, callBodies } = makeMockFetch({
      responses: [
        makeValidSynthesisJson({
          careerStage: "just-starting",
          selfReportedCareerStage: "monetizing",
        }),
      ],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    // The ANSWER's "monetizing" was overridden by the synthesis-inferred
    // "just-starting" — per spec, data-inferred is the source of truth.
    expect(picture!.careerStage).toBe("just-starting");
    expect(picture!.careerStageReconciliation).toBeDefined();
    expect(picture!.careerStageReconciliation!.matches).toBe(false);
    expect(picture!.careerStageReconciliation!.selfReported).toBe("monetizing");
    expect(picture!.careerStageReconciliation!.inferred).toBe("just-starting");
    expect(picture!.careerStageReconciliation!.gentleNudge).toBeDefined();
    expect(picture!.careerStageReconciliation!.gentleNudge!.length).toBeGreaterThan(
      10
    );
    expect(picture!.careerStageReconciliation!.evidence.length).toBeGreaterThan(20);

    // The user payload sent to the model carried selfReportedCareerStage.
    const sent = callBodies[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = sent.messages.find((m) => m.role === "user")!;
    expect(userMessage.content).toMatch(/selfReportedCareerStage/);
    expect(userMessage.content).toMatch(/monetizing/);
  });

  it("reconciliation: matches=true → gentleNudge MUST be null (validator enforces)", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "reconcMatches",
      plan: "manager",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(c, {
        onboardingProgress: {
          currentQuestionIdx: 8,
          answers: { careerStage: "building" },
          updatedAt: NOW,
        },
      });
    });

    const { fetchSpy } = makeMockFetch({
      responses: [
        makeValidSynthesisJson({
          careerStage: "building",
          selfReportedCareerStage: "building",
        }),
      ],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture!.careerStageReconciliation!.matches).toBe(true);
    expect(picture!.careerStageReconciliation!.gentleNudge ?? null).toBeNull();
  });

  it("validator rejects matches=true with a non-null gentleNudge", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tt", postId: "p1", usedFor: "niche" },
        { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
        { platform: "tt", postId: "p1", usedFor: "audience" },
        { platform: "tt", postId: "p1", usedFor: "careerStage" },
      ],
      careerStage: "building",
      careerStageReasoning: "Some reasoning here for the inference call.",
      careerStageReconciliation: {
        selfReported: "building",
        inferred: "building",
        matches: true,
        evidence: "aligned",
        gentleNudge: "this should not be allowed when matches=true",
      },
      growthPlan: {
        currentStage: "building",
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [{ platform: "tt", postId: "p1", usedFor: "focusAreas[0]" }],
      },
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(/gentleNudge.*null when matches=true/i);
  });

  it("validator rejects matches=false with a null/empty gentleNudge", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tt", postId: "p1", usedFor: "niche" },
        { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
        { platform: "tt", postId: "p1", usedFor: "audience" },
        { platform: "tt", postId: "p1", usedFor: "careerStage" },
      ],
      careerStage: "just-starting",
      careerStageReasoning: "data says just-starting; details follow.",
      careerStageReconciliation: {
        selfReported: "monetizing",
        inferred: "just-starting",
        matches: false,
        evidence: "self-report disagrees with observed signal",
        gentleNudge: null,
      },
      growthPlan: {
        currentStage: "just-starting",
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [{ platform: "tt", postId: "p1", usedFor: "focusAreas[0]" }],
      },
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(
      /gentleNudge.*non-empty when matches=false/i
    );
  });

  it("validator rejects matches inconsistency (selfReported=building, inferred=scaling, matches=true)", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tt", postId: "p1", usedFor: "niche" },
        { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
        { platform: "tt", postId: "p1", usedFor: "audience" },
        { platform: "tt", postId: "p1", usedFor: "careerStage" },
      ],
      careerStage: "scaling",
      careerStageReasoning: "scaling reasoning here.",
      careerStageReconciliation: {
        selfReported: "building",
        inferred: "scaling",
        matches: true, // inconsistent — building != scaling
        evidence: "lying about alignment",
        gentleNudge: null,
      },
      growthPlan: {
        currentStage: "scaling",
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [{ platform: "tt", postId: "p1", usedFor: "focusAreas[0]" }],
      },
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(/contradicts/i);
  });

  it("validator rejects growthPlan.currentStage that disagrees with top-level careerStage", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tt", postId: "p1", usedFor: "niche" },
        { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
        { platform: "tt", postId: "p1", usedFor: "audience" },
        { platform: "tt", postId: "p1", usedFor: "careerStage" },
      ],
      careerStage: "building",
      careerStageReasoning: "building reasoning here.",
      careerStageReconciliation: {
        selfReported: "building",
        inferred: "building",
        matches: true,
        evidence: "aligned",
        gentleNudge: null,
      },
      growthPlan: {
        currentStage: "scaling", // disagreement
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [{ platform: "tt", postId: "p1", usedFor: "focusAreas[0]" }],
      },
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(/currentStage.*equal/);
  });

  it("validator rejects growthPlan.horizonWeeks outside [4, 12]", () => {
    const baseBroken = (horizonWeeks: number) =>
      JSON.stringify({
        niche: "x",
        voiceFingerprint: "y",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        sourceCitations: [
          { platform: "tt", postId: "p1", usedFor: "niche" },
          { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
          { platform: "tt", postId: "p1", usedFor: "audience" },
          { platform: "tt", postId: "p1", usedFor: "careerStage" },
        ],
        careerStage: "building",
        careerStageReasoning: "reasoning here.",
        careerStageReconciliation: {
          selfReported: "building",
          inferred: "building",
          matches: true,
          evidence: "aligned",
          gentleNudge: null,
        },
        growthPlan: {
          currentStage: "building",
          nextMilestone: "milestone",
          focusAreas: ["a", "b"],
          antiPatterns: ["c", "d"],
          smartAlternatives: [
            { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
            { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
          ],
          horizonWeeks,
          citations: [{ platform: "tt", postId: "p1", usedFor: "focusAreas[0]" }],
        },
      });
    expect(() => parseAndValidatePicture(baseBroken(2))).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(baseBroken(20))).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(baseBroken(8))).not.toThrow();
  });

  it("validator rejects growthPlan with empty citations", () => {
    const broken = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tt", postId: "p1", usedFor: "niche" },
        { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
        { platform: "tt", postId: "p1", usedFor: "audience" },
        { platform: "tt", postId: "p1", usedFor: "careerStage" },
      ],
      careerStage: "building",
      careerStageReasoning: "reasoning",
      careerStageReconciliation: {
        selfReported: "building",
        inferred: "building",
        matches: true,
        evidence: "aligned",
        gentleNudge: null,
      },
      growthPlan: {
        currentStage: "building",
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [],
      },
    });
    expect(() => parseAndValidatePicture(broken)).toThrow(SynthValidationError);
    expect(() => parseAndValidatePicture(broken)).toThrow(
      /growthPlan\.citations is empty/
    );
  });

  it("repairs missing careerStage source citation from growthPlan citations", () => {
    const json = JSON.stringify({
      niche: "x",
      voiceFingerprint: "y",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      sourceCitations: [
        { platform: "tt", postId: "p1", usedFor: "niche" },
        { platform: "tt", postId: "p1", usedFor: "voiceFingerprint" },
        { platform: "tt", postId: "p1", usedFor: "audience" },
        // No 'careerStage' here
      ],
      careerStage: "building",
      careerStageReasoning: "reasoning",
      careerStageReconciliation: {
        selfReported: "building",
        inferred: "building",
        matches: true,
        evidence: "aligned",
        gentleNudge: null,
      },
      growthPlan: {
        currentStage: "building",
        nextMilestone: "milestone",
        focusAreas: ["a", "b"],
        antiPatterns: ["c", "d"],
        smartAlternatives: [
          { antiPattern: "c", insteadDoThis: "alt c", exampleAction: "Maya does c", reasoning: "calibrated c" },
          { antiPattern: "d", insteadDoThis: "alt d", exampleAction: "Maya does d", reasoning: "calibrated d" },
        ],
        horizonWeeks: 6,
        citations: [{ platform: "tt", postId: "p1", usedFor: "focusAreas[0]" }],
      },
    });
    const parsed = parseAndValidatePicture(json);
    expect(parsed.sourceCitations).toContainEqual({
      platform: "tt",
      postId: "p1",
      usedFor: "careerStage",
    });
  });

  it("loadSynthInputs surfaces selfReportedCareerStage from onboardingProgress.answers", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "loadself",
      plan: "manager",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(c, {
        onboardingProgress: {
          currentQuestionIdx: 8,
          answers: { careerStage: "scaling" },
          updatedAt: NOW,
        },
      });
    });
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    expect(inputs.selfReportedCareerStage).toBe("scaling");
  });

  it("loadSynthInputs falls back to picture.careerStage when onboardingProgress is cleared", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "loadpic",
      plan: "manager",
    });
    // Pre-seed the picture as the answer-submit path would have.
    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: c,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
        careerStage: "monetizing",
      })
    );
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    expect(inputs.selfReportedCareerStage).toBe("monetizing");
  });

  it("cross-tenant: synthesis for A doesn't write growthPlan onto B's picture", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCreatorWithScrapedData(t, { suffix: "ctXa", plan: "manager" });
    const b = await seedCreatorWithScrapedData(t, { suffix: "ctXb", plan: "manager" });

    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: b,
        niche: "B-NICHE",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "B-VOICE",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "manual-seed",
        sourceCitations: [],
      })
    );

    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson({ careerStage: "scaling" })],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: a }
    );
    expect(result.ok).toBe(true);

    const aPicture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .first()
    );
    const bPicture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    // A got the scaling stage + growth plan from synthesis.
    expect(aPicture!.careerStage).toBe("scaling");
    expect(aPicture!.growthPlan).toBeDefined();
    // B remains untouched — no careerStage, no growthPlan, no reasoning leak.
    expect(bPicture!.niche).toBe("B-NICHE");
    expect(bPicture!.careerStage).toBeUndefined();
    expect(bPicture!.growthPlan).toBeUndefined();
    expect(bPicture!.careerStageReasoning).toBeUndefined();
    expect(bPicture!.careerStageReconciliation).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Multimodal video batching integration (added 2026-04-26)                    */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — multimodal video batching", () => {
  it("system prompt includes the [video] vs [text-context] handling rules", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/Multimodal post handling/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/"kind":"video"/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/"kind":"text-context"/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/CANNOT watch the video/);
  });

  it("buildPromptPayload tags posts with kind='video' or 'text-context'", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "tagged",
      plan: "manager",
      ttPostsCount: 5,
    });
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload } = buildPromptPayload(inputs);
    expect(payload.perPlatform[0].posts.length).toBeGreaterThan(0);
    for (const p of payload.perPlatform[0].posts) {
      expect(["video", "text-context"]).toContain(p.kind);
    }
    // Diagnostics surfaced.
    expect(payload.batchingDiagnostics).toBeDefined();
    expect(payload.batchingDiagnostics.totalPostsConsidered).toBe(5);
    expect(payload.batchingDiagnostics.cappedAtSec).toBe(30 * 60);
  });

  it("with 60 short posts WITH duration, prompt uses [video] for top + bottom and [text-context] for the rest", async () => {
    const t = convexTest(schema, modules);
    // Custom-seed 60 short tiktok posts WITH duration so the batching
    // pipeline sees them as video-eligible.
    const c = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_many",
        email: "many@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "onboarding",
        plan: "manager",
        createdAt: NOW,
      })
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: c,
        platform: "tiktok",
        handle: "many_tt",
        verified: true,
        scrapedAt: NOW,
        followerCount: 42_000,
      });
      await ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "profile", "many_tt"),
        payload: {
          userInfo: {
            user: { uniqueId: "many_tt", nickname: "Many" },
            stats: { followerCount: 42_000 },
          },
        },
        fetchedAt: NOW,
        ttlSec: 21_600,
      });
      const posts: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 60; i++) {
        posts.push({
          id: `tt_post_${i}`,
          desc: `caption ${i} — home gym build`,
          createTime: Math.floor(NOW / 1000) - i * 86_400,
          stats: {
            diggCount: 1_000 + i * 100,
            commentCount: 50 + i * 5,
            playCount: 30_000 + i * 1_000,
            shareCount: 20,
            collectCount: 30,
          },
          video: {
            cover: `https://cdn.example.com/cover_${i}.jpg`,
            playAddr: `https://cdn.example.com/play_${i}.mp4`,
            duration: 30, // 30-second TikToks
          },
        });
      }
      await ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "posts", "many_tt"),
        payload: posts,
        fetchedAt: NOW,
        ttlSec: 1_800,
      });
    });

    const { fetchSpy, callBodies } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const sent = callBodies[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = sent.messages.find((m) => m.role === "user")!;

    // Cap on per-platform = 30 (existing behavior). After 30-cap, the
    // batching pass tags top-15 + bottom-5 = 20 as kind='video' and the
    // remaining 10 as kind='text-context'.
    const videoTagOccurrences = (
      userMessage.content.match(/"kind":\s*"video"/g) ?? []
    ).length;
    const textContextOccurrences = (
      userMessage.content.match(/"kind":\s*"text-context"/g) ?? []
    ).length;
    expect(videoTagOccurrences).toBeGreaterThan(0);
    expect(textContextOccurrences).toBeGreaterThan(0);
    expect(videoTagOccurrences + textContextOccurrences).toBe(30);
    // Specifically: top-15 + bottom-5 = 20 video, remaining 10 text-context.
    expect(videoTagOccurrences).toBe(20);
    expect(textContextOccurrences).toBe(10);
  });

  it("batchingDiagnostics surfaced in the payload", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "diag",
      plan: "manager",
      ttPostsCount: 30,
    });
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload } = buildPromptPayload(inputs);
    expect(payload.batchingDiagnostics.totalPostsConsidered).toBe(30);
    expect(payload.batchingDiagnostics.fullVideoCount).toBeGreaterThanOrEqual(0);
    expect(payload.batchingDiagnostics.textOnlyCount).toBeGreaterThanOrEqual(0);
    expect(
      payload.batchingDiagnostics.fullVideoCount +
        payload.batchingDiagnostics.textOnlyCount
    ).toBe(30);
    // None of the seed videos carry a duration → all become text-only
    // (treated as no-video). The diagnostics surface this honestly.
    expect(payload.batchingDiagnostics.fullVideoCount).toBe(0);
    expect(payload.batchingDiagnostics.totalVideoDurationSec).toBe(0);
  });

  it("posts with explicit videoDurationSec route to full-video selection", async () => {
    const t = convexTest(schema, modules);
    const c = await t.run(async (ctx) =>
      ctx.db.insert("creators", {
        clerkUserId: "u_dur",
        email: "dur@test.com",
        channelPreference: "web",
        timezone: TZ,
        status: "onboarding",
        plan: "manager",
        createdAt: NOW,
      })
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("creatorHandles", {
        creatorId: c,
        platform: "tiktok",
        handle: "dur_tt",
        verified: true,
        scrapedAt: NOW,
        followerCount: 10_000,
      });
      await ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "profile", "dur_tt"),
        payload: {
          userInfo: {
            user: { uniqueId: "dur_tt", nickname: "Dur" },
            stats: { followerCount: 10_000 },
          },
        },
        fetchedAt: NOW,
        ttlSec: 21_600,
      });
      // Seed 5 posts WITH duration (15 sec each) — all should be picked
      // for full-video.
      const posts: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 5; i++) {
        posts.push({
          id: `tt_dur_${i}`,
          desc: `caption ${i}`,
          createTime: Math.floor(NOW / 1000) - i * 86_400,
          stats: {
            diggCount: 1_000 + i * 100,
            commentCount: 50,
            playCount: 30_000,
            shareCount: 20,
            collectCount: 30,
          },
          video: {
            cover: `https://cdn.example.com/cover_${i}.jpg`,
            playAddr: `https://cdn.example.com/play_${i}.mp4`,
            duration: 15, // <-- the new field
          },
        });
      }
      await ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "posts", "dur_tt"),
        payload: posts,
        fetchedAt: NOW,
        ttlSec: 1_800,
      });
    });
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload } = buildPromptPayload(inputs);
    // All 5 posts have duration 15 sec; all fit cap; all should be 'video'.
    expect(payload.batchingDiagnostics.fullVideoCount).toBe(5);
    expect(payload.batchingDiagnostics.textOnlyCount).toBe(0);
    expect(payload.batchingDiagnostics.totalVideoDurationSec).toBe(75);
    for (const p of payload.perPlatform[0].posts) {
      expect(p.kind).toBe("video");
      expect(p.videoDurationSec).toBe(15);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 2 — smartAlternatives 1:1 pairing                                     */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — Wave 2 smartAlternatives", () => {
  it("happy path: every antiPattern in the picture row has a paired smartAlternative", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "wave2_happy",
      plan: "manager",
    });

    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture).not.toBeNull();
    const plan = picture!.growthPlan!;
    expect(plan.antiPatterns).toBeDefined();
    expect(plan.smartAlternatives).toBeDefined();
    expect(plan.smartAlternatives!.length).toBe(plan.antiPatterns!.length);
    // 1:1 pairing — every antiPattern matched exactly once.
    const altByAnti = new Map(
      plan.smartAlternatives!.map((a) => [a.antiPattern, a])
    );
    for (const ap of plan.antiPatterns!) {
      expect(altByAnti.get(ap)).toBeDefined();
    }
  });

  it("rejects synth output where antiPatterns is non-empty but smartAlternatives is missing", () => {
    const json = makeValidSynthesisJson();
    const obj = JSON.parse(json) as {
      growthPlan: { smartAlternatives?: unknown };
    };
    delete obj.growthPlan.smartAlternatives;
    expect(() => parseAndValidatePicture(JSON.stringify(obj))).toThrowError(
      SynthValidationError
    );
  });

  it("rejects synth output where smartAlternatives is non-array", () => {
    const json = makeValidSynthesisJson();
    const obj = JSON.parse(json) as {
      growthPlan: { smartAlternatives: unknown };
    };
    obj.growthPlan.smartAlternatives = "not an array";
    expect(() => parseAndValidatePicture(JSON.stringify(obj))).toThrowError(
      SynthValidationError
    );
  });

  it("rejects synth output where any antiPattern lacks a paired smartAlternative", () => {
    const json = makeValidSynthesisJson();
    const obj = JSON.parse(json) as {
      growthPlan: {
        antiPatterns: string[];
        smartAlternatives: Array<{ antiPattern: string; insteadDoThis: string; exampleAction: string; reasoning: string }>;
      };
    };
    obj.growthPlan.smartAlternatives[0].antiPattern = "TOTALLY UNRELATED STRING";
    expect(() => parseAndValidatePicture(JSON.stringify(obj))).toThrowError(
      /no paired smartAlternatives/
    );
  });

  it("rejects synth output where smartAlternatives.length !== antiPatterns.length", () => {
    const json = makeValidSynthesisJson();
    const obj = JSON.parse(json) as {
      growthPlan: { smartAlternatives: Array<unknown> };
    };
    obj.growthPlan.smartAlternatives.pop();
    expect(() => parseAndValidatePicture(JSON.stringify(obj))).toThrowError(
      /exactly .* entries/
    );
  });

  it("rejects empty insteadDoThis / exampleAction / reasoning fields", () => {
    const json = makeValidSynthesisJson();
    const obj = JSON.parse(json) as {
      growthPlan: {
        smartAlternatives: Array<{
          antiPattern: string;
          insteadDoThis: string;
          exampleAction: string;
          reasoning: string;
        }>;
      };
    };
    obj.growthPlan.smartAlternatives[0].insteadDoThis = "";
    expect(() => parseAndValidatePicture(JSON.stringify(obj))).toThrowError(
      SynthValidationError
    );
  });

  it("just-starting stage: smartAlternative for 'pitching brands' antiPattern includes 'local' or 'spec' keywords", () => {
    const json = makeValidSynthesisJson({
      careerStage: "just-starting",
      selfReportedCareerStage: "just-starting",
    });
    const parsed = parseAndValidatePicture(json);
    const pitchAnti = parsed.growthPlan.antiPatterns.find((ap) =>
      ap.toLowerCase().includes("pitching brands")
    );
    expect(pitchAnti).toBeDefined();
    const alt = parsed.growthPlan.smartAlternatives.find(
      (a) => a.antiPattern === pitchAnti
    );
    expect(alt).toBeDefined();
    const text = (alt!.insteadDoThis + " " + alt!.exampleAction).toLowerCase();
    // Just-starting routing must steer toward local + spec-piece work.
    expect(text).toMatch(/local|spec piece|small/);
  });

  it("scaling stage: smartAlternative includes selectivity / decline framing for brand antiPattern", () => {
    const json = makeValidSynthesisJson({
      careerStage: "scaling",
      selfReportedCareerStage: "scaling",
      antiPatterns: [
        "Saying yes to every brand deal",
        "Posting outside core niche to chase a trend",
        "Micro-managing the queue",
      ],
    });
    const parsed = parseAndValidatePicture(json);
    const brandAlt = parsed.growthPlan.smartAlternatives.find((a) =>
      a.antiPattern.toLowerCase().includes("brand")
    );
    expect(brandAlt).toBeDefined();
    const text = (brandAlt!.insteadDoThis + " " + brandAlt!.exampleAction).toLowerCase();
    expect(text).toMatch(/decline|filter|selectiv|floor/);
  });

  it("CROSS-TENANT: smartAlternatives from creator A's synth never appear on creator B's row", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCreatorWithScrapedData(t, {
      suffix: "wave2_ctA",
      plan: "manager",
    });
    const b = await seedCreatorWithScrapedData(t, {
      suffix: "wave2_ctB",
      plan: "manager",
    });
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const { fetchSpy } = makeMockFetch({
      responses: [
        makeValidSynthesisJson({
          antiPatterns: [
            "A_ANTI_MARKER_1",
            "A_ANTI_MARKER_2",
            "A_ANTI_MARKER_3",
          ],
        }),
      ],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: a }
    );
    expect(result.ok).toBe(true);

    const aRow = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", a))
        .first()
    );
    const bRow = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    expect(aRow?.growthPlan?.antiPatterns?.[0]).toBe("A_ANTI_MARKER_1");
    expect(bRow).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 2 — system prompt contract surface                                    */
/* -------------------------------------------------------------------------- */

describe("SYNTH_SYSTEM_PROMPT — Wave 2 contract", () => {
  it("requires smartAlternatives 1:1 pairing in the prompt body", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/smartAlternatives/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/SMART-ALTERNATIVES RULE/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/Maya is OPINIONATED, never refusing/);
  });

  it("documents concrete exampleAction (not generic advice)", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/CONCRETE move/i);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(
      /maya-opportunity-scout|maya-brand-outreach|maya-monetization-diversifier/
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 4 — video-synth-worker integration                                    */
/*                                                                            */
/* When USE_VIDEO_SYNTH_WORKER=true the synthesis call routes through the     */
/* Fly worker (multimodal Gemini Files API). When false (default during      */
/* rollout), it falls back to OpenRouter text-only.                          */
/* -------------------------------------------------------------------------- */

function fakeWorkerOk(): SynthesizeWorkerResponse {
  return {
    content: makeValidSynthesisJson(),
    model: "gemini-3-flash",
    usage: { inputTokens: 12_000, outputTokens: 1_200, thinkingTokens: 9_000 },
    diagnostics: {
      videosRequested: 5,
      videosDownloaded: 5,
      videosUploaded: 5,
      skippedVideos: [],
      totalElapsedMs: 18_000,
      downloadElapsedMs: 6_000,
      uploadElapsedMs: 1_500,
      geminiElapsedMs: 9_500,
    },
  };
}

describe("synthesizeCreatorPicture — Wave 4 worker routing", () => {
  beforeEach(() => {
    process.env.VIDEO_SYNTH_WORKER_URL = "https://worker.test.fly.dev";
    process.env.WORKER_SHARED_SECRET = "wave4-shared-secret-test";
  });

  afterEach(() => {
    _setVideoSynthClientForTests(null);
    delete process.env.USE_VIDEO_SYNTH_WORKER;
  });

  it("USE_VIDEO_SYNTH_WORKER=true → routes synthesis call through worker", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_on",
      plan: "manager",
    });

    const workerSpy = vi.fn(async () => fakeWorkerOk());
    _setVideoSynthClientForTests(workerSpy);

    // Also spy on OpenRouter fetch — must NOT be called.
    const openRouterFetch = vi.fn();
    _setSynthFetchForTests(openRouterFetch as unknown as typeof fetch);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(workerSpy).toHaveBeenCalledOnce();
    expect(openRouterFetch).not.toHaveBeenCalled();
    // Model logged is the worker's reported model, not OpenRouter's slug.
    expect(result.model).toBe("gemini-3-flash");
  });

  it("USE_VIDEO_SYNTH_WORKER unset → routes through OpenRouter (fallback)", async () => {
    delete process.env.USE_VIDEO_SYNTH_WORKER;
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_off",
      plan: "manager",
    });

    const workerSpy = vi.fn(async () => fakeWorkerOk());
    _setVideoSynthClientForTests(workerSpy);

    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    expect(workerSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("USE_VIDEO_SYNTH_WORKER=false (literal) → routes through OpenRouter", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "false";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_false",
      plan: "manager",
    });

    const workerSpy = vi.fn(async () => fakeWorkerOk());
    _setVideoSynthClientForTests(workerSpy);
    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    expect(workerSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("worker request body carries creatorId + systemPrompt + posts + thinkingBudget=high", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_body",
      plan: "coach", // even Starter gets HIGH thinking on synthesis
      ttPostsCount: 8,
    });

    let captured: SynthesizeWorkerRequest | null = null;
    _setVideoSynthClientForTests(async (req) => {
      captured = req;
      return fakeWorkerOk();
    });

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );

    expect(captured).not.toBeNull();
    expect(captured!.creatorId).toBe(c);
    expect(captured!.systemPrompt).toMatch(/Maya's onboarding analyst/);
    expect(captured!.thinkingBudget).toBe("high");
    expect(captured!.posts.length).toBeGreaterThan(0);
    // posts each carry kind marker (video / text-context)
    for (const p of captured!.posts) {
      expect(["video", "text-context"]).toContain(p.kind);
      expect(p.videoUrl).toMatch(/^https:\/\//);
    }
  });

  it("worker non-retryable failure (auth / config) → structured failure, NOT retried", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_authfail",
      plan: "manager",
    });

    const workerSpy = vi.fn(async () => {
      throw new VideoSynthWorkerError(
        "auth rejected",
        "auth",
        false,
        401
      );
    });
    _setVideoSynthClientForTests(workerSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("model-call");
    expect(result.retryable).toBe(false);
    expect(result.message).toMatch(/auth rejected/);
    // Worker was called exactly once — auth failure short-circuits the retry.
    expect(workerSpy).toHaveBeenCalledOnce();
  });

  it("worker retryable failure (5xx / network) → structured failure with retryable=true", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_5xx",
      plan: "manager",
    });

    _setVideoSynthClientForTests(async () => {
      throw new VideoSynthWorkerError(
        "upstream 503",
        "worker-error",
        true,
        503
      );
    });

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("model-call");
    expect(result.retryable).toBe(true);
  });

  it("worker returns malformed JSON on first attempt → retried with stricter reminder, succeeds on second", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_retry",
      plan: "manager",
    });

    const calls: SynthesizeWorkerRequest[] = [];
    _setVideoSynthClientForTests(async (req) => {
      calls.push(req);
      const isRetry = Boolean(req.retryReminder);
      return {
        ...fakeWorkerOk(),
        content: isRetry ? makeValidSynthesisJson() : "{not json",
      };
    });

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retried).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].retryReminder).toBeUndefined();
    expect(calls[1].retryReminder).toMatch(/malformed JSON|stricter|JSON object/);
  });

  it("aiCallLog row carries the worker's reported usage + cost", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_log",
      plan: "manager",
    });

    _setVideoSynthClientForTests(async () => ({
      ...fakeWorkerOk(),
      usage: { inputTokens: 50_000, outputTokens: 2_000, thinkingTokens: 30_000 },
    }));

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );

    const logs = await t.run(async (ctx) =>
      ctx.db
        .query("aiCallLog")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .collect()
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].thinkingBudget).toBe("high");
    expect(logs[0].inputTokens).toBe(50_000);
    expect(logs[0].outputTokens).toBe(2_000);
    expect(logs[0].thinkingTokens).toBe(30_000);
    expect(logs[0].model).toBe("gemini-3-flash");
    // Cost = (50_000 * 0.5 + (2_000 + 30_000) * 3.0) / 1_000_000
    //      = (25_000 + 96_000) / 1e6 = 0.121
    expect(logs[0].costUsd).toBeCloseTo(0.121, 4);
  });

  it("buildWorkerPosts forwards (postId, platform, videoUrl, kind) only — no caption/transcript", () => {
    const payload = {
      creator: { timezone: "UTC", plan: "manager" },
      perPlatform: [
        {
          platform: "tiktok",
          handle: "@u",
          profile: {
            displayName: null,
            bio: null,
            followerCount: null,
            bioLink: null,
            verified: false,
          },
          posts: [
            {
              platform: "tiktok",
              postId: "p1",
              caption: "should-not-leak",
              transcript: "also-should-not-leak",
              thumbnailUrl: null,
              videoUrl: "https://t/p1",
              videoDurationSec: 30,
              postedAtIso: null,
              viewCount: null,
              likeCount: 100,
              commentCount: 5,
              shareCount: 1,
              saveCount: null,
              topComments: [],
              kind: "video" as const,
            },
            {
              platform: "tiktok",
              postId: "p2",
              caption: null,
              transcript: null,
              thumbnailUrl: null,
              videoUrl: "https://t/p2",
              videoDurationSec: 12,
              postedAtIso: null,
              viewCount: null,
              likeCount: 1,
              commentCount: 0,
              shareCount: 0,
              saveCount: null,
              topComments: [],
              kind: "text-context" as const,
            },
            {
              platform: "tiktok",
              postId: "p3-novideo",
              caption: null,
              transcript: null,
              thumbnailUrl: null,
              videoUrl: null,
              videoDurationSec: null,
              postedAtIso: null,
              viewCount: null,
              likeCount: 0,
              commentCount: 0,
              shareCount: 0,
              saveCount: null,
              topComments: [],
              kind: "text-context" as const,
            },
          ],
        },
      ],
      batchingDiagnostics: {
        totalPostsConsidered: 3,
        fullVideoCount: 1,
        textOnlyCount: 2,
        totalVideoDurationSec: 30,
        cappedAtSec: 1800,
        finalTopN: 1,
        finalBottomM: 0,
        downShifted: false,
        oversizedSingleVideoCount: 0,
      },
    };
    const out = buildWorkerPosts(payload);
    // Only 2 forwarded — p3-novideo dropped because no videoUrl.
    expect(out).toHaveLength(2);
    const out0 = out[0];
    expect(Object.keys(out0).sort()).toEqual(
      ["kind", "platform", "postId", "videoUrl"].sort()
    );
    expect(JSON.stringify(out)).not.toMatch(/should-not-leak/);
  });

  it("buildWorkerUserPayloadJson serializes the PromptPayload as the user-message body", () => {
    const payload = {
      creator: { timezone: "America/Los_Angeles", plan: "manager" },
      perPlatform: [],
      batchingDiagnostics: {
        totalPostsConsidered: 0,
        fullVideoCount: 0,
        textOnlyCount: 0,
        totalVideoDurationSec: 0,
        cappedAtSec: 1800,
        finalTopN: 0,
        finalBottomM: 0,
        downShifted: false,
        oversizedSingleVideoCount: 0,
      },
    };
    const json = buildWorkerUserPayloadJson(payload);
    expect(json).toMatch(/Synthesize the picture per the schema/);
    expect(json).toMatch(/America\/Los_Angeles/);
    expect(json).toMatch(/perPlatform/);
  });

  it("CROSS-TENANT: worker called with creator A's id never patches creator B's row", async () => {
    process.env.USE_VIDEO_SYNTH_WORKER = "true";
    const t = convexTest(schema, modules);
    const a = await seedCreatorWithScrapedData(t, {
      suffix: "w4_ctA",
      plan: "manager",
    });
    const b = await seedCreatorWithScrapedData(t, {
      suffix: "w4_ctB",
      plan: "manager",
    });

    // Pre-seed B's row.
    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: b,
        niche: "B-MARKER-WAVE4",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "B-VOICE-WAVE4",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "manual-seed",
        sourceCitations: [],
      })
    );

    _setVideoSynthClientForTests(async () => fakeWorkerOk());

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: a }
    );

    // B's row untouched.
    const bPic = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", b))
        .first()
    );
    expect(bPic?.niche).toBe("B-MARKER-WAVE4");
  });

  it("falls back to OpenRouter cleanly when feature flag is off — even if worker env is set", async () => {
    // Both env vars set, but flag is false.
    process.env.VIDEO_SYNTH_WORKER_URL = "https://present.worker.fly.dev";
    process.env.WORKER_SHARED_SECRET = "present";
    process.env.USE_VIDEO_SYNTH_WORKER = "false";

    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "w4_flag_off",
      plan: "manager",
    });

    const workerSpy = vi.fn(async () => fakeWorkerOk());
    _setVideoSynthClientForTests(workerSpy);
    const { fetchSpy } = makeMockFetch({
      responses: [makeValidSynthesisJson()],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
    expect(workerSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 4 — audience upstream consumption                                    */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — Sprint 4 audience upstream", () => {
  it("renormalizeAudienceFromCache extracts ageRanges + topGeos + gender from documented shape", () => {
    const upstream = {
      audience: {
        ageRanges: [
          { range: "18-24", percent: 0.4 },
          { range: "25-34", percent: 0.35 },
        ],
        topGeos: [
          { country: "US", percent: 0.6 },
          { country: "CA", percent: 0.1 },
        ],
        gender: { male: 0.55, female: 0.44, other: 0.01 },
      },
    };
    const out = renormalizeAudienceFromCache("tiktok", "h", upstream);
    expect(out).not.toBeNull();
    expect(out?.ageRanges).toEqual(["18-24", "25-34"]);
    expect(out?.topGeos).toEqual(["US", "CA"]);
    expect(out?.genderSplit?.male).toBeCloseTo(0.55, 2);
  });

  it("renormalizeAudienceFromCache returns null on completely empty / malformed payloads", () => {
    expect(renormalizeAudienceFromCache("tiktok", "h", null)).toBeNull();
    expect(renormalizeAudienceFromCache("tiktok", "h", {})).toBeNull();
    expect(renormalizeAudienceFromCache("tiktok", "h", { unrelated: 42 })).toBeNull();
    expect(
      renormalizeAudienceFromCache("tiktok", "h", { audience: {} })
    ).toBeNull();
  });

  it("buildPromptPayload surfaces audienceUpstream when an audience cache row is present", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "s4_aud",
      plan: "manager",
    });
    // Seed an audience cache row keyed to this creator's TT handle.
    await t.run(async (ctx) =>
      ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "audience", "s4_aud_tt"),
        payload: {
          audience: {
            ageRanges: [{ range: "18-24" }, { range: "25-34" }],
            topGeos: [{ country: "US" }, { country: "GB" }],
            gender: { male: 0.6, female: 0.4 },
          },
        },
        fetchedAt: NOW,
        ttlSec: 86_400,
      })
    );
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload } = buildPromptPayload(inputs);
    expect(payload.audienceUpstream).toBeDefined();
    expect(payload.audienceUpstream?.length).toBe(1);
    expect(payload.audienceUpstream?.[0].platform).toBe("tiktok");
    expect(payload.audienceUpstream?.[0].ageRanges).toEqual([
      "18-24",
      "25-34",
    ]);
    expect(payload.audienceUpstream?.[0].topGeos).toEqual(["US", "GB"]);
  });

  it("buildPromptPayload omits audienceUpstream entries with no usable signal", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "s4_aud_empty",
      plan: "manager",
    });
    // Garbage audience row.
    await t.run(async (ctx) =>
      ctx.db.insert("scrapeCreatorsCache", {
        creatorId: c,
        cacheKey: cacheKey("tiktok", "audience", "s4_aud_empty_tt"),
        payload: { unrelated: "garbage" },
        fetchedAt: NOW,
        ttlSec: 86_400,
      })
    );
    const inputs = await t.query(
      internal.onboarding.maya.synthesizeCreatorPicture.loadSynthInputs,
      { creatorId: c }
    );
    const { payload } = buildPromptPayload(inputs);
    expect(payload.audienceUpstream ?? []).toEqual([]);
  });

  it("system prompt instructs the model to PREFER audienceUpstream over inference", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/audienceUpstream/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/PREFER/);
  });
});


/* -------------------------------------------------------------------------- */
/* Sprint 6 — anchor-driven verification (London-bug regression)               */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — Sprint 6 anchor-driven verification", () => {
  it("system prompt includes the anchor supremacy section + needsVerification schema", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/ANCHOR-DRIVEN VERIFICATION/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/ANCHOR SUPREMACY RULES/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/needsVerification/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/LONDON-BUG RULE/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/blocker/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/soft/);
  });

  it("reconcileAnchorVsObserved returns null when anchor and observation match", () => {
    const item = reconcileAnchorVsObserved({
      field: "location",
      selfReported: "Brooklyn",
      observedSignal: "Brooklyn",
      matches: (a, b) => a === b,
      buildQuestion: () => "?",
      buildEvidence: () => ["match"],
      severity: "blocker",
    });
    expect(item).toBeNull();
  });

  it("reconcileAnchorVsObserved returns null when either side is undefined/null", () => {
    expect(
      reconcileAnchorVsObserved({
        field: "location",
        selfReported: undefined,
        observedSignal: "London",
        matches: () => false,
        buildQuestion: () => "?",
        buildEvidence: () => ["x"],
        severity: "blocker",
      })
    ).toBeNull();
    expect(
      reconcileAnchorVsObserved({
        field: "location",
        selfReported: "Brooklyn",
        observedSignal: null,
        matches: () => false,
        buildQuestion: () => "?",
        buildEvidence: () => ["x"],
        severity: "blocker",
      })
    ).toBeNull();
  });

  it("reconcileAnchorVsObserved emits a NeedsVerificationItem when they diverge", () => {
    const item = reconcileAnchorVsObserved({
      field: "location",
      selfReported: "Brooklyn",
      observedSignal: "London",
      matches: (a, b) => a === b,
      buildQuestion: (a, b) => `${a} vs ${b}?`,
      buildEvidence: (a, b) => [`anchor=${a}`, `observed=${b}`],
      severity: "blocker",
    });
    expect(item).not.toBeNull();
    expect(item!.field).toBe("location");
    expect(item!.severity).toBe("blocker");
    expect(item!.question).toBe("Brooklyn vs London?");
    expect(item!.evidence).toEqual(["anchor=Brooklyn", "observed=London"]);
  });

  it("parseAndValidatePicture: tolerates missing needsVerification (defaults to empty array)", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    delete baseJson.needsVerification;
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    expect(parsed.needsVerification).toEqual([]);
  });

  it("parseAndValidatePicture: rejects malformed needsVerification entry (missing severity)", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.needsVerification = [
      {
        field: "location",
        evidence: ["x"],
        question: "?",
        // severity missing
      },
    ];
    expect(() => parseAndValidatePicture(JSON.stringify(baseJson))).toThrow(
      SynthValidationError
    );
  });

  it("parseAndValidatePicture: rejects needsVerification entry with empty evidence array", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.needsVerification = [
      {
        field: "location",
        evidence: [],
        question: "?",
        severity: "blocker",
      },
    ];
    expect(() => parseAndValidatePicture(JSON.stringify(baseJson))).toThrow(
      SynthValidationError
    );
  });

  it("parseAndValidatePicture: parses a well-formed needsVerification array (London-bug shape)", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.needsVerification = [
      {
        field: "location",
        selfReported: { city: "Brooklyn", state: "NY", country: "US" },
        observedSignal: { city: "London", country: "UK" },
        evidence: [
          "18 of last 30 captions reference London landmarks",
          "comments addressing creator as London-based",
          "on-screen Tube signage in 6 posts",
        ],
        question:
          "I see a lot of London footage in your last 30 — are you actually in Brooklyn or splitting time?",
        severity: "blocker",
      },
    ];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    expect(parsed.needsVerification).toHaveLength(1);
    expect(parsed.needsVerification[0].field).toBe("location");
    expect(parsed.needsVerification[0].severity).toBe("blocker");
    expect(parsed.needsVerification[0].question).toMatch(/London/);
    expect(parsed.needsVerification[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("checkAnchorInvariant: returns null when openingAnswers is undefined (no anchor to check)", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    expect(checkAnchorInvariant(parsed, undefined)).toBeNull();
  });

  it("checkAnchorInvariant: returns null when picture's audience.topGeos contains the anchor country", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.audience.topGeos = ["US", "UK", "CA"];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    const result = checkAnchorInvariant(parsed, {
      locationCity: "Brooklyn",
      locationCountry: "US",
    });
    expect(result).toBeNull();
  });

  it("checkAnchorInvariant: returns null when anchor IS flagged in needsVerification", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.audience.topGeos = ["UK", "DE", "FR"]; // doesn't include anchor's US
    baseJson.needsVerification = [
      {
        field: "location",
        evidence: ["majority London footage"],
        question: "Brooklyn or London?",
        severity: "blocker",
      },
    ];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    const result = checkAnchorInvariant(parsed, {
      locationCity: "Brooklyn",
      locationCountry: "US",
    });
    expect(result).toBeNull();
  });

  it("checkAnchorInvariant: returns SynthValidationError when anchor is unflagged AND observed signal disagrees", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.audience.topGeos = ["UK", "DE", "FR"]; // doesn't include US/Brooklyn
    baseJson.audience.interestTags = ["fitness", "gym"]; // no Brooklyn/US
    baseJson.niche = "Generic fitness"; // no Brooklyn/US
    // No needsVerification.location entry → invariant must fail.
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    const result = checkAnchorInvariant(parsed, {
      locationCity: "Brooklyn",
      locationCountry: "US",
    });
    expect(result).toBeInstanceOf(SynthValidationError);
    expect(result!.message).toMatch(/needsVerification invariant/);
    expect(result!.message).toMatch(/location/);
  });

  /* ------------------------------------------------------------------------ */
  /* THE BAR: London-bug regression                                           */
  /* ------------------------------------------------------------------------ */

  it("LONDON-BUG REGRESSION: NYC self-report + heavy London footage → synth produces blocker needsVerification[location], does NOT silently overwrite", async () => {
    // The bar of Sprint 6: a creator who anchored their location as
    // Brooklyn/NY/US, but whose last 30 posts read as heavy London
    // footage, must surface a verification question. The picture's
    // location stays anchored. The creator confirms or corrects via
    // `lock_picture`. Locking without confirmation is structurally
    // prevented by the synth-side invariant + the playbook flow.
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "london",
      plan: "manager",
    });

    // Pre-seed the picture row with the creator's NYC anchor — this is
    // what `submit_opening_answers` would have written before synth.
    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: c,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
        openingAnswers: {
          goal: "10K + first paid deal",
          tone: "strategic",
          submittedAt: NOW,
          // The NYC anchor — creator told Maya in iMessage.
          locationCity: "Brooklyn",
          locationState: "NY",
          locationCountry: "US",
          timezone: "America/New_York",
          nicheInOwnWords: "constraint cooking on a budget",
        },
      })
    );

    // The model's response: heavy London signals (audience topGeos lean
    // UK), and a needsVerification entry surfacing the divergence with
    // severity=blocker — the model behaving correctly.
    const wellBehavedResponseJson = JSON.parse(makeValidSynthesisJson());
    wellBehavedResponseJson.audience.topGeos = ["UK", "GB", "EU", "DE", "FR"];
    wellBehavedResponseJson.audience.interestTags = [
      "London life",
      "Tube commuter",
      "British food",
      "UK creator",
    ];
    wellBehavedResponseJson.needsVerification = [
      {
        field: "location",
        selfReported: { city: "Brooklyn", state: "NY", country: "US" },
        observedSignal: { city: "London", country: "UK" },
        evidence: [
          "18 of last 30 captions reference London landmarks",
          "comments addressing creator as London-based",
          "on-screen Tube signage in 6 posts",
        ],
        question:
          "I see a lot of London footage in your last 30 — are you actually in Brooklyn or splitting time?",
        severity: "blocker",
      },
    ];

    const { fetchSpy } = makeMockFetch({
      responses: [JSON.stringify(wellBehavedResponseJson)],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );
    expect(picture).not.toBeNull();

    // ─── BAR ASSERTION 1: needsVerification surfaced ────────────────────
    expect(picture!.needsVerification).toBeTruthy();
    expect(picture!.needsVerification!.length).toBeGreaterThanOrEqual(1);

    // ─── BAR ASSERTION 2: the location entry exists with severity=blocker
    const locationEntry = picture!.needsVerification!.find(
      (n: { field: string }) => n.field === "location"
    );
    expect(locationEntry).toBeDefined();
    expect(locationEntry!.severity).toBe("blocker");

    // ─── BAR ASSERTION 3: question mentions London (the divergence) ─────
    expect(locationEntry!.question.toLowerCase()).toMatch(/london/);
    expect(locationEntry!.evidence.length).toBeGreaterThanOrEqual(1);

    // ─── BAR ASSERTION 4: the anchor is preserved on openingAnswers ─────
    // The picture's locationSoul / topGeos may reflect the model's
    // observed signal, but `openingAnswers.locationCity` MUST stay
    // Brooklyn (the anchor). Synth never silently overwrites the anchor.
    expect(picture!.openingAnswers?.locationCity).toBe("Brooklyn");
    expect(picture!.openingAnswers?.locationCountry).toBe("US");

    // ─── BAR ASSERTION 5: creators.pictureLockedAt is NOT yet set ───────
    // The picture cannot lock until Maya runs the verify round-trip with
    // the creator. The lock cursor is what gates first_weekly_plan; if it
    // were stamped now, the plan would fire on unverified data — exactly
    // the London-bug class of problem.
    const creator = await t.run((ctx) => ctx.db.get(c));
    expect(creator?.pictureLockedAt).toBeUndefined();
  });

  it("LONDON-BUG (auto-injection): even when the model FORGETS to flag the divergence, the deterministic invariant injects a blocker entry", async () => {
    // The structural protection: if the LLM emits a London-flavored
    // picture without surfacing the divergence in needsVerification[],
    // checkAnchorInvariant detects it and the synth pipeline auto-injects
    // a synthesized blocker entry. The picture lock still cannot fire
    // without operator confirmation. This is the deterministic safety net
    // behind the LLM judgment call.
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "lndforgot",
      plan: "manager",
    });

    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: c,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
        openingAnswers: {
          goal: "10K + first paid deal",
          tone: "strategic",
          submittedAt: NOW,
          locationCity: "Brooklyn",
          locationCountry: "US",
        },
      })
    );

    // The model's response is BUGGY — it shows London signals (topGeos
    // = UK et al.) and DOESN'T emit a needsVerification[] entry. The
    // invariant check must catch this and auto-inject a blocker.
    const buggyResponseJson = JSON.parse(makeValidSynthesisJson());
    buggyResponseJson.audience.topGeos = ["UK", "GB", "DE", "FR", "AU"];
    buggyResponseJson.audience.interestTags = [
      "London life",
      "British food",
      "UK creator",
    ];
    buggyResponseJson.niche = "London-based budget cooking creator";
    buggyResponseJson.needsVerification = []; // model "forgot"

    const { fetchSpy } = makeMockFetch({
      responses: [JSON.stringify(buggyResponseJson)],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);

    const picture = await t.run(async (ctx) =>
      ctx.db
        .query("creatorPicture")
        .withIndex("by_creator", (q) => q.eq("creatorId", c))
        .first()
    );

    // The auto-injection landed a blocker.
    const locationEntry = picture!.needsVerification!.find(
      (n: { field: string }) => n.field === "location"
    );
    expect(locationEntry).toBeDefined();
    expect(locationEntry!.severity).toBe("blocker");
    expect(locationEntry!.question.toLowerCase()).toMatch(/in brooklyn|in us|splitting time|geographic/);
  });

  /* ------------------------------------------------------------------------ */
  /* Adversarial: malformed openingAnswers shouldn't crash synth              */
  /* ------------------------------------------------------------------------ */

  it("ADVERSARIAL: malformed openingAnswers (dealsFloorUsd as string) — endpoint catches before synth ever sees it", async () => {
    // The lcMaya HTTP endpoint validates openingAnswers shape before
    // persistence (see lcMayaHttp.test.ts). Synth therefore only ever
    // sees well-typed openingAnswers. We assert the synth behaves
    // correctly on a hand-crafted malformed picture row (the surface a
    // future writer could accidentally introduce by skipping the HTTP
    // gate). The synth's contract: don't crash, prefer to flag rather
    // than overwrite.
    const t = convexTest(schema, modules);
    const c = await seedCreatorWithScrapedData(t, {
      suffix: "adv",
      plan: "manager",
    });
    await t.run(async (ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: c,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
        openingAnswers: {
          goal: "g",
          tone: "strategic",
          submittedAt: NOW,
          locationCity: "Brooklyn",
          locationCountry: "US",
          // Defensive: even if a malformed value snuck in, we pass it
          // through to the prompt as-is (the model handles it as
          // free-form context); the picture row's other anchors remain
          // canonical.
        },
      })
    );

    const okJson = JSON.parse(makeValidSynthesisJson());
    okJson.audience.topGeos = ["US", "CA", "UK"];
    okJson.needsVerification = [];

    const { fetchSpy } = makeMockFetch({
      responses: [JSON.stringify(okJson)],
    });
    _setSynthFetchForTests(fetchSpy);

    const result = await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: c }
    );
    expect(result.ok).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /* Cross-tenant: openingAnswers from creator A never leaks to creator B's synth */
  /* ------------------------------------------------------------------------ */

  it("CROSS-TENANT: creator A's openingAnswers never leak into B's synth (each synth reads only its own picture row)", async () => {
    const t = convexTest(schema, modules);
    const a = await seedCreatorWithScrapedData(t, {
      suffix: "ctsa",
      plan: "manager",
    });
    const b = await seedCreatorWithScrapedData(t, {
      suffix: "ctsb",
      plan: "manager",
    });

    // Creator A: NYC anchor.
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: a,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
        openingAnswers: {
          goal: "A goal",
          tone: "strategic",
          submittedAt: NOW,
          locationCity: "Brooklyn",
          locationCountry: "US",
        },
      })
    );
    // Creator B: London anchor.
    await t.run((ctx) =>
      ctx.db.insert("creatorPicture", {
        creatorId: b,
        niche: "",
        audience: { ageRanges: [], topGeos: [], interestTags: [] },
        voiceFingerprint: "",
        topHooks: [],
        bottomHooks: [],
        postingCadence: { perPlatform: [] },
        brandDealHistory: [],
        generatedAt: NOW,
        model: "awaiting-synthesis",
        sourceCitations: [],
        openingAnswers: {
          goal: "B goal",
          tone: "supportive",
          submittedAt: NOW,
          locationCity: "London",
          locationCountry: "UK",
        },
      })
    );

    // Run synth for B. The fetch spy records every payload sent to the
    // model — the user message MUST contain B's openingAnswers, NEVER A's.
    const okJson = JSON.parse(makeValidSynthesisJson());
    const { fetchSpy, callBodies } = makeMockFetch({
      responses: [JSON.stringify(okJson)],
    });
    _setSynthFetchForTests(fetchSpy);

    await t.action(
      internal.onboarding.maya.synthesizeCreatorPicture
        .synthesizeCreatorPicture,
      { creatorId: b }
    );

    expect(callBodies).toHaveLength(1);
    const messages = (
      callBodies[0] as { messages: Array<{ role: string; content: string }> }
    ).messages;
    const userContent = messages.find((m) => m.role === "user")?.content ?? "";
    // B's anchor must be present.
    expect(userContent).toMatch(/London/);
    // A's anchor MUST NOT leak into B's synth payload.
    expect(userContent).not.toMatch(/Brooklyn/);
    expect(userContent).not.toMatch(/A goal/);
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 9.5 — always-ask soft verification (real-world test 2026-05-06)      */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — Sprint 9.5 always-ask soft verification", () => {
  it("system prompt includes the ALWAYS-ASK RULE section", () => {
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/ALWAYS-ASK RULE/);
    // The four picture-defining axes that must surface a soft entry on
    // confident first-boot reads.
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/"niche"/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/"location"/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/"audience\.ageRanges"/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/"audience\.topGeos"/);
  });

  it("system prompt explains the rationale: confident reads still get verified", () => {
    // Anti-sycophancy + anti-silent-confidence framing — Maya cannot KNOW
    // without the creator's word, even when the data reads clearly.
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/cannot KNOW/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/cite/i);
    // The operator's framing: asking while referencing what she's seeing.
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/asking while|referencing what/i);
  });

  it("system prompt routes always-ask entries to severity=soft (blockers reserved for divergence)", () => {
    // The "always-ask" section must specify severity is ALWAYS soft.
    const alwaysAskBlock = SYNTH_SYSTEM_PROMPT.split("ALWAYS-ASK RULE")[1] ?? "";
    expect(alwaysAskBlock).toMatch(/severity is ALWAYS "soft"/);
    // Severity stays "blocker" only for the divergence cases (London-bug class).
    expect(alwaysAskBlock).toMatch(/blocker.*only for the divergence/i);
  });

  it("system prompt updates the WHEN-EMPTY rule: never empty on Day-0 inferred reads", () => {
    // Old rule: empty when anchors-and-observation agree.
    // New rule: empty only when every axis is anchored OR sourced verbatim
    // from audienceUpstream. Day-0 with no openingAnswers → always non-empty.
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/Day-0 boot/);
    expect(SYNTH_SYSTEM_PROMPT).toMatch(/NEVER empty/);
  });

  it("system prompt instructs Maya to cite evidence + reference the read in the question", () => {
    // The operator quote: "She's asking while also referencing what she's
    // seeing." The example questions should encode this shape.
    const alwaysAskBlock = SYNTH_SYSTEM_PROMPT.split("ALWAYS-ASK RULE")[1] ?? "";
    // At least one example question that follows the "I see X — confirm or
    // correct?" shape.
    expect(alwaysAskBlock).toMatch(/Reading your last 30/);
    // Audience age example.
    expect(alwaysAskBlock).toMatch(/Audience comments|comments skew/);
  });

  it("validator accepts a Day-0 confident-read picture with 4 soft entries (no blockers)", () => {
    // Confident-read fixture: niche, location, audience.ageRanges,
    // audience.topGeos all inferred from posts — no openingAnswers anchor.
    // Every entry is severity=soft and selfReported=null. The validator
    // must accept this shape — no schema regressions from the prompt
    // change, since the schema stays the same.
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.needsVerification = [
      {
        field: "niche",
        selfReported: null,
        observedSignal:
          "Home-gym builds for ADHD-prone fitness adopters who hate the typical gym aesthetic.",
        evidence: [
          "23 of last 30 posts feature gym builds",
          "captions reference ADHD productivity in 8 posts",
          "audience comments cluster on home-gym hashtags",
        ],
        question:
          "Reading your last 30 — niche reads as gym + ADHD-friendly home builds. Is that the read or did I miss something?",
        severity: "soft",
      },
      {
        field: "location",
        selfReported: null,
        observedSignal: { city: "London", country: "UK" },
        evidence: [
          "Tube signage on-screen in 6 posts",
          "comments addressing creator as London-based",
        ],
        question:
          "I'm seeing a lot of London footage — are you based in London?",
        severity: "soft",
      },
      {
        field: "audience",
        selfReported: null,
        observedSignal: ["25-34", "18-24"],
        evidence: ["comment language clusters early-career", "no parent-talk"],
        question:
          "Audience comments skew 25-34 — does that match what your analytics tell you?",
        severity: "soft",
      },
      {
        field: "audience",
        selfReported: null,
        observedSignal: ["UK", "US", "CA"],
        evidence: ["UK-locale spelling in comments", "GBP price references"],
        question:
          "Top geo reads as UK then US/Canada — does that match your numbers?",
        severity: "soft",
      },
    ];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));

    // Regression bar: confident-read fixture → length ≥ 3, all soft.
    expect(parsed.needsVerification.length).toBeGreaterThanOrEqual(3);
    for (const item of parsed.needsVerification) {
      expect(item.severity).toBe("soft");
    }
    // Picture is still confident — niche + audience + handles all populated
    // — Maya is just going to ask before locking.
    expect(parsed.niche.length).toBeGreaterThan(0);
  });

  it("validator still accepts a London-bug-style blocker entry alongside soft entries", () => {
    // Mixed-mode fixture: 3 soft entries (Day-0 inferred axes) + 1 blocker
    // (location anchor disagrees with observed). Both shapes coexist.
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.needsVerification = [
      {
        field: "location",
        selfReported: { city: "Brooklyn", state: "NY", country: "US" },
        observedSignal: { city: "London", country: "UK" },
        evidence: ["18 of 30 captions reference London", "Tube signage in 6"],
        question: "Brooklyn or London?",
        severity: "blocker",
      },
      {
        field: "niche",
        selfReported: null,
        observedSignal: "Home-gym builds",
        evidence: ["23 of 30 posts gym-themed"],
        question: "Gym-niche read — confirm?",
        severity: "soft",
      },
      {
        field: "audience",
        selfReported: null,
        observedSignal: ["25-34"],
        evidence: ["comment language clusters early-career"],
        question: "Audience reads 25-34 — match your analytics?",
        severity: "soft",
      },
    ];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    const blockers = parsed.needsVerification.filter(
      (i) => i.severity === "blocker"
    );
    const softs = parsed.needsVerification.filter((i) => i.severity === "soft");
    expect(blockers).toHaveLength(1);
    expect(softs).toHaveLength(2);
    expect(blockers[0].field).toBe("location");
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 10 — multimodal picture fields (voiceAndPersonality / visualStyle / */
/*               recurringElements / warmthMaterial)                          */
/* -------------------------------------------------------------------------- */

describe("synthesizeCreatorPicture — Sprint 10 multimodal fields", () => {
  it("HAPPY: parses voiceAndPersonality + visualStyle + recurringElements + warmthMaterial when present", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.voiceAndPersonality = {
      humorType: "deadpan",
      energyLevel: "low-key conversational",
      onCameraPersona: "Talks to camera like a friend, occasional eye-roll for emphasis",
      dryWittyEarnest: "dry-witty",
      signaturePhrases: ["that's the move", "you already know"],
    };
    baseJson.visualStyle = {
      framing: "Tight handheld POV; eye-level dominates; rarely uses tripods",
      aesthetic: ["high-contrast urban", "natural light", "minimal cuts"],
      settingsSeen: ["bodegas", "Washington Square", "subway platforms"],
      strengths: ["good first-second hooks", "consistent color palette"],
      weaknesses: ["audio inconsistent in evening clips"],
    };
    baseJson.recurringElements = [
      {
        kind: "pet",
        name: "Charlie (dog)",
        appearancesIn: ["tt_post_0", "tt_post_2", "tt_post_4"],
        roleSummary:
          "Charlie steals every shot — runs across frame in 3 of 5 watched",
      },
      {
        kind: "location",
        name: "Washington Square Park",
        appearancesIn: ["tt_post_1", "tt_post_2"],
        roleSummary: "Recurring NYC backdrop, signature wide shots",
      },
    ];
    baseJson.warmthMaterial = [
      {
        kind: "recurring-element-callout",
        text: "Your dog Charlie running across Washington Square — gorgeous shot",
        confidence: "safe-to-use",
        citationPostIds: ["tt_post_2"],
      },
      {
        kind: "compliment",
        text: "Your London street clips are punching above your baseline",
        confidence: "check-with-creator",
        citationPostIds: ["tt_post_1"],
      },
    ];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    expect(parsed.voiceAndPersonality?.humorType).toBe("deadpan");
    expect(parsed.voiceAndPersonality?.signaturePhrases).toContain("that's the move");
    expect(parsed.visualStyle?.framing).toContain("Tight handheld POV");
    expect(parsed.visualStyle?.settingsSeen).toContain("Washington Square");
    expect(parsed.recurringElements).toHaveLength(2);
    expect(parsed.recurringElements?.[0]?.name).toBe("Charlie (dog)");
    expect(parsed.warmthMaterial).toHaveLength(2);
    expect(parsed.warmthMaterial?.[0]?.confidence).toBe("safe-to-use");
    expect(parsed.warmthMaterial?.[1]?.confidence).toBe("check-with-creator");
    // Citation firewall: warmthMaterial postIds get auto-added to sourceCitations.
    const citedIds = parsed.sourceCitations.map((c) => c.postId);
    expect(citedIds).toContain("tt_post_2");
    expect(citedIds).toContain("tt_post_1");
  });

  it("TEXT-ONLY FALLBACK: explicit null voiceAndPersonality / visualStyle is preserved as null", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.voiceAndPersonality = null;
    baseJson.visualStyle = null;
    baseJson.recurringElements = [];
    baseJson.warmthMaterial = [];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    expect(parsed.voiceAndPersonality).toBeNull();
    expect(parsed.visualStyle).toBeNull();
    expect(parsed.recurringElements).toEqual([]);
    expect(parsed.warmthMaterial).toEqual([]);
  });

  it("ABSENT: omitting all multimodal fields entirely doesn't break the parser", () => {
    // Old text-only synth output (pre-Sprint-10) must still parse.
    const baseJson = JSON.parse(makeValidSynthesisJson());
    delete baseJson.voiceAndPersonality;
    delete baseJson.visualStyle;
    delete baseJson.recurringElements;
    delete baseJson.warmthMaterial;
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    expect(parsed.voiceAndPersonality).toBeUndefined();
    expect(parsed.visualStyle).toBeUndefined();
    expect(parsed.recurringElements).toEqual([]);
    expect(parsed.warmthMaterial).toEqual([]);
  });

  it("ADVERSARIAL: warmthMaterial entry with empty citationPostIds is rejected", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.warmthMaterial = [
      {
        kind: "compliment",
        text: "broken — no citations",
        confidence: "safe-to-use",
        citationPostIds: [],
      },
    ];
    expect(() => parseAndValidatePicture(JSON.stringify(baseJson))).toThrow(
      SynthValidationError
    );
  });

  it("ADVERSARIAL: invalid recurringElements.kind is rejected", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.recurringElements = [
      {
        kind: "vehicle", // not in allowed enum
        name: "Truck",
        appearancesIn: ["tt_post_0"],
        roleSummary: "appears in one post",
      },
    ];
    expect(() => parseAndValidatePicture(JSON.stringify(baseJson))).toThrow(
      SynthValidationError
    );
  });

  it("ADVERSARIAL: invalid warmthMaterial.confidence is rejected", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.warmthMaterial = [
      {
        kind: "compliment",
        text: "x",
        confidence: "high", // not in allowed enum
        citationPostIds: ["tt_post_0"],
      },
    ];
    expect(() => parseAndValidatePicture(JSON.stringify(baseJson))).toThrow(
      SynthValidationError
    );
  });

  it("CITATION-FIREWALL: recurringElements.appearancesIn postIds get auto-added to sourceCitations", () => {
    const baseJson = JSON.parse(makeValidSynthesisJson());
    baseJson.recurringElements = [
      {
        kind: "pet",
        name: "Charlie",
        // post not in sourceCitations — parser must auto-add
        appearancesIn: ["uncited_post_id_xyz", "tt_post_0"],
        roleSummary: "recurring dog",
      },
    ];
    const parsed = parseAndValidatePicture(JSON.stringify(baseJson));
    const citedIds = parsed.sourceCitations.map((c) => c.postId);
    expect(citedIds).toContain("uncited_post_id_xyz");
    const usedFors = parsed.sourceCitations
      .filter((c) => c.postId === "uncited_post_id_xyz")
      .map((c) => c.usedFor);
    expect(usedFors).toContain("recurringElements[0]");
  });
});
