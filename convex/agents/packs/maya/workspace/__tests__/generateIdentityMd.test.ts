/**
 * generateIdentityMd — pure-function generator tests.
 *
 * Coverage:
 *   - Always emits canonical SEED fields: name=Maya, vibe, emoji=✨,
 *     creature="creator manager".
 *   - Vibe resolution precedence: tonePreference > openingAnswers.tone > strategic.
 *   - Banned voice terms (no "AI", "AI manager", "AI assistant", "bot",
 *     "chatbot") never appear in the output.
 *   - Determinism + size discipline.
 */

import { describe, it, expect } from "vitest";
import {
  generateIdentityMd,
  resolveVibe,
} from "../generateIdentityMd";
import type { Doc } from "../../../../../_generated/dataModel";
import type { CreatorPictureExt } from "../types";

// AI-self-reference + chatbot-style framing the operator has locked out of
// user-facing prose. We deliberately exclude the bare substring "bot" because
// IDENTITY.md correctly names "chatbot" as something Maya is NOT — that meta
// reference is healthy framing, not Maya speaking as one.
const BANNED_TERMS = [
  "AI manager",
  "AI assistant",
  "as an AI",
  "I'm an AI",
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

function pictureWithTone(tone: "supportive" | "strategic" | "tough-love"): CreatorPictureExt {
  return {
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
      tone,
      submittedAt: 1_700_000_000_000,
    },
  };
}

describe("generateIdentityMd — SEED fields", () => {
  it("Manager tier — name=Maya / emoji=✨ / creature=content manager (Sprint 9.7+ tier-aware)", () => {
    const out = generateIdentityMd({
      creator: baseCreator({ plan: "manager" }),
      picture: null,
    });
    expect(out).toContain("# IDENTITY.md");
    expect(out).toContain("**Name:** Maya");
    expect(out).toContain("**Emoji:** ✨");
    expect(out).toContain("**Creature:** content manager");
    // Manager scope sentence — autonomous mode references brand pitching.
    expect(out).toContain("plans and runs");
    expect(out).toContain("brands");
  });

  it("Coach tier — creature=content coach + advisory scope sentence (Sprint 9.7+ tier-aware)", () => {
    const out = generateIdentityMd({
      creator: baseCreator({ plan: "coach" }),
      picture: null,
    });
    expect(out).toContain("**Creature:** content coach");
    // Coach scope — advisory framing, no autonomous brand-pitching wording.
    expect(out).toContain("with the creator");
    expect(out).toContain("posting consistently");
    expect(out).not.toContain("pitches brands");
    // And NEVER the wrong tier label.
    expect(out).not.toContain("**Creature:** content manager");
  });

  it("never says the creature is an 'AI manager' (operator-locked)", () => {
    const out = generateIdentityMd({
      creator: baseCreator(),
      picture: null,
    });
    expect(out).not.toContain("AI manager");
  });

  it("never self-presents as 'AI' / 'AI manager' / 'AI assistant' (operator-locked)", () => {
    const out = generateIdentityMd({
      creator: baseCreator(),
      picture: null,
    });
    for (const banned of BANNED_TERMS) {
      expect(out, `must not contain "${banned}"`).not.toContain(banned);
    }
    // Standalone-word "AI" should not appear (the substring inside other
    // words is fine — guard against the noun).
    expect(out).not.toMatch(/\bAI\b/);
  });

  it("is small and stable (under 2K chars — IDENTITY is intentionally tiny)", () => {
    const out = generateIdentityMd({
      creator: baseCreator(),
      picture: null,
    });
    expect(out.length).toBeGreaterThan(200);
    expect(out.length).toBeLessThanOrEqual(2_000);
  });

  it("is deterministic across identical inputs", () => {
    const a = generateIdentityMd({
      creator: baseCreator(),
      picture: null,
    });
    const b = generateIdentityMd({
      creator: baseCreator(),
      picture: null,
    });
    expect(a).toBe(b);
  });
});

describe("generateIdentityMd — vibe resolution", () => {
  it("uses tonePreference from the creator row when set", () => {
    for (const vibe of ["supportive", "strategic", "tough-love"] as const) {
      const out = generateIdentityMd({
        creator: baseCreator({ tonePreference: vibe }),
        picture: null,
      });
      expect(out).toContain(`**Vibe:** ${vibe}`);
    }
  });

  it("falls back to openingAnswers.tone when tonePreference unset", () => {
    const out = generateIdentityMd({
      creator: baseCreator(),
      picture: pictureWithTone("tough-love"),
    });
    expect(out).toContain("**Vibe:** tough-love");
  });

  it("tonePreference overrides openingAnswers.tone (creator override wins)", () => {
    const out = generateIdentityMd({
      creator: baseCreator({ tonePreference: "supportive" }),
      picture: pictureWithTone("tough-love"),
    });
    expect(out).toContain("**Vibe:** supportive");
  });

  it("defaults to strategic when neither is set", () => {
    const out = generateIdentityMd({
      creator: baseCreator(),
      picture: null,
    });
    expect(out).toContain("**Vibe:** strategic");
  });
});

describe("resolveVibe — direct precedence test", () => {
  it("precedence: tonePreference > openingAnswers.tone > strategic", () => {
    expect(
      resolveVibe(baseCreator({ tonePreference: "supportive" }), pictureWithTone("tough-love"))
    ).toBe("supportive");
    expect(resolveVibe(baseCreator(), pictureWithTone("tough-love"))).toBe("tough-love");
    expect(resolveVibe(baseCreator(), null)).toBe("strategic");
  });
});
