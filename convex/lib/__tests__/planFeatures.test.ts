/**
 * planFeatures matrix — REVISED 2026-05-04 (coach / manager migration).
 *
 * The creator product moved from a 3-tier (starter / pro / studio) model to a
 * 2-tier (coach / manager) model. Tier boundary is AUTONOMY ON THE CREATOR'S
 * BEHALF, not breadth — Coach is advisory-only, Manager is autonomous.
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

const PLANS: ReadonlyArray<Plan> = ["coach", "manager"];

/* -------------------------------------------------------------------------- */
/* Per-field × per-tier matrix                                                 */
/* -------------------------------------------------------------------------- */

describe("planFeatures matrix — coach / manager", () => {
  describe("maxHandles — UNGATED (both tiers reach all 5 platforms)", () => {
    it.each<[Plan, number]>([
      ["coach", 5],
      ["manager", 5],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).maxHandles).toBe(expected);
    });
  });

  describe("allowedChannels — UNGATED (channels are OpenClaw-native)", () => {
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

  describe("maxThinkingBudget — UNGATED (boundary is autonomy, not compute)", () => {
    it.each<[Plan, ThinkingBudget]>([
      ["coach", "high"],
      ["manager", "high"],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).maxThinkingBudget).toBe(expected);
    });
  });

  describe("allowedThinkingBudgets — UNGATED (both tiers get all four)", () => {
    for (const plan of PLANS) {
      it(`${plan} = all four`, () => {
        expect(planFeatures({ plan }).allowedThinkingBudgets).toEqual([
          "none",
          "low",
          "medium",
          "high",
        ]);
      });
    }
  });

  describe("chatTurnsPerMonth — Coach capped, Manager unlimited", () => {
    it.each<[Plan, number | "unlimited"]>([
      ["coach", 400],
      ["manager", "unlimited"],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).chatTurnsPerMonth).toBe(expected);
    });
  });

  describe("proactiveCronAll — both tiers run the full set", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).proactiveCronAll).toBe(true);
      });
    }
  });

  describe("gmailDealDeskEnabled — UNGATED (Coach drafts; Manager auto-sends)", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).gmailDealDeskEnabled).toBe(true);
      });
    }
  });

  describe("competitorWatchSlots — Coach: 5, Manager: 10", () => {
    it.each<[Plan, number]>([
      ["coach", 5],
      ["manager", 10],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).competitorWatchSlots).toBe(expected);
    });
  });

  describe("readinessPacketCadence", () => {
    it.each<[Plan, "none" | "quarterly" | "on-demand"]>([
      ["coach", "quarterly"],
      ["manager", "on-demand"],
    ])("%s = %s", (plan, expected) => {
      expect(planFeatures({ plan }).readinessPacketCadence).toBe(expected);
    });
  });

  describe("autonomy gates — the load-bearing tier boundary", () => {
    describe("canAutoSendBrandEmails", () => {
      it("coach = false", () => {
        expect(planFeatures({ plan: "coach" }).canAutoSendBrandEmails).toBe(false);
      });
      it("manager = true", () => {
        expect(planFeatures({ plan: "manager" }).canAutoSendBrandEmails).toBe(true);
      });
    });

    describe("canDoBrandOutreach", () => {
      it("coach = false", () => {
        expect(planFeatures({ plan: "coach" }).canDoBrandOutreach).toBe(false);
      });
      it("manager = true", () => {
        expect(planFeatures({ plan: "manager" }).canDoBrandOutreach).toBe(true);
      });
    });

    describe("canPitchBrands", () => {
      it("coach = false", () => {
        expect(planFeatures({ plan: "coach" }).canPitchBrands).toBe(false);
      });
      it("manager = true", () => {
        expect(planFeatures({ plan: "manager" }).canPitchBrands).toBe(true);
      });
    });

    describe("brandOutreachEnabled (back-compat alias of canPitchBrands)", () => {
      it("coach = false", () => {
        expect(planFeatures({ plan: "coach" }).brandOutreachEnabled).toBe(false);
      });
      it("manager = true", () => {
        expect(planFeatures({ plan: "manager" }).brandOutreachEnabled).toBe(true);
      });
    });

    describe("brandContactDiscoveryEnabled (Apollo/Hunter)", () => {
      it("coach = false", () => {
        expect(planFeatures({ plan: "coach" }).brandContactDiscoveryEnabled).toBe(false);
      });
      it("manager = true", () => {
        expect(planFeatures({ plan: "manager" }).brandContactDiscoveryEnabled).toBe(true);
      });
    });
  });

  describe("opportunityScoutEnabled — UNGATED (read-only)", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).opportunityScoutEnabled).toBe(true);
      });
    }
  });

  describe("monetizationAdvisorEnabled — UNGATED (read-only)", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).monetizationAdvisorEnabled).toBe(true);
      });
    }
  });

  describe("collabMatchEnabled — UNGATED (read-only)", () => {
    for (const plan of PLANS) {
      it(`${plan} = true`, () => {
        expect(planFeatures({ plan }).collabMatchEnabled).toBe(true);
      });
    }
  });

  describe("multiAccountSlots — both tiers cap at 1 (multi-account deferred to a later release)", () => {
    it.each<[Plan, number]>([
      ["coach", 1],
      ["manager", 1],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).multiAccountSlots).toBe(expected);
    });
  });

  describe("postPublishReactionLatencySec — tighter on Manager", () => {
    it.each<[Plan, number]>([
      ["coach", 600],
      ["manager", 300],
    ])("%s = %d", (plan, expected) => {
      expect(planFeatures({ plan }).postPublishReactionLatencySec).toBe(expected);
    });

    it("monotonically tightens with tier", () => {
      const c = planFeatures({ plan: "coach" }).postPublishReactionLatencySec;
      const m = planFeatures({ plan: "manager" }).postPublishReactionLatencySec;
      expect(c).toBeGreaterThan(m);
    });
  });

  describe("allowedProviders — gmail/calendar/stripe ungated; paid/action providers Manager-only", () => {
    const expected: Record<Plan, Record<Provider, boolean>> = {
      coach: {
        gmail: true,
        calendar: true,
        stripe: true,
        apollo: false,
        hunter: false,
        linkedin: false,
        twitter: false,
      },
      manager: {
        gmail: true,
        calendar: true,
        stripe: true,
        apollo: true,
        hunter: true,
        linkedin: true,
        twitter: true,
      },
    };
    const ALL_PROVIDERS: ReadonlyArray<Provider> = [
      "gmail",
      "calendar",
      "stripe",
      "apollo",
      "hunter",
      "linkedin",
      "twitter",
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
  // Both tiers allow every budget post-migration (boundary is autonomy, not
  // compute). The helper is preserved for forward-compat.
  const cases: Record<Plan, Record<ThinkingBudget, boolean>> = {
    coach:   { none: true, low: true, medium: true, high: true },
    manager: { none: true, low: true, medium: true, high: true },
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
  // Both tiers allow every budget — clamp is a no-op v0.
  const cases: Record<Plan, Record<ThinkingBudget, ThinkingBudget>> = {
    coach:   { none: "none", low: "low", medium: "medium", high: "high" },
    manager: { none: "none", low: "low", medium: "medium", high: "high" },
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
    for (const ch of ["web", "sms", "imessage", "whatsapp", "telegram"] as const) {
      it(`${plan}/${ch} = true`, () => {
        expect(channelAllowed({ plan }, ch)).toBe(true);
      });
    }
  }
});

describe("providerAllowed", () => {
  it("coach: apollo and hunter rejected; gmail/calendar/stripe accepted", () => {
    expect(providerAllowed({ plan: "coach" }, "apollo")).toBe(false);
    expect(providerAllowed({ plan: "coach" }, "hunter")).toBe(false);
    expect(providerAllowed({ plan: "coach" }, "gmail")).toBe(true);
    expect(providerAllowed({ plan: "coach" }, "calendar")).toBe(true);
    expect(providerAllowed({ plan: "coach" }, "stripe")).toBe(true);
  });
  it("manager: every provider accepted", () => {
    for (const provider of [
      "gmail",
      "calendar",
      "stripe",
      "apollo",
      "hunter",
    ] as const) {
      expect(providerAllowed({ plan: "manager" }, provider)).toBe(true);
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
        { plan: "coach" },
        (f) => f.gmailDealDeskEnabled,
        "gmail-dealdesk",
        "coach"
      )
    ).not.toThrow();
  });

  it("throws PlanGateError when predicate fails", () => {
    expect(() =>
      requireFeature(
        { plan: "coach" },
        (f) => f.brandContactDiscoveryEnabled,
        "brand-contact-discovery",
        "manager"
      )
    ).toThrow(PlanGateError);
  });

  it("PlanGateError carries plan / attemptedFeature / requiredPlan", () => {
    let caught: PlanGateError | null = null;
    try {
      requireFeature(
        { plan: "coach" },
        (f) => f.brandContactDiscoveryEnabled,
        "apollo-lookup",
        "manager"
      );
    } catch (err) {
      caught = err as PlanGateError;
    }
    expect(caught).toBeInstanceOf(PlanGateError);
    expect(caught?.plan).toBe("coach");
    expect(caught?.attemptedFeature).toBe("apollo-lookup");
    expect(caught?.requiredPlan).toBe("manager");
    // Message is descriptive
    expect(caught?.message).toMatch(/coach/);
    expect(caught?.message).toMatch(/apollo-lookup/);
    expect(caught?.message).toMatch(/manager/);
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
      planFeatures({ plan: "starter" as unknown as Plan })
    ).toThrow(PlanGateError);
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
    "canAutoSendBrandEmails",
    "canDoBrandOutreach",
    "canPitchBrands",
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
