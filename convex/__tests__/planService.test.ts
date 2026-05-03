/**
 * planFeaturesService matrix — Service product Sprint 0 (heymaya/service-v0).
 *
 * Source of truth: docs/SPRINT_PLAN_SERVICE_V0.md § 3 (pricing) + § 6 (per-
 * behavior plan-tier columns) + § 8 (approvalRules) + § 13 Sprint 5 (rule-
 * type × tier matrix).
 *
 * This file is the audit grid for the service-side plan-tier matrix.
 * Per-field × per-tier assertions read top-to-bottom; if anyone changes
 * `convex/planService.ts` and forgets to update this file, the diff is the
 * paper trail.
 *
 * Five mandatory test categories per
 *   /Users/joshcastro/.claude/projects/.../memory/feedback_validation_gap_prevention.md:
 *   1. Cross-tenant — covered by serviceCrossTenantIsolation.test.ts (sibling).
 *   2. Plan-tier × action matrix — exhaustive grid below.
 *   3. Adversarial — undefined / unknown / null planTier → fail-closed to
 *      starter; review-reply-auto-publish-allowlist rejected at every tier.
 *   4. Sibling-file scan — covered by sprint1Acceptance.test.ts (the
 *      generic by_creator scan) + the service-side equivalent will land in
 *      Sprint 3 alongside skills.
 *   5. TODO grep — covered repo-wide by sprint1Acceptance.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  planFeaturesService,
  approvalRuleEnableable,
  requireFeatureService,
  PlanServiceGateError,
  type ServicePlan,
  type ApprovalRuleType,
} from "../planService";

const PLANS: ReadonlyArray<ServicePlan> = ["starter", "pro", "studio"];

/* -------------------------------------------------------------------------- */
/* Per-field × per-tier matrix                                                */
/* -------------------------------------------------------------------------- */

describe("planFeaturesService matrix — Sprint 0", () => {
  describe("voice (Studio-only headline channel; Pro gets sample inclusion)", () => {
    it.each<[ServicePlan, boolean]>([
      ["starter", false],
      ["pro", true],
      ["studio", true],
    ])("%s voice = %s", (plan, expected) => {
      expect(planFeaturesService({ planTier: plan }).voice).toBe(expected);
    });
  });

  describe("voiceMinIncluded — § 3 voice tier economics", () => {
    it.each<[ServicePlan, number]>([
      ["starter", 0],
      ["pro", 30],
      ["studio", 100],
    ])("%s = %d minutes", (plan, expected) => {
      expect(planFeaturesService({ planTier: plan }).voiceMinIncluded).toBe(
        expected
      );
    });
  });

  describe("voiceOverageRate — § 3 voice tier economics", () => {
    it("starter has no overage rate (no voice access at all)", () => {
      expect(planFeaturesService({ planTier: "starter" }).voiceOverageRate).toBe(
        null
      );
    });
    it("pro = $0.20/min", () => {
      expect(planFeaturesService({ planTier: "pro" }).voiceOverageRate).toBe(
        0.2
      );
    });
    it("studio = $0.15/min (cheaper, encourages upgrade at ~50min/mo)", () => {
      expect(planFeaturesService({ planTier: "studio" }).voiceOverageRate).toBe(
        0.15
      );
    });
  });

  describe("voiceHardCap — runaway-bill protection", () => {
    it("starter null (no voice)", () => {
      expect(planFeaturesService({ planTier: "starter" }).voiceHardCap).toBe(
        null
      );
    });
    it("pro null (overage charged but no cap)", () => {
      expect(planFeaturesService({ planTier: "pro" }).voiceHardCap).toBe(null);
    });
    it("studio capped at 500 min/mo", () => {
      expect(planFeaturesService({ planTier: "studio" }).voiceHardCap).toBe(
        500
      );
    });
  });

  describe("chatTurnsPerMonth — § 3 cost envelope", () => {
    it("starter = 200", () => {
      expect(
        planFeaturesService({ planTier: "starter" }).chatTurnsPerMonth
      ).toBe(200);
    });
    it("pro = 1000", () => {
      expect(planFeaturesService({ planTier: "pro" }).chatTurnsPerMonth).toBe(
        1000
      );
    });
    it("studio = unlimited", () => {
      expect(
        planFeaturesService({ planTier: "studio" }).chatTurnsPerMonth
      ).toBe("unlimited");
    });
  });

  describe("maxGbpLocations — § 3 + § 8 gbpLocations cap", () => {
    it.each<[ServicePlan, number]>([
      ["starter", 1],
      ["pro", 1],
      ["studio", 5],
    ])("%s = %d locations", (plan, expected) => {
      expect(planFeaturesService({ planTier: plan }).maxGbpLocations).toBe(
        expected
      );
    });
  });

  describe("maxSocialPlatforms — § 3 platform headlines", () => {
    it("starter = 0 (GBP-only)", () => {
      expect(
        planFeaturesService({ planTier: "starter" }).maxSocialPlatforms
      ).toBe(0);
    });
    it("pro = 2 social beyond GBP", () => {
      expect(planFeaturesService({ planTier: "pro" }).maxSocialPlatforms).toBe(
        2
      );
    });
    it("studio = unlimited", () => {
      expect(
        planFeaturesService({ planTier: "studio" }).maxSocialPlatforms
      ).toBe("unlimited");
    });
  });

  describe("crmIntegration — § 3 CRM headline (Pro+)", () => {
    it.each<[ServicePlan, boolean]>([
      ["starter", false],
      ["pro", true],
      ["studio", true],
    ])("%s crmIntegration = %s", (plan, expected) => {
      expect(planFeaturesService({ planTier: plan }).crmIntegration).toBe(
        expected
      );
    });
  });

  describe("serviceTitanIntegration — Studio-only", () => {
    it.each<[ServicePlan, boolean]>([
      ["starter", false],
      ["pro", false],
      ["studio", true],
    ])("%s = %s", (plan, expected) => {
      expect(
        planFeaturesService({ planTier: plan }).serviceTitanIntegration
      ).toBe(expected);
    });
  });

  describe("contentRejuvenation — § 6 behavior #6 (Pro+)", () => {
    it.each<[ServicePlan, boolean]>([
      ["starter", false],
      ["pro", true],
      ["studio", true],
    ])("%s = %s", (plan, expected) => {
      expect(planFeaturesService({ planTier: plan }).contentRejuvenation).toBe(
        expected
      );
    });
  });

  describe("mayaVideoEditing — § 12.5.7 (Studio-only)", () => {
    it.each<[ServicePlan, boolean]>([
      ["starter", false],
      ["pro", false],
      ["studio", true],
    ])("%s = %s", (plan, expected) => {
      expect(planFeaturesService({ planTier: plan }).mayaVideoEditing).toBe(
        expected
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Approval rules × tier matrix — § 8 + § 13 Sprint 5                         */
/* -------------------------------------------------------------------------- */

describe("approvalRulesEnableable matrix — § 8 + § 13 Sprint 5", () => {
  const RULE_TYPES: ReadonlyArray<ApprovalRuleType> = [
    "review-request-auto-send",
    "gbp-post-auto-publish",
    "review-reply-auto-publish-allowlist",
    "content-rejuvenation-auto-publish",
  ];

  // Source-of-truth grid from § 13 Sprint 5:
  //   Starter — none.
  //   Pro     — review-request-auto-send + gbp-post-auto-publish.
  //   Studio  — adds content-rejuvenation-auto-publish.
  //   review-reply-auto-publish-allowlist — FORBIDDEN at every tier.
  const expected: Record<ServicePlan, Record<ApprovalRuleType, boolean>> = {
    starter: {
      "review-request-auto-send": false,
      "gbp-post-auto-publish": false,
      "review-reply-auto-publish-allowlist": false,
      "content-rejuvenation-auto-publish": false,
    },
    pro: {
      "review-request-auto-send": true,
      "gbp-post-auto-publish": true,
      "review-reply-auto-publish-allowlist": false,
      "content-rejuvenation-auto-publish": false,
    },
    studio: {
      "review-request-auto-send": true,
      "gbp-post-auto-publish": true,
      "review-reply-auto-publish-allowlist": false,
      "content-rejuvenation-auto-publish": true,
    },
  };

  for (const plan of PLANS) {
    for (const ruleType of RULE_TYPES) {
      it(`${plan} × ${ruleType} = ${expected[plan][ruleType]}`, () => {
        expect(approvalRuleEnableable({ planTier: plan }, ruleType)).toBe(
          expected[plan][ruleType]
        );
      });
    }
  }

  it("review-reply-auto-publish-allowlist rejected at every tier (Google ReviewReplyState lock)", () => {
    for (const plan of PLANS) {
      expect(
        approvalRuleEnableable(
          { planTier: plan },
          "review-reply-auto-publish-allowlist"
        )
      ).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial — fail-closed defaults                                         */
/* -------------------------------------------------------------------------- */

describe("planFeaturesService adversarial inputs — fail-closed to starter", () => {
  it("undefined planTier returns starter matrix", () => {
    const f = planFeaturesService({ planTier: undefined });
    expect(f.plan).toBe("starter");
    expect(f.voice).toBe(false);
    expect(f.crmIntegration).toBe(false);
  });

  it("null planTier returns starter matrix", () => {
    const f = planFeaturesService({ planTier: null });
    expect(f.plan).toBe("starter");
    expect(f.crmIntegration).toBe(false);
  });

  it("empty-string planTier returns starter matrix", () => {
    const f = planFeaturesService({ planTier: "" });
    expect(f.plan).toBe("starter");
  });

  it("malformed planTier ('enterprise') returns starter matrix", () => {
    const f = planFeaturesService({ planTier: "enterprise" });
    expect(f.plan).toBe("starter");
    expect(f.voice).toBe(false);
    expect(f.serviceTitanIntegration).toBe(false);
  });

  it("uppercase planTier ('PRO') returns starter matrix (case-sensitive enum)", () => {
    // Adversarial: a UI bug uppercasing the value should NOT silently unlock
    // Pro features. Fail closed.
    const f = planFeaturesService({ planTier: "PRO" });
    expect(f.plan).toBe("starter");
    expect(f.crmIntegration).toBe(false);
  });

  it("approvalRuleEnableable with bad ruleType + Studio tier still uses tier matrix", () => {
    // Even when callers pass unknown rule types, the check stays fail-closed
    // because the lookup is against a bounded list — unknown values fall
    // through to `false` via the includes() check.
    const result = approvalRuleEnableable(
      { planTier: "studio" },
      // Cast through unknown to simulate a runtime malformed-rule attack.
      "fake-rule-type" as unknown as ApprovalRuleType
    );
    expect(result).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* requireFeatureService — throwing-form gate                                 */
/* -------------------------------------------------------------------------- */

describe("requireFeatureService — throwing-form gate", () => {
  it("starter calling crmIntegration throws PlanServiceGateError", () => {
    expect(() =>
      requireFeatureService(
        { planTier: "starter" },
        (f) => f.crmIntegration,
        "crm-connect",
        "pro"
      )
    ).toThrow(PlanServiceGateError);
  });

  it("pro calling serviceTitanIntegration throws", () => {
    expect(() =>
      requireFeatureService(
        { planTier: "pro" },
        (f) => f.serviceTitanIntegration,
        "servicetitan-connect",
        "studio"
      )
    ).toThrow(PlanServiceGateError);
  });

  it("pro calling voice succeeds (Pro has 30-min sample inclusion)", () => {
    expect(() =>
      requireFeatureService(
        { planTier: "pro" },
        (f) => f.voice,
        "voice-channel",
        "pro"
      )
    ).not.toThrow();
  });

  it("studio calling mayaVideoEditing succeeds", () => {
    expect(() =>
      requireFeatureService(
        { planTier: "studio" },
        (f) => f.mayaVideoEditing,
        "video-edit",
        "studio"
      )
    ).not.toThrow();
  });

  it("undefined planTier (fail-closed to starter) throws on Pro+ feature", () => {
    expect(() =>
      requireFeatureService(
        { planTier: undefined },
        (f) => f.crmIntegration,
        "crm-connect",
        "pro"
      )
    ).toThrow(PlanServiceGateError);
  });

  it("PlanServiceGateError carries plan + attemptedFeature + requiredPlan", () => {
    try {
      requireFeatureService(
        { planTier: "starter" },
        (f) => f.mayaVideoEditing,
        "video-edit",
        "studio"
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PlanServiceGateError);
      const err = e as PlanServiceGateError;
      expect(err.plan).toBe("starter");
      expect(err.attemptedFeature).toBe("video-edit");
      expect(err.requiredPlan).toBe("studio");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* No accidental widening — sentinel checks                                   */
/* -------------------------------------------------------------------------- */

describe("planFeaturesService — accidental-widening sentinels", () => {
  it("starter has zero approval rules enableable", () => {
    expect(
      planFeaturesService({ planTier: "starter" }).approvalRulesEnableable
    ).toEqual([]);
  });

  it("starter has no voice / no CRM / no rejuvenation / no editor (locked floor)", () => {
    const f = planFeaturesService({ planTier: "starter" });
    expect(f.voice).toBe(false);
    expect(f.crmIntegration).toBe(false);
    expect(f.serviceTitanIntegration).toBe(false);
    expect(f.contentRejuvenation).toBe(false);
    expect(f.mayaVideoEditing).toBe(false);
  });

  it("pro never has serviceTitan or video editing", () => {
    const f = planFeaturesService({ planTier: "pro" });
    expect(f.serviceTitanIntegration).toBe(false);
    expect(f.mayaVideoEditing).toBe(false);
  });

  it("studio is the ONLY tier with mayaVideoEditing + serviceTitanIntegration + voiceHardCap", () => {
    expect(planFeaturesService({ planTier: "studio" }).mayaVideoEditing).toBe(
      true
    );
    expect(
      planFeaturesService({ planTier: "studio" }).serviceTitanIntegration
    ).toBe(true);
    expect(planFeaturesService({ planTier: "studio" }).voiceHardCap).toBe(500);
  });

  it("approvalRulesEnableable arrays do NOT contain review-reply-auto-publish-allowlist at any tier", () => {
    for (const plan of PLANS) {
      const list = planFeaturesService({ planTier: plan })
        .approvalRulesEnableable;
      expect(list).not.toContain("review-reply-auto-publish-allowlist");
    }
  });
});
