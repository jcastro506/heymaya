/**
 * maya-packet-generator — unit tests.
 *
 * Coverage:
 *  - happy path: Pro creator on-demand assembly with prose sections firewall-passed
 *  - adversarial 1: Starter creator attempting on-demand → PacketPlanGateError
 *  - adversarial 2: citation firewall fails on a prose section → degrades to fields
 *  - adversarial 3: invalid windowDays rejected
 */

import { describe, it, expect } from "vitest";
import {
  assemblePacket,
  assertPlanAllowsTrigger,
  PacketPlanGateError,
  type PacketData,
  type PacketInputs,
  type CitationFirewall,
  type InternalCommsSkill,
} from "../script";
import type { PlanFeatures } from "../../../../convex/lib/planFeatures";

const NOW = 1_700_000_000_000;

// Plan-tier matrix mirror — REVISED 2026-04-26.
// Channels are OpenClaw-native (ungated). Gmail deal desk is universal.
// Brand outreach + opportunity scout + collab match + monetization advisor
// are universal. Apollo/Hunter (brandContactDiscovery + allowedProviders)
// remains Studio-only. readinessPacketCadence stays tiered (none → quarterly
// cron → on-demand) because that's the actual gating axis for THIS skill.
const STARTER_FEATURES: PlanFeatures = {
  plan: "starter",
  maxHandles: 1,
  allowedChannels: ["web", "sms", "imessage", "whatsapp"],
  maxThinkingBudget: "low",
  allowedThinkingBudgets: ["none", "low"],
  chatTurnsPerMonth: 200,
  proactiveCronAll: false,
  gmailDealDeskEnabled: true,
  competitorWatchSlots: 2,
  readinessPacketCadence: "none",
  brandOutreachEnabled: true,
  brandContactDiscoveryEnabled: false,
  opportunityScoutEnabled: true,
  monetizationAdvisorEnabled: true,
  collabMatchEnabled: true,
  multiAccountSlots: 1,
  postPublishReactionLatencySec: 1800,
  allowedProviders: ["gmail", "calendar", "stripe"],
};

// Per-test variant: bumps readinessPacketCadence to 'quarterly' so the gate
// in this skill (which is the only thing this fixture exercises) can be
// asserted against cron-triggered runs. Production Starter is 'none' for
// readinessPacketCadence — that's a per-skill gating axis, not a tier-wide
// cost lever.
const STARTER_CRON_ONLY: PlanFeatures = {
  ...STARTER_FEATURES,
  readinessPacketCadence: "quarterly",
};

const PRO_FEATURES: PlanFeatures = {
  ...STARTER_FEATURES,
  plan: "pro",
  maxHandles: 3,
  maxThinkingBudget: "high",
  allowedThinkingBudgets: ["none", "low", "medium", "high"],
  chatTurnsPerMonth: "unlimited",
  proactiveCronAll: true,
  competitorWatchSlots: 5,
  readinessPacketCadence: "quarterly",
  postPublishReactionLatencySec: 600,
};

const STUDIO_FEATURES: PlanFeatures = {
  ...PRO_FEATURES,
  plan: "studio",
  maxHandles: 5,
  competitorWatchSlots: 10,
  readinessPacketCadence: "on-demand",
  brandContactDiscoveryEnabled: true,
  multiAccountSlots: 3,
  postPublishReactionLatencySec: 300,
  allowedProviders: ["gmail", "calendar", "stripe", "apollo", "hunter"],
};

function fixtureData(): PacketData {
  return {
    creatorName: "Sam Rivera",
    primaryHandle: "samrivera.fit",
    niche: "Beginner-friendly home strength training",
    audience: {
      ageRanges: ["25-34", "35-44"],
      topGeos: ["US", "CA"],
      interestTags: ["fitness", "wellness"],
    },
    voiceFingerprint: "warm, specific, em-dash heavy",
    followerCountByPlatform: [
      { platform: "tiktok", count: 142_000 },
      { platform: "instagram", count: 98_500 },
    ],
    postingCadence: [
      { platform: "tiktok", postsPerWeek: 4 },
      { platform: "instagram", postsPerWeek: 3 },
    ],
    topPosts: [
      {
        postId: "p1",
        platform: "tiktok",
        hookPattern: "POV bold-claim",
        views: 482_000,
        saves: 18_400,
        comments: 2_100,
        mayaAnnotation: "Pattern interrupt at 0.4s.",
        captionExcerpt: "I haven't done a real squat in 4 months.",
      },
    ],
    brandDealHistory: [
      {
        dealId: "d1",
        brand: "Lululemon",
        format: "IG Reel + TT post",
        deliverables: "1 Reel, 1 TT",
        valueUsd: 4500,
        paymentStatus: "paid",
      },
    ],
    voiceSamples: [{ postId: "p1", captionExcerpt: "real squat in 4 months." }],
    goals: ["sign with real talent agent"],
  };
}

const passingFirewall: CitationFirewall = {
  async check() {
    return { passed: true, unsupportedClaims: [] };
  },
};

const failingFirewall: CitationFirewall = {
  async check() {
    return { passed: false, unsupportedClaims: ["fabricated audience claim"] };
  },
};

const stubInternalComms: InternalCommsSkill = {
  async draftProse({ outline }) {
    return outline.map((line, i) => `[${i + 1}] ${line}`).join(" ");
  },
};

describe("maya-packet-generator", () => {
  describe("plan-tier gating (assertPlanAllowsTrigger)", () => {
    it("Studio on-demand: allowed", () => {
      expect(() =>
        assertPlanAllowsTrigger(STUDIO_FEATURES, "on-demand")
      ).not.toThrow();
    });
    it("Pro quarterly-cron: allowed", () => {
      expect(() =>
        assertPlanAllowsTrigger(PRO_FEATURES, "quarterly-cron")
      ).not.toThrow();
    });
    it("Pro on-demand: blocked (Pro is quarterly-only in production matrix)", () => {
      expect(() =>
        assertPlanAllowsTrigger(PRO_FEATURES, "on-demand")
      ).toThrow(PacketPlanGateError);
    });
    it("Starter quarterly-cron: allowed", () => {
      expect(() =>
        assertPlanAllowsTrigger(STARTER_CRON_ONLY, "quarterly-cron")
      ).not.toThrow();
    });
    it("Starter on-demand: blocked", () => {
      expect(() =>
        assertPlanAllowsTrigger(STARTER_CRON_ONLY, "on-demand")
      ).toThrow(PacketPlanGateError);
    });
    it("'none' cadence: blocks both", () => {
      expect(() =>
        assertPlanAllowsTrigger(STARTER_FEATURES, "quarterly-cron")
      ).toThrow(PacketPlanGateError);
      expect(() =>
        assertPlanAllowsTrigger(STARTER_FEATURES, "on-demand")
      ).toThrow(PacketPlanGateError);
    });
  });

  describe("happy path — Studio on-demand", () => {
    it("assembles all 7 sections in order with citations", async () => {
      const inputs: PacketInputs = {
        creatorId: "c_studio",
        windowDays: 90,
        triggeredBy: "on-demand",
        planFeatures: STUDIO_FEATURES,
        data: fixtureData(),
      };
      const bundle = await assemblePacket(inputs, {
        internalComms: stubInternalComms,
        firewall: passingFirewall,
        now: NOW,
      });

      expect(bundle.sections.map((s) => s.kind)).toEqual([
        "cover",
        "snapshot",
        "niche-audience",
        "top-posts",
        "brand-deals",
        "voice-samples",
        "why-hire-me",
      ]);
      // Both prose sections were firewall-checked.
      const proseSections = bundle.sections.filter(
        (s) => s.kind === "niche-audience" || s.kind === "why-hire-me"
      );
      for (const s of proseSections) {
        expect(s.firewallChecked).toBe(true);
        expect(s.body.kind).toBe("prose");
      }
      // Top posts cite their post IDs.
      const topPosts = bundle.sections.find((s) => s.kind === "top-posts")!;
      expect(topPosts.citations).toContain("posts:p1");
      // Brand deals cite the deal ID.
      const dealSection = bundle.sections.find((s) => s.kind === "brand-deals")!;
      expect(dealSection.citations).toContain("brandDeals:d1");
    });
  });

  describe("adversarial — citation firewall fails", () => {
    it("degrades prose sections to fields, not fabrication", async () => {
      const inputs: PacketInputs = {
        creatorId: "c_studio",
        windowDays: 90,
        triggeredBy: "on-demand",
        planFeatures: STUDIO_FEATURES,
        data: fixtureData(),
      };
      const bundle = await assemblePacket(inputs, {
        internalComms: stubInternalComms,
        firewall: failingFirewall,
        now: NOW,
      });
      const niche = bundle.sections.find((s) => s.kind === "niche-audience")!;
      expect(niche.body.kind).toBe("fields");
      expect(niche.firewallChecked).toBe(true);
      const why = bundle.sections.find((s) => s.kind === "why-hire-me")!;
      expect(why.body.kind).toBe("fields");
      expect(why.firewallChecked).toBe(true);
    });
  });

  describe("adversarial — invalid windowDays", () => {
    it("rejects windowDays = 0", async () => {
      const inputs: PacketInputs = {
        creatorId: "c_studio",
        windowDays: 0,
        triggeredBy: "on-demand",
        planFeatures: STUDIO_FEATURES,
        data: fixtureData(),
      };
      await expect(
        assemblePacket(inputs, {
          internalComms: stubInternalComms,
          firewall: passingFirewall,
          now: NOW,
        })
      ).rejects.toThrow(/windowDays must be between/);
    });
    it("rejects windowDays = 366", async () => {
      const inputs: PacketInputs = {
        creatorId: "c_studio",
        windowDays: 366,
        triggeredBy: "on-demand",
        planFeatures: STUDIO_FEATURES,
        data: fixtureData(),
      };
      await expect(
        assemblePacket(inputs, {
          internalComms: stubInternalComms,
          firewall: passingFirewall,
          now: NOW,
        })
      ).rejects.toThrow();
    });
  });

  describe("empty brand-deal history", () => {
    it("emits a prose 'no deals' section without throwing", async () => {
      const data = fixtureData();
      data.brandDealHistory = [];
      const inputs: PacketInputs = {
        creatorId: "c_studio",
        windowDays: 90,
        triggeredBy: "on-demand",
        planFeatures: STUDIO_FEATURES,
        data,
      };
      const bundle = await assemblePacket(inputs, {
        internalComms: stubInternalComms,
        firewall: passingFirewall,
        now: NOW,
      });
      const dealSection = bundle.sections.find((s) => s.kind === "brand-deals")!;
      expect(dealSection.body.kind).toBe("prose");
      if (dealSection.body.kind === "prose") {
        expect(dealSection.body.text).toMatch(/No signed brand deals/i);
      }
    });
  });
});
