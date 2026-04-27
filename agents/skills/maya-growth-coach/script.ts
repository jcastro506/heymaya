/**
 * maya-growth-coach — pure-logic helpers.
 *
 * Sprint 3.5. The Convex action that wires the model router + citation
 * firewall lives in `convex/agents/skills/growthCoach.ts` (lead pushes).
 * This module is the pure logic the action composes:
 *
 *   - `aggregateMetrics`: roll posts/metrics into per-format / per-day-of-week
 *     / per-hook / per-length buckets so the model can reason across them
 *   - `coachingPrompt`: build the high-thinking prompt
 *   - `parseMovesOutput`: parse the model's structured response (tolerant
 *     to small format drift; returns only well-formed moves)
 *   - `validateMoveCitations`: pre-firewall sanity check that each move's
 *     evidence string contains at least one cited identifier
 *
 * Stage-aware adaptive product (Agent B, 2026-04-26): `coachingPrompt` now
 * accepts an optional `growthPlan` and appends a focusAreas/antiPatterns
 * suffix so the coach's "moves" align with the synthesis-emitted plan. The
 * coach itself is NEVER hard-deferred (it's the universal stage-aware
 * skill — its job is to surface the right moves at every stage), but the
 * suffix nudges it toward stage-appropriate recommendations.
 *
 * No Convex imports. No network. Pure TypeScript.
 */
import {
  growthPlanPromptSuffix,
  routeViaGrowthPlan,
  type GrowthPlanForSkill,
} from "../maya-platform/growthPlanGuard";

export type Priority = 1 | 2 | 3;
export type Timeframe = "1d" | "1w" | "1mo";

export interface PostLite {
  readonly postId: string;
  readonly platform: string;
  readonly format: string;          // 'reel' | 'carousel' | 'short' | 'long' | 'thread' | 'tiktok'
  readonly publishedAt: string;     // ISO date
  readonly dayOfWeekLocal: string;  // 'mon'..'sun'
  readonly durationSec?: number;
  readonly hookPattern?: string;    // tagged by maya-hook-extractor
  readonly views?: number;
  readonly saves?: number;
  readonly completionRate?: number; // 0-1
  readonly performanceLift?: number; // x times trailing-30 baseline
}

export interface MetricBucket {
  readonly key: string;
  readonly count: number;
  readonly avgLift: number;
  readonly examples: ReadonlyArray<string>; // post IDs
}

export interface AggregatedMetrics {
  readonly byFormat: ReadonlyArray<MetricBucket>;
  readonly byDayOfWeek: ReadonlyArray<MetricBucket>;
  readonly byHookPattern: ReadonlyArray<MetricBucket>;
  readonly byLengthBucket: ReadonlyArray<MetricBucket>;
}

export interface Move {
  readonly priority: Priority;
  readonly move: string;
  readonly evidence: string;
  readonly expectedOutcome: string;
  readonly timeframe: Timeframe;
}

export interface CoachOutput {
  readonly moves: ReadonlyArray<Move>;
  readonly antiPatterns: ReadonlyArray<string>;
}

/**
 * Bucket posts by format / day-of-week / hook pattern / length. The avg lift
 * per bucket is the model's grounding for any move that claims a pattern.
 *
 * Buckets with `count < 2` are dropped — single-post evidence is anecdote,
 * not pattern. (The skill can still cite a single post directly in the move
 * evidence; this is just the aggregation layer.)
 */
export function aggregateMetrics(posts: ReadonlyArray<PostLite>): AggregatedMetrics {
  return {
    byFormat: bucket(posts, (p) => p.format),
    byDayOfWeek: bucket(posts, (p) => p.dayOfWeekLocal),
    byHookPattern: bucket(posts, (p) => p.hookPattern),
    byLengthBucket: bucket(posts, (p) => lengthBucketOf(p.durationSec)),
  };
}

function bucket(
  posts: ReadonlyArray<PostLite>,
  keyOf: (p: PostLite) => string | undefined
): MetricBucket[] {
  const map = new Map<string, { lifts: number[]; ids: string[] }>();
  for (const p of posts) {
    const k = keyOf(p);
    if (!k) continue;
    const lift = p.performanceLift;
    if (lift == null || Number.isNaN(lift)) continue;
    const slot = map.get(k) ?? { lifts: [], ids: [] };
    slot.lifts.push(lift);
    slot.ids.push(p.postId);
    map.set(k, slot);
  }
  const out: MetricBucket[] = [];
  for (const [key, slot] of map.entries()) {
    if (slot.lifts.length < 2) continue;
    const avg = slot.lifts.reduce((a, b) => a + b, 0) / slot.lifts.length;
    out.push({
      key,
      count: slot.lifts.length,
      avgLift: roundTo(avg, 2),
      examples: slot.ids.slice(0, 3),
    });
  }
  return out.sort((a, b) => b.avgLift - a.avgLift);
}

function lengthBucketOf(seconds?: number): string | undefined {
  if (seconds == null) return undefined;
  if (seconds <= 15) return "≤15s";
  if (seconds <= 30) return "16-30s";
  if (seconds <= 60) return "31-60s";
  if (seconds <= 90) return "61-90s";
  if (seconds <= 180) return "91s-3m";
  if (seconds <= 480) return "3-8m";
  return "8m+";
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/**
 * Build the high-thinking prompt for the move synthesis. Includes the
 * aggregated metrics, the goals, and the optional struggle context.
 *
 * Output format is JSON for easy parsing — but we also tolerate small
 * drift in `parseMovesOutput`.
 */
export function coachingPrompt(args: {
  readonly niche: string;
  readonly platforms: ReadonlyArray<string>;
  readonly metrics: AggregatedMetrics;
  readonly goals: string;
  readonly currentStruggle?: string;
  /** Stage-aware growth plan from creatorPicture.growthPlan. Optional. */
  readonly growthPlan?: GrowthPlanForSkill | null;
}): string {
  const lines: string[] = [];
  lines.push("You are Maya, a creator's AI manager. Produce strategic MOVES.");
  lines.push(`Creator niche: ${args.niche}`);
  lines.push(`Creator platforms: ${args.platforms.join(", ")}`);
  lines.push(`Goals (from soul.md): ${args.goals}`);
  if (args.currentStruggle) {
    lines.push(`Creator's stated context: ${args.currentStruggle}`);
    lines.push(
      "When the creator names a struggle, bias toward smaller, lower-cost re-entry moves over heroic ones."
    );
  }
  lines.push("");
  lines.push("Aggregated metrics (post counts in parens; avgLift = x trailing-30 baseline):");
  lines.push("By format: " + summarizeBuckets(args.metrics.byFormat));
  lines.push("By day-of-week: " + summarizeBuckets(args.metrics.byDayOfWeek));
  lines.push("By hook pattern: " + summarizeBuckets(args.metrics.byHookPattern));
  lines.push("By length: " + summarizeBuckets(args.metrics.byLengthBucket));
  lines.push("");
  lines.push("Output STRICTLY JSON matching:");
  lines.push("{");
  lines.push('  "moves": [{ "priority": 1|2|3, "move": string, "evidence": string,');
  lines.push('              "expectedOutcome": string, "timeframe": "1d"|"1w"|"1mo" }],');
  lines.push('  "antiPatterns": string[]');
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push("- 2-5 moves total. Priority 1 = do this week.");
  lines.push("- Every `evidence` MUST cite at least one specific post ID, metric value, or aggregated bucket from above.");
  lines.push("- Every `expectedOutcome` may name an expected lift only if it traces to a cited prior post — otherwise say 'similar to past comparable posts' without a number.");
  lines.push("- 0-3 antiPatterns. Each must cite evidence too.");
  lines.push("- Do NOT motivational-speak. Do NOT promise specific view counts.");
  lines.push("- If you cannot find 2 cited moves, return what you have — empty `moves` array is OK.");
  // Wave 2 — growth-coach itself NEVER hard-blocks (its job is stage-aware),
  // but when antiPatterns are present we still surface the smartAlternatives
  // so the coach's moves align with the plan's route-to-instead framing.
  const route = routeViaGrowthPlan("growth-coach", args.growthPlan);
  const stageSuffix = growthPlanPromptSuffix(args.growthPlan, {
    smartAlternative: route.smartAlternative,
  });
  if (stageSuffix.length > 0) lines.push(stageSuffix);
  return lines.join("\n");
}

function summarizeBuckets(buckets: ReadonlyArray<MetricBucket>): string {
  if (buckets.length === 0) return "(no buckets met the count>=2 threshold)";
  return buckets
    .slice(0, 6)
    .map((b) => `${b.key}=${b.avgLift}x (n=${b.count}, ex: ${b.examples.join(",")})`)
    .join("; ");
}

/**
 * Parse the model's JSON output. Tolerant: strips ```json fences if present,
 * returns empty arrays on parse failure (caller decides whether to retry).
 * Never throws — this is a chat-path skill and a model glitch must not crash
 * the user-facing flow.
 */
export function parseMovesOutput(raw: string): CoachOutput {
  let body = raw.trim();
  // Strip code fences if the model wrapped its JSON.
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { moves: [], antiPatterns: [] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { moves: [], antiPatterns: [] };
  }
  const obj = parsed as { moves?: unknown; antiPatterns?: unknown };
  const moves: Move[] = [];
  if (Array.isArray(obj.moves)) {
    for (const m of obj.moves) {
      if (!isMove(m)) continue;
      moves.push(m);
    }
  }
  const antiPatterns: string[] = [];
  if (Array.isArray(obj.antiPatterns)) {
    for (const a of obj.antiPatterns) {
      if (typeof a === "string" && a.trim().length > 0) antiPatterns.push(a);
    }
  }
  return { moves, antiPatterns };
}

function isMove(x: unknown): x is Move {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Partial<Move>;
  if (m.priority !== 1 && m.priority !== 2 && m.priority !== 3) return false;
  if (typeof m.move !== "string" || m.move.length === 0) return false;
  if (typeof m.evidence !== "string" || m.evidence.length === 0) return false;
  if (typeof m.expectedOutcome !== "string") return false;
  if (m.timeframe !== "1d" && m.timeframe !== "1w" && m.timeframe !== "1mo") {
    return false;
  }
  return true;
}

/**
 * Pre-firewall sanity check: every move's `evidence` field should contain
 * at least one citation-shaped token (a post ID like `tt_938` / `ig_reel_402`,
 * a metric mention like `2.4×` / `52%`, or a bucket key like a day-of-week or
 * format name).
 *
 * Returns the indexes of moves that look uncited so the caller can either
 * pre-drop them or feed them to the firewall as suspects.
 */
export function validateMoveCitations(moves: ReadonlyArray<Move>): {
  uncitedIndexes: number[];
} {
  const uncited: number[] = [];
  const CITATION_HINT = /(?:[a-z]{2,5}_[a-z0-9_]+|[0-9.]+\s*[×x%]|monday|tuesday|wednesday|thursday|friday|saturday|sunday|reel|carousel|short|long|thread|tiktok)/i;
  moves.forEach((m, i) => {
    if (!CITATION_HINT.test(m.evidence)) {
      uncited.push(i);
    }
  });
  return { uncitedIndexes: uncited };
}
