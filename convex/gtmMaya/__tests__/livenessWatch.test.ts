import { describe, expect, it } from "vitest";
import { classifyAgentLiveness, classifyLiveness } from "../livenessWatch";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
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

  it("a pre-foundation agent is judged by the stalled-onboarding watch, NOT the dark/blind watches", () => {
    // Within the stall threshold → still healthy (the cold-boot grace).
    expect(
      classifyLiveness({
        ...base,
        foundationCompletedAt: null,
        deployedAt: NOW - 5 * MIN,
        recentOperationalSpendUsd: 0,
      })
    ).toBeNull();
    // Past the threshold with no progress → flagged as a cold-boot stall.
    expect(
      classifyLiveness({
        ...base,
        foundationCompletedAt: null,
        deployedAt: NOW - 40 * MIN,
        recentOperationalSpendUsd: 0,
      })
    ).toBe("stalled_onboarding");
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

// ── GAP 1: stalled-onboarding (cold-boot) detection ──────────────────────────
// A pre-foundation agent (foundationCompletedAt === null) that was deployed but
// never finished onboarding and shows no recent progress.
const onboardingBase = {
  now: NOW,
  killed: false,
  hasFlyApp: true,
  foundationCompletedAt: null as number | null,
  deployedAt: NOW - 40 * MIN, // well past the 25-min stall threshold
  lastMorningBriefAt: null,
  livenessAlertedAt: null,
  recentOperationalSpendUsd: 0,
  lastProgressAt: null as number | null,
};

describe("classifyAgentLiveness — stalled onboarding", () => {
  it("flags STALLED_ONBOARDING: deployed past threshold, no recent progress", () => {
    expect(classifyAgentLiveness(onboardingBase)).toBe("stalled_onboarding");
  });

  it("flags STALLED_ONBOARDING when last progress is older than the progress window", () => {
    expect(
      classifyAgentLiveness({ ...onboardingBase, lastProgressAt: NOW - 30 * MIN })
    ).toBe("stalled_onboarding");
  });

  it("does NOT flag an onboarding agent within the stall threshold", () => {
    expect(
      classifyAgentLiveness({ ...onboardingBase, deployedAt: NOW - 10 * MIN })
    ).toBeNull();
  });

  it("does NOT flag when there is recent onboarding progress (still working)", () => {
    expect(
      classifyAgentLiveness({ ...onboardingBase, lastProgressAt: NOW - 2 * MIN })
    ).toBeNull();
  });

  it("does NOT flag a not-yet-deployed (still provisioning) agent", () => {
    expect(
      classifyAgentLiveness({ ...onboardingBase, deployedAt: null })
    ).toBeNull();
  });

  it("does NOT flag a killed / no-fly-app onboarding agent", () => {
    expect(
      classifyAgentLiveness({ ...onboardingBase, killed: true })
    ).toBeNull();
    expect(
      classifyAgentLiveness({ ...onboardingBase, hasFlyApp: false })
    ).toBeNull();
  });

  it("dedups a stalled-onboarding agent alerted within the dedup window", () => {
    expect(
      classifyAgentLiveness({
        ...onboardingBase,
        livenessAlertedAt: NOW - 2 * HOUR,
      })
    ).toBeNull();
  });

  it("a foundationComplete-but-silent agent yields the existing went-silent class, not stalled_onboarding", () => {
    expect(
      classifyAgentLiveness({
        ...base,
        foundationCompletedAt: NOW - 40 * HOUR,
        lastMorningBriefAt: NOW - 30 * HOUR, // dark
        lastProgressAt: null,
      })
    ).toBe("dark_brief");
  });

  it("a healthy active (post-onboarding) agent is never flagged", () => {
    expect(classifyAgentLiveness({ ...base, lastProgressAt: NOW })).toBeNull();
  });
});
