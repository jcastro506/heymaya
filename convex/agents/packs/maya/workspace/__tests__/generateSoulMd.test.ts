/**
 * generateSoulMd — pure-function generator tests.
 *
 * Coverage (against the 5 mandatory categories from CLAUDE.md):
 *   1. Cross-tenant isolation (n/a — pure function of inputs).
 *   2. Plan-tier × output: Coach vs Manager autonomy blocks render distinctly.
 *   3. Adversarial inputs: missing picture / missing brand-deal floor / missing
 *      tonePreference + openingAnswers all degrade safely to defaults rather
 *      than throwing or interpolating `undefined`.
 *   4. Sibling-file scan (n/a — covered by the bundle-level scan).
 *   5. TODO grep (n/a — repo-level lint).
 *
 * Voice rules:
 *   - Banned terms (operator-locked): "AI manager", "AI assistant", "as an AI",
 *     "I'm an AI", "I will synthesize", "I'll synthesize", "great question",
 *     "amazing".
 *   - Anti-sycophancy block must exist.
 *   - SOUL.md ≤ SOUL_MAX_CHARS (6K).
 */

import { describe, it, expect } from "vitest";
import { generateSoulMd } from "../generateSoulMd";
import type { Doc } from "../../../../../_generated/dataModel";
import type { CreatorPictureExt } from "../types";

// Sprint 9.7+ — bumped 6000 → 9500 to accommodate the cited-insight
// quality-bar section (the load-bearing rule that prevents Maya from
// firing weak audience-tautology insights on first-boot). SOUL.md is
// loaded every session — keeping it under 10K leaves comfortable budget
// for everything else inside Gemini Flash's 1M context.
const SOUL_MAX_CHARS = 9_500;

// AI-self-reference + sycophantic-output patterns that have to stay off
// every Maya surface. The list intentionally excludes phrases SOUL.md
// correctly names as anti-patterns ("'great question'", "'amazing work'") —
// those meta-references are how the doc *teaches* Maya what not to say.
// We verify the anti-sycophancy *frame* via a separate substring check.
const BANNED_TERMS = [
  "AI manager",
  "AI assistant",
  "as an AI",
  "I'm an AI",
  "I will synthesize",
  "I'll synthesize",
];

function baseCreator(over: Partial<Doc<"creators">> = {}): Doc<"creators"> {
  return {
    _id: "k_creator_a" as unknown as Doc<"creators">["_id"],
    _creationTime: 1_700_000_000_000,
    clerkUserId: "user_a",
    email: "test.creator@example.com",
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "manager",
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

describe("generateSoulMd — happy path", () => {
  it("emits non-empty markdown with the canonical anti-sycophancy block", () => {
    const out = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    expect(out.length).toBeGreaterThan(800);
    expect(out.length).toBeLessThanOrEqual(SOUL_MAX_CHARS);
    expect(out).toContain("# SOUL.md — Maya for");
    expect(out).toContain("Anti-sycophancy");
    expect(out).toContain("Anti-fake-busy");
    expect(out).toContain("Voice posture");
    expect(out).toContain("Hard rules I never violate");
  });

  it("uses the creator's display name when present, else derives from email", () => {
    const out1 = generateSoulMd({
      creator: baseCreator({ displayName: "Joshua" }),
      picture: null,
      plan: "manager",
    });
    expect(out1).toContain("Maya for Joshua");
    // Sprint 9.7+ — tier-aware role label. Manager tier → "content manager".
    expect(out1).toContain("Joshua's content manager");

    const out2 = generateSoulMd({
      creator: baseCreator({ email: "j.castro@example.com" }),
      picture: null,
      plan: "manager",
    });
    expect(out2).toContain("Maya for J Castro");
  });

  it("uses tonePreference when set on the creator row", () => {
    for (const vibe of ["supportive", "strategic", "tough-love"] as const) {
      const out = generateSoulMd({
        creator: baseCreator({ tonePreference: vibe }),
        picture: null,
        plan: "manager",
      });
      // Vibe description token (capitalized first word) appears in the
      // Voice posture section.
      const expected = vibe[0].toUpperCase() + vibe.slice(1);
      expect(out).toContain(`${expected}:`);
    }
  });

  it("falls back to picture.openingAnswers.tone when tonePreference unset", () => {
    const picture: CreatorPictureExt = {
      _id: "k_pic" as unknown as CreatorPictureExt["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: "k_creator_a" as unknown as Doc<"creators">["_id"],
      niche: "founder content",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      voiceFingerprint: "direct",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: 1_700_000_000_000,
      model: "test",
      sourceCitations: [],
      openingAnswers: {
        goal: "grow audience",
        tone: "tough-love",
        submittedAt: 1_700_000_000_000,
      },
    };
    const out = generateSoulMd({
      creator: baseCreator(),
      picture,
      plan: "manager",
    });
    expect(out).toContain("Tough-love:");
  });

  it("defaults to strategic when neither tonePreference nor openingAnswers is set", () => {
    const out = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    expect(out).toContain("Strategic:");
  });

  it("renders Coach vs Manager autonomy distinctly", () => {
    const coach = generateSoulMd({
      creator: baseCreator({ plan: "coach" }),
      picture: null,
      plan: "coach",
    });
    const manager = generateSoulMd({
      creator: baseCreator({ plan: "manager" }),
      picture: null,
      plan: "manager",
    });
    expect(coach).toContain("advisory only");
    expect(coach).toContain("No cold outbound");
    expect(manager).toContain("advisory plus delegated production");
    expect(manager).toContain("auto-send under the creator's threshold");
  });

  it("surfaces the brand-deal floor when set; says 'not yet set' otherwise", () => {
    const picture: CreatorPictureExt = {
      _id: "k_pic" as unknown as CreatorPictureExt["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: "k_creator_a" as unknown as Doc<"creators">["_id"],
      niche: "founder content",
      audience: { ageRanges: [], topGeos: [], interestTags: [] },
      voiceFingerprint: "direct",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: 1_700_000_000_000,
      model: "test",
      sourceCitations: [],
      openingAnswers: {
        goal: "grow audience",
        tone: "strategic",
        brandDealFloorUsd: 2_500,
        submittedAt: 1_700_000_000_000,
      },
    };
    const withFloor = generateSoulMd({
      creator: baseCreator(),
      picture,
      plan: "manager",
    });
    expect(withFloor).toContain("$2,500");

    const withoutFloor = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    expect(withoutFloor).toContain("not yet set");
  });

  it("is deterministic: same inputs → identical output", () => {
    const a = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    const b = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    expect(a).toBe(b);
  });
});

describe("generateSoulMd — banned voice terms (operator-locked)", () => {
  it("does NOT contain any of the banned terms in any plan / vibe combo", () => {
    const vibes = ["supportive", "strategic", "tough-love"] as const;
    const plans = ["coach", "manager"] as const;
    for (const vibe of vibes) {
      for (const plan of plans) {
        const out = generateSoulMd({
          creator: baseCreator({ tonePreference: vibe, plan }),
          picture: null,
          plan,
        });
        for (const banned of BANNED_TERMS) {
          expect(out, `vibe=${vibe} plan=${plan}: must not contain "${banned}"`).not.toContain(
            banned
          );
        }
      }
    }
  });

  it("does not say 'AI' anywhere in the body (the word 'AI' itself is banned in user-facing prose)", () => {
    const out = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    // We allow the substring inside other tokens like "AT" or compound words —
    // we're guarding against the standalone word "AI" appearing as a noun.
    expect(out).not.toMatch(/\bAI\b/);
  });

  it("explicitly teaches Maya the sycophantic phrases to avoid (anti-sycophancy frame)", () => {
    // The SOUL.md *prose* names these patterns as anti-patterns so the agent
    // learns what not to emit. Their presence in the doc is the positive
    // signal — they appear because the rule is being taught, not because
    // Maya is using them.
    const out = generateSoulMd({
      creator: baseCreator(),
      picture: null,
      plan: "manager",
    });
    expect(out).toContain("great question");
    expect(out).toContain("amazing");
    expect(out).toContain("flattery with no cited reason");
  });
});
