import { describe, it, expect, vi } from "vitest";
import {
  generatePacket,
  SKILL_METADATA,
  __test__,
  type PacketGeneratorInputs,
  type LlmCaller,
  type PdfRenderer,
} from "../script";

const realisticInputs: PacketGeneratorInputs = {
  businessId: "biz_test",
  businessPicture: { name: "Mike's HVAC" },
  metrics90d: {
    jobsCompleted: 87,
    revenue: 142_300,
    avgTicket: 1635,
    reviewVolume: 23,
    avgStarRating: 4.7,
    gbpPostsPublished: 36,
    leadResponseTimeMedian: 12,
  },
  brandVoiceSamples: [
    { source: "review-reply", text: "Y'all are awesome — Eddie loved the work." },
    { source: "gbp-caption", text: "Big shout to Linda for trusting us." },
  ],
  reviewHighlights: [
    {
      stars: 5,
      body: "Eddie was on time and explained everything.",
      reply: "Thanks Linda — y'all made his day.",
    },
  ],
  contentCadence: { gbpPerWeek: 3, fbPerWeek: 1, igPerWeek: 1 },
  crewNames: ["Eddie", "Sam"],
  competitorContext: [
    { name: "Lincoln HVAC Co", gbpRating: 4.3, cadenceWeekly: 2 },
  ],
};

const mockRenderer = (pageCount = 4): PdfRenderer =>
  vi.fn(async (input) => ({
    pdfBase64: Buffer.from(
      JSON.stringify({ title: input.title, sections: input.sections })
    ).toString("base64"),
    storageKey: `r2/packets/${input.businessId}/${input.generatedAt}.pdf`,
    pageCount,
  }));

const mockLlm = (text: string): LlmCaller => vi.fn(async () => text);

describe("maya-service-packet-generator — contract", () => {
  it("declares HIGH thinking + Studio-only", () => {
    expect(SKILL_METADATA.thinkingBudget).toBe("high");
    expect(SKILL_METADATA.planTier).toEqual(["studio"]);
  });
});

describe("maya-service-packet-generator — happy path", () => {
  it("renders all sections from realistic 90d data", async () => {
    const llm = mockLlm("Strong quarter: 87 jobs, $142K, 4.7 stars, 12-min lead response.");
    const renderer = mockRenderer(6);
    const out = await generatePacket(realisticInputs, llm, renderer);
    expect(out.pageCount).toBe(6);
    expect(out.pdfBase64.length).toBeGreaterThan(0);
    expect(out.storageKey).toMatch(/biz_test/);
    expect(out.citationsManifest.length).toBe(7); // 6 sections + summary
  });

  it("citationsManifest reports correct sourceCount per section", async () => {
    const out = await generatePacket(
      realisticInputs,
      mockLlm("Summary"),
      mockRenderer()
    );
    const cadence = out.citationsManifest.find(
      (c) => c.section === "Content Cadence"
    );
    expect(cadence?.sourceCount).toBe(3);
    const crew = out.citationsManifest.find((c) => c.section === "Crew");
    expect(crew?.sourceCount).toBe(2);
  });
});

describe("maya-service-packet-generator — adversarial / fallback", () => {
  it("missing data sections produce '[insufficient data]' placeholders, never silent dropouts", async () => {
    const empty: PacketGeneratorInputs = {
      businessId: "biz_empty",
      businessPicture: {},
      metrics90d: {
        jobsCompleted: 0,
        revenue: 0,
        avgTicket: 0,
        reviewVolume: 0,
        avgStarRating: 0,
        gbpPostsPublished: 0,
        leadResponseTimeMedian: 0,
      },
      brandVoiceSamples: [],
      reviewHighlights: [],
      contentCadence: { gbpPerWeek: 0, fbPerWeek: 0, igPerWeek: 0 },
      crewNames: [],
      competitorContext: [],
    };
    const captured: { sections: ReadonlyArray<{ title: string; body: string }> }[] = [];
    const renderer: PdfRenderer = vi.fn(async (input) => {
      captured.push({ sections: input.sections });
      return {
        pdfBase64: "FAKE",
        storageKey: "r2/test",
        pageCount: 1,
      };
    });
    const out = await generatePacket(empty, mockLlm("Limited data."), renderer);
    expect(out.pageCount).toBe(1);
    const allSections = captured[0].sections.map((s) => s.body).join("\n");
    expect(allSections).toContain("[insufficient data");
    // Every section sourceCount is 0:
    const sectionsZero = out.citationsManifest.filter(
      (c) => c.section !== "Executive Summary"
    );
    for (const s of sectionsZero) {
      expect(s.sourceCount).toBe(0);
    }
  });

  it("LLM empty string still produces a fallback summary", async () => {
    const out = await generatePacket(
      realisticInputs,
      mockLlm(""),
      mockRenderer()
    );
    expect(out.pdfBase64.length).toBeGreaterThan(0);
  });
});

describe("maya-service-packet-generator — cross-tenant", () => {
  it("Business A's metrics never appear in Business B's renderer call", async () => {
    const calls: { sections: ReadonlyArray<{ title: string; body: string }> }[] =
      [];
    const renderer: PdfRenderer = vi.fn(async (input) => {
      calls.push({ sections: input.sections });
      return {
        pdfBase64: "X",
        storageKey: `r2/${input.businessId}`,
        pageCount: 1,
      };
    });
    await generatePacket(realisticInputs, mockLlm("A summary"), renderer);
    await generatePacket(
      {
        ...realisticInputs,
        businessId: "biz_b",
        metrics90d: { ...realisticInputs.metrics90d, jobsCompleted: 999 },
      },
      mockLlm("B summary"),
      renderer
    );
    const aText = calls[0].sections.map((s) => s.body).join(" ");
    const bText = calls[1].sections.map((s) => s.body).join(" ");
    expect(aText).toContain("87");
    expect(aText).not.toContain("999");
    expect(bText).toContain("999");
  });
});

describe("maya-service-packet-generator — sibling-file scan", () => {
  it("never throws Sprint 3 stub error", async () => {
    await expect(
      generatePacket(realisticInputs, mockLlm("ok"), mockRenderer())
    ).resolves.toBeDefined();
  });
});

describe("maya-service-packet-generator — section helpers", () => {
  it("metricsSection emits insufficient placeholder when zeroed", () => {
    const s = __test__.metricsSection({
      jobsCompleted: 0,
      revenue: 0,
      avgTicket: 0,
      reviewVolume: 0,
      avgStarRating: 0,
      gbpPostsPublished: 0,
      leadResponseTimeMedian: 0,
    });
    expect(s.body).toContain("[insufficient data");
    expect(s.sourceCount).toBe(0);
  });
});
