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
