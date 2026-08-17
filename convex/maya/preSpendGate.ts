/**
 * ⭐ The pre-spend gate (§7.5.7, Sprint 9) — eight checks, in order.
 *
 * > *"**All of these run before the founder ever sees the idea**, so an
 * > approved idea can never fail on budget or assets. **Failing after a yes is
 * > the worst possible sequence.**"*
 *
 * That sentence is the whole design. A gate that runs after approval turns a
 * founder's "yes" into an apology, and §7.5.7 exists specifically to stop that.
 * `preflight.ts` applies the same ordering to text posts; this is its sibling
 * for anything that spends render credits.
 *
 * ## It resolves rather than refuses
 *
 * Seven of the eight failures have a defined *adjustment* — drop a rung,
 * re-brief around what exists, rewrite without the claim, shorten. Only a hard
 * budget block and an empty library stop everything. So the verdict is a plan
 * she can execute, not a yes/no — which is what makes "an approved idea can
 * never fail" achievable rather than aspirational.
 *
 * ## ⚠️ And it never invents a shot
 *
 * Check 4 fails to *re-brief around what exists*, never to generate the missing
 * asset. §2.7's floor covers images: a fabricated UI is the one thing this
 * system may not produce, and "the brief called for a dashboard" is exactly the
 * innocent-sounding reason it would.
 */

/** Cheapest first — dropping a rung means moving DOWN this list. */
export const RUNGS = ["static", "carousel", "avatar", "ad_clone"] as const;
export type Rung = (typeof RUNGS)[number];

/**
 * ⭐ THE HIGHEST RUNG ANYTHING IN THIS CODEBASE CAN ACTUALLY BUILD.
 *
 * ⚠️ Not a tier, not a budget, not a preference — a statement about what code
 * exists. `avatar` and `ad_clone` are video rungs, and **`convex/maya` has no
 * video path at all**: no `make_video`, no `enqueue_render`, no caller for
 * `videoSynthWorker`, and no Creatify call. Her only media tool is
 * `make_carousel`. The video implementation lives in `gtmMaya/`, the frozen
 * product, and was never carried across.
 *
 * ⚠️ The bug this closes is the opposite of the obvious one. The live customer
 * is on `mvp`, which grants `videosPerMonth: 4`, so `tierMaxRung` computed to
 * `avatar` and the gate said **yes** to a rung nothing can produce. A gate that
 * authorises impossible work is worse than one that blocks it: the founder is
 * told a video is coming, and §2.7 is broken by a promise rather than a
 * sentence.
 *
 * Deliberately a named constant and not a removed rung. The ladder is the
 * product's shape and `videosPerMonth: 4` is a real commercial promise — both
 * stay, and this is the one line that flips as rungs become buildable.
 *
 * ⭐ MOVED TO `avatar` 2026-08-17 — Sprint 9's `make_video` landed. The
 * `link_to_videos` HYBRID flow is wired end to end against the published
 * contract (`convex/maya/video.ts`), gated, storyboarded and queued.
 *
 * ⚠️ `ad_clone` stays out of reach, and not for a technical reason: it is built
 * and tested in the same file. It recreates a proven ad's structure, which is
 * the rung whose COMMERCIAL terms are unsettled — CLAUDE.md operator blocker 1
 * asks for written resale rights, and shipping a clone before those exist is a
 * legal exposure rather than an engineering one. It flips when the paperwork
 * does, not when the code does.
 */
export const MAX_BUILDABLE_RUNG: Rung = "avatar";

/** §7.5.7 check 7 — render time against post time. */
export const DEADLINE_RATIO = 10;

export type BudgetMode = "full" | "graceful_degrade" | "hard_block";

export interface GateInput {
  rung: Rung;
  budgetMode: BudgetMode;
  /** Check 2 — the shared pool, not this customer's slice. */
  poolAboveReserve: boolean;
  /** Check 3 — the highest rung this tier permits. */
  tierMaxRung: Rung;
  /** Check 4 — assets the brief names that the library actually has. */
  assetsNamed: number;
  assetsResolved: number;
  /**
   * ⚠️ Checks 5–8 are OPTIONAL, and their absence is reported rather than
   * treated as a pass.
   *
   * A caller that can only feed four of the eight used to have to invent the
   * other four — and an invented input makes the gate look active while
   * checking nothing, which is worse than not calling it. `notEvaluated` on the
   * verdict names exactly what did not run.
   */
  /** Check 5 — claims with no support in product truth. */
  unverifiedClaims?: string[];
  /** Check 6 — has this angle run recently. */
  angleRanRecently?: boolean;
  /** Check 7 — seconds. */
  estimatedRenderSeconds?: number;
  secondsUntilSlot?: number;
  /** Check 8 */
  estimatedCredits?: number;
  remainingCredits?: number;
}

export interface GateVerdict {
  /** ⭐ False only when nothing can be made at all. */
  proceed: boolean;
  /** The rung she may actually spend at, after every drop. */
  rung: Rung;
  /** What each failed check did about it, in order. Never silent. */
  adjustments: string[];
  /** Which check stopped everything, when one did. */
  blockedBy?: string;
  /** Plain language, for the founder. */
  detail: string;
  /**
   * ⚠️ Checks the caller could not feed. Empty means all eight ran.
   *
   * Stated so a surface can never present a four-check verdict as the full
   * gate — §2.5, a partial result reported as complete is the failure this
   * codebase keeps finding.
   */
  notEvaluated: string[];
}

function lower(rung: Rung): Rung | null {
  const i = RUNGS.indexOf(rung);
  return i > 0 ? RUNGS[i - 1] : null;
}

function capTo(rung: Rung, max: Rung): Rung {
  return RUNGS.indexOf(rung) > RUNGS.indexOf(max) ? max : rung;
}

/**
 * Cap a tier ceiling to what the pipeline can actually produce.
 *
 * Exported so a caller computing `tierMaxRung` from a plan cannot forget it —
 * `carousel.ts` computed `avatar` from `videosPerMonth: 4` and handed the gate
 * a rung nothing implements.
 */
export function capToBuildable(rung: Rung): Rung {
  return capTo(rung, MAX_BUILDABLE_RUNG);
}

/**
 * ⭐ Run all eight, in order, and return something executable.
 *
 * Pure. §7.5.7's ordering is the contract, and a gate whose decision depends on
 * a live vendor is a gate that can't be reasoned about — or tested, which is
 * the same problem later.
 */
export function runGate(input: GateInput): GateVerdict {
  const adjustments: string[] = [];
  let rung = input.rung;

  const notEvaluated: string[] = [];
  if (input.unverifiedClaims === undefined) notEvaluated.push("claims");
  if (input.angleRanRecently === undefined) notEvaluated.push("repeats");
  if (
    input.estimatedRenderSeconds === undefined ||
    input.secondsUntilSlot === undefined
  ) {
    notEvaluated.push("deadline");
  }
  if (
    input.estimatedCredits === undefined ||
    input.remainingCredits === undefined
  ) {
    notEvaluated.push("credits");
  }

  // 1 — creative budget. "Never render blind."
  if (input.budgetMode === "hard_block") {
    return {
      proceed: false,
      rung,
      adjustments,
      blockedBy: "budget",
      notEvaluated,
      // ⚠️ Said plainly. §2230: a credit shortage costs quality, never
      // availability — and never a silent downgrade either.
      detail:
        "I've used up what I can spend on making videos this month — I'll do a simple image post instead, and I'm telling you rather than quietly downgrading",
    };
  }
  if (input.budgetMode === "graceful_degrade") {
    const next = lower(rung);
    if (next) {
      adjustments.push(
        `made a simpler version to stay inside the month's budget`,
      );
      rung = next;
    }
  }

  /**
   * 2 — the SHARED pool. Fleet-wide, not this customer's slice: one account
   * cannot be allowed to drain the pool the other 199 render from.
   */
  if (!input.poolAboveReserve) {
    return {
      proceed: false,
      rung,
      adjustments,
      blockedBy: "pool",
      notEvaluated,
      detail: "I can't make a video safely right now — an image post instead",
    };
  }

  // 3 — tier ceiling.
  const capped = capTo(rung, input.tierMaxRung);
  if (capped !== rung) {
    adjustments.push(`${rung} isn't on this plan, so ${capped}`);
    rung = capped;
  }

  /**
   * 4 — assets. ⚠️ Re-brief around what exists; NEVER invent the missing shot.
   * §2.7's floor covers images, and "the brief called for it" is precisely the
   * innocent reason a fabricated UI would get made.
   */
  if (input.assetsResolved < input.assetsNamed) {
    if (input.assetsResolved === 0) {
      return {
        proceed: false,
        rung,
        adjustments,
        blockedBy: "assets",
        notEvaluated,
        detail:
          "nothing you've sent me matches what this needs, and I won't invent a picture of your product",
      };
    }
    adjustments.push(
      `built it around the ${input.assetsResolved} of ${input.assetsNamed} pictures I actually have`,
    );
  }

  // 5 — claims. Rewrite without it, never soften it.
  if (input.unverifiedClaims && input.unverifiedClaims.length > 0) {
    adjustments.push(
      `cut ${input.unverifiedClaims!.length === 1 ? "a claim" : `${input.unverifiedClaims!.length} claims`} I can't back from what you've told me`,
    );
  }

  // 6 — repeats.
  if (input.angleRanRecently === true) {
    return {
      proceed: false,
      rung,
      adjustments,
      blockedBy: "repeat",
      notEvaluated,
      detail: "this angle went out recently — I'll take the next idea instead",
    };
  }

  /**
   * 7 — deadline. Render time against time-to-slot at a 1:10 ratio, so a job
   * that would finish at the wire doesn't push the post past its best hour.
   */
  if (
    input.estimatedRenderSeconds !== undefined &&
    input.secondsUntilSlot !== undefined &&
    input.estimatedRenderSeconds * DEADLINE_RATIO > input.secondsUntilSlot
  ) {
    const next = lower(rung);
    if (!next) {
      return {
        proceed: false,
        rung,
        adjustments,
        blockedBy: "deadline",
        notEvaluated,
        detail:
          "not enough time before I meant to post this to make it properly — I'd rather move it than rush it",
      };
    }
    adjustments.push(
      `a simpler version — not enough time before I meant to post for the longer one`,
    );
    rung = next;
  }

  // 8 — the monthly allowance.
  if (
    input.estimatedCredits !== undefined &&
    input.remainingCredits !== undefined &&
    input.estimatedCredits > input.remainingCredits
  ) {
    const next = lower(rung);
    if (!next) {
      return {
        proceed: false,
        rung,
        adjustments,
        blockedBy: "credits",
        notEvaluated,
        detail:
          "I've used up this month's video allowance — an image post instead",
      };
    }
    adjustments.push(`a simpler version, to fit what's left of this month`);
    rung = next;
  }

  return {
    proceed: true,
    rung,
    adjustments,
    notEvaluated,
    detail:
      adjustments.length === 0
        ? `making a ${rung}`
        : `making a ${rung} — ${adjustments.join("; ")}`,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * ⭐ The authenticity half (§7.5.3, Sprint 9).
 *
 * > *"the eight-check gate carries authenticity checks, not just completeness:
 * > is there real footage · is the cut rhythm varied · is the hook shown rather
 * > than explained."*
 *
 * ⚠️ These do NOT block. They are notes on the brief, because "the cut rhythm
 * is even" is a judgment about a thing that doesn't exist yet — blocking on it
 * would stop work on a prediction. §7.5.3's actual requirement is that an
 * avatar is *stated*, and that is enforced separately in `assetFloor`.
 */
export interface AuthenticityInput {
  hasRealFootage: boolean;
  cutsPerSecond: number | null;
  /** Does the opening SHOW the problem, or describe it? */
  hookIsShown: boolean;
}

export function authenticityNotes(input: AuthenticityInput): string[] {
  const notes: string[] = [];

  if (!input.hasRealFootage) {
    // §6.0.1: founder footage is "the best-performing content there is".
    notes.push(
      "no real footage in this one — it'll read as made rather than filmed",
    );
  }

  /**
   * §7.5.3 names "perfectly even cut rhythm" as a visual tell. A single
   * sustained rate is the signature of an assembled video; real editing
   * bunches and pauses.
   */
  if (
    input.cutsPerSecond !== null &&
    input.cutsPerSecond > 0 &&
    input.cutsPerSecond < 0.15
  ) {
    notes.push("the cuts are very evenly spaced — worth varying the rhythm");
  }

  if (!input.hookIsShown) {
    notes.push("the opening explains the problem rather than showing it");
  }

  return notes;
}
