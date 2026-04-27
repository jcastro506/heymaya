/**
 * maya-content-arc-planner — unit tests.
 *
 * Coverage:
 *  - happy path: calendar event, 3 platforms, 5-beat arc shape
 *  - happy path: theme arc, cadence-driven distribution
 *  - plan-tier: Starter (maxPlatformVariantsPerDay=1) trims to 1 per beat
 *  - adversarial 1: both seedEvent + theme provided → throws
 *  - adversarial 2: neither seedEvent nor theme → throws
 *  - adversarial 3: empty platforms → throws
 *  - adversarial 4: lookAheadDays out of range → throws
 *  - firewall: a slot whose caption fails firewall is dropped
 *  - citation: every arc day cites the seed
 */

import { describe, it, expect } from "vitest";
import {
  buildEventDayGrid,
  buildThemeDayGrid,
  planArc,
  type ArcInputs,
  type CalendarEvent,
  type CitationFirewall,
  type CreativeModel,
  type CreatorPictureSubset,
  type PlatformBestPracticeSkill,
} from "../script";

const FIXTURE_PICTURE: CreatorPictureSubset = {
  niche: "Beginner-friendly home strength training",
  voiceFingerprint: "lowercase, em-dash heavy",
  postingCadence: [
    { platform: "tiktok", postsPerWeek: 4, bestHoursLocal: [12, 18, 21] },
    { platform: "instagram", postsPerWeek: 3, bestHoursLocal: [10, 19] },
    { platform: "youtube", postsPerWeek: 1, bestHoursLocal: [16] },
  ],
};

const SEED_EVENT: CalendarEvent = {
  id: "cal_evt_001",
  title: "Sister's wedding — destination, Tulum",
  startMs: 1_714_435_200_000,
  classification: "creator-relevant-life-event",
};

const passingFirewall: CitationFirewall = {
  async check() {
    return { passed: true, unsupportedClaims: [] };
  },
};

const stubBestPractice: PlatformBestPracticeSkill = {
  async pickFormat({ platform, beat }) {
    if (platform === "tiktok") return "tiktok-post";
    if (platform === "instagram")
      return beat === "evergreen" || beat === "recap" ? "ig-carousel" : "ig-reel";
    if (platform === "youtube")
      return beat === "evergreen" ? "yt-long" : "yt-short";
    if (platform === "linkedin") return "linkedin-post";
    return "x-single";
  },
  async pickPostingHourLocal({ creatorBestHours }) {
    return creatorBestHours[0];
  },
};

const stubCreative: CreativeModel = {
  async draftHooksAndCaption({ platform, beat, seedTitle }) {
    return {
      hookOptions: [
        `${platform} ${beat} hook 1 — ${seedTitle.slice(0, 30)}`,
        `${platform} ${beat} hook 2`,
        `${platform} ${beat} hook 3`,
      ],
      captionDraft: `${platform} ${beat} caption referencing ${seedTitle}.`,
    };
  },
};

describe("maya-content-arc-planner — day grid (deterministic)", () => {
  it("event grid: 3 platforms × 5 beats = 15 slots", () => {
    const grid = buildEventDayGrid(["tiktok", "instagram", "youtube"], 3);
    expect(grid).toHaveLength(15);
    // build-up appears twice (offsets -3 and -1).
    expect(grid.filter((s) => s.beat === "build-up")).toHaveLength(6);
    expect(grid.filter((s) => s.beat === "day-of")).toHaveLength(3);
    expect(grid.filter((s) => s.beat === "recap")).toHaveLength(3);
    expect(grid.filter((s) => s.beat === "evergreen")).toHaveLength(3);
  });

  it("event grid: Starter cap = 1 platform per beat", () => {
    const grid = buildEventDayGrid(["tiktok", "instagram", "youtube"], 1);
    expect(grid).toHaveLength(5); // one per beat
    // Each slot's platform follows BEAT_PRIORITY[beat][0] filtered by connected.
    expect(grid.find((s) => s.beat === "day-of")?.platform).toBe("instagram");
    expect(grid.find((s) => s.beat === "evergreen")?.platform).toBe("youtube");
  });

  it("theme grid: cadence-driven distribution", () => {
    const grid = buildThemeDayGrid(
      ["tiktok", "instagram"],
      FIXTURE_PICTURE.postingCadence,
      7,
      2
    );
    // tiktok: 4/week → 4 slots in a 7-day window
    expect(grid.filter((s) => s.platform === "tiktok")).toHaveLength(4);
    // instagram: 3/week → 3 slots
    expect(grid.filter((s) => s.platform === "instagram")).toHaveLength(3);
  });

  it("theme grid: respects maxPlatformVariantsPerDay = 1", () => {
    const grid = buildThemeDayGrid(
      ["tiktok", "instagram"],
      FIXTURE_PICTURE.postingCadence,
      7,
      1
    );
    expect(grid.every((s) => s.platform === "tiktok")).toBe(true);
  });
});

describe("maya-content-arc-planner — planArc happy path", () => {
  it("event arc: produces 15 slots, every slot cites the calendar event", async () => {
    const inputs: ArcInputs = {
      seedEvent: SEED_EVENT,
      creatorPicture: FIXTURE_PICTURE,
      platforms: ["tiktok", "instagram", "youtube"],
      lookAheadDays: 14,
      maxPlatformVariantsPerDay: 3,
      timezoneIana: "America/Los_Angeles",
    };
    const result = await planArc(inputs, {
      bestPractice: stubBestPractice,
      model: stubCreative,
      firewall: passingFirewall,
    });
    expect(result.shape).toBe("build-up-day-of-recap");
    expect(result.arc).toHaveLength(15);
    for (const day of result.arc) {
      expect(day.citation.sourceKind).toBe("calendar-event");
      expect(day.citation.sourceId).toBe(SEED_EVENT.id);
      expect(day.hookOptions).toHaveLength(3);
      expect(day.postingTimeLocal).toMatch(/^\d{2}:00$/);
    }
    expect(result.rationale).toMatch(/Sister's wedding/);
  });

  it("theme arc: produces cadence-driven slots", async () => {
    const inputs: ArcInputs = {
      theme: "Recovery week",
      creatorPicture: FIXTURE_PICTURE,
      platforms: ["tiktok", "instagram"],
      lookAheadDays: 7,
      maxPlatformVariantsPerDay: 2,
      timezoneIana: "America/Los_Angeles",
    };
    const result = await planArc(inputs, {
      bestPractice: stubBestPractice,
      model: stubCreative,
      firewall: passingFirewall,
    });
    expect(result.shape).toBe("flexible-theme");
    expect(result.arc.length).toBeGreaterThan(0);
    for (const day of result.arc) {
      expect(day.citation.sourceKind).toBe("theme");
      expect(day.citation.sourceId).toBe("theme:recovery-week");
    }
  });

  it("Starter (cap=1) produces a single platform per beat", async () => {
    const inputs: ArcInputs = {
      seedEvent: SEED_EVENT,
      creatorPicture: FIXTURE_PICTURE,
      platforms: ["instagram"],
      lookAheadDays: 14,
      maxPlatformVariantsPerDay: 1,
      timezoneIana: "America/New_York",
    };
    const result = await planArc(inputs, {
      bestPractice: stubBestPractice,
      model: stubCreative,
      firewall: passingFirewall,
    });
    // 5 beats × 1 platform = 5 slots, all instagram.
    expect(result.arc).toHaveLength(5);
    expect(result.arc.every((d) => d.platform === "instagram")).toBe(true);
  });
});

describe("maya-content-arc-planner — adversarial", () => {
  const baseInputs: ArcInputs = {
    creatorPicture: FIXTURE_PICTURE,
    platforms: ["tiktok"],
    lookAheadDays: 7,
    maxPlatformVariantsPerDay: 1,
    timezoneIana: "America/Los_Angeles",
  };

  it("both seedEvent and theme: throws", async () => {
    await expect(
      planArc(
        { ...baseInputs, seedEvent: SEED_EVENT, theme: "x" },
        { bestPractice: stubBestPractice, model: stubCreative, firewall: passingFirewall }
      )
    ).rejects.toThrow(/exactly one/);
  });

  it("neither seedEvent nor theme: throws", async () => {
    await expect(
      planArc(baseInputs, {
        bestPractice: stubBestPractice,
        model: stubCreative,
        firewall: passingFirewall,
      })
    ).rejects.toThrow(/exactly one/);
  });

  it("empty platforms: throws", async () => {
    await expect(
      planArc(
        { ...baseInputs, theme: "x", platforms: [] },
        { bestPractice: stubBestPractice, model: stubCreative, firewall: passingFirewall }
      )
    ).rejects.toThrow(/non-empty/);
  });

  it("lookAheadDays = 2: throws", async () => {
    await expect(
      planArc(
        { ...baseInputs, theme: "x", lookAheadDays: 2 },
        { bestPractice: stubBestPractice, model: stubCreative, firewall: passingFirewall }
      )
    ).rejects.toThrow(/between 3 and 14/);
  });

  it("maxPlatformVariantsPerDay = 0: throws", async () => {
    await expect(
      planArc(
        { ...baseInputs, theme: "x", maxPlatformVariantsPerDay: 0 },
        { bestPractice: stubBestPractice, model: stubCreative, firewall: passingFirewall }
      )
    ).rejects.toThrow(/maxPlatformVariantsPerDay/);
  });

  it("firewall fails on every slot: arc is empty, no fabrication", async () => {
    const failingFirewall: CitationFirewall = {
      async check() {
        return { passed: false, unsupportedClaims: ["x"] };
      },
    };
    const inputs: ArcInputs = {
      ...baseInputs,
      seedEvent: SEED_EVENT,
      platforms: ["tiktok"],
      maxPlatformVariantsPerDay: 1,
    };
    const result = await planArc(inputs, {
      bestPractice: stubBestPractice,
      model: stubCreative,
      firewall: failingFirewall,
    });
    expect(result.arc).toHaveLength(0);
    expect(result.rationale).toMatch(/anchored to/);
  });
});
