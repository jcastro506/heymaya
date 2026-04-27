/**
 * maya-platform/growthPlanGuard — stage-aware skill-calibration helper tests.
 *
 * Added 2026-04-26 by Agent B (stage-aware adaptive product). Pure-logic
 * tests for the shared helper that every recommending skill consults before
 * running its LLM prompt or deterministic recommendation matrix.
 *
 * 5 mandatory test categories:
 *   1. Cross-tenant — N/A (pure helper, no DB).
 *   2. Plan-tier — N/A here (gating is upstream); but coverage of the stage
 *      matrix per skill domain.
 *   3. Adversarial — null/undefined growth plan, empty antiPatterns,
 *      keyword-substring matching is case-insensitive.
 *   4. Sibling-file scan — covered repo-wide.
 *   5. TODO grep — covered repo-wide.
 *
 * Plus integration:
 *   - just-starting plan with "pitch brands" anti → brand-outreach BLOCKED.
 *   - building plan without anti → brand-outreach PASSES.
 *   - scaling plan with "post more consistently" anti → growth-coach NEVER
 *     defers (its job is stage-aware; the guard for growth-coach is empty).
 *   - the prompt suffix is non-empty when growthPlan present, empty otherwise.
 */

import { describe, it, expect } from "vitest";
import {
  assertSkillRespectsGrowthPlan,
  growthPlanPromptSuffix,
  isSkillBlockedByAntiPatterns,
  routeViaGrowthPlan,
  type GrowthPlanForSkill,
  type CareerStage,
  type SkillDomain,
} from "../growthPlanGuard";

function planFor(
  stage: CareerStage,
  antiPatterns: string[],
  focusAreas: string[] = ["focus 1", "focus 2"]
): GrowthPlanForSkill {
  return {
    currentStage: stage,
    nextMilestoneText: "Reach milestone X",
    focusAreas,
    antiPatterns,
    horizonWeeks: 8,
  };
}

/**
 * Wave 2 — plan with paired smartAlternatives. Each antiPattern gets a
 * concrete `insteadDoThis` / `exampleAction` / `reasoning`.
 */
function planForWithAlternatives(
  stage: CareerStage,
  pairs: Array<{
    antiPattern: string;
    insteadDoThis: string;
    exampleAction: string;
    reasoning: string;
  }>
): GrowthPlanForSkill {
  return {
    currentStage: stage,
    nextMilestoneText: "Reach milestone X",
    focusAreas: ["focus 1", "focus 2"],
    antiPatterns: pairs.map((p) => p.antiPattern),
    smartAlternatives: pairs,
    horizonWeeks: 8,
  };
}

describe("isSkillBlockedByAntiPatterns", () => {
  it("returns false when growthPlan is null/undefined", () => {
    expect(isSkillBlockedByAntiPatterns("brand-outreach", null)).toBe(false);
    expect(isSkillBlockedByAntiPatterns("brand-outreach", undefined)).toBe(
      false
    );
  });

  it("returns false when antiPatterns is empty", () => {
    expect(
      isSkillBlockedByAntiPatterns(
        "brand-outreach",
        planFor("just-starting", [])
      )
    ).toBe(false);
  });

  it("blocks brand-outreach when antiPatterns contains 'pitching brands'", () => {
    const plan = planFor("just-starting", [
      "Pitching brands cold before niche is clear",
    ]);
    expect(isSkillBlockedByAntiPatterns("brand-outreach", plan)).toBe(true);
  });

  it("is case-insensitive", () => {
    const plan = planFor("just-starting", [
      "PITCHING BRANDS COLD before niche is clear",
    ]);
    expect(isSkillBlockedByAntiPatterns("brand-outreach", plan)).toBe(true);
  });

  it("blocks monetization-diversifier on diversification anti-pattern", () => {
    const plan = planFor("just-starting", [
      "Diversifying monetization streams before 5K followers",
    ]);
    expect(isSkillBlockedByAntiPatterns("monetization-diversifier", plan)).toBe(
      true
    );
  });

  it("blocks opportunity-scout on marketplace anti-pattern", () => {
    const plan = planFor("just-starting", [
      "UGC marketplace prospecting before niche is locked",
    ]);
    expect(isSkillBlockedByAntiPatterns("opportunity-scout", plan)).toBe(true);
  });

  it("blocks content-arc-planner on complex-arc anti-pattern", () => {
    const plan = planFor("just-starting", [
      "Complex content arcs before voice is consistent",
    ]);
    expect(isSkillBlockedByAntiPatterns("content-arc-planner", plan)).toBe(
      true
    );
  });

  it("growth-coach NEVER defers (empty keyword catalog)", () => {
    // Even if the plan literally contains every other anti-pattern, the
    // growth-coach itself is stage-aware and shouldn't be hard-blocked.
    const plan = planFor("just-starting", [
      "Pitching brands cold",
      "Diversifying monetization",
      "Marketplace scouting",
      "Complex content arcs",
    ]);
    expect(isSkillBlockedByAntiPatterns("growth-coach", plan)).toBe(false);
  });

  it("brand-outreach passes when antiPatterns are unrelated", () => {
    const plan = planFor("building", [
      "Posting outside your niche for trend chases",
      "Multi-account splits at this size",
    ]);
    expect(isSkillBlockedByAntiPatterns("brand-outreach", plan)).toBe(false);
  });
});

describe("assertSkillRespectsGrowthPlan", () => {
  it("returns blocked=false when no plan", () => {
    const result = assertSkillRespectsGrowthPlan("brand-outreach", null);
    expect(result.blocked).toBe(false);
    expect(result.deferralMessage).toBeNull();
    expect(result.stage).toBeNull();
  });

  it("returns blocked=true with stage-specific message when blocked", () => {
    const plan = planFor("just-starting", ["Pitching brands cold"]);
    const result = assertSkillRespectsGrowthPlan("brand-outreach", plan);
    expect(result.blocked).toBe(true);
    expect(result.deferralMessage).toMatch(/growth phase, not pitch phase/i);
    expect(result.stage).toBe("just-starting");
  });

  it("returns blocked=false with stage when not blocked", () => {
    const plan = planFor("building", []);
    const result = assertSkillRespectsGrowthPlan("brand-outreach", plan);
    expect(result.blocked).toBe(false);
    expect(result.stage).toBe("building");
  });

  it("each stage gets a different deferral message for the same domain", () => {
    const messages = (["just-starting", "building", "monetizing", "scaling"] as const).map(
      (s) => {
        const plan = planFor(s, ["Pitching brands cold"]);
        return assertSkillRespectsGrowthPlan("brand-outreach", plan)
          .deferralMessage;
      }
    );
    // All four are non-empty and distinct.
    expect(new Set(messages).size).toBe(4);
    for (const m of messages) {
      expect(m).not.toBeNull();
      expect(m!.length).toBeGreaterThan(20);
    }
  });
});

describe("growthPlanPromptSuffix", () => {
  it("returns empty string when no plan", () => {
    expect(growthPlanPromptSuffix(null)).toBe("");
    expect(growthPlanPromptSuffix(undefined)).toBe("");
  });

  it("returns a suffix block citing focus areas + anti-patterns when plan present", () => {
    const plan = planFor("building", ["anti-1", "anti-2"], ["focus-A", "focus-B"]);
    const out = growthPlanPromptSuffix(plan);
    expect(out).toMatch(/STAGE-AWARE GROWTH PLAN/);
    expect(out).toMatch(/Creator current stage: building/);
    expect(out).toMatch(/focus-A/);
    expect(out).toMatch(/anti-1/);
    expect(out).toMatch(/Reach milestone X/);
    expect(out).toMatch(/8 weeks/);
  });

  it("Wave 2 — instructs the model to route to the paired smartAlternative when violating an anti-pattern (anti-paternalism)", () => {
    const plan = planFor("building", ["anti-1"]);
    const out = growthPlanPromptSuffix(plan);
    // Wave 2 replaced "defer instead" with the route-to-alternative framing.
    expect(out).toMatch(/route to the paired smartAlternative/i);
    expect(out).toMatch(/Maya is opinionated, never refusing/);
  });
});

describe("stage-aware deferral by skill domain — comprehensive matrix", () => {
  const STAGES: ReadonlyArray<CareerStage> = [
    "just-starting",
    "building",
    "monetizing",
    "scaling",
  ];

  it("just-starting + brand-pitch antiPattern → brand-outreach AND brand-pitch-strategy AND opportunity-scout AND rate-calculator all defer", () => {
    const plan = planFor("just-starting", [
      "Pitching brands cold before niche is clear",
      "Marketplace prospecting before niche is locked",
      "Setting rates before your first deal",
    ]);
    expect(
      assertSkillRespectsGrowthPlan("brand-outreach", plan).blocked
    ).toBe(true);
    expect(
      assertSkillRespectsGrowthPlan("brand-pitch-strategy", plan).blocked
    ).toBe(true);
    expect(
      assertSkillRespectsGrowthPlan("opportunity-scout", plan).blocked
    ).toBe(true);
    expect(
      assertSkillRespectsGrowthPlan("rate-calculator", plan).blocked
    ).toBe(true);
  });

  it("growth-coach is never blocked at any stage by any anti-pattern", () => {
    for (const stage of STAGES) {
      const plan = planFor(stage, [
        "Pitching brands cold",
        "Diversifying monetization",
        "Marketplace scouting",
        "Complex content arcs",
      ]);
      expect(
        assertSkillRespectsGrowthPlan("growth-coach", plan).blocked
      ).toBe(false);
    }
  });

  it("scaling-stage typical antiPatterns (deal volume, posting outside niche) do NOT block monetization-diversifier", () => {
    // The scaling-stage example antiPatterns from the synthesis prompt:
    // "Saying yes to every brand", "Posting outside core niche", "Micro-managing the queue"
    // None of these contain monetization-diversifier keywords, so the diversifier
    // remains permitted.
    const plan = planFor("scaling", [
      "Saying yes to every brand",
      "Posting outside core niche",
      "Micro-managing the queue",
    ]);
    expect(
      assertSkillRespectsGrowthPlan("monetization-diversifier", plan).blocked
    ).toBe(false);
  });
});

describe("anti-sycophancy in deferral messages", () => {
  // The deferral messages must explain WHY (cite the stage) rather than
  // platitude. These are negative-pattern checks.
  const NEVER_USE_PHRASES = [
    "you're amazing",
    "you're crushing it",
    "great job",
    "killing it",
  ];

  it("none of the per-stage messages contain sycophantic phrases", () => {
    const DOMAINS: ReadonlyArray<SkillDomain> = [
      "brand-outreach",
      "brand-pitch-strategy",
      "monetization-diversifier",
      "collab-matchmaker",
      "opportunity-scout",
      "rate-calculator",
      "content-arc-planner",
    ];
    const STAGES: ReadonlyArray<CareerStage> = [
      "just-starting",
      "building",
      "monetizing",
      "scaling",
    ];
    for (const domain of DOMAINS) {
      for (const stage of STAGES) {
        const plan = planFor(stage, [keywordForDomain(domain)]);
        const result = assertSkillRespectsGrowthPlan(domain, plan);
        if (!result.blocked) continue;
        const lower = (result.deferralMessage ?? "").toLowerCase();
        for (const phrase of NEVER_USE_PHRASES) {
          expect(lower.includes(phrase)).toBe(false);
        }
      }
    }
  });
});

/**
 * Pick a representative anti-pattern keyword that triggers the domain so the
 * sycophancy test can iterate the full grid without needing the specific
 * keyword catalog imported. Mirrors the catalog in growthPlanGuard.ts.
 */
function keywordForDomain(domain: SkillDomain): string {
  switch (domain) {
    case "brand-outreach":
    case "brand-pitch-strategy":
      return "pitching brands cold";
    case "monetization-diversifier":
      return "diversifying monetization";
    case "collab-matchmaker":
      return "collab partnerships";
    case "opportunity-scout":
      return "marketplace prospecting";
    case "rate-calculator":
      return "setting rates artificially";
    case "growth-coach":
      // Will never block, but provide a token.
      return "n/a";
    case "content-arc-planner":
      return "complex content arcs";
  }
}

/* -------------------------------------------------------------------------- */
/* Wave 2 — routeViaGrowthPlan + smartAlternative routing                     */
/* -------------------------------------------------------------------------- */

describe("Wave 2 — routeViaGrowthPlan", () => {
  it("returns mode='proceed' when no plan", () => {
    const r = routeViaGrowthPlan("brand-outreach", null);
    expect(r.mode).toBe("proceed");
    expect(r.smartAlternative).toBeNull();
    expect(r.matchedAntiPattern).toBeNull();
  });

  it("returns mode='proceed' when no antiPattern matches the domain", () => {
    const plan = planForWithAlternatives("building", [
      {
        antiPattern: "Posting outside your niche",
        insteadDoThis: "Stay in niche",
        exampleAction: "Maya runs an in-niche content arc",
        reasoning: "Compounds inside niche",
      },
      {
        antiPattern: "Multi-platform splits early",
        insteadDoThis: "Lock one platform first",
        exampleAction: "Maya proposes a 4-week single-platform arc",
        reasoning: "Single-platform consistency compounds",
      },
    ]);
    const r = routeViaGrowthPlan("brand-outreach", plan);
    expect(r.mode).toBe("proceed");
    expect(r.smartAlternative).toBeNull();
  });

  it("returns mode='smartAlternative' when a paired alternative exists", () => {
    const plan = planForWithAlternatives("just-starting", [
      {
        antiPattern: "Pitching brands cold before niche is clear",
        insteadDoThis:
          "Pitch local + small businesses in your niche near your city",
        exampleAction:
          "Maya scouts 3-5 local fitness brands within 25mi and drafts spec piece offers",
        reasoning: "Small brands close at 60% at your size; nationals close <2%",
      },
    ]);
    const r = routeViaGrowthPlan("brand-outreach", plan);
    expect(r.mode).toBe("smartAlternative");
    expect(r.smartAlternative).not.toBeNull();
    expect(r.smartAlternative!.exampleAction).toMatch(/local fitness brands/);
    expect(r.matchedAntiPattern).toMatch(/Pitching brands cold/);
    expect(r.stage).toBe("just-starting");
  });

  it("returns mode='proceed' when antiPattern matches but no smartAlternative is paired (legacy plan)", () => {
    // No smartAlternatives at all — legacy plan path.
    const plan = planFor("just-starting", ["Pitching brands cold"]);
    const r = routeViaGrowthPlan("brand-outreach", plan);
    expect(r.mode).toBe("proceed");
    expect(r.smartAlternative).toBeNull();
    expect(r.matchedAntiPattern).toBe("Pitching brands cold");
    expect(r.stage).toBe("just-starting");
  });
});

describe("Wave 2 — assertSkillRespectsGrowthPlan never hard-blocks when smartAlternative present", () => {
  it("returns blocked=false even when antiPattern matches IF a smartAlternative is paired", () => {
    const plan = planForWithAlternatives("just-starting", [
      {
        antiPattern: "Pitching brands cold before niche is clear",
        insteadDoThis: "Pitch local",
        exampleAction: "Maya scouts local",
        reasoning: "calibrated",
      },
    ]);
    const result = assertSkillRespectsGrowthPlan("brand-outreach", plan);
    expect(result.blocked).toBe(false);
    expect(result.stage).toBe("just-starting");
  });

  it("returns blocked=true (legacy) when antiPattern matches AND no smartAlternative is paired", () => {
    const plan = planFor("just-starting", ["Pitching brands cold"]);
    const result = assertSkillRespectsGrowthPlan("brand-outreach", plan);
    expect(result.blocked).toBe(true);
    expect(result.deferralMessage).not.toBeNull();
  });
});

describe("Wave 2 — growthPlanPromptSuffix routes to smartAlternative", () => {
  it("includes the ROUTE TO THIS SMART ALTERNATIVE block when one is provided", () => {
    const plan = planForWithAlternatives("just-starting", [
      {
        // Must contain a "brand-outreach" domain keyword (e.g. "pitching brands").
        antiPattern: "Pitching brands cold before niche is clear",
        insteadDoThis:
          "Pitch local + small businesses in your niche near your city",
        exampleAction:
          "Maya scouts 3-5 local fitness brands within 25mi and drafts spec offers",
        reasoning: "Small brands close at 60% at your size",
      },
    ]);
    const route = routeViaGrowthPlan("brand-outreach", plan);
    const suffix = growthPlanPromptSuffix(plan, {
      smartAlternative: route.smartAlternative,
    });
    expect(suffix).toMatch(/ROUTE TO THIS SMART ALTERNATIVE/);
    expect(suffix).toMatch(/DO NOT REFUSE/);
    expect(suffix).toMatch(/local fitness brands/);
    expect(suffix).toMatch(/INSTEAD DO THIS/);
    expect(suffix).toMatch(/EXAMPLE ACTION/);
  });

  it("DOES NOT include the route block when no smartAlternative is provided", () => {
    const plan = planFor("building", ["unrelated anti"]);
    const suffix = growthPlanPromptSuffix(plan);
    expect(suffix).not.toMatch(/ROUTE TO THIS SMART ALTERNATIVE/);
    expect(suffix).toMatch(/Maya is opinionated, never refusing/);
  });

  it("surfaces all paired smartAlternatives in the prompt body when present (any matched or not)", () => {
    const plan = planForWithAlternatives("monetizing", [
      {
        antiPattern: "Saying yes to every brand deal",
        insteadDoThis: "Filter against floor + niche fit",
        exampleAction: "Maya raises auto-decline floor",
        reasoning: "Selectivity protects rate",
      },
      {
        antiPattern: "Posting outside core niche",
        insteadDoThis: "Stay in niche",
        exampleAction: "Maya runs an in-niche content arc",
        reasoning: "Niche compounds",
      },
    ]);
    const suffix = growthPlanPromptSuffix(plan);
    expect(suffix).toMatch(/Smart alternatives/);
    expect(suffix).toMatch(/Filter against floor/);
    expect(suffix).toMatch(/Stay in niche/);
    expect(suffix).toMatch(/INSTEAD:/);
    expect(suffix).toMatch(/EXAMPLE:/);
  });
});

describe("Wave 2 — anti-paternalism contract", () => {
  // The Wave 2 product principle: Maya is opinionated, never gatekeeper. Every
  // antiPattern with a paired smartAlternative routes to the alternative.
  it("for ALL stages × ALL skills with a paired smartAlternative: assertSkillRespectsGrowthPlan never returns blocked=true", () => {
    const STAGES: ReadonlyArray<CareerStage> = [
      "just-starting",
      "building",
      "monetizing",
      "scaling",
    ];
    const DOMAINS_THAT_BLOCK_LEGACY: ReadonlyArray<SkillDomain> = [
      "brand-outreach",
      "brand-pitch-strategy",
      "monetization-diversifier",
      "collab-matchmaker",
      "opportunity-scout",
    ];
    for (const stage of STAGES) {
      for (const domain of DOMAINS_THAT_BLOCK_LEGACY) {
        const keyword = keywordForDomain(domain);
        const plan = planForWithAlternatives(stage, [
          {
            antiPattern: keyword,
            insteadDoThis: "stage-appropriate alternative",
            exampleAction: "Maya does X concretely",
            reasoning: "calibrated",
          },
          {
            antiPattern: "secondary anti",
            insteadDoThis: "secondary alt",
            exampleAction: "Maya does Y",
            reasoning: "calibrated 2",
          },
        ]);
        const result = assertSkillRespectsGrowthPlan(domain, plan);
        expect(result.blocked).toBe(false);
      }
    }
  });
});
