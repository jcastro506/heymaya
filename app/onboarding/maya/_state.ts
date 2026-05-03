/**
 * Sprint 2 onboarding — shared state machine.
 *
 * The page-level component (`page.tsx`) holds an `OnboardingState` in React
 * state and renders the active step from `_steps/`. Each step is a leaf
 * component that receives a slice of state + a small set of dispatchers.
 *
 * Why a hand-rolled reducer (no `useReducer` wrapper, no router params):
 *   - Sub-4-min onboarding means we never want a back button to land the user
 *     on a half-finished step. We model progression in memory only, so the
 *     browser back button bounces them out of onboarding entirely.
 *   - The transitions are linear with no skips — `nextStep` is a pure
 *     function of the current step. Reducers / state machines from a library
 *     are overkill.
 *
 * The reducer module is tested in `tests/sprint2OnboardingState.test.ts`.
 */

export type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

export type Channel = "imessage" | "whatsapp" | "sms" | "web";

export type Provider = "calendar" | "gmail" | "stripe";

export type StepId =
  | "handles"
  | "pulling"
  | "questions"
  | "channel"
  | "composio"
  | "deploy";

export const STEP_ORDER: ReadonlyArray<StepId> = [
  "handles",
  "pulling",
  "questions",
  "channel",
  "composio",
  "deploy",
];

export interface VerifiedHandle {
  platform: Platform;
  /** Canonical handle returned by ScrapeCreators (no leading `@`). */
  handle: string;
  displayName: string | null;
  followerCount: number;
  avatarUrl: string | null;
}

export type Tone = "supportive" | "strategic" | "tough-love";

/* -------------------------------------------------------------------------- */
/* Sprint 3.7 — full-picture answer set                                       */
/* -------------------------------------------------------------------------- */

/**
 * Career-stage buckets — Maya can largely INFER this from follower count, so
 * the question UI shows the inference + an override path rather than asking
 * cold. Source of truth lives in `inferCareerStage()` below; both the UI and
 * `submitOnboardingAnswers` mutation read it.
 */
export type CareerStage =
  | "just-starting" // <10K followers, exploring
  | "building"      // 10K-100K, making content their thing
  | "monetizing"    // 100K-500K, revenue is real
  | "scaling";      // 500K+, building a brand/business

/**
 * Buckets we ask the creator to pick from for monthly creator-work revenue.
 * Stored on `creatorPicture.monthlyRevenueUsd` as the bucket midpoint (or 0
 * for the "<$500" bucket) — enough fidelity for Maya's coaching reads
 * without forcing creators to type an exact number they don't know.
 */
export type RevenueBucket =
  | "<500"
  | "500-2k"
  | "2k-10k"
  | "10k-50k"
  | "50k+";

export type RevenueStream =
  | "brand-deals"
  | "affiliate"
  | "merch"
  | "courses"
  | "subs"
  | "ad-rev"
  | "email-list"
  | "live-events"
  | "consulting"
  | "other";

export interface LocationAnswer {
  city: string;
  state: string;
  /**
   * Optional country — most creators leave blank (US is the default audience),
   * but Maya's `maya-opportunity-scout` skill does local brand search, which
   * needs the country to disambiguate (e.g. "Birmingham, AL" vs UK).
   */
  country: string;
}

export interface LongTermGoalsAnswer {
  oneYear: string;
}

/* -------------------------------------------------------------------------- */
/* Wave 2 — dynamic onboarding (stage-tiered Q's)                              */
/* -------------------------------------------------------------------------- */

/**
 * Goals shared between foundational and senior paths. Multi-select for
 * `primaryGoals`; single-select for `ninetyDayPriority`.
 */
export type PrimaryGoal =
  | "grow-following"
  | "make-money"
  | "become-full-time"
  | "land-brand-deals"
  | "launch-product"
  | "build-community"
  | "monetize-existing-audience"
  | "personal-brand-for-career"
  | "creative-outlet";

export type Blocker =
  | "consistency"
  | "what-to-make"
  | "slow-growth"
  | "low-engagement"
  | "no-monetization"
  | "no-time"
  | "brand-deals-not-coming"
  | "unclear-niche"
  | "burnout";

export type SeriousnessLevel =
  | "hobby"
  | "side-hustle"
  | "transitioning-full-time"
  | "already-full-time";

/**
 * SENIOR-only Q's. Surfaced when `getQuestionPath(answers) === "senior"`.
 */
export type SixToTwelveMonthChange =
  | "hire-team"
  | "launch-product"
  | "deprioritize-platform"
  | "focus-monetization-shift"
  | "scale-down-deal-volume"
  | "raise-rates"
  | "less-content-more-strategy";

export type HiringReadiness =
  | "not-yet"
  | "considering"
  | "actively-looking"
  | "already-hired";

/**
 * The full conversational answer set. Each field is independently nullable so
 * the cursor can advance one Q at a time without forcing the creator to fill
 * everything in order. The page-level state holds an in-flight copy here; the
 * `submitOnboardingAnswers` Convex mutation persists to `creatorPicture` once
 * the questions step terminates.
 */
export interface AnswersState {
  goal: string;
  /**
   * Tone is null until the creator picks one. We don't pre-pick a default
   * because the conversational flow needs to render the tone question, and
   * a pre-filled value would make the cursor skip it. The "Strategic" chip
   * is shown as visually-default but the value remains null until clicked.
   */
  tone: Tone | null;
  /**
   * Brand-deal floor in USD (per post / deliverable). null until the creator
   * commits an answer (including 0 = "show me everything"). We treat "the
   * creator typed nothing and moved on" as still requiring a confirmation.
   */
  brandDealFloorUsd: number | null;
  /** Maya-inferred + creator-confirmed. Required to advance. */
  careerStage: CareerStage | null;
  /** Required (Maya needs city + state for local brand search). */
  location: LocationAnswer | null;
  /** Optional (sensitive). Stored as bucket id. */
  monthlyRevenueBucket: RevenueBucket | null;
  /** Required (Maya's monetization diversifier needs to know what's already paying). */
  revenueStreams: RevenueStream[];
  /** Optional. Single sentence is enough. */
  longTermGoals: LongTermGoalsAnswer | null;
  // ─── Wave 2 (dynamic onboarding) — added 2026-04-26 ─────────────────────
  // Stage-tiered Q's. The `getQuestionPath(answers)` helper picks
  // "foundational" (just-starting / building) or "senior" (monetizing /
  // scaling). Foundational path uses `primaryGoals` / `biggestBlockers` /
  // `ninetyDayPriority` / `howSerious` / `brandTypes` / `weeklyHoursAvailable`.
  // Senior path uses `sixToTwelveMonthChanges` / `deprioritizingPlatforms` /
  // `hiringReadiness` / `weeklyHoursAvailable`.
  /** Foundational — multi-select. Empty array = "not answered". */
  primaryGoals: PrimaryGoal[];
  /** Foundational — multi-select. Empty array = "not answered". */
  biggestBlockers: Blocker[];
  /** Foundational — single-select. */
  ninetyDayPriority: PrimaryGoal | null;
  /** Foundational — single-select. */
  howSerious: SeriousnessLevel | null;
  /** Foundational — multi-select free-form list, all optional. */
  brandTypes: string[];
  /** Both paths — number input. null = not answered. */
  weeklyHoursAvailable: number | null;
  /** Senior — multi-select. */
  sixToTwelveMonthChanges: SixToTwelveMonthChange[];
  /** Senior — multi-select. */
  deprioritizingPlatforms: Platform[];
  /** Senior — single-select. */
  hiringReadiness: HiringReadiness | null;
}

/**
 * Question cursor — drives the chat-style "one question at a time" UX. The
 * `questions` step renders the question at index `currentQuestionIdx`,
 * advances on answer, and surfaces the next bubble. We model the order
 * here (not in the component) so transition behavior stays unit-testable.
 *
 * Wave 2 (2026-04-26) — the order is now STAGE-TIERED. The base 8 Q's stay,
 * but `getQuestionPath(answers)` (driven by `careerStage`) picks the dynamic
 * tail: foundational creators answer 6 extra Q's, senior creators answer 4.
 * `nextUnansweredIdx` skips Q's that don't apply to the active path so the
 * cursor advances cleanly.
 *
 * Canonical order:
 *   1. goal — anchors everything
 *   2. careerStage — THE GATE (decides foundational vs senior tail)
 *   3. tone — sets Maya's voice for the rest of onboarding
 *   4. location — required; can't be skipped
 *   5. monthlyRevenue — sensitive; skippable
 *   6. revenueStreams — required; multi-select chips
 *   7. longTermGoals — optional; warm close
 *   8. brandDealFloor — quick numeric, anchors the deal-triage threshold
 *   --- foundational tail (just-starting / building) ---
 *   9.  primaryGoals
 *   10. biggestBlockers
 *   11. ninetyDayPriority
 *   12. howSerious
 *   13. brandTypes
 *   14. weeklyHoursAvailable
 *   --- senior tail (monetizing / scaling) ---
 *   9.  sixToTwelveMonthChanges
 *   10. deprioritizingPlatforms
 *   11. hiringReadiness
 *   12. weeklyHoursAvailable
 *
 * `weeklyHoursAvailable` lives in BOTH paths. The cursor logic surfaces it
 * once based on the active path.
 */
export type QuestionId =
  | "goal"
  | "tone"
  | "brandDealFloor"
  | "careerStage"
  | "location"
  | "monthlyRevenue"
  | "revenueStreams"
  | "longTermGoals"
  // ─── Wave 2 ─────────────────────────────────────────────────────────────
  | "primaryGoals"
  | "biggestBlockers"
  | "ninetyDayPriority"
  | "howSerious"
  | "brandTypes"
  | "weeklyHoursAvailable"
  | "sixToTwelveMonthChanges"
  | "deprioritizingPlatforms"
  | "hiringReadiness";

/**
 * The complete canonical ordering across BOTH paths. The cursor logic skips
 * the path-irrelevant entries; we keep them in one ordered list so:
 *   - the test suite can assert the canonical ordering once
 *   - the QuestionsStep render loop walks ONE list, not two
 */
export const QUESTION_ORDER: ReadonlyArray<QuestionId> = [
  "goal",
  "careerStage", // gate — must come before path-specific Q's
  "tone",
  "location",
  "monthlyRevenue",
  "revenueStreams",
  "longTermGoals",
  "brandDealFloor",
  // Foundational tail (skipped on senior path)
  "primaryGoals",
  "biggestBlockers",
  "ninetyDayPriority",
  "howSerious",
  "brandTypes",
  // Senior tail (skipped on foundational path)
  "sixToTwelveMonthChanges",
  "deprioritizingPlatforms",
  "hiringReadiness",
  // Both paths — render last so the conversational close lands here
  "weeklyHoursAvailable",
];

/** Stage-tiered path. `careerStage` decides which tail to surface. */
export type QuestionPath = "foundational" | "senior";

/**
 * Returns the path the dynamic tail Q's should follow given the creator's
 * `careerStage`. Defaults to "foundational" if careerStage hasn't been
 * picked yet (the cursor will land on careerStage first anyway).
 *
 * just-starting / building → foundational
 * monetizing / scaling     → senior
 */
export function getQuestionPath(answers: AnswersState): QuestionPath {
  const stage = answers.careerStage;
  if (stage === "monetizing" || stage === "scaling") return "senior";
  return "foundational";
}

/** Q ids that belong to the foundational tail (after careerStage gate). */
export const FOUNDATIONAL_TAIL: ReadonlySet<QuestionId> = new Set<QuestionId>([
  "primaryGoals",
  "biggestBlockers",
  "ninetyDayPriority",
  "howSerious",
  "brandTypes",
  "weeklyHoursAvailable",
]);

/** Q ids that belong to the senior tail (after careerStage gate). */
export const SENIOR_TAIL: ReadonlySet<QuestionId> = new Set<QuestionId>([
  "sixToTwelveMonthChanges",
  "deprioritizingPlatforms",
  "hiringReadiness",
  "weeklyHoursAvailable",
]);

/**
 * Returns true iff the question applies to the creator's current path. Always
 * true for the base 8 Q's. For the dynamic tail Q's, returns true only if the
 * Q belongs to the active path's tail.
 */
export function questionAppliesToPath(
  qid: QuestionId,
  answers: AnswersState
): boolean {
  // Base Q's always apply.
  if (
    qid === "goal" ||
    qid === "tone" ||
    qid === "brandDealFloor" ||
    qid === "careerStage" ||
    qid === "location" ||
    qid === "monthlyRevenue" ||
    qid === "revenueStreams" ||
    qid === "longTermGoals"
  ) {
    return true;
  }
  const path = getQuestionPath(answers);
  if (path === "foundational") return FOUNDATIONAL_TAIL.has(qid);
  return SENIOR_TAIL.has(qid);
}

/** Required Q's must be answered before `canAdvance` releases the step. */
export const REQUIRED_QUESTIONS: ReadonlySet<QuestionId> = new Set<QuestionId>([
  "goal",
  "tone",
  "brandDealFloor",
  "careerStage",
  "location",
  "revenueStreams",
]);

/**
 * Skip-allowed Q's. Mirrors `monthlyRevenue` + `longTermGoals` per spec.
 * Wave 2: every dynamic-tail Q is also optional — they enrich the synthesis
 * picture but no answer should ever block onboarding completion.
 */
export const OPTIONAL_QUESTIONS: ReadonlySet<QuestionId> = new Set<QuestionId>([
  "monthlyRevenue",
  "longTermGoals",
  "primaryGoals",
  "biggestBlockers",
  "ninetyDayPriority",
  "howSerious",
  "brandTypes",
  "weeklyHoursAvailable",
  "sixToTwelveMonthChanges",
  "deprioritizingPlatforms",
  "hiringReadiness",
]);

export interface ChannelState {
  phoneNumber: string;
  /** What the UI recommends based on `navigator.userAgent`. May not equal `selected`. */
  recommended: Channel;
  selected: Channel;
}

export interface ConnectedProviderRecord {
  status: "connected" | "skipped";
  /** Composio account id once OAuth completes. Null when skipped. */
  composioAccountId: string | null;
}

export interface ComposioState {
  /** Per-provider snapshot — undefined means "user hasn't decided yet". */
  providers: Partial<Record<Provider, ConnectedProviderRecord>>;
  /**
   * One-time skip nudge for calendar. The UI shows the nudge dialog the FIRST
   * time the user clicks "Skip" on calendar; on the second click they pass
   * through. This is the "two skip-nudges before allowing skip" requirement
   * from the sprint plan, condensed to one in-flow nudge plus the implicit
   * second click as the confirmation.
   */
  calendarSkipNudgeShown: boolean;
}

export type Plan = "starter" | "pro" | "studio";

/**
 * Wave 3 (2026-04-26) — opaque-string id for the `onboardingJobs` rows
 * tracked client-side. Typed as `string` (not `Id<"onboardingJobs">`) so
 * `_state.ts` doesn't take a runtime dependency on the Convex generated
 * types — keeps the state module pure-TS and trivially unit-testable.
 * The actual `Id<"onboardingJobs">` is what Convex returns; the string
 * representation round-trips fine.
 */
export type OnboardingJobId = string;

export interface OnboardingState {
  step: StepId;
  /** Plan inferred from `creators.plan` once the Convex me-query lands. */
  plan: Plan;
  handles: VerifiedHandle[];
  answers: AnswersState;
  /** Question cursor for the conversational `questions` step. 0..QUESTION_ORDER.length. */
  currentQuestionIdx: number;
  /**
   * Q ids the creator explicitly skipped. Only Q's in `OPTIONAL_QUESTIONS`
   * are allowed in here — `markQuestionSkipped` enforces this.
   */
  skippedQuestions: ReadonlySet<QuestionId>;
  channel: ChannelState;
  composio: ComposioState;
  /** Set true after `runFullScrapePull` resolves; gates entry into `questions`. */
  scrapeComplete: boolean;
  /** Surface-level error banner shown across steps. Cleared on next action. */
  error: string | null;
  // ─── Wave 3 (onboarding parallelism) — added 2026-04-26 ─────────────────
  // Tracks the background-job rows kicked off DURING onboarding so
  // PullingStep / DeployStep can subscribe to live state and skip the
  // corresponding deploy stages when done. null until the kickoff returns.
  /** `onboardingJobs` row id for the bulk ScrapeCreators pull. */
  bulkPullJobId: OnboardingJobId | null;
  /** `onboardingJobs` row id for the multimodal synth picture. */
  synthJobId: OnboardingJobId | null;
}

export const DEFAULT_ANSWERS: AnswersState = {
  goal: "",
  tone: null,
  brandDealFloorUsd: null,
  careerStage: null,
  location: null,
  monthlyRevenueBucket: null,
  revenueStreams: [],
  longTermGoals: null,
  // ─── Wave 2 defaults ────────────────────────────────────────────────────
  primaryGoals: [],
  biggestBlockers: [],
  ninetyDayPriority: null,
  howSerious: null,
  brandTypes: [],
  weeklyHoursAvailable: null,
  sixToTwelveMonthChanges: [],
  deprioritizingPlatforms: [],
  hiringReadiness: null,
};

export const DEFAULT_CHANNEL: ChannelState = {
  phoneNumber: "",
  recommended: "web",
  selected: "web",
};

export const DEFAULT_COMPOSIO: ComposioState = {
  providers: {},
  calendarSkipNudgeShown: false,
};

export function initialState(plan: Plan = "starter"): OnboardingState {
  return {
    step: "handles",
    plan,
    handles: [],
    answers: DEFAULT_ANSWERS,
    currentQuestionIdx: 0,
    skippedQuestions: new Set<QuestionId>(),
    channel: DEFAULT_CHANNEL,
    composio: DEFAULT_COMPOSIO,
    scrapeComplete: false,
    error: null,
    // Wave 3 — no jobs kicked off yet at boot.
    bulkPullJobId: null,
    synthJobId: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Wave 3 — job-id setters                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Pure reducer — record the bulkPullJobId that `kickoffBulkPullJob` returned.
 * Called from HandlesStep after the user clicks "Continue" and the kickoff
 * action resolves with a jobId.
 */
export function setBulkPullJobId(
  state: OnboardingState,
  jobId: OnboardingJobId | null
): OnboardingState {
  return { ...state, bulkPullJobId: jobId };
}

/**
 * Pure reducer — record the synthJobId that `kickoffSynthJob` returned.
 * Called from QuestionsStep after the final required answer is submitted
 * and the kickoff action resolves with a jobId.
 */
export function setSynthJobId(
  state: OnboardingState,
  jobId: OnboardingJobId | null
): OnboardingState {
  return { ...state, synthJobId: jobId };
}

/* -------------------------------------------------------------------------- */
/* Plan-tier caps                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Mirror of `convex/lib/planFeatures.ts`. Frontend uses this for UX cues only;
 * server-side enforcement remains the source of truth. Keep these two in sync
 * by hand — the fixture corpus tests in Sprint 1 cover the server values.
 */
export const PLAN_MAX_HANDLES: Record<Plan, number> = {
  starter: 1,
  pro: 3,
  studio: 5,
};

export const PLAN_ALLOWED_PROVIDERS: Record<Plan, ReadonlySet<Provider>> = {
  starter: new Set<Provider>(["stripe"]),
  pro: new Set<Provider>(["calendar", "gmail", "stripe"]),
  studio: new Set<Provider>(["calendar", "gmail", "stripe"]),
};

export const PLAN_ALLOWED_CHANNELS: Record<Plan, ReadonlySet<Channel>> = {
  starter: new Set<Channel>(["web", "sms"]),
  pro: new Set<Channel>(["web", "sms", "imessage", "whatsapp"]),
  studio: new Set<Channel>(["web", "sms", "imessage", "whatsapp"]),
};

/* -------------------------------------------------------------------------- */
/* Pure transitions — easy to unit-test                                        */
/* -------------------------------------------------------------------------- */

export function canAdvance(state: OnboardingState): boolean {
  switch (state.step) {
    case "handles":
      return state.handles.length > 0;
    case "pulling":
      return state.scrapeComplete;
    case "questions":
      // Sprint 3.7: every required Q must be answered (skipping a required Q
      // is rejected by `markQuestionSkipped`, so we only need the value
      // check here).
      return allRequiredAnswered(state.answers);
    case "channel":
      // Web is always valid (no phone needed). Other channels need a phone.
      if (state.channel.selected === "web") return true;
      return /^[+]?[\d\s\-()]{7,}$/.test(state.channel.phoneNumber.trim());
    case "composio":
      // All three are optional — but calendar requires a skip-nudge ack first
      // when the creator is Pro/Studio (handled in the step component).
      return true;
    case "deploy":
      return false; // Deploy is the terminal step; no "next".
  }
}

/* -------------------------------------------------------------------------- */
/* Sprint 3.7 — question-machine helpers                                      */
/* -------------------------------------------------------------------------- */

/**
 * Per-question "is this answer present?" predicate. Used by:
 *   - `canAdvance` (questions step) — every required Q must return true
 *   - `nextUnansweredQuestion` — pick the next bubble to show
 *   - `submitOnboardingAnswers` mutation — required-vs-optional validation
 *
 * Treat empty strings + empty arrays + null as "not answered" so the cursor
 * doesn't false-positive on a half-filled state slice.
 */
export function isQuestionAnswered(
  answers: AnswersState,
  q: QuestionId
): boolean {
  switch (q) {
    case "goal":
      return answers.goal.trim().length > 0;
    case "tone":
      return answers.tone !== null;
    case "brandDealFloor":
      // 0 is a valid answer ("show me everything") so any non-negative
      // number counts. Negatives are filtered upstream. null means the
      // creator hasn't committed yet.
      return (
        answers.brandDealFloorUsd !== null &&
        Number.isFinite(answers.brandDealFloorUsd) &&
        answers.brandDealFloorUsd >= 0
      );
    case "careerStage":
      return answers.careerStage !== null;
    case "location":
      return (
        answers.location !== null &&
        answers.location.city.trim().length > 0 &&
        answers.location.state.trim().length > 0
      );
    case "monthlyRevenue":
      return answers.monthlyRevenueBucket !== null;
    case "revenueStreams":
      return answers.revenueStreams.length > 0;
    case "longTermGoals":
      return (
        answers.longTermGoals !== null &&
        answers.longTermGoals.oneYear.trim().length > 0
      );
    // ─── Wave 2 ───────────────────────────────────────────────────────────
    case "primaryGoals":
      return answers.primaryGoals.length > 0;
    case "biggestBlockers":
      return answers.biggestBlockers.length > 0;
    case "ninetyDayPriority":
      return answers.ninetyDayPriority !== null;
    case "howSerious":
      return answers.howSerious !== null;
    case "brandTypes":
      return answers.brandTypes.length > 0;
    case "weeklyHoursAvailable":
      return (
        answers.weeklyHoursAvailable !== null &&
        Number.isFinite(answers.weeklyHoursAvailable) &&
        answers.weeklyHoursAvailable >= 0
      );
    case "sixToTwelveMonthChanges":
      return answers.sixToTwelveMonthChanges.length > 0;
    case "deprioritizingPlatforms":
      return answers.deprioritizingPlatforms.length > 0;
    case "hiringReadiness":
      return answers.hiringReadiness !== null;
  }
}

/**
 * Returns true iff every required Q has a present answer AND applies to the
 * active path. Used by both the frontend `canAdvance` and the server-side
 * validation in `submitOnboardingAnswers`. Skipped Q's are *not* required by
 * definition (`markQuestionSkipped` rejects skips on required Q's).
 *
 * Wave 2 — required Q's are all in the BASE 8 (none of the dynamic-tail Q's
 * are required), so the path filter is defensive but always permits them.
 */
export function allRequiredAnswered(answers: AnswersState): boolean {
  for (const q of QUESTION_ORDER) {
    if (!REQUIRED_QUESTIONS.has(q)) continue;
    if (!questionAppliesToPath(q, answers)) continue;
    if (!isQuestionAnswered(answers, q)) return false;
  }
  return true;
}

/**
 * Career-stage inference from total followers across all connected handles.
 * The threshold buckets match the spec — see `CareerStage` JSDoc above.
 *
 * Pure function so unit tests pin the bucket boundaries; the UI calls this
 * to render the "I see you're at ~12K — building stage. Sound right?" line.
 */
export function inferCareerStage(totalFollowers: number): CareerStage {
  if (totalFollowers < 10_000) return "just-starting";
  if (totalFollowers < 100_000) return "building";
  if (totalFollowers < 500_000) return "monetizing";
  return "scaling";
}

/** Sum follower counts across the connected handles. */
export function totalFollowerCount(handles: ReadonlyArray<VerifiedHandle>): number {
  return handles.reduce((acc, h) => acc + (h.followerCount ?? 0), 0);
}

/**
 * Convert a `RevenueBucket` id to a midpoint USD value the backend can
 * persist on `creatorPicture.monthlyRevenueUsd`. The bucket boundaries are
 * the source of truth; tests pin them.
 */
export function revenueBucketToUsd(bucket: RevenueBucket): number {
  switch (bucket) {
    case "<500":
      return 0;
    case "500-2k":
      return 1_250; // midpoint
    case "2k-10k":
      return 6_000;
    case "10k-50k":
      return 30_000;
    case "50k+":
      return 50_000; // floor; we don't ask for an upper bound past this
  }
}

/* -------------------------------------------------------------------------- */
/* Question-cursor reducers                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Patch the answer payload + advance the cursor to the next unanswered Q.
 * If every Q is now answered, the cursor parks at `QUESTION_ORDER.length`
 * (i.e. one past the end) which the UI reads as "show the advance CTA".
 */
export function answerQuestion<K extends keyof AnswersState>(
  state: OnboardingState,
  field: K,
  value: AnswersState[K]
): OnboardingState {
  const answers = { ...state.answers, [field]: value };
  return {
    ...state,
    answers,
    currentQuestionIdx: nextUnansweredIdx(answers, state.skippedQuestions, state.currentQuestionIdx),
    error: null,
  };
}

/**
 * Mark an OPTIONAL question as skipped. Throws on a required Q so the caller
 * can never accidentally skip something Maya needs.
 */
export function markQuestionSkipped(
  state: OnboardingState,
  q: QuestionId
): OnboardingState {
  if (!OPTIONAL_QUESTIONS.has(q)) {
    return {
      ...state,
      error: `Cannot skip a required question (${q}).`,
    };
  }
  const skipped = new Set<QuestionId>(state.skippedQuestions);
  skipped.add(q);
  return {
    ...state,
    skippedQuestions: skipped,
    currentQuestionIdx: nextUnansweredIdx(state.answers, skipped, state.currentQuestionIdx),
    error: null,
  };
}

/**
 * Internal: walk forward and return the index of the next Q that is neither
 * answered nor skipped AND applies to the active path. Returns
 * `QUESTION_ORDER.length` when nothing is left.
 *
 * Wave 2: Q's not in the active path (foundational vs senior tail) are
 * skipped automatically. The path is decided by `getQuestionPath(answers)` —
 * which reads `careerStage`. Until careerStage lands, we're in the
 * foundational path by default (the cursor lands on careerStage early
 * regardless, so the path can flip mid-flow).
 */
function nextUnansweredIdx(
  answers: AnswersState,
  skipped: ReadonlySet<QuestionId>,
  _from: number
): number {
  // Always return the FIRST unanswered (and not-skipped) Q in the canonical
  // order that applies to the current path. Out-of-order answers (creator
  // clicks careerStage chip first, or inference pre-fills it) must NOT cause
  // the cursor to skip over Q's that remain unanswered earlier in the list.
  for (let i = 0; i < QUESTION_ORDER.length; i++) {
    const q = QUESTION_ORDER[i];
    if (!questionAppliesToPath(q, answers)) continue;
    if (!skipped.has(q) && !isQuestionAnswered(answers, q)) return i;
  }
  return QUESTION_ORDER.length;
}

/**
 * UI helper: which Q should the chat surface right now? Returns null when
 * everything is answered/skipped (the advance CTA replaces the bubble).
 */
export function currentQuestion(state: OnboardingState): QuestionId | null {
  if (state.currentQuestionIdx >= QUESTION_ORDER.length) return null;
  return QUESTION_ORDER[state.currentQuestionIdx];
}

/**
 * Pre-seed the inferred career stage on the answer payload + advance past it
 * if the creator implicitly accepts the inference (the UI shows it as
 * "Sound right?" — ack = answer accepted; override = re-pick).
 */
export function applyCareerStageInference(
  state: OnboardingState,
  totalFollowers: number
): OnboardingState {
  if (state.answers.careerStage !== null) return state; // creator already answered/overrode
  const inferred = inferCareerStage(totalFollowers);
  return {
    ...state,
    answers: { ...state.answers, careerStage: inferred },
  };
}

export function nextStep(step: StepId): StepId {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1 || idx === STEP_ORDER.length - 1) return step;
  return STEP_ORDER[idx + 1];
}

export function previousStep(step: StepId): StepId {
  const idx = STEP_ORDER.indexOf(step);
  if (idx <= 0) return step;
  return STEP_ORDER[idx - 1];
}

/**
 * `addHandle` enforces:
 *   - per-platform uniqueness (one handle per platform)
 *   - plan-tier max-handles cap (UI-side; server enforces too)
 *   - returns either the new state or a structured error reason
 */
export type AddHandleResult =
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: "duplicate-platform" | "plan-cap" };

export function addHandle(
  state: OnboardingState,
  handle: VerifiedHandle
): AddHandleResult {
  if (state.handles.some((h) => h.platform === handle.platform)) {
    return { ok: false, reason: "duplicate-platform" };
  }
  if (state.handles.length >= PLAN_MAX_HANDLES[state.plan]) {
    return { ok: false, reason: "plan-cap" };
  }
  return {
    ok: true,
    state: { ...state, handles: [...state.handles, handle], error: null },
  };
}

export function removeHandle(
  state: OnboardingState,
  platform: Platform
): OnboardingState {
  return {
    ...state,
    handles: state.handles.filter((h) => h.platform !== platform),
  };
}

export function setStep(state: OnboardingState, step: StepId): OnboardingState {
  return { ...state, step, error: null };
}

export function recordProviderConnection(
  state: OnboardingState,
  provider: Provider,
  composioAccountId: string
): OnboardingState {
  return {
    ...state,
    composio: {
      ...state.composio,
      providers: {
        ...state.composio.providers,
        [provider]: { status: "connected", composioAccountId },
      },
    },
  };
}

export function recordProviderSkip(
  state: OnboardingState,
  provider: Provider
): OnboardingState {
  return {
    ...state,
    composio: {
      ...state.composio,
      providers: {
        ...state.composio.providers,
        [provider]: { status: "skipped", composioAccountId: null },
      },
    },
  };
}

export function markCalendarSkipNudgeShown(
  state: OnboardingState
): OnboardingState {
  return {
    ...state,
    composio: { ...state.composio, calendarSkipNudgeShown: true },
  };
}

/**
 * Heuristic device detection for Sprint 2's channel recommendation.
 * Pure function (takes the user-agent string) so it's trivially testable.
 *
 *   - iPhone / iPad / iPod → iMessage
 *   - Android → WhatsApp (rich media + ubiquitous)
 *   - Anything else → web (the always-available fallback)
 */
export function recommendChannel(userAgent: string): Channel {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "imessage";
  if (/android/.test(ua)) return "whatsapp";
  return "web";
}
