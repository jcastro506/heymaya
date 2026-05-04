/**
 * planFeatures matrix — REVISED 2026-04-26.
 *
 * This file is the documentation of the locked plan-tier matrix. It reads
 * top-to-bottom as a per-field × per-tier assertion grid; if anyone changes
 * `convex/lib/planFeatures.ts` and forgets to update this file, the diff is
 * the audit trail.
 *
 * Tier philosophy (kept verbatim with the source-of-truth header):
 *   1. Channels are OpenClaw-native — no per-tier cost. Every plan gets
 *      every channel.
 *   2. Composio Gmail is a small per-call cost but the headline value prop —
 *      every plan gets the deal desk.
 *   3. Apollo / Hunter ARE real per-query paid lookups — Studio-only.
 *   4. Differentiation moves to where actual scaling cost lives:
 *      thinking budget, chat-turn cap, multi-account slots, max handles,
 *      post-publish reaction latency, allowedProviders (apollo/hunter),
 *      brandContactDiscoveryEnabled.
 *
 * Five mandatory test categories (see
 * /Users/joshcastro/.claude/projects/.../memory/feedback_validation_gap_prevention.md):
 *   1. Cross-tenant — N/A here directly (planFeatures is pure); the
 *      cross-tenant integration tests in convex/__tests__/* exercise the
 *      gate downstream.
 *   2. Plan-tier × action matrix — every field × every tier explicitly
 *      asserted below.
 *   3. Adversarial — invalid plan input throws PlanGateError (fail-closed).
 *   4. Sibling-file scan — sprint1Acceptance.test.ts cross-checks the
 *      channel + provider helpers; this file does NOT replace it.
 *   5. TODO grep — no TODOs introduced.
 */

import { describe, it, expect } from "vitest";
import {
  planFeatures,
  thinkingBudgetAllowed,
  clampThinkingBudget,
  channelAllowed,
  providerAllowed,
  requireFeature,
  PlanGateError,
  type Plan,
  type ThinkingBudget,
  type Channel,
  type Provider,
  type PlanFeatures,
} from "../planFeatures";

const PLANS: ReadonlyArray<Plan> = ["starter", "pro", "studio"];

/* -------------------------------------------------------------------------- */
/* Per-field × per-tier matrix                                                 */
/* -------------------------------------------------------------------------- */

describe("planFeatures matrix — REVISED 2026-04-26", () => {
  describe("maxHandles", () => {
    it.each<[Plan, number]>([
      ["starter", 1],
      ["pro", 3],
      ["studio", 5],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).maxHandles).toBe(expected);
    });
  });

  describe("allowedChannels — UNGATED (channels are OpenClaw-native; telegram added 2026-05-03)", () => {
    const ALL: ReadonlyArray<Channel> = ["web", "sms", "imessage", "whatsapp", "telegram"];
    for (const plan of PLANS) {
      it(`${plan} includes all 5 channels`, () => {
        const f = planFeatures({ plan });
        for (const ch of ALL) {
          expect(f.allowedChannels).toContain(ch);
        }
        expect(f.allowedChannels.length).toBe(5);
      });
    }
  });

  describe("maxThinkingBudget — cost lever STAYS (Starter clamped to low)", () => {
    it.each<[Plan, ThinkingBudget]>([
      ["starter", "low"],
      ["pro", "high"],
      ["studio", "high"],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).maxThinkingBudget).toBe(expected);
    });
  });

  describe("allowedThinkingBudgets", () => {
    it("starter = none, low only", () => {
      expect(planFeatures({ plan: "starter" }).allowedThinkingBudgets).toEqual([
        "none",
        "low",
      ]);
    });
    it.each<Plan>(["pro", "studio"])("%s = all four", (plan) => {
      expect(planFeatures({ plan }).allowedThinkingBudgets).toEqual([
        "none",
        "low",
        "medium",
        "high",
      ]);
    });
  });

  describe("chatTurnsPerMonth — cost lever STAYS", () => {
    it.each<[Plan, number | "unlimited"]>([
      ["starter", 200],
      ["pro", "unlimited"],
      ["studio", "unlimited"],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).chatTurnsPerMonth).toBe(expected);
    });
  });

  describe("proactiveCronAll — Starter limited cron, Pro/Studio full set", () => {
    it.each<[Plan, boolean]>([
      ["starter", false],
      ["pro", true],
      ["studio", true],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).proactiveCronAll).toBe(expected);
    });
  });

  describe("gmailDealDeskEnabled — UNGATED (universal)", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).gmailDealDeskEnabled).toBe(true);
      });
    }
  });

  describe("competitorWatchSlots — Starter gets a small slot count, not zero", () => {
    it.each<[Plan, number]>([
      ["starter", 2],
      ["pro", 5],
      ["studio", 10],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).competitorWatchSlots).toBe(expected);
    });
  });

  describe("readinessPacketCadence", () => {
    it.each<[Plan, "none" | "quarterly" | "on-demand"]>([
      ["starter", "none"],
      ["pro", "quarterly"],
      ["studio", "on-demand"],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).readinessPacketCadence).toBe(expected);
    });
  });

  describe("brandOutreachEnabled — UNGATED (Maya pitches at every tier)", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).brandOutreachEnabled).toBe(true);
      });
    }
  });

  describe("brandContactDiscoveryEnabled — Studio only (paid Apollo/Hunter lookups)", () => {
    it.each<[Plan, boolean]>([
      ["starter", false],
      ["pro", false],
      ["studio", true],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).brandContactDiscoveryEnabled).toBe(expected);
    });
  });

  describe("opportunityScoutEnabled — UNGATED", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).opportunityScoutEnabled).toBe(true);
      });
    }
  });

  describe("monetizationAdvisorEnabled — UNGATED", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).monetizationAdvisorEnabled).toBe(true);
      });
    }
  });

  describe("collabMatchEnabled — UNGATED", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).collabMatchEnabled).toBe(true);
      });
    }
  });

  describe("multiAccountSlots — cost lever STAYS (Starter/Pro 1, Studio 3)", () => {
    it.each<[Plan, number]>([
      ["starter", 1],
      ["pro", 1],
      ["studio", 3],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).multiAccountSlots).toBe(expected);
    });
  });

  describe("postPublishReactionLatencySec — cost lever STAYS (tightens with tier)", () => {
    it.each<[Plan, number]>([
      ["starter", 1800],
      ["pro", 600],
      ["studio", 300],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).postPublishReactionLatencySec).toBe(expected);
    });

    it("monotonically tightens with tier", () => {
      const s = planFeatures({ plan: "starter" }).postPublishReactionLatencySec;
      const p = planFeatures({ plan: "pro" }).postPublishReactionLatencySec;
      const st = planFeatures({ plan: "studio" }).postPublishReactionLatencySec;
      expect(s).toBeGreaterThan(p);
      expect(p).toBeGreaterThan(st);
    });
  });

  describe("allowedProviders — gmail/calendar/stripe UNGATED; apollo/hunter Studio-only", () => {
    const expected: Record<Plan, Record<Provider, boolean>> = {
      starter: { gmail: true, calendar: true, stripe: true, apollo: false, hunter: false },
      pro:     { gmail: true, calendar: true, stripe: true, apollo: false, hunter: false },
      studio:  { gmail: true, calendar: true, stripe: true, apollo: true,  hunter: true  },
    };
    const ALL_PROVIDERS: ReadonlyArray<Provider> = [
      "gmail",
      "calendar",
      "stripe",
      "apollo",
      "hunter",
    ];
    for (const plan of PLANS) {
      for (const provider of ALL_PROVIDERS) {
        const want = expected[plan][provider];
        it(`${plan}.${provider} = ${want}`, () => {
          expect(planFeatures({ plan }).allowedProviders.includes(provider)).toBe(
            want
          );
        });
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Helper functions                                                            */
/* -------------------------------------------------------------------------- */

describe("thinkingBudgetAllowed", () => {
  const cases: Record<Plan, Record<ThinkingBudget, boolean>> = {
    starter: { none: true, low: true, medium: false, high: false },
    pro:     { none: true, low: true, medium: true,  high: true  },
    studio:  { none: true, low: true, medium: true,  high: true  },
  };
  for (const plan of PLANS) {
    for (const budget of ["none", "low", "medium", "high"] as const) {
      const expected = cases[plan][budget];
      it(`${plan}/${budget} = ${expected}`, () => {
        expect(thinkingBudgetAllowed({ plan }, budget)).toBe(expected);
      });
    }
  }
});

describe("clampThinkingBudget", () => {
  const cases: Record<Plan, Record<ThinkingBudget, ThinkingBudget>> = {
    starter: { none: "none", low: "low", medium: "low",    high: "low"    },
    pro:     { none: "none", low: "low", medium: "medium", high: "high"   },
    studio:  { none: "none", low: "low", medium: "medium", high: "high"   },
  };
  for (const plan of PLANS) {
    for (const budget of ["none", "low", "medium", "high"] as const) {
      const expected = cases[plan][budget];
      it(`${plan} requesting ${budget} -> ${expected}`, () => {
        expect(clampThinkingBudget({ plan }, budget)).toBe(expected);
      });
    }
  }
});

describe("channelAllowed", () => {
  // Channels are universally allowed under the revised matrix.
  for (const plan of PLANS) {
    for (const ch of ["web", "sms", "imessage", "whatsapp"] as const) {
      it(`${plan}/${ch} = true`, () => {
        expect(channelAllowed({ plan }, ch)).toBe(true);
      });
    }
  }
});

describe("providerAllowed", () => {
  it("starter + pro: apollo and hunter rejected", () => {
    for (const plan of ["starter", "pro"] as const) {
      expect(providerAllowed({ plan }, "apollo")).toBe(false);
      expect(providerAllowed({ plan }, "hunter")).toBe(false);
      // gmail / calendar / stripe accepted on every tier
      expect(providerAllowed({ plan }, "gmail")).toBe(true);
      expect(providerAllowed({ plan }, "calendar")).toBe(true);
      expect(providerAllowed({ plan }, "stripe")).toBe(true);
    }
  });
  it("studio: every provider accepted", () => {
    for (const provider of [
      "gmail",
      "calendar",
      "stripe",
      "apollo",
      "hunter",
    ] as const) {
      expect(providerAllowed({ plan: "studio" }, provider)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* requireFeature + PlanGateError contract                                     */
/* -------------------------------------------------------------------------- */

describe("requireFeature", () => {
  it("does NOT throw when predicate passes", () => {
    expect(() =>
      requireFeature(
        { plan: "starter" },
        (f) => f.gmailDealDeskEnabled,
        "gmail-dealdesk",
        "starter"
      )
    ).not.toThrow();
  });

  it("throws PlanGateError when predicate fails", () => {
    expect(() =>
      requireFeature(
        { plan: "starter" },
        (f) => f.brandContactDiscoveryEnabled,
        "brand-contact-discovery",
        "studio"
      )
    ).toThrow(PlanGateError);
  });

  it("PlanGateError carries plan / attemptedFeature / requiredPlan", () => {
    let caught: PlanGateError | null = null;
    try {
      requireFeature(
        { plan: "starter" },
        (f) => f.brandContactDiscoveryEnabled,
        "apollo-lookup",
        "studio"
      );
    } catch (err) {
      caught = err as PlanGateError;
    }
    expect(caught).toBeInstanceOf(PlanGateError);
    expect(caught?.plan).toBe("starter");
    expect(caught?.attemptedFeature).toBe("apollo-lookup");
    expect(caught?.requiredPlan).toBe("studio");
    // Message is descriptive
    expect(caught?.message).toMatch(/starter/);
    expect(caught?.message).toMatch(/apollo-lookup/);
    expect(caught?.message).toMatch(/studio/);
  });
});

/* -------------------------------------------------------------------------- */
/* Adversarial: invalid plan field                                             */
/* -------------------------------------------------------------------------- */

describe("planFeatures — adversarial inputs", () => {
  it("throws PlanGateError when plan is an unknown string (fail-closed)", () => {
    // The Doc<creators>.plan column is a typed union, but defense-in-depth:
    // if a row is corrupted (or a future migration adds a new tier), the
    // helper must NOT silently fall through to "no gate."
    expect(() =>
      planFeatures({ plan: "enterprise" as unknown as Plan })
    ).toThrow(PlanGateError);
  });

  it("throws when plan is empty string", () => {
    expect(() =>
      planFeatures({ plan: "" as unknown as Plan })
    ).toThrow(PlanGateError);
  });

  it("throws when plan is undefined", () => {
    expect(() =>
      planFeatures({ plan: undefined as unknown as Plan })
    ).toThrow(PlanGateError);
  });
});

/* -------------------------------------------------------------------------- */
/* Type contract — every PlanFeatures field is present on every tier           */
/* -------------------------------------------------------------------------- */

describe("PlanFeatures shape — sibling-file safety", () => {
  // If someone adds a new field to PlanFeatures and forgets to populate it
  // for one of the tiers, the TS strict check should already complain at
  // compile time. This belt-and-suspenders runtime check also fires if the
  // field accidentally lands as undefined via a `...spread` that omits it.
  const REQUIRED_KEYS: ReadonlyArray<keyof PlanFeatures> = [
    "plan",
    "maxHandles",
    "allowedChannels",
    "maxThinkingBudget",
    "allowedThinkingBudgets",
    "chatTurnsPerMonth",
    "proactiveCronAll",
    "gmailDealDeskEnabled",
    "competitorWatchSlots",
    "readinessPacketCadence",
    "brandOutreachEnabled",
    "brandContactDiscoveryEnabled",
    "opportunityScoutEnabled",
    "monetizationAdvisorEnabled",
    "collabMatchEnabled",
    "multiAccountSlots",
    "postPublishReactionLatencySec",
    "allowedProviders",
  ];

  for (const plan of PLANS) {
    it(`${plan} populates every PlanFeatures key`, () => {
      const f = planFeatures({ plan }) as unknown as Record<string, unknown>;
      for (const key of REQUIRED_KEYS) {
        expect(
          f[key],
          `missing key '${key}' on ${plan}`
        ).not.toBeUndefined();
      }
    });
  }
});
