import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATOR_MAYA_V0_ROUTES,
  assertCreatorMayaV0ImportAllowed,
  forbiddenCreatorMayaV0Import,
  isCreatorMayaV0Route,
} from "../scope";

const root = process.cwd();

describe("Creator Maya v0 scope gates", () => {
  it("keeps the required v0 route inventory small", () => {
    expect([...CREATOR_MAYA_V0_ROUTES]).toEqual([
      "/onboarding",
      "/today",
      "/plan",
      "/posts",
      "/memory",
      "/settings",
    ]);
    expect(isCreatorMayaV0Route("/today")).toBe(true);
    expect(isCreatorMayaV0Route("/deals")).toBe(false);
    expect(isCreatorMayaV0Route("/performance")).toBe(false);
  });

  it("fails closed on imports from the old broad creator and service-business surfaces", () => {
    expect(forbiddenCreatorMayaV0Import("../riley_growth/generators")).toBe(
      "riley_growth"
    );
    expect(forbiddenCreatorMayaV0Import("@/components/business/JobCard")).toBe(
      "business"
    );
    expect(() =>
      assertCreatorMayaV0ImportAllowed("@/convex/creatorMayaV0/videoSampling")
    ).not.toThrow();
  });

  it("links the TikTok-first sprint plan from README", () => {
    const docPath = join(
      root,
      "docs",
      "CREATOR_MAYA_TIKTOK_FIRST_SPRINT_PLAN.md"
    );
    const readme = readFileSync(join(root, "README.md"), "utf8");

    expect(existsSync(docPath)).toBe(true);
    expect(readme).toContain("docs/CREATOR_MAYA_TIKTOK_FIRST_SPRINT_PLAN.md");
  });

  it("standardizes the vendor name to ScrapeCreators", () => {
    const doc = readFileSync(
      join(root, "docs", "CREATOR_MAYA_TIKTOK_FIRST_SPRINT_PLAN.md"),
      "utf8"
    );

    expect(doc).toContain("ScrapeCreators");
    expect(doc).not.toContain("CreatorScraper");
  });
});
