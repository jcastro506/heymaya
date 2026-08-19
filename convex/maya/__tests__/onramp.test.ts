/**
 * ⚠️ `applyRead` — the end of onboarding — had NO TEST FILE AT ALL, which is
 * how this gap survived: `relearnIfStale` skips customers with no map on the
 * stated grounds that "onboarding owns that", and onboarding did not own it.
 * Each side assumed the other did, and nothing asserted either way.
 *
 * The cost was quiet and total. `targetsFor` is read by ten production modules
 * — trends, formats (x5), competitors, scroll, complaints, benchmarks,
 * dashboard, strategy, audience — and every one took its null branch
 * permanently for every customer onboarded through this path. The perception
 * layer the product calls its moat was dark for exactly the people just
 * onboarded.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsFirstLearn } from "../onramp";

describe("who still needs their first learn", () => {
  it("⭐ a brand-new customer does", () => {
    expect(needsFirstLearn(undefined)).toBe(true);
    expect(needsFirstLearn("")).toBe(true);
  });

  it("⭐ one who already has targets does NOT — twelve searches aren't spent twice", () => {
    /**
     * A retried submit or a corrected URL re-enters `applyRead`. Guarding on
     * the insert-vs-patch branch would not be enough: the thing that must not
     * be duplicated is the SPEND, and the spend is keyed on whether a learned
     * map exists. `learnBusiness` is the most expensive single call in
     * onboarding.
     */
    expect(needsFirstLearn(JSON.stringify({ targets: { accounts: ["@a"] } }))).toBe(
      false
    );
  });

  it("⚠️ an unparseable map counts as UNLEARNED, not as learned", () => {
    // The other way round, a corrupted row locks a customer out of the
    // perception layer forever — silently, with every reader seeing a clean
    // null and nothing reporting a fault.
    expect(needsFirstLearn("{{ not json")).toBe(true);
  });

  it("⚠️ a map with no targets key is unlearned, not 'learned with nothing'", () => {
    expect(needsFirstLearn(JSON.stringify({}))).toBe(true);
    expect(needsFirstLearn(JSON.stringify({ targets: null }))).toBe(true);
  });
});

describe("the read validator accepts what the read actually produces", () => {
  /**
   * ⚠️ FOUND BY THE OPERATOR IN A BROWSER, NOT BY THIS SUITE. Step 2 of
   * onboarding died for everyone who clicked "yes, that's it":
   *
   *   ArgumentValidationError: Object contains extra field `gaps`
   *
   * A Convex `v.object` REJECTS an unknown field rather than ignoring it, and
   * `demo.ts` returns five fields where `READ` knew about four. Nobody could
   * complete signup, and every test passed — because the tests called
   * `applyRead` with hand-written fixtures shaped like the validator instead of
   * like the thing that actually calls it.
   *
   * This pins the CONTRACT BETWEEN THE TWO, which is the only thing that would
   * have caught it: whatever `demo.ts` extracts, `READ` must accept.
   */
  const DEMO_SOURCE = readFileSync(
    join(process.cwd(), "convex/maya/demo.ts"),
    "utf8",
  );
  const ONRAMP_SOURCE = readFileSync(
    join(process.cwd(), "convex/maya/onramp.ts"),
    "utf8",
  );

  it("⭐ every field the public read returns is accepted by READ", () => {
    // The parse block in demo.ts that builds the object handed to the client.
    const parse = /gaps:\s*Array\.isArray[\s\S]{0,2000}?\n\s*\};/.exec(DEMO_SOURCE);
    expect(parse, "demo.ts parse block not found — renamed?").toBeTruthy();

    const readValidator = /const READ = v\.object\(\{[\s\S]*?\n\}\);/.exec(
      ONRAMP_SOURCE,
    );
    expect(readValidator, "READ validator not found").toBeTruthy();

    // Fields demo.ts assigns, minus ones it deliberately drops before sending.
    for (const field of ["name", "whatItIs", "whoItsFor", "whatsDifferent", "gaps"]) {
      expect(
        readValidator![0],
        `demo.ts produces \`${field}\` and READ does not accept it — onboarding will 400 for every founder`,
      ).toContain(field);
    }
  });

  it("⚠️ gaps are KEPT, not accepted and thrown away", () => {
    /**
     * Accepting the field only to discard it would fix the crash and repeat the
     * `ProductTruth.competitors` defect — a field the read produces, the
     * validator accepts, and nothing ever reads. `gaps` is what she does not
     * know about their product, which is the best source for her first
     * questions.
     */
    expect(ONRAMP_SOURCE).toMatch(/gaps:\s*\(args\.read\.gaps/);
  });
});
