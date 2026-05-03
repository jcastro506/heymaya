/**
 * wikiInitialPages — synthesis from a fixture businessPicture.
 *
 * Asserts:
 *   1. All 5 wiki sections (entity / concept / synthesis / source / report)
 *      get at least one page when the picture is well-formed.
 *   2. Every non-report page has non-empty provenance.
 *   3. No phantom-name leakage — competitor pages are a subset of the
 *      operator's named-competitor answers (Q9). The hallucination firewall
 *      regression: competitors that would only appear because the picture
 *      hallucinated are dropped.
 *   4. Local-positioning concept page renders even when the picture has
 *      thin localPositioning.
 *   5. No phantom-neighborhood leakage — neighborhoods are union of
 *      operator answers + picture's servedNeighborhoods.
 *   6. Source-pointer page count tracks `sourceCounts`.
 *
 * Pure-function tests (no convex-test harness needed — this is the renderer).
 */

import { describe, it, expect } from "vitest";
import { generateWikiInitialPages } from "../../../agents/packs/maya_service/wikiInitialPages";
import type { BusinessPictureLite } from "../../../agents/packs/maya_service/types";

const NOW_FIXED = 1_745_680_000_000; // 2026-04-26

function fixturePicture(
  overrides: Partial<BusinessPictureLite> = {}
): BusinessPictureLite {
  return {
    brandVoice: "Friendly, neighborhood, plainspoken",
    brandVoiceSamples: [],
    customerSentiment:
      "Customers consistently praise on-time arrival and clean job sites.",
    recurringServicePatterns: ["AC tune-up", "Furnace install"],
    localPositioning: {
      servedZips: ["68501", "68502"],
      servedNeighborhoods: ["Lincoln Park"],
      namedCompetitors: [
        { name: "Joe's HVAC", reputationalNote: "Faster but pricier" },
        { name: "AC King", gbpRating: 4.2 },
      ],
      recurringLocalHooks: [
        { kind: "season", text: "Nebraska winter cold snap" },
        { kind: "community", text: "Husker game day" },
      ],
      localChoiceThesis:
        "Locals choose us because we answer the phone and show up same-day.",
    },
    ...overrides,
  };
}

describe("generateWikiInitialPages — section coverage", () => {
  it("emits at least one page in each of the 5 wiki sections", () => {
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture: fixturePicture(),
      onboardingLocalAnswers: {
        namedCompetitors: ["Joe's HVAC", "AC King"],
        neighborhoodEmphasis: ["Lincoln Park", "Eagle Ridge"],
        operatorVolunteeredHooks: [
          "Nebraska winter cold snap",
          "Husker game day",
        ],
      },
      sourceCounts: { reviews: 30, posts: 20, hasGbpProfile: true },
      now: NOW_FIXED,
    });

    const kinds = new Set(out.pages.map((p) => p.kind));
    expect(kinds.has("entity")).toBe(true);
    expect(kinds.has("concept")).toBe(true);
    expect(kinds.has("synthesis")).toBe(true);
    expect(kinds.has("source")).toBe(true);
    expect(kinds.has("report")).toBe(true);
  });

  it("non-report pages always have non-empty provenance", () => {
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture: fixturePicture(),
      onboardingLocalAnswers: {
        namedCompetitors: ["Joe's HVAC", "AC King"],
        neighborhoodEmphasis: ["Lincoln Park"],
        operatorVolunteeredHooks: ["Nebraska winter cold snap"],
      },
      sourceCounts: { reviews: 30, posts: 20, hasGbpProfile: true },
      now: NOW_FIXED,
    });
    for (const page of out.pages) {
      if (page.kind === "report") continue;
      expect(page.provenance.length).toBeGreaterThan(0);
      for (const entry of page.provenance) {
        expect(entry.sourceId.length).toBeGreaterThan(0);
        expect(entry.path.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("generateWikiInitialPages — phantom-name regression", () => {
  it("drops competitor pages whose names aren't in operator answers", () => {
    const picture = fixturePicture({
      localPositioning: {
        servedZips: [],
        servedNeighborhoods: [],
        namedCompetitors: [
          { name: "Joe's HVAC" }, // operator-named — keep
          { name: "Phantom Co" }, // not in operator answers — drop
        ],
        recurringLocalHooks: [],
        localChoiceThesis: "",
      },
    });
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture,
      onboardingLocalAnswers: {
        namedCompetitors: ["Joe's HVAC"],
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    const competitorPages = out.pages.filter((p) =>
      p.vaultPath.startsWith("entities/competitors/")
    );
    expect(competitorPages).toHaveLength(1);
    expect(competitorPages[0].vaultPath).toBe(
      "entities/competitors/joe-s-hvac"
    );
    expect(out.droppedPhantomNames.length).toBe(1);
    expect(out.droppedPhantomNames[0].raw).toBe("Phantom Co");
  });

  it("competitor pages are a subset of operator's namedCompetitors", () => {
    const operatorAnswers = ["Acme HVAC", "BetaCool"];
    const picture = fixturePicture({
      localPositioning: {
        servedZips: [],
        servedNeighborhoods: [],
        namedCompetitors: [
          { name: "Acme HVAC" },
          { name: "BetaCool" },
          { name: "GammaAir" }, // phantom
        ],
        recurringLocalHooks: [],
        localChoiceThesis: "",
      },
    });
    const out = generateWikiInitialPages({
      businessName: "X",
      serviceTypes: ["hvac"],
      picture,
      onboardingLocalAnswers: {
        namedCompetitors: operatorAnswers,
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    const competitorNames = out.pages
      .filter((p) => p.vaultPath.startsWith("entities/competitors/"))
      .map((p) => p.claim.split(" is")[0]);
    const operatorSet = new Set(operatorAnswers);
    for (const n of competitorNames) {
      expect(operatorSet.has(n)).toBe(true);
    }
  });
});

describe("generateWikiInitialPages — neighborhood union", () => {
  it("unions operator-named + picture's servedNeighborhoods", () => {
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture: fixturePicture({
        localPositioning: {
          servedZips: [],
          servedNeighborhoods: ["Lincoln Park", "Lakeview"],
          namedCompetitors: [],
          recurringLocalHooks: [],
          localChoiceThesis: "",
        },
      }),
      onboardingLocalAnswers: {
        namedCompetitors: [],
        neighborhoodEmphasis: ["Lincoln Park", "Eagle Ridge"],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    const neighborhoods = out.pages
      .filter((p) => p.vaultPath.startsWith("entities/neighborhoods/"))
      .map((p) => p.vaultPath);
    // Union: Lincoln Park + Eagle Ridge + Lakeview (deduped by slug)
    expect(neighborhoods).toContain("entities/neighborhoods/lincoln-park");
    expect(neighborhoods).toContain("entities/neighborhoods/eagle-ridge");
    expect(neighborhoods).toContain("entities/neighborhoods/lakeview");
  });
});

describe("generateWikiInitialPages — source pointers", () => {
  it("emits source-pointer page only when the corresponding count > 0", () => {
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture: fixturePicture(),
      onboardingLocalAnswers: {
        namedCompetitors: [],
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 5, hasGbpProfile: true },
      now: NOW_FIXED,
    });
    const sourcePaths = out.pages
      .filter((p) => p.kind === "source")
      .map((p) => p.vaultPath);
    expect(sourcePaths).toContain("sources/onboarding/gbp-profile");
    expect(sourcePaths).toContain("sources/onboarding/posts");
    expect(sourcePaths).not.toContain("sources/onboarding/reviews");
  });

  it("emits no source pages when sourceCounts is all zero", () => {
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture: fixturePicture(),
      onboardingLocalAnswers: {
        namedCompetitors: [],
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    const sourcePages = out.pages.filter((p) => p.kind === "source");
    expect(sourcePages).toHaveLength(0);
  });
});

describe("generateWikiInitialPages — adversarial / thin inputs", () => {
  it("renders cleanly even with empty localPositioning", () => {
    const picture: BusinessPictureLite = {
      brandVoice: "",
      brandVoiceSamples: [],
      localPositioning: {
        servedZips: [],
        servedNeighborhoods: [],
        namedCompetitors: [],
        recurringLocalHooks: [],
        localChoiceThesis: "",
      },
    };
    const out = generateWikiInitialPages({
      businessName: "Henderson HVAC",
      serviceTypes: ["hvac"],
      picture,
      onboardingLocalAnswers: {
        namedCompetitors: [],
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    // At minimum: service-type concept + local-positioning concept +
    // synthesis page + report seed = 4 pages.
    expect(out.pages.length).toBeGreaterThanOrEqual(4);
    const servicePage = out.pages.find(
      (p) => p.vaultPath === "concepts/service-type-taxonomy"
    );
    expect(servicePage).toBeDefined();
    const positioningPage = out.pages.find(
      (p) => p.vaultPath === "concepts/local-positioning"
    );
    expect(positioningPage).toBeDefined();
    expect(out.droppedPhantomNames).toHaveLength(0);
  });

  it("synthesis page has stable date-slugged path for `now`", () => {
    const out = generateWikiInitialPages({
      businessName: "X",
      serviceTypes: ["hvac"],
      picture: fixturePicture(),
      onboardingLocalAnswers: {
        namedCompetitors: ["Joe's HVAC", "AC King"],
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    const synth = out.pages.find((p) => p.kind === "synthesis");
    expect(synth).toBeDefined();
    // 2026-04-26 → ISO date
    expect(synth!.vaultPath).toMatch(/^syntheses\/business-picture-\d{4}-\d{2}-\d{2}$/);
  });
});

describe("generateWikiInitialPages — confidence bands", () => {
  it("operator-named competitors carry highest confidence", () => {
    const out = generateWikiInitialPages({
      businessName: "X",
      serviceTypes: ["hvac"],
      picture: fixturePicture({
        localPositioning: {
          servedZips: [],
          servedNeighborhoods: [],
          namedCompetitors: [{ name: "Joe's HVAC" }],
          recurringLocalHooks: [],
          localChoiceThesis: "",
        },
      }),
      onboardingLocalAnswers: {
        namedCompetitors: ["Joe's HVAC"],
        neighborhoodEmphasis: [],
        operatorVolunteeredHooks: [],
      },
      sourceCounts: { reviews: 0, posts: 0, hasGbpProfile: false },
      now: NOW_FIXED,
    });
    const compPage = out.pages.find((p) =>
      p.vaultPath.startsWith("entities/competitors/")
    );
    expect(compPage?.confidence).toBeGreaterThan(0.9);
  });
});
