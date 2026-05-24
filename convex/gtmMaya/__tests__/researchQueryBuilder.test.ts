import { describe, expect, it } from "vitest";
import {
  buildResearchQueryPlan,
  PlatformQueryPackSchema,
  type BuildResearchQueryPlanInput,
} from "../researchQueryBuilder";

const baseInput: BuildResearchQueryPlanInput = {
  diagnosis: {
    productName: "ClawLaunch",
    productCategoryKeywords: ["AI launch teammate", "indie hacker GTM"],
    oneSentencePromise:
      "ClawLaunch helps indie founders find their first 100 users by replying where buyers already are.",
    showability: "screen-recordable",
    competitorMentions: ["Beehiiv", "Hypefury"],
    unverifiable: false,
  },
  icpHypotheses: [
    {
      id: "icp_1",
      buyer: "Indie devs shipping solo SaaS with <100 followers",
      currentPain:
        "I shipped my MVP but I have no audience and no idea what to do",
      currentWorkaround: "post once on Twitter, wait, give up",
      locatableOn: "twitter",
    },
    {
      id: "icp_2",
      buyer: "Vibe-coders launching their first AI app",
      currentPain: "I built it in a weekend but launching is harder than coding",
      currentWorkaround: "ask in Discord servers, no responses",
      locatableOn: "reddit",
    },
  ],
};

describe("Sprint 3 — researchQueryBuilder", () => {
  it("emits a pack for every supported platform when unblocked", () => {
    const plan = buildResearchQueryPlan(baseInput);
    const platforms = plan.packs.map((p) => p.platform).sort();
    // LinkedIn is skipped (no ICP locates there); rest emitted.
    expect(platforms).toEqual([
      "google",
      "instagram",
      "reddit",
      "tiktok",
      "twitter",
    ]);
    expect(plan.skipped.find((s) => s.platform === "linkedin")).toBeTruthy();
  });

  it("every emitted pack passes the zod schema", () => {
    const plan = buildResearchQueryPlan(baseInput);
    for (const pack of plan.packs) {
      const parsed = PlatformQueryPackSchema.safeParse(pack);
      expect(parsed.success).toBe(true);
    }
  });

  it("skips TikTok + Instagram when showability is unshowable (tiktok.md rule 4)", () => {
    const plan = buildResearchQueryPlan({
      ...baseInput,
      diagnosis: { ...baseInput.diagnosis, showability: "unshowable" },
    });
    const platforms = plan.packs.map((p) => p.platform);
    expect(platforms).not.toContain("tiktok");
    expect(platforms).not.toContain("instagram");
    const tiktokSkip = plan.skipped.find((s) => s.platform === "tiktok");
    const igSkip = plan.skipped.find((s) => s.platform === "instagram");
    expect(tiktokSkip?.reason).toContain("unshowable");
    expect(igSkip?.reason).toContain("unshowable");
  });

  it("emits LinkedIn pack when an ICP locates on linkedin", () => {
    const plan = buildResearchQueryPlan({
      ...baseInput,
      icpHypotheses: [
        {
          id: "icp_b2b",
          buyer: "Ops manager at 50-200 person SaaS",
          currentPain: "we have no playbook for cross-team comms",
          currentWorkaround: "Slack channels + spreadsheets",
          locatableOn: "linkedin",
        },
      ],
    });
    const platforms = plan.packs.map((p) => p.platform);
    expect(platforms).toContain("linkedin");
  });

  it("Reddit pack includes reply-mining patterns from reddit.md § 4", () => {
    const plan = buildResearchQueryPlan(baseInput);
    const reddit = plan.packs.find((p) => p.platform === "reddit")!;
    const allQueries = [
      ...reddit.painQueries,
      ...reddit.solutionQueries,
      ...reddit.competitorQueries,
    ];
    expect(allQueries.some((q) => q.startsWith("how do I"))).toBe(true);
    expect(allQueries.some((q) => q.startsWith("anyone using"))).toBe(true);
    expect(allQueries.some((q) => q.includes("alternative to Beehiiv"))).toBe(
      true
    );
    expect(reddit.formatQueries).toEqual([]);
  });

  it("Twitter pack uses quoted advanced-search operators from x.md § 3", () => {
    const plan = buildResearchQueryPlan(baseInput);
    const twitter = plan.packs.find((p) => p.platform === "twitter")!;
    expect(twitter.painQueries.some((q) => q.includes("-filter:retweets"))).toBe(
      true
    );
    expect(twitter.painQueries.some((q) => q.includes("anyone know"))).toBe(true);
    expect(twitter.competitorQueries.some((q) => q.includes("too expensive"))).toBe(
      true
    );
  });

  it("TikTok pack includes format-mining queries for the 5-video rule", () => {
    const plan = buildResearchQueryPlan(baseInput);
    const tiktok = plan.packs.find((p) => p.platform === "tiktok")!;
    expect(tiktok.formatQueries.length).toBeGreaterThan(0);
    expect(tiktok.formatQueries.some((q) => q.startsWith("#"))).toBe(true);
    expect(tiktok.formatQueries.some((q) => q.includes("before after"))).toBe(
      true
    );
  });

  it("respects per-platform call budget overrides", () => {
    const plan = buildResearchQueryPlan({
      ...baseInput,
      budgetOverrides: { reddit: 3, tiktok: 0 },
    });
    const reddit = plan.packs.find((p) => p.platform === "reddit")!;
    expect(reddit.maxCalls).toBe(3);
    // budget=0 skips the platform.
    expect(plan.packs.find((p) => p.platform === "tiktok")).toBeUndefined();
    expect(plan.skipped.find((s) => s.platform === "tiktok")?.reason).toBe(
      "budget=0"
    );
  });

  it("handles empty category keywords gracefully", () => {
    const plan = buildResearchQueryPlan({
      ...baseInput,
      diagnosis: { ...baseInput.diagnosis, productCategoryKeywords: [] },
    });
    expect(plan.packs).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
    // Every platform must be in skipped[] (some for "empty" reason, some
    // for LinkedIn's earlier-checked "no ICP locates" gate).
    const allPlatforms = [
      "reddit",
      "twitter",
      "tiktok",
      "instagram",
      "linkedin",
      "google",
    ];
    for (const platform of allPlatforms) {
      expect(plan.skipped.find((s) => s.platform === platform)).toBeTruthy();
    }
  });

  it("plan fingerprint is stable across calls and changes when inputs change", () => {
    const a = buildResearchQueryPlan(baseInput);
    const b = buildResearchQueryPlan(baseInput);
    expect(a.planFingerprint).toBe(b.planFingerprint);
    const c = buildResearchQueryPlan({
      ...baseInput,
      diagnosis: {
        ...baseInput.diagnosis,
        productCategoryKeywords: [...baseInput.diagnosis.productCategoryKeywords, "GTM"],
      },
    });
    expect(c.planFingerprint).not.toBe(a.planFingerprint);
  });

  it("propagates excludedAudiences into Reddit exclusionQueries", () => {
    const plan = buildResearchQueryPlan({
      ...baseInput,
      excludedAudiences: ["enterprise procurement", "MBA students"],
    });
    const reddit = plan.packs.find((p) => p.platform === "reddit")!;
    expect(reddit.exclusionQueries).toContain("-enterprise procurement");
    expect(reddit.exclusionQueries).toContain("-MBA students");
  });

  it("Google pack includes 'alternative to X' competitor probes", () => {
    const plan = buildResearchQueryPlan(baseInput);
    const google = plan.packs.find((p) => p.platform === "google")!;
    expect(google.competitorQueries.some((q) => q === "alternative to Beehiiv")).toBe(
      true
    );
    expect(google.competitorQueries.some((q) => q.includes("review reddit"))).toBe(
      true
    );
  });

  it("Reddit pack carries the documented minimum evidence count", () => {
    const plan = buildResearchQueryPlan(baseInput);
    const reddit = plan.packs.find((p) => p.platform === "reddit")!;
    expect(reddit.minimumEvidenceCards).toBeGreaterThanOrEqual(3);
    expect(reddit.maxCalls).toBeGreaterThan(0);
  });

  it("does not produce duplicate queries within a pack", () => {
    const plan = buildResearchQueryPlan({
      ...baseInput,
      diagnosis: {
        ...baseInput.diagnosis,
        // Repeats should de-dupe.
        productCategoryKeywords: ["AI launch teammate", "AI launch teammate"],
      },
    });
    for (const pack of plan.packs) {
      const all = [
        ...pack.painQueries,
        ...pack.solutionQueries,
        ...pack.competitorQueries,
        ...pack.formatQueries,
      ];
      const set = new Set(all.map((s) => s.toLowerCase()));
      expect(set.size).toBe(all.length);
    }
  });
});
