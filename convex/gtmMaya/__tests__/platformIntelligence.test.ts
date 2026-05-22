import { describe, expect, it } from "vitest";
import {
  heartbeatPlatformIntelligenceDecision,
  nextPlatformRefreshAt,
  validateChannelRecommendationHasPlatformIntelligence,
  validatePlatformBrief,
  type GtmPlatformBrief,
  type GtmPlatformClaim,
} from "../platformIntelligence";
import type { GtmChannelEvaluation } from "../channelScoring";

const NOW = 1_779_480_000_000;

function claim(
  id: string,
  claimType: GtmPlatformClaim["claimType"],
  overrides: Partial<GtmPlatformClaim> = {}
): GtmPlatformClaim {
  return {
    id,
    platform: "tiktok",
    claimType,
    claim: `TikTok ${claimType} claim`,
    sourceKind: "scrapecreators",
    sourceUrl: `https://example.com/${id}`,
    retrievedAt: NOW - 60_000,
    expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
    confidence: "high",
    ...overrides,
  };
}

function brief(overrides: Partial<GtmPlatformBrief> = {}): GtmPlatformBrief {
  return {
    platform: "tiktok",
    whatWorksNow: ["screenshot slideshows with direct problem hooks"],
    formatPatterns: ["before/after screen sequence"],
    publishingLimits: ["manual posting in V1"],
    policyRisks: ["do not claim auto-posting without official approval"],
    recommendedUseCases: ["visual consumer apps"],
    avoidFor: ["founder cannot provide screen assets"],
    claimIds: ["c1", "c2", "c3"],
    lastReviewedAt: NOW - 60_000,
    expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
    confidence: "high",
    ...overrides,
  };
}

function evaluation(overrides: Partial<GtmChannelEvaluation> = {}): GtmChannelEvaluation {
  return {
    channel: "tiktok",
    score: 0.82,
    decision: "primary",
    confidence: "high",
    reasons: ["strong visual proof"],
    risks: [],
    evidenceCardIds: ["e1", "e2"],
    firstWeekTest: "Run three manual TikTok slideshow tests",
    qualityGate: { passed: true, failures: [] },
    ...overrides,
  };
}

describe("GTM platform intelligence", () => {
  it("requires fresh cited platform claims before a brief can drive strategy", () => {
    const gate = validatePlatformBrief(
      brief(),
      [
        claim("c1", "what_works_now"),
        claim("c2", "publishing_limit"),
        claim("c3", "format_pattern"),
      ],
      NOW
    );

    expect(gate.passed).toBe(true);
  });

  it("fails stale platform briefs even when old claims exist", () => {
    const gate = validatePlatformBrief(
      brief({ expiresAt: NOW - 1 }),
      [
        claim("c1", "what_works_now", { expiresAt: NOW - 1 }),
        claim("c2", "publishing_limit", { expiresAt: NOW - 1 }),
        claim("c3", "format_pattern", { expiresAt: NOW - 1 }),
      ],
      NOW
    );

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("tiktok platform brief is stale");
    expect(gate.failures).toContain("tiktok needs at least three fresh cited claims");
  });

  it("blocks active channel recommendations without current platform intelligence", () => {
    const gate = validateChannelRecommendationHasPlatformIntelligence(
      evaluation(),
      [brief({ expiresAt: NOW - 1 })],
      [
        claim("c1", "what_works_now", { expiresAt: NOW - 1 }),
        claim("c2", "publishing_limit", { expiresAt: NOW - 1 }),
      ],
      NOW
    );

    expect(gate.passed).toBe(false);
    expect(gate.failures).toContain("tiktok platform brief is stale");
  });

  it("keeps heartbeat cheap and queues refresh instead of spending directly", () => {
    const decision = heartbeatPlatformIntelligenceDecision({
      briefs: [brief({ expiresAt: NOW - 1 })],
      activeChannels: ["tiktok"],
      now: NOW,
    });

    expect(decision.shouldSpend).toBe(false);
    expect(decision.shouldQueueRefresh).toBe(true);
    expect(decision.reasons).toContain("tiktok brief is stale");
  });

  it("uses weekly refresh for niche strategy and monthly refresh for platform doctrine", () => {
    expect(nextPlatformRefreshAt(NOW, "weekly")).toBe(NOW + 7 * 24 * 60 * 60 * 1000);
    expect(nextPlatformRefreshAt(NOW, "monthly")).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
  });
});

