/**
 * mayaVoice — fixture-driven voice degradation test.
 *
 * Sprint 8 Slice C deliverable. Replaces the original Sprint 2 banned-term
 * grep with a corpus-driven test that runs every entry in
 * `tests/fixtures/mayaVoiceFixture.ts` through the four-check
 * `validateOutput` validator and asserts the expected pass/fail outcome.
 *
 * Coverage shape (counts asserted at the bottom):
 *   - ≥30 fixture entries total
 *   - ≥20 fail-mode entries split across 4 categories (≥5 each)
 *   - ≥10 realistic-pass entries
 *   - All 6 creator-pack workspace generators produce validator-clean output
 *
 * The workspace-generator subtest uses `kind: "workspace-file"` so the
 * length and citation checks are skipped (these are bootstrap docs, not
 * model utterances). The banned-term check still runs but tolerates
 * quoted-as-bad-example occurrences via `isInstructionalQuote`.
 *
 * Why this lives at `tests/mayaVoice.test.ts` (top-level, not nested):
 *   - It is a cross-cutting acceptance gate, not a per-module unit test.
 *   - It pulls from both `tests/fixtures/` and `convex/agents/packs/maya/
 *     workspace/` — the top-level location keeps the import paths
 *     uncomplicated.
 */

import { describe, it, expect } from "vitest";
import {
  validateOutput,
  bannedTermsCheck,
  lengthCheck,
  disclaimerPatternCheck,
  citationCheck,
} from "./lib/mayaVoiceValidator";
import {
  VOICE_FIXTURE,
  VOICE_FIXTURE_COUNTS,
  type VoiceFixtureEntry,
} from "./fixtures/mayaVoiceFixture";

import { generateAgentsMd } from "../convex/agents/packs/maya/workspace/generateAgentsMd";
import { generateUserMd } from "../convex/agents/packs/maya/workspace/generateUserMd";
import { generateMemoryMdSeed } from "../convex/agents/packs/maya/workspace/generateMemoryMdSeed";
import { generateHeartbeatMd } from "../convex/agents/packs/maya/workspace/generateHeartbeatMd";
import { generateBootMd } from "../convex/agents/packs/maya/workspace/generateBootMd";
import { generateDreamingMd } from "../convex/agents/packs/maya/workspace/generateDreamingMd";

import type { Doc } from "../convex/_generated/dataModel";

/* -------------------------------------------------------------------------- */
/* Fixture-driven subtest                                                      */
/* -------------------------------------------------------------------------- */

describe("mayaVoice — fixture-driven validation", () => {
  it("ships ≥50 entries with all 7 fail-mode categories + multi-send pass shape", () => {
    // Sprint 9.7 — extended from ≥30 to ≥50 entries to cover the four
    // new degradation modes (fabrication, jargon, 400-char cap regression,
    // bundled-multi-send) plus the multi-send pass-mode shape.
    expect(VOICE_FIXTURE_COUNTS.total).toBeGreaterThanOrEqual(50);
    const failMode =
      VOICE_FIXTURE_COUNTS.aiSelfReference +
      VOICE_FIXTURE_COUNTS.lengthBlowup +
      VOICE_FIXTURE_COUNTS.sycophancy +
      VOICE_FIXTURE_COUNTS.scaffolding +
      VOICE_FIXTURE_COUNTS.fabrication +
      VOICE_FIXTURE_COUNTS.jargon +
      VOICE_FIXTURE_COUNTS.lengthBlowup400;
    expect(failMode).toBeGreaterThanOrEqual(30);
    expect(VOICE_FIXTURE_COUNTS.realisticPass).toBeGreaterThanOrEqual(20);
    // Each fail-mode category must have ≥5 entries per spec.
    expect(VOICE_FIXTURE_COUNTS.aiSelfReference).toBeGreaterThanOrEqual(5);
    expect(VOICE_FIXTURE_COUNTS.lengthBlowup).toBeGreaterThanOrEqual(5);
    expect(VOICE_FIXTURE_COUNTS.sycophancy).toBeGreaterThanOrEqual(5);
    expect(VOICE_FIXTURE_COUNTS.scaffolding).toBeGreaterThanOrEqual(5);
    expect(VOICE_FIXTURE_COUNTS.fabrication).toBeGreaterThanOrEqual(5);
    expect(VOICE_FIXTURE_COUNTS.jargon).toBeGreaterThanOrEqual(5);
    expect(VOICE_FIXTURE_COUNTS.lengthBlowup400).toBeGreaterThanOrEqual(3);
  });

  // Group by scenario prefix for readable test failures. Each entry runs
  // as its own `it` so a single regression surfaces with the entry name.
  for (const entry of VOICE_FIXTURE) {
    runFixtureCase(entry);
  }
});

function runFixtureCase(entry: VoiceFixtureEntry): void {
  it(entry.scenario, () => {
    const result = validateOutput(entry.output);
    if (entry.expectedToPass) {
      // Render the failure detail when an output unexpectedly fails.
      expect(
        result.ok,
        `expected pass; got reasons=[${result.reasons.join(",")}] details=${result.details.join(" | ")}`
      ).toBe(true);
    } else {
      expect(
        result.ok,
        `expected fail (${entry.failureReasonIfNot ?? "n/a"}); got ok=true`
      ).toBe(false);
      // If the fixture declared expectedReasons, at least one must match.
      // This is the "failed for the right reason" guard — protects against
      // a fixture that fails by accident on a different check.
      if (entry.expectedReasons && entry.expectedReasons.length > 0) {
        const hasExpected = entry.expectedReasons.some((r) =>
          result.reasons.includes(r)
        );
        expect(
          hasExpected,
          `expected one of [${entry.expectedReasons.join(",")}], got [${result.reasons.join(",")}]`
        ).toBe(true);
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Workspace generator subtest                                                 */
/* -------------------------------------------------------------------------- */

describe("mayaVoice — workspace generator outputs are validator-clean", () => {
  // Stable creator + handles fixture for the generator inputs. Mirrors the
  // shape used by `assembleWorkspaceBundle.test.ts` so the generators see
  // realistic-but-pinned inputs.
  const creator: Doc<"creators"> = {
    _id: "k_creator_voice_test" as unknown as Doc<"creators">["_id"],
    _creationTime: 1_700_000_000_000,
    clerkUserId: "user_voice",
    email: "joshua.castro@example.com",
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "manager",
    createdAt: 1_700_000_000_000,
  };

  const handles: ReadonlyArray<Doc<"creatorHandles">> = [
    {
      _id: "k_h1" as unknown as Doc<"creatorHandles">["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: creator._id,
      platform: "tiktok",
      handle: "@joshuacastro",
      verified: true,
      followerCount: 47_321,
    },
  ];

  type GeneratorCase = {
    name: string;
    produce: () => string;
  };

  const cases: ReadonlyArray<GeneratorCase> = [
    {
      name: "generateAgentsMd (manager, embedded standing orders)",
      produce: () =>
        generateAgentsMd({
          creatorDisplayName: "Joshua Castro",
          plan: "manager",
          handles: [{ platform: "tiktok", handle: "@joshuacastro" }],
          embedStandingOrders: true,
          bootstrapMaxChars: 32_000,
        }),
    },
    {
      name: "generateAgentsMd (coach, split standing orders)",
      produce: () =>
        generateAgentsMd({
          creatorDisplayName: "Joshua Castro",
          plan: "coach",
          handles: [{ platform: "tiktok", handle: "@joshuacastro" }],
          embedStandingOrders: false,
          bootstrapMaxChars: 32_000,
        }),
    },
    {
      name: "generateUserMd (manager, no picture)",
      produce: () =>
        generateUserMd({ creator, picture: null, handles, plan: "manager" }),
    },
    {
      name: "generateMemoryMdSeed",
      produce: () =>
        generateMemoryMdSeed({
          creator,
          picture: null,
          handles,
          now: 1_700_000_000_000,
        }),
    },
    {
      name: "generateHeartbeatMd (manager)",
      produce: () => generateHeartbeatMd({ plan: "manager" }),
    },
    {
      name: "generateHeartbeatMd (coach)",
      produce: () => generateHeartbeatMd({ plan: "coach" }),
    },
    {
      name: "generateBootMd",
      produce: () =>
        generateBootMd({ creatorDisplayName: "Joshua Castro" }),
    },
    {
      name: "generateDreamingMd",
      produce: () => generateDreamingMd(),
    },
  ];

  for (const c of cases) {
    it(`${c.name} passes validateOutput(kind=workspace-file)`, () => {
      const out = c.produce();
      const result = validateOutput(out, "workspace-file");
      expect(
        result.ok,
        `workspace generator "${c.name}" failed: reasons=[${result.reasons.join(",")}] details=${result.details.join(" | ")}`
      ).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* Composition + sanity subtest                                                */
/* -------------------------------------------------------------------------- */

describe("mayaVoice — validator composition sanity", () => {
  it("validateOutput composes the four checks (each fires independently)", () => {
    // A single output that trips all four categories at once. Confirms the
    // top-level validator surfaces every category, not just the first.
    const compound =
      "Just to be clear, as an AI assistant I think you're absolutely crushing it! Two quick things before I begin: ".repeat(
        30
      );
    const result = validateOutput(compound);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("disclaimer-prefix");
    expect(result.reasons).toContain("banned-ai-self-reference");
    expect(result.reasons).toContain("banned-sycophancy");
    expect(result.reasons).toContain("banned-scaffolding");
    // Length should also fire on this monster.
    const longEnough =
      result.reasons.includes("length-words") ||
      result.reasons.includes("length-chars");
    expect(longEnough).toBe(true);
  });

  it("individual checks are independently exported and usable", () => {
    // Smoke-test that each check is callable without going through
    // validateOutput. Lets us reuse them inline if a future skill wants to
    // run a single check against a candidate draft.
    expect(bannedTermsCheck("As an AI, I think...", false).length).toBeGreaterThan(0);
    expect(lengthCheck("a ".repeat(400)).length).toBeGreaterThan(0);
    expect(
      disclaimerPatternCheck("Just to be clear, you're trending up.")
    ).not.toBeNull();
    // Clear cited claim should pass citationCheck — a 30-word output with
    // a numeric claim AND a weekday anchor.
    const citedFortyWords =
      "Tuesday's TikTok hit 47k views, about 2.1x your trailing average. Save rate is up. Want a draft for Thursday in the same hook shape, or rest the format and try a different open?";
    expect(citationCheck(citedFortyWords)).toBeNull();
  });
});
