export type CreatorMayaTier = "starter" | "pro" | "studio";
export type BrandAutonomyLevel = 0 | 1 | 2 | 3 | 4;

export interface CreatorMayaTierFeatures {
  tier: CreatorMayaTier;
  calendarRead: boolean;
  calendarContentHolds: boolean;
  dailyImessageBrief: boolean;
  weeklyContentPlan: boolean;
  postWatcher: boolean;
  trendScan: boolean;
  commentMining: boolean;
  peerWatch: boolean;
  mediaKitDraft: boolean;
  inboundBrandTriage: boolean;
  outboundBrandDiscovery: boolean;
  contactEnrichment: boolean;
  brandPitchCampaigns: boolean;
  brandCallScheduling: boolean;
  maxBrandAutonomyLevel: BrandAutonomyLevel;
}

const STARTER: CreatorMayaTierFeatures = {
  tier: "starter",
  calendarRead: true,
  calendarContentHolds: true,
  dailyImessageBrief: true,
  weeklyContentPlan: true,
  postWatcher: true,
  trendScan: true,
  commentMining: false,
  peerWatch: false,
  mediaKitDraft: false,
  inboundBrandTriage: false,
  outboundBrandDiscovery: false,
  contactEnrichment: false,
  brandPitchCampaigns: false,
  brandCallScheduling: false,
  maxBrandAutonomyLevel: 0,
};

const PRO: CreatorMayaTierFeatures = {
  ...STARTER,
  tier: "pro",
  commentMining: true,
  peerWatch: true,
  mediaKitDraft: true,
  inboundBrandTriage: true,
  maxBrandAutonomyLevel: 1,
};

const STUDIO: CreatorMayaTierFeatures = {
  ...PRO,
  tier: "studio",
  outboundBrandDiscovery: true,
  contactEnrichment: true,
  brandPitchCampaigns: true,
  brandCallScheduling: true,
  maxBrandAutonomyLevel: 2,
};

const FEATURES: Record<CreatorMayaTier, CreatorMayaTierFeatures> = {
  starter: STARTER,
  pro: PRO,
  studio: STUDIO,
};

export class CreatorMayaTierGateError extends Error {
  constructor(
    readonly tier: string,
    readonly feature: keyof CreatorMayaTierFeatures | "unknown_tier"
  ) {
    super(`Creator Maya tier gate failed: ${tier} cannot use ${feature}.`);
  }
}

export function creatorMayaTierFeatures(
  tier: CreatorMayaTier
): CreatorMayaTierFeatures {
  const features = FEATURES[tier];
  if (!features) {
    throw new CreatorMayaTierGateError(tier, "unknown_tier");
  }
  return features;
}

export function requireCreatorMayaFeature(
  tier: CreatorMayaTier,
  feature: keyof CreatorMayaTierFeatures
): void {
  const value = creatorMayaTierFeatures(tier)[feature];
  if (value !== true) {
    throw new CreatorMayaTierGateError(tier, feature);
  }
}

export function brandAutonomyAllowed(
  tier: CreatorMayaTier,
  requested: BrandAutonomyLevel
): boolean {
  return requested <= creatorMayaTierFeatures(tier).maxBrandAutonomyLevel;
}
