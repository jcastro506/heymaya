/**
 * mayaVoiceFixture — corpus regression test.
 *
 * Asserts that EVERY entry in `AI_TRAP_FIXTURE` matches its declared
 * `expectedToPass`:
 *   - `expectedToPass: true`  → validator MUST report no leak.
 *   - `expectedToPass: false` → validator MUST report a leak.
 *
 * Also asserts the corpus structure:
 *   - At least 5 PASS entries (the operator's "5+ in-voice" rule).
 *   - At least 5 FAIL entries (the operator's "5+ disclaimer leak" rule
 *     — overshoot the spec).
 *   - Every fixture id is unique.
 *
 * This test is the load-bearing regression for the locked operator rule:
 * Maya never says "I'm an AI" or any disclaimer. If a future skill prompt
 * or playbook edit causes Maya to emit a disclaimer, we'll add a failing
 * fixture entry so the regression sticks.
 */

import { describe, expect, it } from "vitest";
import {
  AI_TRAP_FIXTURE,
  containsDisclaimerLeak,
  findDisclaimerLeak,
} from "./fixtures/mayaVoiceFixture";

describe("mayaVoiceFixture — corpus shape", () => {
  it("has at least 5 in-voice (pass) entries", () => {
    const pass = AI_TRAP_FIXTURE.filter((e) => e.expectedToPass);
    expect(pass.length).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 disclaimer-leak (fail) entries", () => {
    const fail = AI_TRAP_FIXTURE.filter((e) => !e.expectedToPass);
    expect(fail.length).toBeGreaterThanOrEqual(5);
  });

  it("fixture ids are unique", () => {
    const ids = AI_TRAP_FIXTURE.map((e) => e.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });

  it("every entry has a non-empty rationale (operator-readable corpus)", () => {
    for (const e of AI_TRAP_FIXTURE) {
      expect(e.rationale.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("mayaVoiceFixture — validator catches every fail entry", () => {
  for (const entry of AI_TRAP_FIXTURE.filter((e) => !e.expectedToPass)) {
    it(`flags leak: ${entry.id}`, () => {
      const result = findDisclaimerLeak(entry.candidateResponse);
      if (result === null) {
        throw new Error(
          `Expected disclaimer leak in fixture ${entry.id} but validator returned null.\n` +
            `Candidate: "${entry.candidateResponse}"\n` +
            `Rationale: ${entry.rationale}`
        );
      }
      expect(result).not.toBeNull();
    });
  }
});

describe("mayaVoiceFixture — validator passes every in-voice entry", () => {
  for (const entry of AI_TRAP_FIXTURE.filter((e) => e.expectedToPass)) {
    it(`accepts in-voice: ${entry.id}`, () => {
      const result = findDisclaimerLeak(entry.candidateResponse);
      if (result !== null) {
        throw new Error(
          `False-positive disclaimer leak in fixture ${entry.id}.\n` +
            `Candidate: "${entry.candidateResponse}"\n` +
            `Validator matched: "${result.match}" (pattern ${result.pattern})\n` +
            `Rationale: ${entry.rationale}\n` +
            `If the candidate is genuinely in-voice, narrow the validator pattern.`
        );
      }
      expect(result).toBeNull();
    });
  }
});

describe("containsDisclaimerLeak — adversarial inputs", () => {
  it("does not false-flag legitimate words containing 'ai' or 'bot'", () => {
    expect(containsDisclaimerLeak("Maya. The fairground photo is great.")).toBe(
      false
    );
    expect(
      containsDisclaimerLeak(
        "Maya. Let's check the robotic-arm reveal video — strong hook."
      )
    ).toBe(false);
    expect(
      containsDisclaimerLeak(
        "Maya. Pain points in the survey are clear: pricing, then onboarding."
      )
    ).toBe(false);
  });

  it("flags 'I am an AI' without trailing punctuation", () => {
    expect(containsDisclaimerLeak("I am an AI")).toBe(true);
  });

  it("flags 'as an AI assistant'", () => {
    expect(containsDisclaimerLeak("As an AI assistant, I cannot do that.")).toBe(
      true
    );
  });

  it("flags 'I'm just a bot'", () => {
    expect(containsDisclaimerLeak("I'm just a bot.")).toBe(true);
  });
});

describe("playbook prose — verify the playbook does not leak in its own copy", () => {
  // The "Are you AI?" trap section in the playbook contains examples of
  // BOTH acceptable and forbidden answers. The forbidden ones are bullet
  // points labeled as such. We intentionally do NOT scan the playbook
  // file from this test — the false-positive risk is too high (the rule
  // section necessarily quotes the forbidden phrases). What we DO assert
  // is that the rule itself + the directional examples we ship are clean.
  const directionalExamples: ReadonlyArray<string> = [
    "I'm Maya. I run your account in the background and ping when something matters. What did you want to look at?",
    "Your manager. The thing that matters today is your Tuesday post — want to dig into the hook?",
    "Maya. Here to handle the boring parts so you can keep filming. What's on your mind?",
  ];
  for (const ex of directionalExamples) {
    it(`directional example "${ex.slice(0, 40)}..." passes the validator`, () => {
      expect(containsDisclaimerLeak(ex)).toBe(false);
    });
  }
});
