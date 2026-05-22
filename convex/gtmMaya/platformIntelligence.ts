import type { GtmChannel, GtmChannelEvaluation } from "./channelScoring";

export type GtmPlatform =
  | "tiktok"
  | "instagram"
  | "x"
  | "reddit"
  | "linkedin";

export type GtmPlatformClaimType =
  | "what_works_now"
  | "format_pattern"
  | "audience_behavior"
  | "publishing_limit"
  | "api_access"
  | "policy_risk"
  | "measurement_model"
  | "avoid_for";

export type GtmPlatformSourceKind =
  | "official_doc"
  | "scrapecreators"
  | "web_search"
  | "user_account"
  | "third_party_analysis";

export type GtmPlatformConfidence = "low" | "medium" | "high";
export type GtmPlatformRefreshCadence = "onboarding" | "weekly" | "monthly";

export interface GtmPlatformClaim {
  id?: string;
  platform: GtmPlatform;
  claimType: GtmPlatformClaimType;
  claim: string;
  sourceKind: GtmPlatformSourceKind;
  sourceUrl: string;
  retrievedAt: number;
  publishedAt?: number;
  expiresAt: number;
  confidence: GtmPlatformConfidence;
}

export interface GtmPlatformBrief {
  platform: GtmPlatform;
  whatWorksNow: string[];
  formatPatterns: string[];
  publishingLimits: string[];
  policyRisks: string[];
  recommendedUseCases: string[];
  avoidFor: string[];
  claimIds: string[];
  lastReviewedAt: number;
  expiresAt: number;
  confidence: GtmPlatformConfidence;
}

export interface GtmPlatformIntelligenceGate {
  passed: boolean;
  failures: string[];
}

export interface GtmPlatformHeartbeatDecision {
  shouldSpend: false;
  shouldQueueRefresh: boolean;
  reasons: string[];
}

const ACTIVE_CHANNEL_TO_PLATFORM: Partial<Record<GtmChannel, GtmPlatform>> = {
  reddit: "reddit",
  x: "x",
  linkedin: "linkedin",
  tiktok: "tiktok",
};

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function nextPlatformRefreshAt(
  lastReviewedAt: number,
  cadence: GtmPlatformRefreshCadence
): number {
  if (cadence === "onboarding") return lastReviewedAt;
  if (cadence === "weekly") return lastReviewedAt + WEEK_MS;
  return lastReviewedAt + MONTH_MS;
}

export function validatePlatformBrief(
  brief: GtmPlatformBrief,
  claims: ReadonlyArray<GtmPlatformClaim>,
  now: number
): GtmPlatformIntelligenceGate {
  const failures: string[] = [];
  const matchingClaims = claims.filter(
    (claim) => claim.platform === brief.platform && brief.claimIds.includes(claim.id ?? "")
  );
  const freshClaims = matchingClaims.filter((claim) => claim.expiresAt > now);

  if (brief.expiresAt <= now) {
    failures.push(`${brief.platform} platform brief is stale`);
  }
  if (freshClaims.length < 3) {
    failures.push(`${brief.platform} needs at least three fresh cited claims`);
  }
  if (!freshClaims.some((claim) => claim.claimType === "what_works_now")) {
    failures.push(`${brief.platform} needs a current what-works-now claim`);
  }
  if (!freshClaims.some((claim) => claim.claimType === "publishing_limit")) {
    failures.push(`${brief.platform} needs a publishing-limit/API claim`);
  }
  if (brief.confidence === "low") {
    failures.push(`${brief.platform} platform brief confidence is too low`);
  }

  return { passed: failures.length === 0, failures };
}

export function validateChannelRecommendationHasPlatformIntelligence(
  evaluation: GtmChannelEvaluation,
  briefs: ReadonlyArray<GtmPlatformBrief>,
  claims: ReadonlyArray<GtmPlatformClaim>,
  now: number
): GtmPlatformIntelligenceGate {
  const platform = ACTIVE_CHANNEL_TO_PLATFORM[evaluation.channel];
  if (!platform || evaluation.decision === "parked" || evaluation.decision === "blocked") {
    return { passed: true, failures: [] };
  }

  const brief = briefs.find((row) => row.platform === platform);
  if (!brief) {
    return {
      passed: false,
      failures: [`${evaluation.channel} cannot be active without a platform brief`],
    };
  }

  const briefGate = validatePlatformBrief(brief, claims, now);
  const failures = [...briefGate.failures];
  if (evaluation.evidenceCardIds.length < 2) {
    failures.push(`${evaluation.channel} still needs product-specific evidence cards`);
  }

  return { passed: failures.length === 0, failures };
}

export function heartbeatPlatformIntelligenceDecision(input: {
  briefs: ReadonlyArray<GtmPlatformBrief>;
  activeChannels: ReadonlyArray<GtmChannel>;
  now: number;
}): GtmPlatformHeartbeatDecision {
  const activePlatforms = new Set(
    input.activeChannels
      .map((channel) => ACTIVE_CHANNEL_TO_PLATFORM[channel])
      .filter((platform): platform is GtmPlatform => Boolean(platform))
  );
  const reasons: string[] = [];

  for (const brief of input.briefs) {
    if (!activePlatforms.has(brief.platform)) continue;
    if (brief.expiresAt <= input.now) {
      reasons.push(`${brief.platform} brief is stale`);
    } else if (brief.expiresAt - input.now <= 24 * 60 * 60 * 1000) {
      reasons.push(`${brief.platform} brief expires within 24h`);
    }
  }

  return {
    shouldSpend: false,
    shouldQueueRefresh: reasons.length > 0,
    reasons,
  };
}

