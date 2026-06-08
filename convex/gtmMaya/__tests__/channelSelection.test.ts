import { describe, expect, it } from "vitest";
import {
  selectActiveChannels,
  MIN_ACTIVE_CHANNELS,
  PROMOTION_SCORE_FLOOR,
  type ChannelScoreInput,
} from "../channelSelection";
import type { GtmChannel, GtmChannelDecision } from "../channelScoring";

function row(
  channel: GtmChannel,
  decision: GtmChannelDecision,
  overrides: Partial<ChannelScoreInput> = {}
): ChannelScoreInput {
  return {
    channel,
    decision,
    score: decision === "primary" ? 0.85 : 0.6,
    confidence: "high",
    qualityGate: { passed: true, failures: [] },
    ...overrides,
  };
}

describe("selectActiveChannels", () => {
  it("locks in ALL high-fit primaries with no cap", () => {
    const sel = selectActiveChannels([
      row("reddit", "primary", { score: 0.95 }),
      row("tiktok", "primary", { score: 0.9 }),
      row("instagram", "primary", { score: 0.88 }),
      row("youtube", "primary", { score: 0.86 }),
      row("x", "secondary", { score: 0.65 }),
    ]);
    // 4 primaries — all active, secondary NOT pulled in (floor already met).
    expect(sel.active).toEqual(["reddit", "tiktok", "instagram", "youtube"]);
    expect(sel.promoted).toEqual([]);
    expect(sel.parked).toEqual(["x"]);
    expect(sel.belowFloor).toBe(false);
    expect(sel.primaryChannel).toBe("reddit");
    expect(sel.secondaryChannel).toBe("tiktok");
  });

  it("promotes top-scored secondaries to reach the floor of 3", () => {
    const sel = selectActiveChannels([
      row("reddit", "primary", { score: 0.9 }),
      row("x", "secondary", { score: 0.7 }),
      row("linkedin", "secondary", { score: 0.55 }),
      row("tiktok", "secondary", { score: 0.52 }),
    ]);
    // 1 primary + promote the 2 highest floor-clearing secondaries = 3.
    expect(sel.active).toEqual(["reddit", "x", "linkedin"]);
    expect(sel.promoted).toEqual(["x", "linkedin"]);
    expect(sel.parked).toEqual(["tiktok"]);
    expect(sel.belowFloor).toBe(false);
    expect(sel.active.length).toBe(MIN_ACTIVE_CHANNELS);
  });

  it("never promotes a secondary below the quality floor (honesty escape)", () => {
    const sel = selectActiveChannels([
      row("reddit", "primary", { score: 0.9 }),
      row("x", "secondary", { score: 0.7 }),
      // sub-floor score — must NOT be promoted even to hit 3
      row("linkedin", "secondary", { score: PROMOTION_SCORE_FLOOR - 0.1 }),
      // low confidence — must NOT be promoted
      row("tiktok", "secondary", { score: 0.8, confidence: "low" }),
      // failed quality gate — must NOT be promoted
      row("instagram", "secondary", {
        score: 0.8,
        qualityGate: { passed: false, failures: ["no evidence"] },
      }),
    ]);
    expect(sel.active).toEqual(["reddit", "x"]);
    expect(sel.belowFloor).toBe(true);
    expect(sel.note).toContain("Only 2 channel");
    expect(sel.parked).toEqual(
      expect.arrayContaining(["linkedin", "tiktok", "instagram"])
    );
  });

  it("never activates a blocked channel", () => {
    const sel = selectActiveChannels([
      row("reddit", "primary", { score: 0.9 }),
      row("x", "blocked", { score: 0.99 }),
      row("tiktok", "secondary", { score: 0.6 }),
      row("linkedin", "secondary", { score: 0.55 }),
    ]);
    expect(sel.active).not.toContain("x");
    expect(sel.parked).not.toContain("x"); // blocked is excluded entirely
    expect(sel.active).toEqual(["reddit", "tiktok", "linkedin"]);
  });

  it("excludes research-only / launch channels (hn, product_hunt)", () => {
    const sel = selectActiveChannels([
      row("hn" as GtmChannel, "primary", { score: 0.99 }),
      row("product_hunt" as GtmChannel, "primary", { score: 0.99 }),
      row("reddit", "primary", { score: 0.8 }),
    ]);
    expect(sel.active).toEqual(["reddit"]);
    expect(sel.belowFloor).toBe(true);
  });

  it("floor-of-1 safety: activates the top non-blocked channel when nothing clears", () => {
    const sel = selectActiveChannels([
      row("reddit", "parked", { score: 0.4 }),
      row("x", "parked", { score: 0.45 }),
      row("tiktok", "blocked", { score: 0.99 }),
    ]);
    // No primaries, no floor-clearing secondaries — fall back to top non-blocked.
    expect(sel.active).toEqual(["x"]);
    expect(sel.promoted).toEqual(["x"]);
    expect(sel.belowFloor).toBe(true);
  });

  it("returns an empty, honest selection when there is nothing eligible", () => {
    const sel = selectActiveChannels([
      row("hn" as GtmChannel, "primary", { score: 0.9 }),
      row("tiktok", "blocked", { score: 0.9 }),
    ]);
    expect(sel.active).toEqual([]);
    expect(sel.primaryChannel).toBeNull();
    expect(sel.belowFloor).toBe(true);
    expect(sel.note).toContain("No channels");
  });

  it("de-dupes a channel that appears twice, keeping the higher score", () => {
    const sel = selectActiveChannels([
      row("reddit", "secondary", { score: 0.55 }),
      row("reddit", "primary", { score: 0.9 }),
      row("x", "secondary", { score: 0.6 }),
      row("tiktok", "secondary", { score: 0.58 }),
    ]);
    expect(sel.active.filter((c) => c === "reddit").length).toBe(1);
    expect(sel.primaryChannel).toBe("reddit");
    expect(sel.active).toEqual(["reddit", "x", "tiktok"]);
  });
});
