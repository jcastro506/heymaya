/**
 * The pre-spend gate (§7.5.7) — eight checks, in order.
 *
 * > *"All of these run before the founder ever sees the idea, so an approved
 * > idea can never fail on budget or assets. **Failing after a yes is the worst
 * > possible sequence.**"*
 *
 * So the property under test isn't "does it say no". It's that it resolves to
 * something executable, and that the two cases where it can't are the two where
 * proceeding would be dishonest.
 */

import { describe, expect, it } from "vitest";
import {
  DEADLINE_RATIO,
  RUNGS,
  authenticityNotes,
  runGate,
  type GateInput,
} from "../preSpendGate";

const ok: GateInput = {
  rung: "avatar",
  budgetMode: "full",
  poolAboveReserve: true,
  tierMaxRung: "ad_clone",
  assetsNamed: 2,
  assetsResolved: 2,
  unverifiedClaims: [],
  angleRanRecently: false,
  estimatedRenderSeconds: 60,
  secondsUntilSlot: 3600,
  estimatedCredits: 10,
  remainingCredits: 100,
};

describe("the happy path", () => {
  it("proceeds at the requested rung with nothing to report", () => {
    const out = runGate(ok);
    expect(out.proceed).toBe(true);
    expect(out.rung).toBe("avatar");
    expect(out.adjustments).toEqual([]);
  });
});

describe("it resolves rather than refusing", () => {
  it("drops a rung on a soft budget rather than stopping", () => {
    const out = runGate({ ...ok, budgetMode: "graceful_degrade" });
    expect(out.proceed).toBe(true);
    expect(RUNGS.indexOf(out.rung)).toBeLessThan(RUNGS.indexOf("avatar"));
    expect(out.adjustments[0]).toContain("budget");
  });

  it("caps to what the tier allows", () => {
    const out = runGate({ ...ok, rung: "ad_clone", tierMaxRung: "carousel" });
    expect(out.rung).toBe("carousel");
    expect(out.proceed).toBe(true);
  });

  /**
   * ⚠️ Re-brief around what exists. NEVER generate the missing shot — §2.7's
   * floor covers images, and "the brief called for it" is exactly the
   * innocent-sounding reason a fabricated UI would get made.
   */
  it("re-briefs around partial assets", () => {
    const out = runGate({ ...ok, assetsNamed: 3, assetsResolved: 1 });
    expect(out.proceed).toBe(true);
    expect(out.adjustments.join(" ")).toContain("1 of 3");
  });

  it("cuts an unbacked claim and keeps going", () => {
    const out = runGate({ ...ok, unverifiedClaims: ["3x faster"] });
    expect(out.proceed).toBe(true);
    expect(out.adjustments.join(" ")).toMatch(/cut a claim/i);
  });

  it("drops a rung rather than missing the slot", () => {
    // Render time × 10 must fit before the post's best hour.
    const out = runGate({ ...ok, estimatedRenderSeconds: 500, secondsUntilSlot: 3600 });
    expect(out.proceed).toBe(true);
    expect(out.rung).not.toBe("avatar");
    expect(DEADLINE_RATIO).toBe(10);
  });

  it("drops a rung to fit the remaining credits", () => {
    const out = runGate({ ...ok, estimatedCredits: 200, remainingCredits: 5 });
    expect(out.proceed).toBe(true);
    expect(out.adjustments.join(" ")).toContain("credits");
  });
});

describe("the cases where proceeding would be dishonest", () => {
  it("stops on a hard budget block, and says so plainly", () => {
    const out = runGate({ ...ok, budgetMode: "hard_block" });
    expect(out.proceed).toBe(false);
    expect(out.blockedBy).toBe("budget");
    // §2230 — a credit shortage costs quality, never availability, and never
    // silently.
    expect(out.detail).toMatch(/static/i);
  });

  /**
   * ⭐ The shared pool, not this customer's slice. One account draining the
   * pool the other 199 render from is a fleet incident, not a per-customer one.
   */
  it("stops when the shared pool is below reserve", () => {
    const out = runGate({ ...ok, poolAboveReserve: false });
    expect(out.proceed).toBe(false);
    expect(out.blockedBy).toBe("pool");
  });

  /**
   * ⭐ The one that matters most: an empty library stops everything rather
   * than producing a fabricated product shot.
   */
  it("refuses to invent a shot when nothing resolves", () => {
    const out = runGate({ ...ok, assetsNamed: 2, assetsResolved: 0 });
    expect(out.proceed).toBe(false);
    expect(out.blockedBy).toBe("assets");
    expect(out.detail).toMatch(/won't make up a shot/i);
  });

  it("skips a repeated angle rather than posting it twice", () => {
    const out = runGate({ ...ok, angleRanRecently: true });
    expect(out.proceed).toBe(false);
    expect(out.blockedBy).toBe("repeat");
  });
});

describe("order is the contract", () => {
  /**
   * §7.5.7 lists them "in order". Budget is check 1 because "never render
   * blind" — a run that checks assets first would do work it can't pay for.
   */
  it("reports budget before assets when both fail", () => {
    const out = runGate({
      ...ok,
      budgetMode: "hard_block",
      assetsResolved: 0,
    });
    expect(out.blockedBy).toBe("budget");
  });

  it("never returns a rung above the tier cap, whatever else happened", () => {
    const out = runGate({
      ...ok,
      rung: "ad_clone",
      tierMaxRung: "static",
      budgetMode: "graceful_degrade",
    });
    expect(out.rung).toBe("static");
  });
});

describe("authenticityNotes", () => {
  /**
   * ⚠️ Notes, never blocks. "The cut rhythm is even" is a judgment about a
   * video that doesn't exist yet — blocking on a prediction stops work for no
   * evidence.
   */
  it("flags the three §7.5.3 tells without stopping anything", () => {
    const notes = authenticityNotes({
      hasRealFootage: false,
      cutsPerSecond: 0.05,
      hookIsShown: false,
    });
    expect(notes).toHaveLength(3);
    expect(notes.join(" ")).toMatch(/real footage/i);
    expect(notes.join(" ")).toMatch(/evenly spaced/i);
    expect(notes.join(" ")).toMatch(/explains the problem/i);
  });

  it("says nothing when there's nothing to say", () => {
    expect(
      authenticityNotes({ hasRealFootage: true, cutsPerSecond: 0.6, hookIsShown: true })
    ).toEqual([]);
  });

  it("stays quiet about cut rhythm it cannot measure", () => {
    // Null is "we haven't watched it", not "it's even" — guessing here would
    // be the fabricated observation §2.7 forbids.
    const notes = authenticityNotes({
      hasRealFootage: true,
      cutsPerSecond: null,
      hookIsShown: true,
    });
    expect(notes).toEqual([]);
  });
});
