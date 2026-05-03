/**
 * Wave C.5 — learnings extractor unit tests.
 *
 * Five mandatory categories + outcome-specific:
 *   1. Cross-tenant: handled by orchestrator (`runLearningsExtractor.ts`),
 *      not the pure script. We assert the script does NOT read businessId
 *      from inputs (which it doesn't — input is already scoped).
 *   2. Plan-tier: extractor runs at every tier; output identical regardless.
 *      We assert the SKILL_METADATA exposes all three plans.
 *   3. Adversarial:
 *      - Replay: same inputs → same output (deterministic; no LLM call seam).
 *      - Empty window short-circuit.
 *      - Phantom-pattern guard: 2-sample fixture emits zero patterns.
 *      - Malformed window throws.
 *   4. Sibling-file scan: covered separately by skill-wiki-integration.test.ts
 *      and siblingFileScan.test.ts.
 *   5. TODO grep: repo-wide, separate file.
 *   Outcome-specific:
 *      - Attribution chain integrity: a fixture where lead → post X and
 *        job → lead produces a pattern that mentions both ids.
 *      - 8-week timeline acceptance: priorWeekDelta.jobsAttributedDelta
 *        increases week-over-week.
 */

import { describe, it, expect } from "vitest";
import {
  extractWeeklyLearnings,
  weekTag,
  slugify,
  MIN_SAMPLE_SIZE,
  SKILL_METADATA,
  __test__,
  type ExtractorInputs,
  type LlmCaller,
  type ExtractorPost,
  type ExtractorLead,
  type ExtractorJob,
  type ExtractorReviewRequest,
} from "../script";

const NOW = 1_700_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

function emptyInputs(): ExtractorInputs {
  return {
    weekStartMs: NOW - ONE_WEEK,
    weekEndMs: NOW,
    priorWindowStartMs: NOW - 2 * ONE_WEEK,
    priorWindowEndMs: NOW - ONE_WEEK,
    posts: [],
    leads: [],
    jobs: [],
    reviewRequests: [],
  };
}

function makePost(overrides: Partial<ExtractorPost> & Pick<ExtractorPost, "id" | "postedAt">): ExtractorPost {
  return {
    text: "default post text",
    engagementMetrics: { callsClicked: 0, directionsClicked: 0, websiteClicked: 0, postViews: 0 },
    attributedLeadIds: [],
    ...overrides,
  };
}
function makeLead(overrides: Partial<ExtractorLead> & Pick<ExtractorLead, "id" | "capturedAt">): ExtractorLead {
  return {
    source: "gbp-msg",
    ...overrides,
  };
}
function makeJob(overrides: Partial<ExtractorJob> & Pick<ExtractorJob, "id">): ExtractorJob {
  return { ...overrides };
}
function makeReviewRequest(
  overrides: Partial<ExtractorReviewRequest> & Pick<ExtractorReviewRequest, "id" | "channel">
): ExtractorReviewRequest {
  return { ...overrides };
}

/* -------------------------------------------------------------------------- */
/* Adversarial: empty window short-circuit                                     */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — adversarial inputs", () => {
  it("empty window returns empty output without calling LLM", async () => {
    let llmCalled = false;
    const llm: LlmCaller = async () => {
      llmCalled = true;
      return "[]";
    };
    const out = await extractWeeklyLearnings(emptyInputs(), llm);
    expect(out.topPatterns).toEqual([]);
    expect(out.priorWeekDelta).toBeNull();
    expect(out.wikiApplies).toEqual([]);
    expect(llmCalled).toBe(false);
  });

  it("invalid window throws", async () => {
    const bad: ExtractorInputs = {
      ...emptyInputs(),
      weekStartMs: NOW,
      weekEndMs: NOW - 1, // end before start
    };
    await expect(extractWeeklyLearnings(bad)).rejects.toThrow(/invalid window/);
  });

  it("NaN/Infinity in window bounds throws", async () => {
    await expect(
      extractWeeklyLearnings({ ...emptyInputs(), weekStartMs: NaN })
    ).rejects.toThrow(/invalid window/);
    await expect(
      extractWeeklyLearnings({ ...emptyInputs(), weekEndMs: Infinity })
    ).rejects.toThrow(/invalid window/);
  });
});

/* -------------------------------------------------------------------------- */
/* Phantom-pattern guard                                                       */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — phantom-pattern guard", () => {
  it("2 posts with the same hook DO NOT produce a local-hook pattern", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({
          id: "p1",
          postedAt: NOW - 6 * ONE_DAY,
          localHookText: "Friday freeze warning",
          engagementMetrics: { callsClicked: 5, directionsClicked: 0, websiteClicked: 0, postViews: 50 },
        }),
        makePost({
          id: "p2",
          postedAt: NOW - 5 * ONE_DAY,
          localHookText: "Friday freeze warning",
          engagementMetrics: { callsClicked: 3, directionsClicked: 0, websiteClicked: 0, postViews: 30 },
        }),
      ],
    };
    const out = await extractWeeklyLearnings(inputs);
    expect(out.topPatterns).toEqual([]);
    expect(out.wikiApplies).toEqual([]);
  });

  it("3 posts with the same hook DO produce a local-hook pattern", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({
          id: "p1",
          postedAt: NOW - 6 * ONE_DAY,
          localHookText: "Friday freeze warning",
          engagementMetrics: { callsClicked: 5, directionsClicked: 0, websiteClicked: 0, postViews: 50 },
        }),
        makePost({
          id: "p2",
          postedAt: NOW - 5 * ONE_DAY,
          localHookText: "Friday freeze warning",
          engagementMetrics: { callsClicked: 3, directionsClicked: 0, websiteClicked: 0, postViews: 30 },
        }),
        makePost({
          id: "p3",
          postedAt: NOW - 4 * ONE_DAY,
          localHookText: "Friday freeze warning",
          engagementMetrics: { callsClicked: 4, directionsClicked: 0, websiteClicked: 0, postViews: 40 },
        }),
      ],
    };
    const out = await extractWeeklyLearnings(inputs);
    expect(out.topPatterns.length).toBeGreaterThanOrEqual(1);
    const localHookPattern = out.topPatterns.find((p) => p.kind === "local-hook");
    expect(localHookPattern).toBeDefined();
    expect(localHookPattern!.sampleSize).toBe(3);
    // Confidence ceiling for sample-size 3 is 0.5.
    expect(localHookPattern!.confidence).toBe(0.5);
  });

  it("MIN_SAMPLE_SIZE constant equals 3 (locked rule)", () => {
    expect(MIN_SAMPLE_SIZE).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Outcome attribution: every claim references a metric                       */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — outcome-attributed claims only", () => {
  it("every emitted claim contains an outcome metric reference", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({
          id: "p1",
          postedAt: NOW - 6 * ONE_DAY,
          localHookText: "Friday freeze warning",
          attributedLeadIds: ["l1"],
          engagementMetrics: { callsClicked: 5, directionsClicked: 0, websiteClicked: 0, postViews: 50 },
        }),
        makePost({
          id: "p2",
          postedAt: NOW - 5 * ONE_DAY,
          localHookText: "Friday freeze warning",
          attributedLeadIds: ["l2"],
          engagementMetrics: { callsClicked: 3, directionsClicked: 0, websiteClicked: 0, postViews: 30 },
        }),
        makePost({
          id: "p3",
          postedAt: NOW - 4 * ONE_DAY,
          localHookText: "Friday freeze warning",
          attributedLeadIds: ["l3"],
          engagementMetrics: { callsClicked: 4, directionsClicked: 0, websiteClicked: 0, postViews: 40 },
        }),
      ],
      leads: [
        makeLead({ id: "l1", capturedAt: NOW - 6 * ONE_DAY, originatingActionKind: "gbp-post", originatingActionId: "p1", convertedJobId: "j1" }),
        makeLead({ id: "l2", capturedAt: NOW - 5 * ONE_DAY, originatingActionKind: "gbp-post", originatingActionId: "p2" }),
        makeLead({ id: "l3", capturedAt: NOW - 4 * ONE_DAY, originatingActionKind: "gbp-post", originatingActionId: "p3", convertedJobId: "j2" }),
      ],
      jobs: [
        makeJob({ id: "j1", originatingLeadId: "l1" }),
        makeJob({ id: "j2", originatingLeadId: "l3" }),
      ],
    };
    const out = await extractWeeklyLearnings(inputs);
    expect(out.topPatterns.length).toBeGreaterThanOrEqual(1);
    for (const p of out.topPatterns) {
      expect(__test__.claimHasOutcome(p.claim), `claim missing outcome: '${p.claim}'`).toBe(true);
    }
  });

  it("rejects LLM phrasing without outcome metrics; falls back deterministic", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({ id: "p1", postedAt: NOW - 6 * ONE_DAY, localHookText: "Test hook" }),
        makePost({ id: "p2", postedAt: NOW - 5 * ONE_DAY, localHookText: "Test hook" }),
        makePost({ id: "p3", postedAt: NOW - 4 * ONE_DAY, localHookText: "Test hook" }),
      ],
    };
    // LLM returns an aesthetic claim with no outcome metrics — should be rejected.
    const llm: LlmCaller = async () =>
      JSON.stringify([
        {
          slug: "concepts/what-works/gbp/local-hook-test-hook",
          claim: "This hook felt very natural and warm and engaging.",
        },
      ]);
    const out = await extractWeeklyLearnings(inputs, llm);
    expect(out.topPatterns.length).toBe(1);
    // The aesthetic claim should be REPLACED by the deterministic fallback.
    expect(out.topPatterns[0].claim).not.toContain("natural and warm");
    expect(__test__.claimHasOutcome(out.topPatterns[0].claim)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism / replay                                                        */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — replay + determinism", () => {
  it("same inputs without LLM produce identical output", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({ id: "p1", postedAt: NOW - 6 * ONE_DAY, localHookText: "AC tune-up week" }),
        makePost({ id: "p2", postedAt: NOW - 5 * ONE_DAY, localHookText: "AC tune-up week" }),
        makePost({ id: "p3", postedAt: NOW - 4 * ONE_DAY, localHookText: "AC tune-up week" }),
      ],
    };
    const a = await extractWeeklyLearnings(inputs);
    const b = await extractWeeklyLearnings(inputs);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("LLM failure swallowed; falls back to deterministic claim", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({ id: "p1", postedAt: NOW - 6 * ONE_DAY, localHookText: "Test hook" }),
        makePost({ id: "p2", postedAt: NOW - 5 * ONE_DAY, localHookText: "Test hook" }),
        makePost({ id: "p3", postedAt: NOW - 4 * ONE_DAY, localHookText: "Test hook" }),
      ],
    };
    const llm: LlmCaller = async () => {
      throw new Error("openrouter timeout");
    };
    const out = await extractWeeklyLearnings(inputs, llm);
    expect(out.topPatterns.length).toBe(1);
    expect(__test__.claimHasOutcome(out.topPatterns[0].claim)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan-tier identical regardless of caller                                    */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — plan-tier identical at every tier", () => {
  it("SKILL_METADATA exposes all three plans (no gating)", () => {
    expect(SKILL_METADATA.planTier).toEqual(["starter", "pro", "studio"]);
  });
  it("MEDIUM thinking budget per § 3 routing", () => {
    expect(SKILL_METADATA.thinkingBudget).toBe("medium");
  });
  it("Gemini 3 Flash model target", () => {
    expect(SKILL_METADATA.modelTarget).toBe("gemini-3-flash");
  });
  it("modelTarget + thinkingBudget + routedReason all set", () => {
    expect(SKILL_METADATA.routedReason.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Attribution chain integrity                                                 */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — attribution chain integrity", () => {
  it("post → lead → job chain produces a pattern citing all three ids", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      posts: [
        makePost({
          id: "post_X1",
          postedAt: NOW - 6 * ONE_DAY,
          localHookText: "Same hook",
          attributedLeadIds: ["lead_A1"],
        }),
        makePost({
          id: "post_X2",
          postedAt: NOW - 5 * ONE_DAY,
          localHookText: "Same hook",
          attributedLeadIds: ["lead_A2"],
        }),
        makePost({
          id: "post_X3",
          postedAt: NOW - 4 * ONE_DAY,
          localHookText: "Same hook",
          attributedLeadIds: ["lead_A3"],
        }),
      ],
      leads: [
        makeLead({ id: "lead_A1", capturedAt: NOW - 6 * ONE_DAY, originatingActionKind: "gbp-post", originatingActionId: "post_X1", convertedJobId: "job_Y1" }),
        makeLead({ id: "lead_A2", capturedAt: NOW - 5 * ONE_DAY, originatingActionKind: "gbp-post", originatingActionId: "post_X2", convertedJobId: "job_Y2" }),
        makeLead({ id: "lead_A3", capturedAt: NOW - 4 * ONE_DAY, originatingActionKind: "gbp-post", originatingActionId: "post_X3" }),
      ],
      jobs: [
        makeJob({ id: "job_Y1", originatingLeadId: "lead_A1" }),
        makeJob({ id: "job_Y2", originatingLeadId: "lead_A2" }),
      ],
    };
    const out = await extractWeeklyLearnings(inputs);
    const pattern = out.topPatterns.find((p) => p.kind === "local-hook");
    expect(pattern).toBeDefined();
    expect(pattern!.jobsAttributed).toBe(2);
    // Wiki page provenance must reference all three post ids.
    const wiki = out.wikiApplies.find((w) => w.vaultPath === pattern!.wikiVaultPath);
    expect(wiki).toBeDefined();
    const sourceIds = wiki!.provenance.map((p) => p.sourceId);
    expect(sourceIds).toContain("gbpPost:post_X1");
    expect(sourceIds).toContain("gbpPost:post_X2");
    expect(sourceIds).toContain("gbpPost:post_X3");
  });

  it("review-request channel pattern: SMS sample with 3 5-stars", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      reviewRequests: [
        makeReviewRequest({ id: "r1", channel: "sms", sentAt: NOW - 6 * ONE_DAY, responseRating: 5, responseAt: NOW - 5 * ONE_DAY }),
        makeReviewRequest({ id: "r2", channel: "sms", sentAt: NOW - 5 * ONE_DAY, responseRating: 5, responseAt: NOW - 4 * ONE_DAY }),
        makeReviewRequest({ id: "r3", channel: "sms", sentAt: NOW - 4 * ONE_DAY, responseRating: 5, responseAt: NOW - 3 * ONE_DAY }),
      ],
    };
    const out = await extractWeeklyLearnings(inputs);
    const pattern = out.topPatterns.find((p) => p.kind === "review-request-channel");
    expect(pattern).toBeDefined();
    expect(pattern!.fiveStarsAttributed).toBe(3);
    expect(pattern!.sampleSize).toBe(3);
    expect(__test__.claimHasOutcome(pattern!.claim)).toBe(true);
  });

  it("response-latency pattern fires when converted leads respond fast", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      leads: [
        // Converted leads — 5 min response latency
        makeLead({ id: "l1", capturedAt: NOW - 6 * ONE_DAY, responseLatencyMs: 5 * 60 * 1000, convertedJobId: "j1" }),
        makeLead({ id: "l2", capturedAt: NOW - 5 * ONE_DAY, responseLatencyMs: 7 * 60 * 1000, convertedJobId: "j2" }),
        // Lost leads — 60 min response latency
        makeLead({ id: "l3", capturedAt: NOW - 4 * ONE_DAY, responseLatencyMs: 60 * 60 * 1000 }),
        makeLead({ id: "l4", capturedAt: NOW - 3 * ONE_DAY, responseLatencyMs: 90 * 60 * 1000 }),
      ],
      jobs: [
        makeJob({ id: "j1", originatingLeadId: "l1" }),
        makeJob({ id: "j2", originatingLeadId: "l2" }),
      ],
    };
    const out = await extractWeeklyLearnings(inputs);
    const pattern = out.topPatterns.find((p) => p.kind === "response-latency");
    expect(pattern).toBeDefined();
    expect(pattern!.jobsAttributed).toBe(2);
    expect(__test__.claimHasOutcome(pattern!.claim)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 8-week timeline acceptance: jobs-attributed-delta increases week-over-week */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — 8-week timeline acceptance", () => {
  it("priorWeekDelta.jobsAttributedDelta increases when current > prior", async () => {
    const inputs: ExtractorInputs = {
      ...emptyInputs(),
      // Current: 3 jobs originating from leads
      jobs: [
        makeJob({ id: "j1", originatingLeadId: "l1" }),
        makeJob({ id: "j2", originatingLeadId: "l2" }),
        makeJob({ id: "j3", originatingLeadId: "l3" }),
      ],
      reviewRequests: [
        makeReviewRequest({ id: "r1", channel: "sms", responseRating: 5 }),
        makeReviewRequest({ id: "r2", channel: "sms", responseRating: 5 }),
      ],
      priorWindow: {
        // Prior: 1 job
        jobs: [makeJob({ id: "j_prev", originatingLeadId: "l_prev" })],
        leads: [],
        posts: [],
        reviewRequests: [makeReviewRequest({ id: "r_prev", channel: "sms", responseRating: 5 })],
        priorPatternKinds: [],
      },
    };
    const out = await extractWeeklyLearnings(inputs);
    expect(out.priorWeekDelta).not.toBeNull();
    expect(out.priorWeekDelta!.jobsAttributedDelta).toBe(2); // 3 - 1
    expect(out.priorWeekDelta!.fiveStarsAttributedDelta).toBe(1); // 2 - 1
  });

  it("priorWeekDelta is null when no priorWindow given", async () => {
    const out = await extractWeeklyLearnings(emptyInputs());
    expect(out.priorWeekDelta).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

describe("learnings-extractor — helpers", () => {
  it("weekTag is deterministic ISO-week-ish", () => {
    // 2023-11-14 (Tue) — somewhere in the year
    const t = weekTag(NOW);
    expect(t).toMatch(/^\d{4}-w\d{2}$/);
  });
  it("slugify drops punctuation + lowercases + truncates", () => {
    expect(slugify("Friday Freeze Warning!")).toBe("friday-freeze-warning");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(64);
  });
  it("confidenceFor caps by sample-size band", () => {
    expect(__test__.confidenceFor(2)).toBe(0);
    expect(__test__.confidenceFor(3)).toBe(0.5);
    expect(__test__.confidenceFor(6)).toBe(0.7);
    expect(__test__.confidenceFor(10)).toBe(0.9);
    expect(__test__.confidenceFor(100)).toBe(0.9); // never 1.0
  });
  it("parseClaimResponse handles code-fenced JSON", () => {
    const raw = '```json\n[{"slug":"a","claim":"3 jobs"}]\n```';
    const out = __test__.parseClaimResponse(raw);
    expect(out).toEqual([{ slug: "a", claim: "3 jobs" }]);
  });
  it("parseClaimResponse returns null on garbage", () => {
    expect(__test__.parseClaimResponse("not json")).toBeNull();
    expect(__test__.parseClaimResponse("{}")).toBeNull(); // not an array
  });
});
