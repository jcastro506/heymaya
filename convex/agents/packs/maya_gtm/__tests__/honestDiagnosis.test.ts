import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Sprint F — Honest Diagnosis.
 *
 * These assertions read the skill .md SOURCE files directly (not the bundled
 * copy) and confirm the Sprint F additions are present. The parent session
 * re-syncs the bundle after integrating these .md sources, so this test guards
 * the source of truth.
 *
 * The bar Sprint F enforces: a positioning-vs-distribution diagnostic that
 * separates "the audience SAW it but didn't want it" (positioning / messaging /
 * PMF) from "they never SAW it" (distribution / channel / venue), tells the
 * founder the hard truth with evidence, honors the Tier-2 reach-proxy caveat,
 * uses LLM judgment (no hardcoded thresholds), and feeds the weekly-review
 * strategic-shift decision. No file path here points at bundledLocalSkills.ts
 * or any convex/ generator — only the two skill .md sources under
 * agents/skills/maya-gtm/.
 */

// From convex/agents/packs/maya_gtm/__tests__/ up to the repo root is 5 levels.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKILLS_DIR = resolve(REPO_ROOT, "agents/skills/maya-gtm");

function readSkill(slug: string): string {
  return readFileSync(resolve(SKILLS_DIR, slug, "SKILL.md"), "utf8");
}

describe("Sprint F — maya-results-reviewer positioning-vs-distribution diagnostic", () => {
  const src = readSkill("maya-results-reviewer");
  const lower = src.toLowerCase();

  it("adds an explicit positioning-vs-distribution diagnosis step", () => {
    expect(lower).toContain("positioning");
    expect(lower).toContain("distribution");
    // The contrast is the judgment: saw-but-didn't-want vs never-saw.
    expect(lower).toMatch(/saw it.*(didn'?t want|didn'?t care)|didn'?t want it/);
    expect(lower).toMatch(/never (saw|got seen|seen)/);
  });

  it("names the positioning problem as a messaging problem, not a reach problem", () => {
    expect(lower).toContain("messaging problem");
    expect(lower).toContain("not a reach problem");
    // The hard truth: more posting won't fix a positioning problem.
    expect(lower).toMatch(/more posting won'?t fix it/);
  });

  it("frames distribution as channel/timing/venue, never-seen", () => {
    expect(lower).toMatch(/channel ?\/ ?timing ?\/ ?venue|channel \/ timing|wrong (subreddit|channel|venue|time)/);
  });

  it("carries the Tier-2 reach-proxy caveat and says when the signal is soft", () => {
    expect(lower).toContain("tier");
    expect(lower).toMatch(/proxy/);
    expect(lower).toMatch(/public view/);
    expect(lower).toMatch(/oauth/);
    // Must say the signal is soft / lower confidence on vanity surfaces.
    expect(lower).toMatch(/soft|noisy|lean, not a verdict/);
  });

  it("uses LLM judgment, not hardcoded thresholds (no-heuristics rule)", () => {
    expect(lower).toMatch(/no threshold|no hardcoded|judgment call|not absolutes/);
    // Guard against an accidental hardcoded numeric gate sneaking into rule 12.
    expect(src).not.toMatch(/if\s+views\s*>\s*\d/i);
    expect(src).not.toMatch(/threshold\s*=\s*\d/i);
  });

  it("exposes the diagnosis in the output schema (per-post + week rollup)", () => {
    expect(src).toContain("diagnosis");
    expect(src).toMatch(/"positioning"\s*\|\s*"distribution"/);
    expect(src).toContain("positioningVsDistribution");
    expect(src).toContain("positioningProblem");
    // A reframe the founder can test when it's a positioning problem.
    expect(src).toMatch(/reframeToTest/);
    expect(src).toContain("reachSignalConfidence");
  });

  it("keeps the brutally-honest, signups-not-likes voice", () => {
    // The anti-slop example must show the blunt positioning-vs-distribution line.
    expect(lower).toMatch(/saw this.*messaging problem|messaging problem, not a reach problem/);
    expect(lower).toMatch(/never had a chance|it never (had|got)/);
  });
});

describe("Sprint F — maya-weekly-review surfaces the diagnosis in the strategic shift", () => {
  const src = readSkill("maya-weekly-review");
  const lower = src.toLowerCase();

  it("reads the results-reviewer positioning rollup as a required input", () => {
    expect(src).toContain("maya-results-reviewer");
    expect(src).toContain("positioningVsDistribution");
  });

  it("links the diagnosis into Block 3 (strategic shift), not Block 4 regeneration", () => {
    // The linkage lives in the strategic-shift block.
    expect(src).toMatch(/Block 3/);
    expect(lower).toContain("positioning");
    expect(lower).toContain("distribution");
    // Must explicitly NOT duplicate Block 4's regeneration logic.
    expect(lower).toMatch(/do not duplicate block 4|not duplicate block 4/);
  });

  it("says plainly we won't out-post a positioning problem + proposes a reframe", () => {
    expect(lower).toMatch(/out-?post a positioning problem/);
    expect(lower).toMatch(/reframe/);
    // Strategy reconsideration, not a cadence bump.
    expect(lower).toMatch(/not a cadence bump|reframe, not (a )?cadence|strategy reconsideration/);
  });

  it("still proceeds normally on a genuine distribution problem", () => {
    expect(lower).toMatch(/distribution problem/);
    expect(lower).toMatch(/message is (still )?untested|untested/);
  });

  it("carries the Tier-2 soft-proxy caveat through to the review", () => {
    expect(lower).toMatch(/proxy/);
    expect(lower).toMatch(/lean, not a verdict|soft/);
  });
});
