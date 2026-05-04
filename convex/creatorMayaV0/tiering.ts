/**
 * Creator Maya v0 tier feature matrix — REVISED 2026-05-04 (coach / manager).
 *
 * Sibling of `convex/lib/planFeatures.ts`. This file is the v0 OpenClaw-side
 * shape used by the deployment / brand-outreach flow; the wider feature
 * matrix in planFeatures.ts is the source of truth for HQ + cron gates.
 *
 * Tier semantics align with the locked product spec:
 *   - **Coach**: every read/advisory behavior, NO autonomous brand outreach.
 *   - **Manager**: Coach + autonomous brand-deal back-and-forth (draft +
 *     send + Apollo/Hunter discovery + cold pitch + negotiation).
 *
 * `BrandAutonomyLevel` mapping:
 *   - 0 = Maya advises, creator does the work (Coach max).
 *   - 1 = Maya drafts, creator approves+sends (Manager: in-bounds).
 *   - 2 = Maya drafts + sends with creator-set thresholds (Manager max v0).
 *   - 3+ = reserved for future "Studio-class" autonomy. NOT enabled on
 *     Manager v0 — kept as an explicit fail-closed boundary.
 */

export type CreatorMayaTier = "coach" | "manager";
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

const COACH: CreatorMayaTierFeatures = {
  tier: "coach",
  // Read/advisory features — Coach gets the full set.
  calendarRead: true,
  calendarContentHolds: true,
  dailyImessageBrief: true,
  weeklyContentPlan: true,
  postWatcher: true,
  trendScan: true,
  commentMining: true,
  peerWatch: true,
  mediaKitDraft: true,
  // Inbound brand triage — Coach reads + drafts but never auto-sends.
  inboundBrandTriage: true,
  // Outbound brand work — Coach DOES NOT do any of this.
  outboundBrandDiscovery: false,
  contactEnrichment: false,
  brandPitchCampaigns: false,
  brandCallScheduling: false,
  maxBrandAutonomyLevel: 0,
};

const MANAGER: CreatorMayaTierFeatures = {
  ...COACH,
  tier: "manager",
  // Manager unlocks all autonomous brand-deal work.
  outboundBrandDiscovery: true,
  contactEnrichment: true,
  brandPitchCampaigns: true,
  brandCallScheduling: true,
  // v0 caps Manager autonomy at level 2 (draft + threshold-gated send).
  // Level 3+ reserved for a future tier; explicit fail-closed boundary.
  maxBrandAutonomyLevel: 2,
};

const FEATURES: Record<CreatorMayaTier, CreatorMayaTierFeatures> = {
  coach: COACH,
  manager: MANAGER,
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
