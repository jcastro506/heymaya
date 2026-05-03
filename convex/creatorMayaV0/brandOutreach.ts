import {
  brandAutonomyAllowed,
  requireCreatorMayaFeature,
  type BrandAutonomyLevel,
  type CreatorMayaTier,
} from "./tiering";

export interface BrandTargetCandidate {
  brandId: string;
  brandName: string;
  category: string;
  contactProvenance: string | null;
  audienceFit: number;
  contentFit: number;
  timingFit: number;
  valuesFit: number;
}

export interface BrandFitScore {
  brandId: string;
  score: number;
  reasons: ReadonlyArray<string>;
  needsContactResearch: boolean;
}

export interface BrandSendPolicy {
  tier: CreatorMayaTier;
  requestedAutonomyLevel: BrandAutonomyLevel;
  creatorApproved: boolean;
  contactHasProvenance: boolean;
  suppressed: boolean;
}

export function scoreBrandFit(candidate: BrandTargetCandidate): BrandFitScore {
  const score =
    clamp01(candidate.audienceFit) * 0.35 +
    clamp01(candidate.contentFit) * 0.35 +
    clamp01(candidate.timingFit) * 0.15 +
    clamp01(candidate.valuesFit) * 0.15;

  const reasons = [
    candidate.audienceFit >= 0.75 ? "audience fit is strong" : null,
    candidate.contentFit >= 0.75 ? "content fit is strong" : null,
    candidate.timingFit >= 0.75 ? "timing fit is strong" : null,
    candidate.valuesFit >= 0.75 ? "values fit is strong" : null,
  ].filter((reason): reason is string => Boolean(reason));

  return {
    brandId: candidate.brandId,
    score,
    reasons,
    needsContactResearch: candidate.contactProvenance === null,
  };
}

export function canSendBrandOutreach(policy: BrandSendPolicy): boolean {
  requireCreatorMayaFeature(policy.tier, "brandPitchCampaigns");
  if (!brandAutonomyAllowed(policy.tier, policy.requestedAutonomyLevel)) return false;
  if (policy.requestedAutonomyLevel > 2) return false;
  if (!policy.creatorApproved) return false;
  if (!policy.contactHasProvenance) return false;
  if (policy.suppressed) return false;
  return true;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
