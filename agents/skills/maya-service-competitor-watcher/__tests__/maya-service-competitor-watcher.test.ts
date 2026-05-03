import { describe, it, expect, vi } from "vitest";
import {
  watchCompetitors,
  SKILL_METADATA,
  __test__,
  type CompetitorWatcherInputs,
  type LlmCaller,
} from "../script";

const baseInputs: CompetitorWatcherInputs = {
  namedCompetitors: [
    { name: "Lincoln HVAC Co", gbpPlaceId: "gbp_lhc" },
    { name: "Husker Heating", gbpPlaceId: "gbp_hh" },
    { name: "Capital Air", gbpPlaceId: "gbp_ca" },
  ],
  lastSweep: {
    sweepAt: 1_700_000_000_000,
    competitorSnapshots: [
      {
        gbpPlaceId: "gbp_lhc",
        rating: 4.6,
        reviewCount: 120,
        lastPostAt: 1_699_900_000_000,
        visibleOffers: ["$99 tune-up"],
      },
      {
        gbpPlaceId: "gbp_hh",
        rating: 4.4,
        reviewCount: 80,
        lastPostAt: null,
        visibleOffers: [],
      },
      {
        gbpPlaceId: "gbp_ca",
        rating: 4.5,
        reviewCount: 200,
        lastPostAt: 1_699_800_000_000,
        visibleOffers: [],
      },
    ],
  },
  currentSweep: {
    sweepAt: 1_700_604_800_000,
    competitorSnapshots: [
      {
        gbpPlaceId: "gbp_lhc",
        rating: 4.3, // dropped 0.3 — should flag
        reviewCount: 130, // surge: 130 - 120 = 10, > 1.25x = 150? no — 120*1.25 = 150, 130 < 150, NO surge
        lastPostAt: 1_700_500_000_000,
        visibleOffers: ["$99 tune-up", "Free filter"],
      },
      {
        gbpPlaceId: "gbp_hh",
        rating: 4.4,
        reviewCount: 80,
        lastPostAt: 1_700_500_000_000, // resumed posting
        visibleOffers: [],
      },
      {
        gbpPlaceId: "gbp_ca",
        rating: 4.5,
        reviewCount: 200,
        lastPostAt: 1_700_500_000_000,
        visibleOffers: [],
        suspended: true,
      },
    ],
  },
};

describe("maya-service-competitor-watcher — contract", () => {
  it("declares Flash Lite + LOW + Pro+", () => {
    expect(SKILL_METADATA.modelTarget).toBe("gemini-3.1-flash-lite");
    expect(SKILL_METADATA.thinkingBudget).toBe("low");
    expect(SKILL_METADATA.planTier).toEqual(["pro", "studio"]);
  });
});

describe("maya-service-competitor-watcher — happy path", () => {
  it("detects rating-drop, new-promo, cadence-spike, suspended", async () => {
    const out = await watchCompetitors(baseInputs);
    const kinds = out.flags.map((f) => f.kind);
    expect(kinds).toContain("rating-drop");
    expect(kinds).toContain("new-promo");
    expect(kinds).toContain("cadence-spike");
    expect(kinds).toContain("suspended");
  });

  it("uses LLM for prosification when provided", async () => {
    const llm: LlmCaller = vi.fn(
      async () =>
        "Lincoln HVAC dropped to 4.3 stars and started running a free-filter promo. Husker Heating resumed posting. Capital Air listing is suspended."
    );
    const out = await watchCompetitors(baseInputs, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(out.digestProse).toContain("Lincoln HVAC");
  });

  it("citation manifest includes both sweeps for each competitor", async () => {
    const out = await watchCompetitors(baseInputs);
    const placesInManifest = new Set(
      out.citationManifest.map((c) => c.gbpPlaceId)
    );
    expect(placesInManifest.has("gbp_lhc")).toBe(true);
    expect(placesInManifest.has("gbp_hh")).toBe(true);
    expect(placesInManifest.has("gbp_ca")).toBe(true);
    const lhcRefs = out.citationManifest.filter(
      (c) => c.gbpPlaceId === "gbp_lhc"
    );
    expect(lhcRefs.some((r) => r.sweepRef === "last")).toBe(true);
    expect(lhcRefs.some((r) => r.sweepRef === "current")).toBe(true);
  });
});

describe("maya-service-competitor-watcher — adversarial / edge cases", () => {
  it("suspended competitor: flagged 'suspended' + dropped from regular flags", async () => {
    const out = await watchCompetitors(baseInputs);
    const caFlags = out.flags.filter((f) => f.competitorName === "Capital Air");
    expect(caFlags).toHaveLength(1);
    expect(caFlags[0].kind).toBe("suspended");
  });

  it("returns 'no-change' if every competitor is unchanged", async () => {
    const out = await watchCompetitors({
      ...baseInputs,
      currentSweep: baseInputs.lastSweep,
    });
    expect(out.flags.every((f) => f.kind === "no-change")).toBe(true);
    expect(out.digestProse).toContain("Quiet week");
  });

  it("missing prev snapshot for a non-suspended competitor produces no-change (no false positives)", async () => {
    const out = await watchCompetitors({
      namedCompetitors: [{ name: "NewComp", gbpPlaceId: "gbp_new" }],
      lastSweep: { sweepAt: 0, competitorSnapshots: [] },
      currentSweep: {
        sweepAt: 1,
        competitorSnapshots: [
          {
            gbpPlaceId: "gbp_new",
            rating: 4.5,
            reviewCount: 50,
            lastPostAt: null,
            visibleOffers: [],
          },
        ],
      },
    });
    expect(out.flags.every((f) => f.kind === "no-change")).toBe(true);
  });

  it("never invents a competitor not in input list (citation enforcement)", async () => {
    // Even with empty snapshots, output should never reference
    // competitors that are NOT in namedCompetitors.
    const out = await watchCompetitors({
      namedCompetitors: [{ name: "OnlyOne", gbpPlaceId: "gbp_only" }],
      lastSweep: { sweepAt: 0, competitorSnapshots: [] },
      currentSweep: { sweepAt: 1, competitorSnapshots: [] },
    });
    const allowedNames = new Set(["OnlyOne"]);
    for (const f of out.flags) {
      expect(allowedNames.has(f.competitorName)).toBe(true);
    }
  });
});

describe("maya-service-competitor-watcher — cross-tenant safety", () => {
  it("Business A's competitors never appear when given Business B inputs", async () => {
    const businessA = await watchCompetitors({
      namedCompetitors: [{ name: "A's Rival", gbpPlaceId: "a_rival" }],
      lastSweep: { sweepAt: 0, competitorSnapshots: [] },
      currentSweep: { sweepAt: 1, competitorSnapshots: [] },
    });
    const businessB = await watchCompetitors({
      namedCompetitors: [{ name: "B's Rival", gbpPlaceId: "b_rival" }],
      lastSweep: { sweepAt: 0, competitorSnapshots: [] },
      currentSweep: { sweepAt: 1, competitorSnapshots: [] },
    });
    for (const f of businessA.flags) {
      expect(f.competitorName).not.toBe("B's Rival");
    }
    for (const f of businessB.flags) {
      expect(f.competitorName).not.toBe("A's Rival");
    }
  });
});

describe("maya-service-competitor-watcher — sibling-file scan", () => {
  it("script never throws Sprint 3 stub error", async () => {
    await expect(watchCompetitors(baseInputs)).resolves.toBeDefined();
  });
});

describe("maya-service-competitor-watcher — diff helper", () => {
  it("rating delta < 0.2 does not flag", () => {
    const out = __test__.diffOne(
      "X",
      {
        gbpPlaceId: "x",
        rating: 4.6,
        reviewCount: 100,
        lastPostAt: null,
        visibleOffers: [],
      },
      {
        gbpPlaceId: "x",
        rating: 4.5,
        reviewCount: 100,
        lastPostAt: null,
        visibleOffers: [],
      }
    );
    expect(out.every((f) => f.kind === "no-change")).toBe(true);
  });
});
