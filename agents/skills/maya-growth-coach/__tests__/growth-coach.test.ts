/**
 * Sprint 3.5 — `maya-growth-coach` unit tests.
 *
 * Pure-logic tests. Convex action wiring tested separately by the lead.
 *
 * Coverage:
 *   - happy path: aggregation buckets posts and ranks by avgLift; well-formed
 *     model output parses cleanly; citation hint detector flags an
 *     evidence-free move
 *   - adversarial: malformed model output (broken JSON, partial Move objects,
 *     wrong types), single-post buckets are dropped, parser never throws on
 *     unexpected input
 */

import { describe, it, expect } from "vitest";
import {
  aggregateMetrics,
  coachingPrompt,
  parseMovesOutput,
  validateMoveCitations,
  type Move,
  type PostLite,
} from "../script";

const POSTS: PostLite[] = [
  { postId: "tt_938", platform: "tiktok", format: "tiktok", publishedAt: "2026-04-20", dayOfWeekLocal: "sun", durationSec: 35, hookPattern: "POV", performanceLift: 3.0 },
  { postId: "ig_reel_402", platform: "instagram", format: "reel", publishedAt: "2026-04-13", dayOfWeekLocal: "sun", durationSec: 50, hookPattern: "POV", performanceLift: 2.8 },
  { postId: "ig_reel_409", platform: "instagram", format: "reel", publishedAt: "2026-04-06", dayOfWeekLocal: "wed", durationSec: 45, hookPattern: "POV", performanceLift: 3.4 },
  { postId: "tt_910", platform: "tiktok", format: "tiktok", publishedAt: "2026-04-15", dayOfWeekLocal: "mon", durationSec: 40, hookPattern: "talking-head-intro", performanceLift: 0.3 },
  { postId: "tt_915", platform: "tiktok", format: "tiktok", publishedAt: "2026-04-08", dayOfWeekLocal: "mon", durationSec: 38, hookPattern: "talking-head-intro", performanceLift: 0.4 },
  { postId: "yt_long_61", platform: "youtube", format: "long", publishedAt: "2026-04-13", dayOfWeekLocal: "sun", durationSec: 720, performanceLift: 2.1 },
  // single-post bucket — should be dropped from format aggregation
  { postId: "ig_car_88", platform: "instagram", format: "carousel", publishedAt: "2026-04-10", dayOfWeekLocal: "fri", performanceLift: 1.6 },
];

describe("maya-growth-coach — aggregateMetrics", () => {
  it("buckets by format/day-of-week/hook and ranks by avgLift desc", () => {
    const agg = aggregateMetrics(POSTS);
    // POV pattern (3 posts, avg ~3.07) ranks above talking-head-intro
    const hookKeys = agg.byHookPattern.map((b) => b.key);
    expect(hookKeys[0]).toBe("POV");
    expect(hookKeys).toContain("talking-head-intro");
    // single-post format buckets are dropped (carousel is n=1)
    expect(agg.byFormat.find((b) => b.key === "carousel")).toBeUndefined();
    // sun has 3 posts; mon has 2 — both included
    const dowKeys = agg.byDayOfWeek.map((b) => b.key);
    expect(dowKeys).toContain("sun");
    expect(dowKeys).toContain("mon");
  });

  it("examples list is capped at 3 post IDs per bucket", () => {
    const many: PostLite[] = Array.from({ length: 10 }, (_, i) => ({
      postId: `p_${i}`,
      platform: "tiktok",
      format: "tiktok",
      publishedAt: "2026-04-15",
      dayOfWeekLocal: "tue",
      performanceLift: 1.5,
    }));
    const agg = aggregateMetrics(many);
    const tiktokBucket = agg.byFormat.find((b) => b.key === "tiktok");
    expect(tiktokBucket?.examples).toHaveLength(3);
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("drops posts with NaN / null performance lift", () => {
    const agg = aggregateMetrics([
      ...POSTS,
      { postId: "broken_a", platform: "tiktok", format: "tiktok", publishedAt: "2026-04-15", dayOfWeekLocal: "tue", performanceLift: NaN },
      { postId: "broken_b", platform: "tiktok", format: "tiktok", publishedAt: "2026-04-15", dayOfWeekLocal: "tue" },
    ]);
    // tue still single post (the two broken were both tue) — bucket is dropped
    expect(agg.byDayOfWeek.find((b) => b.key === "tue")).toBeUndefined();
  });
});

describe("maya-growth-coach — coachingPrompt", () => {
  it("returns a non-empty string with the goals + struggle + JSON instruction", () => {
    const agg = aggregateMetrics(POSTS);
    const prompt = coachingPrompt({
      niche: "fitness",
      platforms: ["tiktok", "instagram"],
      metrics: agg,
      goals: "Grow YT long-form to 50K",
      currentStruggle: "I'm tired",
    });
    expect(prompt).toContain("fitness");
    expect(prompt).toContain("50K");
    expect(prompt).toContain("I'm tired");
    expect(prompt).toContain("STRICTLY JSON");
    expect(prompt).toContain("priority");
    // anti-promise rule must be present
    expect(prompt).toMatch(/Do NOT promise specific view counts/);
  });

  it("omits the struggle line when not provided", () => {
    const agg = aggregateMetrics(POSTS);
    const prompt = coachingPrompt({
      niche: "fitness",
      platforms: ["tiktok"],
      metrics: agg,
      goals: "Goal",
    });
    expect(prompt).not.toContain("Creator's stated context");
  });
});

describe("maya-growth-coach — parseMovesOutput", () => {
  it("parses well-formed JSON output", () => {
    const raw = JSON.stringify({
      moves: [
        { priority: 1, move: "Do X", evidence: "Bucket Y=2.0x (n=3, ex: tt_938)", expectedOutcome: "Similar to past", timeframe: "1w" },
      ],
      antiPatterns: ["Stop Z"],
    });
    const out = parseMovesOutput(raw);
    expect(out.moves).toHaveLength(1);
    expect(out.moves[0].priority).toBe(1);
    expect(out.antiPatterns).toEqual(["Stop Z"]);
  });

  it("strips ```json fences if the model wrapped its output", () => {
    const raw = "```json\n" + JSON.stringify({ moves: [], antiPatterns: [] }) + "\n```";
    const out = parseMovesOutput(raw);
    expect(out.moves).toEqual([]);
  });

  // ── adversarial ──────────────────────────────────────────────────────
  it("returns empty arrays on broken JSON, never throws", () => {
    expect(parseMovesOutput("not json at all")).toEqual({ moves: [], antiPatterns: [] });
    expect(parseMovesOutput("")).toEqual({ moves: [], antiPatterns: [] });
    expect(parseMovesOutput("{")).toEqual({ moves: [], antiPatterns: [] });
  });

  it("drops partial Move objects (missing fields, wrong types) silently", () => {
    const raw = JSON.stringify({
      moves: [
        { priority: 1, move: "valid", evidence: "tt_938", expectedOutcome: "ok", timeframe: "1w" },
        { priority: 5, move: "bad priority", evidence: "x", expectedOutcome: "ok", timeframe: "1w" }, // bad
        { priority: 1, move: "", evidence: "x", expectedOutcome: "ok", timeframe: "1w" },             // empty move
        { priority: 2, move: "missing evidence", expectedOutcome: "ok", timeframe: "1w" },           // missing
        { priority: 3, move: "bad timeframe", evidence: "x", expectedOutcome: "ok", timeframe: "next year" }, // bad
        "not even an object",
      ],
      antiPatterns: ["clean", 42, "", "another clean"],
    });
    const out = parseMovesOutput(raw);
    expect(out.moves.map((m) => m.move)).toEqual(["valid"]);
    expect(out.antiPatterns).toEqual(["clean", "another clean"]);
  });
});

describe("maya-growth-coach — validateMoveCitations", () => {
  it("flags moves whose evidence has no citation-shaped token", () => {
    const moves: Move[] = [
      { priority: 1, move: "good", evidence: "Sunday posts averaged 2.0x baseline (tt_938)", expectedOutcome: "x", timeframe: "1w" },
      { priority: 1, move: "bad", evidence: "trust me on this one", expectedOutcome: "x", timeframe: "1w" },
      { priority: 1, move: "good metric", evidence: "Hook completion at 52% beats your 30% baseline", expectedOutcome: "x", timeframe: "1w" },
    ];
    const { uncitedIndexes } = validateMoveCitations(moves);
    expect(uncitedIndexes).toEqual([1]);
  });

  it("treats day-of-week and format keywords as citations", () => {
    const moves: Move[] = [
      { priority: 1, move: "m", evidence: "Carousel format outperforms reel", expectedOutcome: "x", timeframe: "1w" },
      { priority: 1, move: "m", evidence: "Sunday cadence holds", expectedOutcome: "x", timeframe: "1w" },
    ];
    const { uncitedIndexes } = validateMoveCitations(moves);
    expect(uncitedIndexes).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Wave 2 — smartAlternative routing in coachingPrompt                        */
/* -------------------------------------------------------------------------- */

describe("maya-growth-coach — Wave 2 smartAlternative surfacing", () => {
  const baseArgs = {
    niche: "fitness",
    platforms: ["tiktok", "instagram"],
    metrics: aggregateMetrics(POSTS),
    goals: "100K by EOY",
  };

  it("surfaces all paired smartAlternatives in the prompt body when present", () => {
    const plan = {
      currentStage: "building" as const,
      nextMilestoneText: "Reach 25K",
      focusAreas: ["hook craft"],
      antiPatterns: ["chasing virality outside niche"],
      smartAlternatives: [
        {
          antiPattern: "chasing virality outside niche",
          insteadDoThis: "Amplify in-niche hook patterns that already overperform",
          exampleAction:
            "Maya identifies your top 3 in-niche hooks and proposes a 6-week reuse arc",
          reasoning: "Compounds inside niche beats viral spikes outside",
        },
      ],
      horizonWeeks: 8,
    };
    const p = coachingPrompt({ ...baseArgs, growthPlan: plan });
    expect(p).toMatch(/Smart alternatives/);
    expect(p).toMatch(/in-niche hook patterns/);
    expect(p).toMatch(/INSTEAD/);
  });

  it("growth-coach NEVER surfaces a ROUTE TO THIS SMART ALTERNATIVE block (coach is universally enabled)", () => {
    const plan = {
      currentStage: "just-starting" as const,
      nextMilestoneText: "Reach 5K",
      focusAreas: ["niche"],
      antiPatterns: [
        "Pitching brands cold before niche is clear",
        "Diversifying monetization streams",
      ],
      smartAlternatives: [
        {
          antiPattern: "Pitching brands cold before niche is clear",
          insteadDoThis: "Pitch local",
          exampleAction: "Maya scouts local",
          reasoning: "calibrated",
        },
        {
          antiPattern: "Diversifying monetization streams",
          insteadDoThis: "Pick one",
          exampleAction: "Maya drafts ebook outline",
          reasoning: "one beats four",
        },
      ],
      horizonWeeks: 8,
    };
    const p = coachingPrompt({ ...baseArgs, growthPlan: plan });
    // The growth-coach domain has an empty antiPattern catalog, so no
    // ROUTE block fires — but the smartAlternatives are still listed in
    // the suffix for the coach's awareness.
    expect(p).not.toMatch(/ROUTE TO THIS SMART ALTERNATIVE/);
    expect(p).toMatch(/Smart alternatives/);
  });
});
