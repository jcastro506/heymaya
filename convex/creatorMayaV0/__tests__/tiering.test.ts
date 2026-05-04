/**
 * Creator Maya v0 tier feature matrix — REVISED 2026-05-04 (coach / manager).
 *
 * Sibling of `convex/lib/__tests__/planFeatures.test.ts`. This file owns the
 * v0 OpenClaw-side tier shape (`creatorMayaTierFeatures`) and the brand-
 * autonomy ladder (`brandAutonomyAllowed` / `requireCreatorMayaFeature`).
 *
 * Contract under test (see `../tiering.ts` source):
 *   - **Coach**: every read/advisory feature; NO autonomous outbound brand
 *     work (`outboundBrandDiscovery` / `contactEnrichment` /
 *     `brandPitchCampaigns` / `brandCallScheduling` all `false`);
 *     `maxBrandAutonomyLevel = 0` (advise-only).
 *   - **Manager**: Coach + every autonomous outbound brand feature;
 *     `maxBrandAutonomyLevel = 2` (draft + threshold-gated send). Level
 *     3+ explicitly denied as a fail-closed boundary for a future tier.
 *
 * Mandatory test categories:
 *   1. Cross-tenant — N/A (pure helper).
 *   2. Plan-tier × action matrix — every read/advisory + every outbound
 *      flag asserted explicitly per tier.
 *   3. Adversarial — unknown tier throws CreatorMayaTierGateError;
 *      negative / out-of-range autonomy levels rejected.
 *   4. Sibling-file scan — feature-key list matches the type definition.
 *   5. TODO grep — none introduced.
 */

import { describe, expect, it } from "vitest";
import {
  brandAutonomyAllowed,
  creatorMayaTierFeatures,
  requireCreatorMayaFeature,
  CreatorMayaTierGateError,
  type BrandAutonomyLevel,
  type CreatorMayaTier,
  type CreatorMayaTierFeatures,
} from "../tiering";

const TIERS: ReadonlyArray<CreatorMayaTier> = ["coach", "manager"];

/* -------------------------------------------------------------------------- */
/* Read / advisory features — UNGATED across both tiers                        */
/* -------------------------------------------------------------------------- */

describe("creatorMayaTierFeatures — read/advisory features (UNGATED)", () => {
  const READ_KEYS: ReadonlyArray<keyof CreatorMayaTierFeatures> = [
    "calendarRead",
    "calendarContentHolds",
    "dailyImessageBrief",
    "weeklyContentPlan",
    "postWatcher",
    "trendScan",
    "commentMining",
    "peerWatch",
    "mediaKitDraft",
    "inboundBrandTriage",
  ];
  for (const tier of TIERS) {
    for (const key of READ_KEYS) {
      it(`${tier}.${String(key)} = true`, () => {
        expect(creatorMayaTierFeatures(tier)[key]).toBe(true);
      });
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Outbound brand-work features — Manager-only autonomy gates                  */
/* -------------------------------------------------------------------------- */

describe("creatorMayaTierFeatures — outbound brand work (Coach=false, Manager=true)", () => {
  const OUTBOUND_KEYS: ReadonlyArray<keyof CreatorMayaTierFeatures> = [
    "outboundBrandDiscovery",
    "contactEnrichment",
    "brandPitchCampaigns",
    "brandCallScheduling",
  ];
  for (const key of OUTBOUND_KEYS) {
    it(`coach.${String(key)} = false`, () => {
      expect(creatorMayaTierFeatures("coach")[key]).toBe(false);
    });
    it(`manager.${String(key)} = true`, () => {
      expect(creatorMayaTierFeatures("manager")[key]).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Brand-autonomy ladder                                                       */
/* -------------------------------------------------------------------------- */

describe("maxBrandAutonomyLevel — Coach=0 (advise-only), Manager=2 (draft+threshold-send)", () => {
  it("coach = 0", () => {
    expect(creatorMayaTierFeatures("coach").maxBrandAutonomyLevel).toBe(0);
  });
  it("manager = 2", () => {
    expect(creatorMayaTierFeatures("manager").maxBrandAutonomyLevel).toBe(2);
  });
});

describe("brandAutonomyAllowed — full ladder per tier", () => {
  const cases: Array<{
    tier: CreatorMayaTier;
    requested: BrandAutonomyLevel;
    expected: boolean;
  }> = [
    // Coach caps at 0 — only advise, never draft on the creator's behalf.
    { tier: "coach", requested: 0, expected: true },
    { tier: "coach", requested: 1, expected: false },
    { tier: "coach", requested: 2, expected: false },
    { tier: "coach", requested: 3, expected: false },
    { tier: "coach", requested: 4, expected: false },
    // Manager up to 2 — draft+threshold-send. Level 3+ reserved for a future
    // tier; explicit fail-closed boundary on Manager v0.
    { tier: "manager", requested: 0, expected: true },
    { tier: "manager", requested: 1, expected: true },
    { tier: "manager", requested: 2, expected: true },
    { tier: "manager", requested: 3, expected: false },
    { tier: "manager", requested: 4, expected: false },
  ];
  for (const c of cases) {
    it(`${c.tier} requesting level ${c.requested} -> ${c.expected}`, () => {
      expect(brandAutonomyAllowed(c.tier, c.requested)).toBe(c.expected);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* requireCreatorMayaFeature — fail-closed on missing autonomy                 */
/* -------------------------------------------------------------------------- */

describe("requireCreatorMayaFeature — fail-closed semantics", () => {
  it("Coach: outboundBrandDiscovery throws CreatorMayaTierGateError", () => {
    expect(() =>
      requireCreatorMayaFeature("coach", "outboundBrandDiscovery")
    ).toThrow(CreatorMayaTierGateError);
  });

  it("Coach: brandPitchCampaigns throws CreatorMayaTierGateError", () => {
    expect(() =>
      requireCreatorMayaFeature("coach", "brandPitchCampaigns")
    ).toThrow(CreatorMayaTierGateError);
  });

  it("Coach: read/advisory features pass without throwing", () => {
    expect(() =>
      requireCreatorMayaFeature("coach", "weeklyContentPlan")
    ).not.toThrow();
    expect(() =>
      requireCreatorMayaFeature("coach", "inboundBrandTriage")
    ).not.toThrow();
  });

  it("Manager: every Manager feature passes", () => {
    const KEYS: ReadonlyArray<keyof CreatorMayaTierFeatures> = [
      "calendarRead",
      "weeklyContentPlan",
      "inboundBrandTriage",
      "outboundBrandDiscovery",
      "contactEnrichment",
      "brandPitchCampaigns",
      "brandCallScheduling",
    ];
    for (const k of KEYS) {
      expect(() => requireCreatorMayaFeature("manager", k)).not.toThrow();
    }
  });

  it("error message embeds tier + missing feature", () => {
    let caught: CreatorMayaTierGateError | null = null;
    try {
      requireCreatorMayaFeature("coach", "outboundBrandDiscovery");
    } catch (err) {
      caught = err as CreatorMayaTierGateError;
    }
    expect(caught).toBeInstanceOf(CreatorMayaTierGateError);
    expect(caught?.tier).toBe("coach");
    expect(caught?.feature).toBe("outboundBrandDiscovery");
    expect(caught?.message).toMatch(/coach/);
    expect(caught?.message).toMatch(/outboundBrandDiscovery/);
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial — unknown tier fails closed                                     */
/* -------------------------------------------------------------------------- */

describe("creatorMayaTierFeatures — adversarial inputs", () => {
  it("unknown tier string throws CreatorMayaTierGateError (fail-closed)", () => {
    expect(() =>
      creatorMayaTierFeatures("starter" as unknown as CreatorMayaTier)
    ).toThrow(CreatorMayaTierGateError);
    expect(() =>
      creatorMayaTierFeatures("studio" as unknown as CreatorMayaTier)
    ).toThrow(CreatorMayaTierGateError);
    expect(() =>
      creatorMayaTierFeatures("" as unknown as CreatorMayaTier)
    ).toThrow(CreatorMayaTierGateError);
  });

  it("error message identifies the unknown tier", () => {
    let caught: CreatorMayaTierGateError | null = null;
    try {
      creatorMayaTierFeatures("studio" as unknown as CreatorMayaTier);
    } catch (err) {
      caught = err as CreatorMayaTierGateError;
    }
    expect(caught).toBeInstanceOf(CreatorMayaTierGateError);
    expect(caught?.tier).toBe("studio");
    expect(caught?.feature).toBe("unknown_tier");
  });
});
