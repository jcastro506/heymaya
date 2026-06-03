/**
 * Sprint 4 (top-tier) — the experiment-stats core. PURE + deterministic + no DB.
 *
 * Replaces the hand-weighted heuristics ("signups + demos*2 + replies*0.25 >= 5")
 * with real Beta-Bernoulli math, so Maya can say the two most valuable things a
 * low-volume agent can say honestly:
 *   1. "I don't have enough data to call this yet — here's how many more
 *       conversions I need."
 *   2. "lowercase hooks: 3 signups / 12 posts vs polished 0 / 9 — 84% likely
 *       better."
 *
 * Model: each arm's true conversion rate ~ Beta(1+conversions, 1+trials-conversions)
 * (a uniform Beta(1,1) prior). P(best) is computed by deterministic Monte-Carlo
 * (seeded PRNG → Beta via two Marsaglia-Tsang Gamma draws), so the same input
 * always yields the same verdict — ideal for the fixture-corpus tests.
 *
 * A winner requires BOTH P(best) >= WIN_THRESHOLD AND the leader clearing
 * MIN_CONVERSIONS — never P(best) alone (P(best)=1.0 on 1 conversion is noise).
 */

/** P(best) bar a leader must clear to be called a winner. */
export const WIN_THRESHOLD = 0.85;
/** A "leaning" call (worth a provisional lean, not a promotion). */
export const LEAN_THRESHOLD = 0.6;
/** Absolute conversions the leader must have before ANY winner call — guards
 *  against "P(best)=0.99 on 2 conversions". */
export const MIN_CONVERSIONS = 5;
/** Monte-Carlo sample count. Enough for stable 2-decimal P(best). */
const MC_SAMPLES = 4000;
/** Fixed seed → deterministic verdicts (test stability + resumable runs). */
const SEED = 0x9e3779b9;

export interface Arm {
  /** A variant label — a hook type, a channel, a format, etc. */
  label: string;
  /** Denominator: exposures (clicks, or posts). */
  trials: number;
  /** Successes (signups, or whatever counts as the win). */
  conversions: number;
}

export interface ArmPosterior {
  label: string;
  trials: number;
  conversions: number;
  /** Posterior mean conversion rate = (conversions+1)/(trials+2). */
  mean: number;
  /** 80% credible interval [lo, hi] from the posterior samples. */
  ci80: [number, number];
  /** P(this arm has the highest true rate of all arms). */
  pBest: number;
}

export type ExperimentVerdictKind = "winner" | "leaning" | "not_enough_data";

export interface ExperimentVerdict {
  arms: ArmPosterior[];
  /** Label of the leading arm (highest pBest), or null when there are no arms. */
  leader: string | null;
  /** pBest of the leader. */
  pBestLeader: number;
  /** The winner label — set ONLY when verdict === "winner". */
  winner: string | null;
  verdict: ExperimentVerdictKind;
  /** Plain-language one-liner (no jargon — safe to surface to the founder). */
  reason: string;
  /** How many MORE conversions on the leader before a call can be made (0 when decided). */
  conversionsNeeded: number;
}

// ───────────────────────── deterministic RNG ─────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller (guards against log(0)). */
function randNormal(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) via Marsaglia-Tsang. Handles shape < 1 via the boost trick. */
function randGamma(rng: () => number, shape: number): number {
  if (shape < 1) {
    const u = Math.max(rng(), 1e-12);
    return randGamma(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded loop — Marsaglia-Tsang accepts with very high probability per pass.
  for (let i = 0; i < 1000; i++) {
    const x = randNormal(rng);
    const v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = Math.max(rng(), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
  return d; // fallback (effectively never reached)
}

/** Beta(a, b) = G(a) / (G(a) + G(b)). */
function randBeta(rng: () => number, a: number, b: number): number {
  const x = randGamma(rng, a);
  const y = randGamma(rng, b);
  const s = x + y;
  return s > 0 ? x / s : 0.5;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round(p * (sortedAsc.length - 1)))
  );
  return sortedAsc[idx];
}

// ───────────────────────── the core ─────────────────────────

/**
 * Summarize an experiment across arms → per-arm posteriors + a verdict.
 * Deterministic: same arms in → same verdict out.
 */
export function summarizeExperiment(
  rawArms: ReadonlyArray<Arm>
): ExperimentVerdict {
  // Sanitize: clamp conversions to trials, drop nonsense, keep order stable.
  const arms = rawArms.map((a) => {
    const trials = Math.max(0, Math.floor(a.trials));
    const conversions = Math.max(0, Math.min(Math.floor(a.conversions), trials));
    return { label: a.label, trials, conversions };
  });

  if (arms.length === 0) {
    return {
      arms: [],
      leader: null,
      pBestLeader: 0,
      winner: null,
      verdict: "not_enough_data",
      reason: "No data yet — nothing to compare.",
      conversionsNeeded: MIN_CONVERSIONS,
    };
  }

  const rng = mulberry32(SEED);
  // Draw all arms' samples in lockstep so each MC iteration compares one draw
  // per arm (a single shared random "world"), then tally the per-iteration max.
  const alpha = arms.map((a) => 1 + a.conversions);
  const beta = arms.map((a) => 1 + a.trials - a.conversions);
  const samplesByArm: number[][] = arms.map(() => []);
  const bestCount = arms.map(() => 0);

  for (let s = 0; s < MC_SAMPLES; s++) {
    let bestIdx = 0;
    let bestVal = -1;
    for (let i = 0; i < arms.length; i++) {
      const draw = randBeta(rng, alpha[i], beta[i]);
      samplesByArm[i].push(draw);
      if (draw > bestVal) {
        bestVal = draw;
        bestIdx = i;
      }
    }
    bestCount[bestIdx]++;
  }

  const posteriors: ArmPosterior[] = arms.map((a, i) => {
    const sorted = samplesByArm[i].slice().sort((x, y) => x - y);
    return {
      label: a.label,
      trials: a.trials,
      conversions: a.conversions,
      mean: (a.conversions + 1) / (a.trials + 2),
      ci80: [percentile(sorted, 0.1), percentile(sorted, 0.9)],
      pBest: bestCount[i] / MC_SAMPLES,
    };
  });

  // Leader = highest pBest (tie-break by more conversions, then more trials).
  let leaderIdx = 0;
  for (let i = 1; i < posteriors.length; i++) {
    const a = posteriors[i];
    const b = posteriors[leaderIdx];
    if (
      a.pBest > b.pBest ||
      (a.pBest === b.pBest && a.conversions > b.conversions) ||
      (a.pBest === b.pBest &&
        a.conversions === b.conversions &&
        a.trials > b.trials)
    ) {
      leaderIdx = i;
    }
  }
  const leader = posteriors[leaderIdx];
  const totalConversions = arms.reduce((s, a) => s + a.conversions, 0);
  const singleArm = arms.length === 1;

  // A winner needs BOTH a confident pBest AND enough absolute conversions.
  // (A single arm can never "win" a comparison — pBest is trivially 1.)
  const floorMet = leader.conversions >= MIN_CONVERSIONS;
  const confident = leader.pBest >= WIN_THRESHOLD;

  let verdict: ExperimentVerdictKind;
  let reason: string;
  let conversionsNeeded: number;

  if (totalConversions === 0) {
    verdict = "not_enough_data";
    conversionsNeeded = MIN_CONVERSIONS;
    reason =
      "No conversions yet across any variant — too early to call anything.";
  } else if (!singleArm && confident && floorMet) {
    verdict = "winner";
    conversionsNeeded = 0;
    reason = `"${leader.label}" is the winner — ${Math.round(
      leader.pBest * 100
    )}% likely the best (${leader.conversions}/${leader.trials}).`;
  } else if (!singleArm && leader.pBest >= LEAN_THRESHOLD && totalConversions >= 1) {
    verdict = "leaning";
    conversionsNeeded = floorMet
      ? Math.max(2, Math.ceil(leader.conversions * 0.5))
      : MIN_CONVERSIONS - leader.conversions;
    reason = `"${leader.label}" is leaning ahead — ${Math.round(
      leader.pBest * 100
    )}% likely best (${leader.conversions}/${leader.trials}) — not a confident call yet.`;
  } else {
    verdict = "not_enough_data";
    conversionsNeeded = Math.max(1, MIN_CONVERSIONS - leader.conversions);
    reason = singleArm
      ? `Only one variant so far (${leader.conversions}/${leader.trials}) — nothing to compare it against yet.`
      : `Too close to call — the variants aren't separated yet (need ~${Math.max(
          1,
          MIN_CONVERSIONS - leader.conversions
        )} more conversions on the leader).`;
  }

  return {
    arms: posteriors,
    leader: leader.label,
    pBestLeader: leader.pBest,
    winner: verdict === "winner" ? leader.label : null,
    verdict,
    reason,
    conversionsNeeded,
  };
}

// ───────── single-motion helpers (for decideExperimentScale / learning loop) ─────────

/** Real, UNWEIGHTED customer actions from a motion's totals. Replaces the old
 *  "demos*2 + replies*0.25" fudge — a conversion is a conversion. */
export function confirmedConversions(totals: {
  signups?: number;
  installs?: number;
  trials?: number;
  demos?: number;
  feedbackItems?: number;
  creatorApplicants?: number;
}): number {
  return (
    (totals.signups ?? 0) +
    (totals.installs ?? 0) +
    (totals.trials ?? 0) +
    (totals.demos ?? 0) +
    (totals.feedbackItems ?? 0) +
    (totals.creatorApplicants ?? 0)
  );
}

// ───────── Sprint 5 — Thompson allocator + honest-confidence cap ─────────

/**
 * Thompson-sampling allocator: draw ONE sample from each arm's Beta posterior
 * and pick the argmax. Over many calls this allocates traffic to each arm in
 * proportion to its probability of being best — real explore/exploit, not a
 * vibe. A barely-tested arm has a wide posterior, so it still gets picked
 * sometimes (it gets a fair shot); a proven loser rarely does.
 *
 * `seed` is REQUIRED and varies per call (caller passes e.g. a per-draft
 * counter or timestamp) so allocation explores; tests pass a fixed seed for
 * reproducibility. Returns the chosen arm's label (null if no arms).
 */
export function allocateArm(
  rawArms: ReadonlyArray<Arm>,
  seed: number
): { label: string; reason: string } | null {
  const arms = rawArms.map((a) => ({
    label: a.label,
    trials: Math.max(0, Math.floor(a.trials)),
    conversions: Math.max(0, Math.min(Math.floor(a.conversions), Math.max(0, Math.floor(a.trials)))),
  }));
  if (arms.length === 0) return null;
  if (arms.length === 1) {
    return { label: arms[0].label, reason: "only one variant so far" };
  }

  const rng = mulberry32(seed >>> 0);
  let bestIdx = 0;
  let bestDraw = -1;
  for (let i = 0; i < arms.length; i++) {
    const draw = randBeta(rng, 1 + arms[i].conversions, 1 + arms[i].trials - arms[i].conversions);
    if (draw > bestDraw) {
      bestDraw = draw;
      bestIdx = i;
    }
  }
  const chosen = arms[bestIdx];
  // A barely-tested arm winning the draw = exploration; a well-tested leader
  // winning = exploitation. Surface which, in plain words.
  const exploring = chosen.trials < MIN_CONVERSIONS * 2;
  return {
    label: chosen.label,
    reason: exploring
      ? `giving "${chosen.label}" a fair shot — it's still under-tested (${chosen.conversions}/${chosen.trials})`
      : `leaning on "${chosen.label}" — it's the current best bet (${chosen.conversions}/${chosen.trials})`,
  };
}

/**
 * The most confidence a learning may honestly claim given how many data points
 * back it. A learning off 1 observation can't be 0.9 confident. Caps mirror the
 * winner floor: real certainty needs real evidence. Used to clamp save_learning
 * server-side (fail-closed — an overconfident claim can never persist).
 */
export function maxConfidenceForEvidence(evidenceCount: number): number {
  const n = Math.max(0, Math.floor(evidenceCount));
  if (n <= 0) return 0.0;
  if (n === 1) return 0.5;
  if (n === 2) return 0.65;
  if (n < MIN_CONVERSIONS) return 0.8; // 3-4 points
  if (n < MIN_CONVERSIONS * 2) return 0.9; // 5-9 points
  return 0.97; // 10+ points — still never absolute
}

/** Confidence at/below this on an EXISTING learning means it's been contradicted
 *  enough to retire (Maya may revive it if it re-emerges). */
export const RETIRE_CONFIDENCE = 0.3;

export type MotionSignal = "strong" | "weak" | "not_enough_data";

export interface MotionAssessment {
  signal: MotionSignal;
  conversions: number;
  /** More confirmed conversions before "strong" can be claimed (0 when strong). */
  conversionsNeeded: number;
  reason: string;
}

/**
 * Assess a SINGLE motion/format on its own (not an A/B): is the customer signal
 * real enough to act on, or do we need more? Honest floor instead of an
 * arbitrary weighted threshold. `largeExposureNoConversion` lets callers flag a
 * park-worthy "lots of reach, nobody converted".
 */
export function assessSingleMotion(
  conversions: number,
  opts: { samples: number; largeExposureNoConversion?: boolean } = { samples: 0 }
): MotionAssessment {
  const c = Math.max(0, Math.floor(conversions));
  if (c >= MIN_CONVERSIONS) {
    return {
      signal: "strong",
      conversions: c,
      conversionsNeeded: 0,
      reason: `${c} confirmed conversions — a real signal worth doubling down on.`,
    };
  }
  if (c === 0 && opts.largeExposureNoConversion) {
    return {
      signal: "weak",
      conversions: 0,
      conversionsNeeded: MIN_CONVERSIONS,
      reason:
        "Plenty of reach but zero conversions — this isn't converting; revise or park it.",
    };
  }
  return {
    signal: "not_enough_data",
    conversions: c,
    conversionsNeeded: MIN_CONVERSIONS - c,
    reason: `Only ${c} conversion${c === 1 ? "" : "s"} so far — need ${
      MIN_CONVERSIONS - c
    } more before I'd call this, not vanity metrics.`,
  };
}
