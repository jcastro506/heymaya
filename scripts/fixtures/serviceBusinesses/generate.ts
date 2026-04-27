/**
 * `generateAllBusinesses(rootSeed)` — produces the full 50-business fixture
 * corpus deterministically from a single root seed.
 *
 * The 50 = 10 service types × 5 size brackets, with three of those slots
 * replaced by the named persona anchors (mike/sarah/ed). All other 47
 * fixtures are auto-generated combinations.
 *
 * The persona anchors deliberately re-use slot indexes from the grid so the
 * count stays at 50:
 *   - Mike  → slot 0  (hvac × solo)
 *   - Sarah → slot 11 (plumbing × 6-15) — 1 (plumbing) + 10 (6-15 row)
 *   - Ed    → slot 22 (electrical × 16-50) — 2 (electrical) + 20 (16-50 row)
 *
 * Determinism: same `rootSeed` → byte-identical JSON every run. The
 * fixture-loader tests in `convex/__tests__/serviceFixtures.test.ts` verify
 * this by hashing two consecutive runs.
 */

import type { FixtureBusiness } from "./types";
import { makeBusiness, slugify } from "./factories/business";
import { makeMike } from "./personas/mike";
import { makeSarah } from "./personas/sarah";
import { makeEd } from "./personas/ed";
import { SERVICE_TYPES, SIZE_BRACKETS } from "./factories/data";

export const DEFAULT_ROOT_SEED = 42;

/** Slot index mapping for the 10×5 grid, 0..49. */
function gridSlot(serviceTypeIdx: number, sizeIdx: number): number {
  return sizeIdx * SERVICE_TYPES.length + serviceTypeIdx;
}

/** Slots replaced by anchor personas — kept stable for test wire-ups. */
const PERSONA_SLOTS = {
  mike: gridSlot(0, 0), // hvac × solo
  sarah: gridSlot(1, 2), // plumbing × 6-15
  ed: gridSlot(2, 3), // electrical × 16-50
} as const;

/**
 * Build 50 fixtures. Slots replaced by persona anchors keep their grid
 * (serviceType × sizeBracket) coordinates so the corpus distribution
 * stays balanced.
 */
export function generateAllBusinesses(
  rootSeed: number | string = DEFAULT_ROOT_SEED
): FixtureBusiness[] {
  const out: FixtureBusiness[] = [];
  for (let sizeIdx = 0; sizeIdx < SIZE_BRACKETS.length; sizeIdx++) {
    for (let stIdx = 0; stIdx < SERVICE_TYPES.length; stIdx++) {
      const slot = gridSlot(stIdx, sizeIdx);
      if (slot === PERSONA_SLOTS.mike) {
        out.push(makeMike(rootSeed));
        continue;
      }
      if (slot === PERSONA_SLOTS.sarah) {
        out.push(makeSarah(rootSeed));
        continue;
      }
      if (slot === PERSONA_SLOTS.ed) {
        out.push(makeEd(rootSeed));
        continue;
      }
      out.push(makeBusiness(rootSeed, slot));
    }
  }
  // Stable sort by slug — guarantees byte-identical iteration order across
  // runs even if the loop ever changes shape.
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

/**
 * Lookup helper for the loader's `seedSingleBusiness(t, persona)` API.
 */
export function generateAnchor(
  persona: "mike" | "sarah" | "ed",
  rootSeed: number | string = DEFAULT_ROOT_SEED
): FixtureBusiness {
  if (persona === "mike") return makeMike(rootSeed);
  if (persona === "sarah") return makeSarah(rootSeed);
  return makeEd(rootSeed);
}

export { slugify };
