/**
 * Deterministic seeded PRNG for the 50-business fixture corpus.
 *
 * Mulberry32 — a 32-bit single-state generator. Same seed → same sequence
 * across Node versions and platforms. We deliberately do NOT pull `faker.js`
 * (which is non-deterministic across versions) or `seedrandom` (extra dep).
 * This file is the only source of randomness in the fixture pipeline; every
 * factory takes a `Rng` so the entire corpus is reproducible from a single
 * root seed.
 *
 * Source-of-truth contract: `generate.ts` calls `makeRng(rootSeed)` once and
 * threads child Rngs (via `subRng(label)`) through every factory. Two runs
 * with the same root seed MUST produce byte-identical JSON output (verified
 * by the determinism test in `convex/__tests__/serviceFixtures.test.ts`).
 */

export type Rng = {
  /** Returns a float in [0, 1). */
  next(): number;
  /** Returns an integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Picks a single element from the array. */
  pick<T>(arr: readonly T[]): T;
  /** Picks N distinct elements without replacement (or fewer if arr is small). */
  sample<T>(arr: readonly T[], n: number): T[];
  /** Returns true with probability p in [0, 1]. */
  chance(p: number): boolean;
  /** Builds a child Rng deterministically derived from this one + label. */
  subRng(label: string): Rng;
  /** Inspects the current state — used only by tests to detect drift. */
  state(): number;
};

/**
 * String → 32-bit hash (FNV-1a). Used to derive child Rng seeds from labels
 * so subRng("reviews") and subRng("jobs") get distinct, stable streams that
 * don't drift if we add/reorder factories.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 step. Takes a 32-bit state, returns [next state, float]. */
function step(state: number): [number, number] {
  let s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [s, out];
}

export function makeRng(seed: number | string): Rng {
  let state =
    typeof seed === "string" ? fnv1a(seed) : (seed >>> 0) || 0xdeadbeef;
  function next(): number {
    const [s, out] = step(state);
    state = s;
    return out;
  }
  function int(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }
  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick: empty array");
    return arr[Math.floor(next() * arr.length)];
  }
  function sample<T>(arr: readonly T[], n: number): T[] {
    const out: T[] = [];
    const used = new Set<number>();
    const want = Math.min(n, arr.length);
    while (out.length < want) {
      const i = Math.floor(next() * arr.length);
      if (used.has(i)) continue;
      used.add(i);
      out.push(arr[i]);
    }
    return out;
  }
  function chance(p: number): boolean {
    return next() < p;
  }
  function subRng(label: string): Rng {
    const childSeed = (state ^ fnv1a(label)) >>> 0;
    // advance parent so successive subRng calls don't collide
    next();
    return makeRng(childSeed);
  }
  function statefn(): number {
    return state;
  }
  return {
    next,
    int,
    pick,
    sample,
    chance,
    subRng,
    state: statefn,
  };
}
