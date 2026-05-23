import { cacheKey, type CacheKind } from "../integrations/scrapeCreators/cache";
import type { ResearchTaskSpec } from "./researchTasks";

export type ResearchExecutionMode = "onboarding_research" | "heartbeat";

export type ScrapeCreatorsResearchPlatform =
  | "reddit"
  | "x"
  | "linkedin"
  | "tiktok"
  | "instagram";

export interface ScrapeCreatorsQuerySeed {
  appName: string;
  primaryQuery: string;
  alternateQueries?: string[];
  competitorHandles?: Partial<Record<ScrapeCreatorsResearchPlatform, string[]>>;
}

export interface ScrapeCreatorsPlannedCall {
  platform: ScrapeCreatorsResearchPlatform;
  kind: CacheKind | "search";
  query: string;
  cacheKey: string;
  estimatedCredits: number;
  estimatedCostUsd: number;
  reason: string;
}

export interface ScrapeCreatorsQueryPlan {
  taskKind: ResearchTaskSpec["kind"];
  mode: ResearchExecutionMode;
  calls: ScrapeCreatorsPlannedCall[];
  skippedReason?: string;
  totalEstimatedCredits: number;
  totalEstimatedCostUsd: number;
}

const CREDIT_USD_ESTIMATE = 0.01;

export function buildScrapeCreatorsQueryPlan(input: {
  task: ResearchTaskSpec;
  seed: ScrapeCreatorsQuerySeed;
  mode: ResearchExecutionMode;
}): ScrapeCreatorsQueryPlan {
  if (input.mode === "heartbeat") {
    return emptyPlan(input.task, input.mode, "ScrapeCreators spend is forbidden in heartbeat.");
  }
  if (input.task.maxScrapeCreatorsCalls === 0 || input.task.maxCostUsd === 0) {
    return emptyPlan(input.task, input.mode, "Task is configured for no ScrapeCreators spend.");
  }

  const candidates = candidateCalls(input.task, input.seed);
  const calls: ScrapeCreatorsPlannedCall[] = [];
  let totalCost = 0;
  for (const call of candidates) {
    if (calls.length >= input.task.maxScrapeCreatorsCalls) break;
    if (roundUsd(totalCost + call.estimatedCostUsd) > input.task.maxCostUsd) break;
    calls.push(call);
    totalCost = roundUsd(totalCost + call.estimatedCostUsd);
  }

  return {
    taskKind: input.task.kind,
    mode: input.mode,
    calls,
    skippedReason: calls.length === 0 ? "No calls fit inside task budget." : undefined,
    totalEstimatedCredits: calls.reduce(
      (sum, call) => sum + call.estimatedCredits,
      0
    ),
    totalEstimatedCostUsd: totalCost,
  };
}

export function validateScrapeCreatorsQueryPlan(input: {
  task: ResearchTaskSpec;
  plan: ScrapeCreatorsQueryPlan;
}): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (input.plan.mode === "heartbeat" && input.plan.calls.length > 0) {
    failures.push("heartbeat cannot include ScrapeCreators calls");
  }
  if (input.plan.calls.length > input.task.maxScrapeCreatorsCalls) {
    failures.push("plan exceeds ScrapeCreators call cap");
  }
  if (input.plan.totalEstimatedCostUsd > input.task.maxCostUsd) {
    failures.push("plan exceeds ScrapeCreators cost cap");
  }
  if (input.plan.calls.some((call) => !call.cacheKey.startsWith("sc:"))) {
    failures.push("every ScrapeCreators call needs a cache key");
  }
  if (input.plan.calls.some((call) => call.reason.trim().length === 0)) {
    failures.push("every ScrapeCreators call needs a reason");
  }
  return {
    passed: failures.length === 0,
    failures,
  };
}

function candidateCalls(
  task: ResearchTaskSpec,
  seed: ScrapeCreatorsQuerySeed
): ScrapeCreatorsPlannedCall[] {
  switch (task.kind) {
    case "reddit_demand":
      return queryVariants(seed, "reddit", [
        "pain threads",
        "alternatives",
        "launch feedback",
      ]);
    case "x_founder_led":
      return queryVariants(seed, "x", [
        "founder conversations",
        "build in public formats",
      ]);
    case "linkedin_fit":
      return queryVariants(seed, "linkedin", [
        "buyer workflow",
        "professional pain",
      ]);
    case "tiktok_format_research":
      return queryVariants(seed, "tiktok", [
        "demo video formats",
        "slideshow photo mode",
        "UGC hooks",
        "comments transcripts",
      ]);
    case "instagram_format_planner":
      return queryVariants(seed, "instagram", [
        "reels format",
        "carousel format",
      ]);
    default:
      return [];
  }
}

function queryVariants(
  seed: ScrapeCreatorsQuerySeed,
  platform: ScrapeCreatorsResearchPlatform,
  intents: string[]
): ScrapeCreatorsPlannedCall[] {
  const queries = [seed.primaryQuery, ...(seed.alternateQueries ?? [])].filter(
    (query, index, all) => query.trim().length > 0 && all.indexOf(query) === index
  );
  const searchCalls = intents.flatMap((intent) =>
    queries.map((query) =>
      plannedSearchCall({
        platform,
        query: `${query} ${intent}`,
        reason: `Research ${intent} for ${seed.appName}.`,
      })
    )
  );
  const competitorCalls = (seed.competitorHandles?.[platform] ?? []).map((handle) =>
    plannedProfileCall({
      platform,
      handle,
      reason: `Inspect competitor profile ${handle} for reusable positioning.`,
    })
  );
  return [...searchCalls, ...competitorCalls];
}

function plannedSearchCall(input: {
  platform: ScrapeCreatorsResearchPlatform;
  query: string;
  reason: string;
}): ScrapeCreatorsPlannedCall {
  return {
    platform: input.platform,
    kind: "search",
    query: input.query,
    cacheKey: `sc:${input.platform}:search:${normalizeKey(input.query)}`,
    estimatedCredits: 1,
    estimatedCostUsd: CREDIT_USD_ESTIMATE,
    reason: input.reason,
  };
}

function plannedProfileCall(input: {
  platform: ScrapeCreatorsResearchPlatform;
  handle: string;
  reason: string;
}): ScrapeCreatorsPlannedCall {
  return {
    platform: input.platform,
    kind: "profile",
    query: input.handle,
    cacheKey: cacheKey(input.platform, "profile", normalizeKey(input.handle)),
    estimatedCredits: 1,
    estimatedCostUsd: CREDIT_USD_ESTIMATE,
    reason: input.reason,
  };
}

function emptyPlan(
  task: ResearchTaskSpec,
  mode: ResearchExecutionMode,
  skippedReason: string
): ScrapeCreatorsQueryPlan {
  return {
    taskKind: task.kind,
    mode,
    calls: [],
    skippedReason,
    totalEstimatedCredits: 0,
    totalEstimatedCostUsd: 0,
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
