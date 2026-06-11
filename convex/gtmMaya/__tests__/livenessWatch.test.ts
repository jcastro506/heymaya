import { describe, expect, it } from "vitest";
import { classifyLiveness } from "../livenessWatch";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

const base = {
  now: NOW,
  killed: false,
  hasFlyApp: true,
  foundationCompletedAt: NOW - 40 * HOUR, // past onboarding + grace
  deployedAt: NOW - 40 * HOUR,
  lastMorningBriefAt: NOW - 2 * HOUR, // fresh brief
  livenessAlertedAt: null,
  recentOperationalSpendUsd: 0.5, // healthy spend
};

describe("classifyLiveness", () => {
  it("returns null for a healthy live agent", () => {
    expect(classifyLiveness(base)).toBeNull();
  });

  it("flags dark_brief when the morning brief missed a full cycle", () => {
    expect(
      classifyLiveness({ ...base, lastMorningBriefAt: NOW - 30 * HOUR })
    ).toBe("dark_brief");
  });

  it("flags dark_brief when no brief ever fired", () => {
    expect(classifyLiveness({ ...base, lastMorningBriefAt: null })).toBe(
      "dark_brief"
    );
  });

  it("flags blind_cost when spend is zero while alive (brief still fresh)", () => {
    expect(
      classifyLiveness({ ...base, recentOperationalSpendUsd: 0 })
    ).toBe("blind_cost");
  });

  it("does NOT flag a freshly-deployed agent inside the grace window", () => {
    expect(
      classifyLiveness({
        ...base,
        deployedAt: NOW - 2 * HOUR,
        foundationCompletedAt: NOW - 2 * HOUR,
        lastMorningBriefAt: null,
        recentOperationalSpendUsd: 0,
      })
    ).toBeNull();
  });

  it("does NOT flag a killed or no-fly-app agent", () => {
    expect(classifyLiveness({ ...base, killed: true, lastMorningBriefAt: null })).toBeNull();
    expect(classifyLiveness({ ...base, hasFlyApp: false, recentOperationalSpendUsd: 0 })).toBeNull();
  });

  it("does NOT flag an agent still in onboarding (no foundationCompletedAt)", () => {
    expect(
      classifyLiveness({ ...base, foundationCompletedAt: null, recentOperationalSpendUsd: 0 })
    ).toBeNull();
  });

  it("dedups — skips an agent alerted within the dedup window", () => {
    expect(
      classifyLiveness({
        ...base,
        lastMorningBriefAt: NOW - 30 * HOUR, // would be dark...
        livenessAlertedAt: NOW - 2 * HOUR, // ...but alerted recently
      })
    ).toBeNull();
  });
});
