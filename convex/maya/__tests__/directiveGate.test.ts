/**
 * The directive ledger, enforced — Sprint 6's exit criterion.
 *
 * The ledger has been append-only and WRITE-ONLY: `append` had a caller,
 * `activeRules`, `effectiveRule`, `history` and `forget` had none. So a founder
 * said "we do NOT use Reddit", it was recorded verbatim with a timestamp, and
 * nothing stopped her mentioning Reddit.
 */

import { describe, expect, it } from "vitest";
import { parseGateVerdict, CONTENT_KINDS } from "../directiveGate";

describe("⭐ A VIOLATION MUST QUOTE THE RULE IT BREAKS", () => {
  it("⭐ 'violates: true' WITH NO QUOTED RULE IS NOT A VIOLATION", () => {
    /**
     * The guard that makes this gate arguable. A judge that must NAME which
     * sentence was broken cannot invent a violation as easily as one returning
     * a boolean — and holding a post on an unnameable rule is exactly the
     * silent, unarguable block §9 exists to prevent.
     */
    expect(parseGateVerdict(JSON.stringify({ violates: true, rule: "  ", why: "vibes" })))
      .toEqual({ violates: false, rule: "", why: "" });
  });

  it("a quoted rule comes through so it can be read back verbatim", () => {
    const v = parseGateVerdict(
      JSON.stringify({
        violates: true,
        rule: "we do NOT use Reddit or LinkedIn. Only TikTok, Instagram, YouTube and X.",
        why: "the post names Reddit",
      })
    );
    expect(v?.violates).toBe(true);
    expect(v?.rule).toMatch(/do NOT use Reddit/);
  });

  it("most posts violate nothing, and false parses cleanly", () => {
    expect(parseGateVerdict(JSON.stringify({ violates: false }))).toEqual({
      violates: false,
      rule: "",
      why: "",
    });
  });

  it("unreadable output is null, and the caller fails OPEN", () => {
    /**
     * ⚠️ Deliberately opposite to the safety critic, which fails CLOSED. A
     * missed house rule costs an apology and a correction; a missed safety
     * violation costs the account.
     */
    expect(parseGateVerdict("I think it might break the tone rule")).toBeNull();
  });
});

describe("⭐ ONLY RULES ABOUT WHAT A POST SAYS", () => {
  it("behavioural kinds are excluded, because a model can't see them", () => {
    /**
     * `posting_mode`, `cadence` and `timing_window` are enforced in the
     * publish decision and the scheduler. Asking a language model whether a
     * sentence violates a cadence rule invites a confident answer to a
     * question it cannot possibly see.
     */
    for (const kind of ["posting_mode", "cadence", "timing_window", "pause"]) {
      expect(CONTENT_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it("the kinds that constrain language are included", () => {
    for (const kind of ["topic", "phrase_ban", "voice", "entity_rule"]) {
      expect(CONTENT_KINDS as readonly string[]).toContain(kind);
    }
  });

  it("⭐ AND `channel_toggle`, WHICH A LIVE TEST CAUGHT", () => {
    /**
     * Excluded on the first pass as behavioural — it decides WHERE she posts,
     * and the channel config enforces that. Then the gate cleared
     * "Just cross-posted this to Reddit and LinkedIn too" against a live rule
     * reading "we do NOT use Reddit or LinkedIn."
     *
     * The rule constrains two things and only one is behavioural. Where she
     * posts is config. What a post CLAIMS about the business is content — and
     * a post claiming a channel they don't use is a factual lie about them,
     * published under their name.
     */
    expect(CONTENT_KINDS as readonly string[]).toContain("channel_toggle");
  });
});
