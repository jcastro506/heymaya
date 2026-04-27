import { describe, it, expect, vi } from "vitest";
import {
  rejuvenateContent,
  SKILL_METADATA,
  __test__,
  type ContentRejuvenatorInputs,
  type LlmCaller,
  type RejuvenatorMediaAsset,
} from "../script";

const NOW = Date.now();
const ONE_DAY = 1000 * 60 * 60 * 24;

function asset(
  id: string,
  overrides?: Partial<RejuvenatorMediaAsset>
): RejuvenatorMediaAsset {
  return {
    assetId: id,
    catalog: {
      primarySubject: "HVAC condenser",
      serviceCategory: "hvac",
      visualQuality: 0.85,
      suggestedUses: ["gbp-post", "instagram-single"],
      captionDraft: "Fresh install today.",
    },
    receivedAt: NOW - 30 * ONE_DAY,
    usageHistory: [],
    ...overrides,
  };
}

const baseInputs: ContentRejuvenatorInputs = {
  businessId: "biz_a",
  mediaAssets: [
    asset("a1"),
    asset("a2", {
      catalog: {
        primarySubject: "lawn after",
        serviceCategory: "lawn",
        visualQuality: 0.9,
        suggestedUses: ["instagram-single"],
        captionDraft: "Crisp green stripes.",
      },
    }),
    asset("a3", {
      catalog: {
        primarySubject: "blurry shot",
        serviceCategory: "general",
        visualQuality: 0.2, // low-quality
        suggestedUses: ["internal-reference-only"],
      },
    }),
    asset("a4", {
      catalog: {
        primarySubject: "[uncataloged]",
        serviceCategory: "general",
        visualQuality: 0,
        suggestedUses: [],
      },
    }),
  ],
  recentCadence: {
    gbpLastPostAt: NOW - 14 * ONE_DAY,
    fbLastPostAt: NOW - 21 * ONE_DAY,
    igLastPostAt: NOW - 7 * ONE_DAY,
    tiktokLastPostAt: null,
  },
  targetPostCount: 2,
};

describe("maya-service-content-rejuvenator — contract", () => {
  it("declares MEDIUM thinking + all-tier", () => {
    expect(SKILL_METADATA.thinkingBudget).toBe("medium");
    expect(SKILL_METADATA.planTier).toEqual(["starter", "pro", "studio"]);
  });
});

describe("maya-service-content-rejuvenator — happy path", () => {
  it("ranks high-quality unposted assets first", async () => {
    const out = await rejuvenateContent(baseInputs);
    expect(out.suggestions.length).toBe(2);
    const suggestedIds = out.suggestions.map((s) => s.assetId);
    expect(suggestedIds).toContain("a1");
    expect(suggestedIds).toContain("a2");
  });

  it("skips low-quality + uncataloged + private", async () => {
    const out = await rejuvenateContent(baseInputs);
    const skippedIds = out.skippedAssets.map((s) => s.assetId);
    expect(skippedIds).toContain("a3");
    expect(skippedIds).toContain("a4");
    expect(out.skippedAssets.find((s) => s.assetId === "a3")?.reason).toBe(
      "low-quality"
    );
    expect(out.skippedAssets.find((s) => s.assetId === "a4")?.reason).toBe(
      "incomplete-catalog"
    );
  });

  it("uses LLM for prose when provided", async () => {
    const llm: LlmCaller = vi.fn(async () =>
      JSON.stringify({
        items: [
          {
            assetId: "a1",
            draftCaption: "Big install for a Havelock neighbor today.",
            reasoning: "high-quality, never on tiktok",
            confidence: 0.83,
          },
          {
            assetId: "a2",
            draftCaption: "Crisp green stripes after this morning's mow.",
            reasoning: "great photo, light cadence",
            confidence: 0.78,
          },
        ],
      })
    );
    const out = await rejuvenateContent(baseInputs, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    const a1 = out.suggestions.find((s) => s.assetId === "a1");
    expect(a1?.draftCaption).toContain("Havelock");
    expect(a1?.confidence).toBeCloseTo(0.83);
  });
});

describe("maya-service-content-rejuvenator — citation enforcement", () => {
  it("never suggests an asset already recently posted on the target platform", async () => {
    const recentlyPosted = asset("a5", {
      catalog: {
        primarySubject: "x",
        serviceCategory: "hvac",
        visualQuality: 0.9,
        suggestedUses: ["gbp-post"],
      },
      usageHistory: [
        // Posted to all 4 platforms within 90 days
        { platform: "gbp", postedAt: NOW - 5 * ONE_DAY },
        { platform: "instagram", postedAt: NOW - 10 * ONE_DAY },
        { platform: "facebook", postedAt: NOW - 30 * ONE_DAY },
        { platform: "tiktok", postedAt: NOW - 30 * ONE_DAY },
      ],
    });
    const out = await rejuvenateContent({
      ...baseInputs,
      mediaAssets: [recentlyPosted],
    });
    expect(out.suggestions).toEqual([]);
    expect(out.skippedAssets[0].reason).toBe("recently-used");
  });

  it("rejects if LLM returns assetId not in input library", async () => {
    const llm: LlmCaller = vi.fn(async () =>
      JSON.stringify({
        items: [
          {
            assetId: "nonexistent",
            draftCaption: "fake",
            reasoning: "fake",
            confidence: 0.9,
          },
        ],
      })
    );
    // Even with hostile LLM, our skill ignores LLM-only output and uses
    // the rule-based ranked candidates as the source of truth — so the
    // suggestions should still all be from the input library.
    const out = await rejuvenateContent(baseInputs, llm);
    for (const s of out.suggestions) {
      expect(["a1", "a2"]).toContain(s.assetId);
    }
  });
});

describe("maya-service-content-rejuvenator — adversarial", () => {
  it("empty mediaAssets → empty suggestions", async () => {
    const out = await rejuvenateContent({ ...baseInputs, mediaAssets: [] });
    expect(out.suggestions).toEqual([]);
    expect(out.skippedAssets).toEqual([]);
  });

  it("LLM garbage → fallback to deterministic captions", async () => {
    const llm: LlmCaller = vi.fn(async () => "definitely not json");
    const out = await rejuvenateContent(baseInputs, llm);
    expect(out.suggestions.length).toBeGreaterThan(0);
    // Each suggestion has a non-empty fallback caption.
    for (const s of out.suggestions) {
      expect(s.draftCaption.length).toBeGreaterThan(0);
    }
  });
});

describe("maya-service-content-rejuvenator — cross-tenant", () => {
  it("Business B's assets never appear in Business A's suggestions", async () => {
    const a = await rejuvenateContent(baseInputs);
    const b = await rejuvenateContent({
      ...baseInputs,
      businessId: "biz_b",
      mediaAssets: [
        asset("biz_b_only_1", {
          catalog: {
            primarySubject: "B-only",
            serviceCategory: "plumbing",
            visualQuality: 0.85,
            suggestedUses: ["gbp-post"],
            captionDraft: "B caption",
          },
        }),
      ],
    });
    const aIds = a.suggestions.map((s) => s.assetId);
    const bIds = b.suggestions.map((s) => s.assetId);
    expect(aIds).not.toContain("biz_b_only_1");
    expect(bIds).toContain("biz_b_only_1");
    expect(bIds).not.toContain("a1");
  });
});

describe("maya-service-content-rejuvenator — sibling-file scan", () => {
  it("never throws Sprint 3 stub error", async () => {
    await expect(rejuvenateContent(baseInputs)).resolves.toBeDefined();
  });
});

describe("maya-service-content-rejuvenator — helpers", () => {
  it("rankCandidates returns ordered candidates", () => {
    const { ranked } = __test__.rankCandidates(baseInputs);
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].rankScore).toBeGreaterThanOrEqual(
        ranked[i].rankScore
      );
    }
  });

  it("pickAction respects suggestedUses preferences", () => {
    const a = asset("x", {
      catalog: {
        primarySubject: "x",
        serviceCategory: "x",
        visualQuality: 0.9,
        suggestedUses: ["instagram-carousel"],
      },
    });
    expect(__test__.pickAction(a, "instagram")).toBe(
      "post-to-instagram-carousel"
    );
  });
});
