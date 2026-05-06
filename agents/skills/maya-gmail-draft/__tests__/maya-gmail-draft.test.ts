/**
 * maya-gmail-draft — unit tests.
 *
 * Coverage (5 mandatory categories from CLAUDE.md + the runtime-guard
 * hard rule):
 *  1. Cross-tenant isolation — creator A's voice/banned phrases never bleed
 *     into a draft built for creator B
 *  2. Plan-tier × action — buildDraftPrompt rejects an unknown tone; the
 *     upstream gate handles the actual plan check (plan-tier is server-side)
 *  3. Adversarial — drafts containing banned phrases, auto-send hints, or
 *     "AI" token fail validation
 *  4. Sibling-file scan — script + SKILL.md hygiene (no TODO, no "AI" prose,
 *     prompt is consistent with the SKILL.md hard rules)
 *  5. TODO grep — script.ts is clean of TODO/FIXME/eslint-disable
 *
 * Plus the runtime-guard test the spec requires:
 *  - runtimeGuard("send") throws with the documented MVP error message
 *  - runtimeGuard("draft") returns silently
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildDraftPrompt,
  buildAllFourVariants,
  validateDraft,
  runtimeGuard,
  REPLY_TONES,
  type CreatorPicture,
  type GmailThread,
  type ReplyTone,
} from "../script";

const SCRIPT_PATH = path.resolve(__dirname, "..", "script.ts");
const SKILL_MD_PATH = path.resolve(__dirname, "..", "SKILL.md");

function makeThread(overrides: Partial<GmailThread> = {}): GmailThread {
  return {
    threadId: "thr_a1",
    from: {
      email: "partnerships@lululemon.com",
      name: "Lululemon Partnerships",
      domain: "lululemon.com",
    },
    subject: "Partnership opportunity for Q3",
    bodyText:
      "Hi there,\n\nWe'd love to work with you on a campaign in Q3. Thinking 1 Reel + 1 TT post, 30-day usage rights, $4500 total. Let us know your rates.",
    receivedMs: 1_714_435_200_000,
    attachments: [],
    ...overrides,
  };
}

function picture(overrides: Partial<CreatorPicture> = {}): CreatorPicture {
  return {
    niche: "lifestyle",
    voiceFingerprint:
      "direct, low-filler, opinion-led; uses 'shipping', 'building', 'baseline' as recurring anchors",
    tonePreference: "strategic",
    firstContact: true,
    bannedPhrases: [],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* runtimeGuard — MVP hard rule                                                */
/* -------------------------------------------------------------------------- */

describe("runtimeGuard — MVP hard rule (NEVER auto-send)", () => {
  it("throws with the documented MVP error message when intent is 'send'", () => {
    expect(() => runtimeGuard("send")).toThrow(/MVP does not auto-send/);
    expect(() => runtimeGuard("send")).toThrow(/maya-gmail-draft/);
  });

  it("returns silently when intent is 'draft'", () => {
    expect(() => runtimeGuard("draft")).not.toThrow();
    expect(runtimeGuard("draft")).toBeUndefined();
  });

  it("throws on an unknown intent value to fail closed", () => {
    expect(() =>
      // Force-cast to test the runtime-guard's defensive branch.
      runtimeGuard("approve" as unknown as Parameters<typeof runtimeGuard>[0])
    ).toThrow(/unknown intent/);
  });
});

/* -------------------------------------------------------------------------- */
/* buildDraftPrompt — happy path + tone × thread × picture                     */
/* -------------------------------------------------------------------------- */

describe("buildDraftPrompt — prompt composition", () => {
  it("produces a single prompt that names the tone, the sender, and the body", () => {
    const prompt = buildDraftPrompt({
      thread: makeThread(),
      picture: picture(),
      replyTone: "hold-for-info",
    });
    expect(prompt).toContain("hold-for-info");
    expect(prompt).toContain("Lululemon Partnerships");
    expect(prompt).toContain("$4500 total");
    expect(prompt).toContain("Voice fingerprint:");
  });

  it("threads the per-creator banned phrases into the prompt", () => {
    const prompt = buildDraftPrompt({
      thread: makeThread(),
      picture: picture({
        bannedPhrases: ["sounds like a cool opp", "let's hop on a call"],
      }),
      replyTone: "soft-accept",
    });
    expect(prompt).toContain("Per-creator banned phrases");
    expect(prompt).toContain("sounds like a cool opp");
    expect(prompt).toContain("let's hop on a call");
  });

  it("varies the tone instruction across the four tones", () => {
    const prompts: Record<ReplyTone, string> = {
      "soft-accept": buildDraftPrompt({
        thread: makeThread(),
        picture: picture(),
        replyTone: "soft-accept",
      }),
      "hold-for-info": buildDraftPrompt({
        thread: makeThread(),
        picture: picture(),
        replyTone: "hold-for-info",
      }),
      "decline-politely": buildDraftPrompt({
        thread: makeThread(),
        picture: picture(),
        replyTone: "decline-politely",
      }),
      "ask-for-deck": buildDraftPrompt({
        thread: makeThread(),
        picture: picture(),
        replyTone: "ask-for-deck",
      }),
    };
    expect(prompts["soft-accept"]).toContain("Lean toward yes");
    expect(prompts["hold-for-info"]).toContain("Buy time");
    expect(prompts["decline-politely"]).toContain("Decline cleanly");
    expect(prompts["ask-for-deck"]).toContain("campaign brief");
  });

  it("adjusts the word cap based on firstContact flag", () => {
    const firstContact = buildDraftPrompt({
      thread: makeThread(),
      picture: picture({ firstContact: true }),
      replyTone: "hold-for-info",
    });
    const followUp = buildDraftPrompt({
      thread: makeThread(),
      picture: picture({ firstContact: false }),
      replyTone: "hold-for-info",
    });
    expect(firstContact).toContain("≤120 words");
    expect(followUp).toContain("≤200 words");
  });

  it("rejects unknown tones (defense-in-depth caller validation)", () => {
    expect(() =>
      buildDraftPrompt({
        thread: makeThread(),
        picture: picture(),
        // @ts-expect-error — exercising the runtime guard
        replyTone: "yolo-maximum",
      })
    ).toThrow(/unknown replyTone/);
  });
});

/* -------------------------------------------------------------------------- */
/* buildAllFourVariants                                                        */
/* -------------------------------------------------------------------------- */

describe("buildAllFourVariants", () => {
  it("returns prompts for exactly the 4 documented tones", async () => {
    const variants = await buildAllFourVariants({
      thread: makeThread(),
      picture: picture(),
    });
    expect(Object.keys(variants).sort()).toEqual([...REPLY_TONES].sort());
    for (const tone of REPLY_TONES) {
      expect(variants[tone]).toContain(tone);
    }
  });

  it("each variant is independently citable to the source thread", async () => {
    const variants = await buildAllFourVariants({
      thread: makeThread(),
      picture: picture(),
    });
    for (const tone of REPLY_TONES) {
      expect(variants[tone]).toContain("Partnership opportunity for Q3");
      expect(variants[tone]).toContain("Voice fingerprint:");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* validateDraft — banned terms, voice overlap, length cap, auto-send hints    */
/* -------------------------------------------------------------------------- */

describe("validateDraft — happy path", () => {
  it("passes a clean draft that overlaps with voice fingerprint", () => {
    const result = validateDraft(
      "Thanks for reaching out. Before I commit, what's the deliverable baseline you're shipping toward? Want to make sure the rate fits the work.",
      picture()
    );
    expect(result.ok).toBe(true);
    expect(result.reasons).toBeUndefined();
  });
});

describe("validateDraft — adversarial", () => {
  it("FAILS a draft that contains a global banned voice term", () => {
    const result = validateDraft(
      "Hi! I absolutely love this opportunity and I'd be honored to work together — let's hop on shipping next steps.",
      picture()
    );
    expect(result.ok).toBe(false);
    expect(result.reasons?.some((r) => /banned voice term/.test(r))).toBe(true);
  });

  it("FAILS a draft that contains an auto-send hint phrase", () => {
    const result = validateDraft(
      "I'll send this now on your behalf — talk soon. Shipping baseline confirmed.",
      picture()
    );
    expect(result.ok).toBe(false);
    expect(
      result.reasons?.some((r) => /auto-send hint phrase/.test(r))
    ).toBe(true);
  });

  it("FAILS a draft that contains the banned 'AI' token", () => {
    const result = validateDraft(
      "Quick AI-assisted note here — shipping baseline. Want to talk?",
      picture()
    );
    expect(result.ok).toBe(false);
    expect(result.reasons?.some((r) => /AI/.test(r))).toBe(true);
  });

  it("FAILS a draft over the 120-word first-contact cap", () => {
    const long =
      "Thanks for reaching out — shipping baseline. " +
      "I want to make sure I respond well, so here's a long thought. ".repeat(20);
    const result = validateDraft(long, picture({ firstContact: true }));
    expect(result.ok).toBe(false);
    expect(
      result.reasons?.some((r) => /first-contact length cap/.test(r))
    ).toBe(true);
  });

  it("PASSES the same long draft when firstContact is false", () => {
    const text =
      "Thanks for the note — shipping baseline. " +
      "Want to align on deliverables before we talk numbers. ".repeat(8);
    const result = validateDraft(text, picture({ firstContact: false }));
    expect(result.ok).toBe(true);
  });

  it("FAILS a draft that strips all voice anchor overlap", () => {
    const result = validateDraft(
      "Hello. Got it. Sounds good. Send the contract.",
      picture()
    );
    expect(result.ok).toBe(false);
    expect(
      result.reasons?.some((r) => /voice anchor overlap/.test(r))
    ).toBe(true);
  });

  it("FAILS an empty draft", () => {
    const result = validateDraft("   ", picture());
    expect(result.ok).toBe(false);
    expect(result.reasons?.some((r) => /empty/.test(r))).toBe(true);
  });

  it("respects per-creator banned phrases as well as global ones", () => {
    const result = validateDraft(
      "Thanks — shipping baseline. Sounds like a cool opp, want to chat?",
      picture({
        bannedPhrases: ["sounds like a cool opp"],
      })
    );
    expect(result.ok).toBe(false);
    expect(
      result.reasons?.some((r) => /per-creator banned phrase/.test(r))
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-tenant isolation                                                      */
/* -------------------------------------------------------------------------- */

describe("validateDraft — cross-tenant isolation", () => {
  it("creator A's banned phrase does not affect creator B's validation", () => {
    const draft = "Thanks — shipping baseline. Sounds like a cool opp.";
    const creatorA = picture({ bannedPhrases: ["sounds like a cool opp"] });
    const creatorB = picture({ bannedPhrases: ["literally"] });
    expect(validateDraft(draft, creatorA).ok).toBe(false);
    // Same draft passes for creator B (no overlap with B's banned list).
    // (And the "shipping" / "baseline" tokens give voice overlap.)
    expect(validateDraft(draft, creatorB).ok).toBe(true);
  });

  it("creator A's voice fingerprint does not bleed into creator B's draft validation", () => {
    const creatorA = picture({
      voiceFingerprint: "minimalist, no-emoji, lowercase preference",
    });
    const creatorB = picture({
      voiceFingerprint: "warm, exclamation-friendly, hype-led tone",
    });
    const draft = "thanks for reaching out — fits my minimalist baseline.";
    // Creator A — overlap on "minimalist" → passes voice check.
    expect(validateDraft(draft, creatorA).ok).toBe(true);
    // Creator B — no overlap with their fingerprint → voice check fails.
    expect(validateDraft(draft, creatorB).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Sibling-file + TODO scan                                                    */
/* -------------------------------------------------------------------------- */

describe("script + SKILL.md hygiene", () => {
  const scriptSrc = readFileSync(SCRIPT_PATH, "utf-8");
  const skillSrc = readFileSync(SKILL_MD_PATH, "utf-8");

  it("contains no TODO / FIXME / unjustified eslint-disable in script.ts", () => {
    expect(scriptSrc).not.toMatch(/\bTODO\b/);
    expect(scriptSrc).not.toMatch(/\bFIXME\b/);
    expect(scriptSrc).not.toMatch(/eslint-disable/);
  });

  it("never uses the word 'AI' in the SKILL.md prose", () => {
    expect(skillSrc).not.toMatch(/\bAI\b/);
  });

  it("SKILL.md documents the never-auto-send hard rule prominently", () => {
    expect(skillSrc).toMatch(/never sends email/i);
    expect(skillSrc).toMatch(/createDraft/);
    // sendEmail must ONLY appear in negation-shaped contexts — both the
    // "hard rule" and "what this skill does NOT do" sections explicitly
    // deny calling sendEmail. We require each occurrence to live within
    // one line of negation language.
    const sendEmailHits = (skillSrc.match(/sendEmail/g) ?? []).length;
    expect(sendEmailHits).toBeGreaterThan(0);
    expect(sendEmailHits).toBeLessThanOrEqual(2);
    const lines = skillSrc.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("sendEmail")) continue;
      const window = [lines[i - 1] ?? "", lines[i], lines[i + 1] ?? ""].join(" ");
      expect(window).toMatch(/(does NOT|not call|never|do NOT)/i);
    }
  });

  it("re-exports a GmailThread type structurally compatible with maya-gmail-read", () => {
    const t: GmailThread = makeThread();
    expect(t.from.email).toBeTruthy();
    expect(typeof t.receivedMs).toBe("number");
  });
});
