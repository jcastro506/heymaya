import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../../convex/schema";
import { modules } from "../../../../tests/_modules";
import { seedSingleBusiness } from "../../../../convex/_test/serviceFixtures";
import {
  curateJobPhotos,
  SKILL_METADATA,
  ServiceSkillError,
  type JobPhotoCuratorInputs,
  type JobPhotoCuratorOutput,
} from "../script";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockOpenRouterContent(content: string): Response {
  return jsonResponse({
    id: "gen-test",
    model: "google/gemini-3-flash",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 800,
      completion_tokens: 200,
      completion_tokens_details: { reasoning_tokens: 80 },
    },
  });
}

function baseInputs(
  overrides: Partial<JobPhotoCuratorInputs> = {}
): JobPhotoCuratorInputs {
  return {
    photoUrls: [
      "https://r2.example/biz1/job1/photo-0.jpg",
      "https://r2.example/biz1/job1/photo-1.jpg",
      "https://r2.example/biz1/job1/photo-2.jpg",
      "https://r2.example/biz1/job1/photo-3.jpg",
    ],
    jobContext: {
      jobId: "job_henderson_1",
      serviceType: "AC tune-up",
      customerLastName: "Henderson",
    },
    geminiFilesApiClient: {},
    maxPhotosOut: 3,
    ...overrides,
  };
}

describe("maya-service-job-photo-curator — contract", () => {
  it("declares Gemini 3 Flash MEDIUM thinking metadata", () => {
    expect(SKILL_METADATA.modelTarget).toBe("gemini-3-flash");
    expect(SKILL_METADATA.thinkingBudget).toBe("medium");
  });

  it("has typed signature", () => {
    const _fn: (
      i: JobPhotoCuratorInputs
    ) => Promise<JobPhotoCuratorOutput> = curateJobPhotos;
    expect(typeof _fn).toBe("function");
  });
});

describe("maya-service-job-photo-curator — photo-bridge integrity (R3 § 2)", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("rejects file:// URLs", async () => {
    await expect(
      curateJobPhotos(
        baseInputs({ photoUrls: ["file:///tmp/photo.jpg"] })
      )
    ).rejects.toThrow(ServiceSkillError);
  });

  it("rejects data: URLs", async () => {
    await expect(
      curateJobPhotos(
        baseInputs({
          photoUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
        })
      )
    ).rejects.toThrow(/http/);
  });

  it("rejects empty photoUrls", async () => {
    await expect(
      curateJobPhotos(baseInputs({ photoUrls: [] }))
    ).rejects.toThrow(/empty/);
  });

  it("rejects invalid maxPhotosOut", async () => {
    await expect(
      curateJobPhotos(baseInputs({ maxPhotosOut: 0 }))
    ).rejects.toThrow(/maxPhotosOut/);
  });
});

describe("maya-service-job-photo-curator — privacy + quality flags", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("face-detected photos are rejected with reason", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: [
            {
              index: 0,
              qualityScore: 0.9,
              visualQuality: "excellent",
              framingNotes: "well-lit, clean composition",
              flags: ["face-detected"],
              suggestedUses: [],
            },
            {
              index: 1,
              qualityScore: 0.85,
              visualQuality: "good",
              framingNotes: "nice angle on the unit",
              flags: [],
              suggestedUses: ["gbp-post"],
            },
          ],
          beforeAfterPairs: [],
        })
      )
    );
    const out = await curateJobPhotos(baseInputs(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.rejected).toContainEqual(
      expect.objectContaining({
        url: "https://r2.example/biz1/job1/photo-0.jpg",
        reason: expect.stringContaining("face"),
      })
    );
    expect(out.bestPhotos.map((p) => p.url)).not.toContain(
      "https://r2.example/biz1/job1/photo-0.jpg"
    );
  });

  it("license-plate photos are rejected", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: [
            {
              index: 0,
              qualityScore: 0.9,
              visualQuality: "excellent",
              framingNotes: "clear plate visible",
              flags: ["license-plate"],
              suggestedUses: [],
            },
          ],
          beforeAfterPairs: [],
        })
      )
    );
    const out = await curateJobPhotos(baseInputs(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.rejected[0].reason).toMatch(/license/i);
  });

  it("blurry photos are rejected by quality threshold", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: [
            {
              index: 0,
              qualityScore: 0.2,
              visualQuality: "poor",
              framingNotes: "motion blur",
              flags: ["blurry"],
              suggestedUses: [],
            },
          ],
          beforeAfterPairs: [],
        })
      )
    );
    const out = await curateJobPhotos(baseInputs(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.rejected[0].reason).toMatch(/blurry/i);
  });
});

describe("maya-service-job-photo-curator — plan-tier cap", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("Starter cap of 3 trims the bestPhotos list to 3 even if 4 pass", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: [
            { index: 0, qualityScore: 0.9, visualQuality: "excellent", framingNotes: "a", flags: [], suggestedUses: [] },
            { index: 1, qualityScore: 0.85, visualQuality: "good", framingNotes: "b", flags: [], suggestedUses: [] },
            { index: 2, qualityScore: 0.8, visualQuality: "good", framingNotes: "c", flags: [], suggestedUses: [] },
            { index: 3, qualityScore: 0.75, visualQuality: "fair", framingNotes: "d", flags: [], suggestedUses: [] },
          ],
          beforeAfterPairs: [],
        })
      )
    );
    const out = await curateJobPhotos(baseInputs({ maxPhotosOut: 3 }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.bestPhotos).toHaveLength(3);
    // Lowest-scoring one should be in rejected with cap reason.
    expect(
      out.rejected.find((r) => r.reason.includes("maxPhotosOut"))
    ).toBeDefined();
  });
});

describe("maya-service-job-photo-curator — before/after pairing", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("returns only pairs whose both photos passed curation", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: [
            { index: 0, qualityScore: 0.9, visualQuality: "excellent", framingNotes: "before", flags: [], suggestedUses: ["gbp-post"] },
            { index: 1, qualityScore: 0.9, visualQuality: "excellent", framingNotes: "after", flags: [], suggestedUses: ["gbp-post"] },
            { index: 2, qualityScore: 0.95, visualQuality: "excellent", framingNotes: "rejected", flags: ["face-detected"], suggestedUses: [] },
          ],
          beforeAfterPairs: [
            {
              beforeIndex: 0,
              afterIndex: 1,
              rationale: "same scene, different completion state",
            },
            // This pair includes a face-rejected photo and should be dropped.
            {
              beforeIndex: 1,
              afterIndex: 2,
              rationale: "ignored",
            },
          ],
        })
      )
    );
    const out = await curateJobPhotos(baseInputs(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.beforeAfterPairs).toHaveLength(1);
    expect(out.beforeAfterPairs[0].rationale).toContain(
      "completion"
    );
  });
});

describe("maya-service-job-photo-curator — adversarial / errors", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("propagates OpenRouter 503", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "boom" }, 503)
    );
    await expect(
      curateJobPhotos(baseInputs(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/503/);
  });

  it("throws on malformed LLM JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent("NOT JSON")
    );
    await expect(
      curateJobPhotos(baseInputs(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow(/malformed/);
  });

  it("ignores out-of-bounds index entries from LLM", async () => {
    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: [
            { index: 99, qualityScore: 0.9, visualQuality: "excellent", framingNotes: "", flags: [], suggestedUses: [] },
            { index: 0, qualityScore: 0.85, visualQuality: "good", framingNotes: "", flags: [], suggestedUses: [] },
          ],
          beforeAfterPairs: [],
        })
      )
    );
    const out = await curateJobPhotos(baseInputs(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.bestPhotos).toHaveLength(1);
    expect(out.bestPhotos[0].url).toBe(
      "https://r2.example/biz1/job1/photo-0.jpg"
    );
  });
});

describe("maya-service-job-photo-curator — cross-tenant", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it("Business A's photo URLs never appear in Business B's input or output", async () => {
    const t = convexTest(schema, modules);
    const mike = await seedSingleBusiness(t, "mike");
    const sarah = await seedSingleBusiness(t, "sarah");

    const mikeUrls = mike.fixture.photos
      .map((p) => p.url)
      .filter((u) => u.startsWith("http"))
      .slice(0, 3);
    const sarahUrls = sarah.fixture.photos
      .map((p) => p.url)
      .filter((u) => u.startsWith("http"))
      .slice(0, 3);

    expect(mikeUrls.length).toBeGreaterThan(0);

    const fetchImpl = vi.fn(async () =>
      mockOpenRouterContent(
        JSON.stringify({
          perPhoto: mikeUrls.map((_u, i) => ({
            index: i,
            qualityScore: 0.85,
            visualQuality: "good",
            framingNotes: `photo ${i}`,
            flags: [],
            suggestedUses: ["gbp-post"],
          })),
          beforeAfterPairs: [],
        })
      )
    );

    const out = await curateJobPhotos(
      baseInputs({ photoUrls: mikeUrls, maxPhotosOut: 3 }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    for (const p of out.bestPhotos) {
      expect(sarahUrls).not.toContain(p.url);
      expect(mikeUrls).toContain(p.url);
    }
  });
});
