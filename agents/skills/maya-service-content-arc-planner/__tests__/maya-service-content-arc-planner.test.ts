import { describe, it, expect, vi } from "vitest";
import {
  planContentArc,
  SKILL_METADATA,
  ArcLocalHookDensityError,
  __test__,
  type ArcPlannerInputs,
  type LlmCaller,
} from "../script";

const baseInputs: ArcPlannerInputs = {
  seedEvent: {
    kind: "weather",
    description: "freeze warning Friday-Sunday",
    startDate: 1_700_000_000_000,
  },
  businessPicture: {
    serviceType: "HVAC",
    brandVoice: "friendly-neighborhood, first-name basis",
    localPositioning: {
      servedZips: ["68506", "68510"],
      servedNeighborhoods: ["South Lincoln", "Havelock"],
      namedCompetitors: [
        { name: "Lincoln HVAC Co", reputationalNote: "older fleet" },
      ],
      recurringLocalHooks: [
        { kind: "weather", text: "Nebraska freeze warnings" },
        { kind: "sport", text: "Husker game day" },
      ],
    },
  },
  platforms: ["gbp", "facebook"],
  lookAheadDays: 5,
};

const goodArcJson = {
  arc: [
    {
      dayOffset: 0,
      platform: "gbp",
      hookOptions: ["Nebraska freeze warnings — get ready"],
      captionDraft:
        "Nebraska freeze warnings hit Friday — South Lincoln, schedule your tune-up before the cold.",
      postingTimeLocal: "08:00",
      rationale: "build-up day with weather hook",
      localHookUsed: {
        kind: "weather",
        text: "Nebraska freeze warnings",
        sourcedFrom: "recurringHook",
      },
    },
    {
      dayOffset: 1,
      platform: "facebook",
      hookOptions: ["South Lincoln neighbors"],
      captionDraft:
        "Havelock crews — Eddie's running early Saturday morning rounds. Book by tonight.",
      postingTimeLocal: "07:00",
      rationale: "local neighborhood callout",
      localHookUsed: {
        kind: "neighborhood",
        text: "Havelock",
        sourcedFrom: "neighborhood",
      },
    },
    {
      dayOffset: 2,
      platform: "gbp",
      hookOptions: ["Husker game day prep"],
      captionDraft:
        "Husker game day — heat off all afternoon? Call us before kickoff.",
      postingTimeLocal: "09:00",
      rationale: "Sunday recap with sport hook",
      localHookUsed: {
        kind: "sport",
        text: "Husker game day",
        sourcedFrom: "recurringHook",
      },
    },
  ],
  rationale: "3-day arc, weather + community + sport hooks",
};

describe("maya-service-content-arc-planner — contract", () => {
  it("declares HIGH thinking + Pro+ + min density 0.8", () => {
    expect(SKILL_METADATA.thinkingBudget).toBe("high");
    expect(SKILL_METADATA.planTier).toEqual(["pro", "studio"]);
    expect(SKILL_METADATA.minLocalHookDensity).toBe(0.8);
    expect(SKILL_METADATA.localHookRequired).toBe(true);
  });
});

describe("maya-service-content-arc-planner — happy path", () => {
  it("returns 1.0 density when all posts have a verified local hook", async () => {
    const llm: LlmCaller = vi.fn(async () => JSON.stringify(goodArcJson));
    const out = await planContentArc(baseInputs, llm);
    expect(out.localHookDensity).toBe(1);
    expect(out.citationFirewall.passed).toBe(true);
    expect(out.arc.length).toBe(3);
    expect(out.localHooksWoven.length).toBe(3);
  });

  it("rejects arc with density < 0.8", async () => {
    const lowDensity = {
      arc: [
        {
          dayOffset: 0,
          platform: "gbp",
          hookOptions: [],
          captionDraft: "Nebraska freeze warnings — book today.",
          postingTimeLocal: "08:00",
          rationale: "ok",
          localHookUsed: null,
        },
        {
          dayOffset: 1,
          platform: "gbp",
          hookOptions: [],
          captionDraft: "Generic post 1.",
          postingTimeLocal: "08:00",
          rationale: "no hook",
          localHookUsed: null,
        },
        {
          dayOffset: 2,
          platform: "gbp",
          hookOptions: [],
          captionDraft: "Generic post 2.",
          postingTimeLocal: "08:00",
          rationale: "no hook",
          localHookUsed: null,
        },
      ],
      rationale: "low density",
    };
    const llm: LlmCaller = vi.fn(async () => JSON.stringify(lowDensity));
    await expect(planContentArc(baseInputs, llm)).rejects.toBeInstanceOf(
      ArcLocalHookDensityError
    );
  });
});

describe("maya-service-content-arc-planner — adversarial", () => {
  it("empty localPositioning rejected", async () => {
    const empty: ArcPlannerInputs = {
      ...baseInputs,
      businessPicture: {
        ...baseInputs.businessPicture,
        localPositioning: {
          servedZips: [],
          servedNeighborhoods: [],
          namedCompetitors: [],
          recurringLocalHooks: [],
        },
      },
    };
    const llm: LlmCaller = vi.fn();
    await expect(planContentArc(empty, llm)).rejects.toThrow(
      /empty localPositioning/
    );
    expect(llm).not.toHaveBeenCalled();
  });

  it("invalid lookAheadDays rejected", async () => {
    const llm: LlmCaller = vi.fn();
    await expect(
      planContentArc({ ...baseInputs, lookAheadDays: 0 }, llm)
    ).rejects.toThrow();
    await expect(
      planContentArc({ ...baseInputs, lookAheadDays: 30 }, llm)
    ).rejects.toThrow();
  });

  it("LLM returning non-JSON throws", async () => {
    const llm: LlmCaller = vi.fn(async () => "totally not json");
    await expect(planContentArc(baseInputs, llm)).rejects.toThrow();
  });

  it("4 valid + 1 fabricated = 0.8 density (passes threshold) but fabricated claim is stripped", async () => {
    const fab = {
      arc: [
        ...goodArcJson.arc,
        {
          dayOffset: 3,
          platform: "gbp",
          hookOptions: [],
          captionDraft: "South Lincoln neighbors — book today.",
          postingTimeLocal: "08:00",
          rationale: "real",
          localHookUsed: {
            kind: "neighborhood",
            text: "South Lincoln",
            sourcedFrom: "neighborhood",
          },
        },
        {
          dayOffset: 4,
          platform: "gbp",
          hookOptions: [],
          captionDraft: "Generic generic generic.", // fabricated claim
          postingTimeLocal: "08:00",
          rationale: "false claim",
          localHookUsed: {
            kind: "weather",
            text: "Nebraska freeze warnings",
            sourcedFrom: "recurringHook",
          },
        },
      ],
      rationale: "audit test",
    };
    const llm: LlmCaller = vi.fn(async () => JSON.stringify(fab));
    const out = await planContentArc(baseInputs, llm);
    // 4 valid out of 5 = 0.8 — passes.
    expect(out.localHookDensity).toBeCloseTo(0.8, 1);
    // The fabricated claim must have been stripped.
    expect(out.arc[4].localHookUsed).toBeNull();
  });
});

describe("maya-service-content-arc-planner — cross-tenant", () => {
  it("Business B's localPositioning never bleeds into Business A's arc prompt", async () => {
    const businessBArc = {
      arc: [
        {
          dayOffset: 0,
          platform: "gbp",
          hookOptions: [],
          captionDraft: "Mission District residents — book your tune-up today.",
          postingTimeLocal: "10:00",
          rationale: "neighborhood",
          localHookUsed: {
            kind: "neighborhood",
            text: "Mission District",
            sourcedFrom: "neighborhood",
          },
        },
      ],
      rationale: "B-only",
    };

    const calls: { system: string; user: string }[] = [];
    let toggle = 0;
    const llm: LlmCaller = vi.fn(async (p) => {
      calls.push(p);
      const reply = toggle === 0 ? goodArcJson : businessBArc;
      toggle++;
      return JSON.stringify(reply);
    });
    await planContentArc(baseInputs, llm);

    const businessB: ArcPlannerInputs = {
      ...baseInputs,
      businessPicture: {
        serviceType: "Plumbing",
        brandVoice: "professional-efficient",
        localPositioning: {
          servedZips: ["94110"],
          servedNeighborhoods: ["Mission District"],
          namedCompetitors: [{ name: "Bay Plumbers Inc" }],
          recurringLocalHooks: [
            { kind: "landmark", text: "Mission Bay tech corridor" },
          ],
        },
      },
    };
    await planContentArc(businessB, llm);

    expect(calls[1].user).toContain("Mission District");
    expect(calls[1].user).not.toContain("Havelock");
    expect(calls[0].user).toContain("Havelock");
    expect(calls[0].user).not.toContain("Mission District");
  });
});

describe("maya-service-content-arc-planner — sibling-file scan", () => {
  it("never throws Sprint 3 stub error", async () => {
    const llm: LlmCaller = vi.fn(async () => JSON.stringify(goodArcJson));
    await expect(planContentArc(baseInputs, llm)).resolves.toBeDefined();
  });
});

describe("maya-service-content-arc-planner — helpers", () => {
  it("postReferencesLocally finds neighborhood + recurring hook + competitor", () => {
    const lp = baseInputs.businessPicture.localPositioning;
    expect(__test__.postReferencesLocally("Havelock crews ready", lp)).not.toBeNull();
    expect(
      __test__.postReferencesLocally("Nebraska freeze warnings hit", lp)
    ).not.toBeNull();
    expect(
      __test__.postReferencesLocally("Lincoln HVAC Co charges more", lp)
    ).not.toBeNull();
    expect(__test__.postReferencesLocally("Generic post", lp)).toBeNull();
  });
});
