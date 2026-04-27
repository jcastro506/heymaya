"use client";

/**
 * Step 3: Questions (Sprint 3.7 — 8-Q conversational rebuild).
 *
 * Maya's first chat. Conversational, NOT a form: one question at a time,
 * advance on answer, never render the next bubble until the previous answer
 * lands. The state machine + ordering live in `_state.ts` so the bubble
 * sequencing is unit-testable.
 *
 * UX guardrails (from sprint spec):
 *   - Total time budget: <90s for all 8 Q's.
 *   - Answered Q's stay rendered above (so the chat scroll grows naturally).
 *   - Required Q's: goal, tone, brandDealFloor, careerStage, location, revenueStreams.
 *   - Optional (skip-allowed): monthlyRevenue, longTermGoals.
 *   - careerStage is INFERRED from total followers + shown for confirm/override.
 *
 * Why one component (not 8 sub-components): the chat shape requires answered
 * bubbles to stay rendered as a transcript above the active prompt. Splitting
 * by Q would force prop-drilling the transcript history through every leaf.
 * Keeping it together also means the cursor is a single piece of state that
 * matches the reducer 1:1 — easier to reason about, easier to test.
 *
 * Note on grounding: Maya's "specific, cited" first message references at
 * least two scraped posts per platform per the Sprint 2 acceptance gate.
 * That copy is generated server-side from the creatorPicture once the
 * synthesizer ships.
 *
 * TODO(s7): swap the static intro lines for the real grounded-citation
 * intro produced by the creator-picture synthesizer
 * (`internal.agents.packs.maya.firstMessage.draft`). Sprint 2's
 * `synthesizeCreatorPicture` ships the picture; the first-message draft
 * helper that consumes it is deferred to S7 beta hardening so the static
 * copy here is the v0 shipping default. The bubbles render whatever the
 * synthesizer returns once wired.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  OPTIONAL_QUESTIONS,
  QUESTION_ORDER,
  allRequiredAnswered,
  answerQuestion,
  applyCareerStageInference,
  currentQuestion,
  inferCareerStage,
  isQuestionAnswered,
  markQuestionSkipped,
  questionAppliesToPath,
  setSynthJobId,
  totalFollowerCount,
  type AnswersState,
  type Blocker,
  type CareerStage,
  type HiringReadiness,
  type LocationAnswer,
  type LongTermGoalsAnswer,
  type OnboardingState,
  type Platform,
  type PrimaryGoal,
  type QuestionId,
  type RevenueBucket,
  type RevenueStream,
  type SeriousnessLevel,
  type SixToTwelveMonthChange,
  type Tone,
} from "../_state";
import { StepShell, StepFooter } from "./HandlesStep";

const kickoffSynthRef = api.onboarding.maya.jobs.kickoffSynthJob;

interface QuestionsStepProps {
  state: OnboardingState;
  /**
   * Replaces the parent `setAnswers` adapter with a full-state setter. The
   * 3.7 cursor + skip set live alongside `answers`, so the step needs to
   * dispatch through the reducer to keep them coherent.
   */
  setOnboardingState: (next: OnboardingState) => void;
  onAdvance: () => void;
}

/* -------------------------------------------------------------------------- */
/* Static option lists                                                        */
/* -------------------------------------------------------------------------- */

const TONE_OPTIONS: ReadonlyArray<{ id: Tone; label: string; tagline: string }> = [
  { id: "supportive", label: "Supportive", tagline: "Honest but soft." },
  { id: "strategic", label: "Strategic", tagline: "Direct, focused on outcomes." },
  { id: "tough-love", label: "Tough love", tagline: "Will tell you when something's mid." },
];

const REVENUE_BUCKETS: ReadonlyArray<{ id: RevenueBucket; label: string }> = [
  { id: "<500", label: "Under $500" },
  { id: "500-2k", label: "$500 – $2K" },
  { id: "2k-10k", label: "$2K – $10K" },
  { id: "10k-50k", label: "$10K – $50K" },
  { id: "50k+", label: "$50K+" },
];

const REVENUE_STREAMS: ReadonlyArray<{ id: RevenueStream; label: string }> = [
  { id: "brand-deals", label: "Brand deals" },
  { id: "affiliate", label: "Affiliate" },
  { id: "merch", label: "Merch" },
  { id: "courses", label: "Courses" },
  { id: "subs", label: "Subs" },
  { id: "ad-rev", label: "Ad rev" },
  { id: "email-list", label: "Email list" },
  { id: "live-events", label: "Live events" },
  { id: "consulting", label: "Consulting" },
  { id: "other", label: "Something else" },
];

const CAREER_STAGE_LABEL: Record<CareerStage, string> = {
  "just-starting": "Just starting",
  building: "Building",
  monetizing: "Monetizing",
  scaling: "Scaling",
};

/* Wave 2 — option lists for the dynamic-tail Q's */

const PRIMARY_GOAL_OPTIONS: ReadonlyArray<{ id: PrimaryGoal; label: string }> = [
  { id: "grow-following", label: "Grow my following" },
  { id: "make-money", label: "Make money from this" },
  { id: "become-full-time", label: "Become a full-time creator" },
  { id: "land-brand-deals", label: "Land brand deals" },
  { id: "launch-product", label: "Launch a product" },
  { id: "build-community", label: "Build a community" },
  { id: "monetize-existing-audience", label: "Monetize my existing audience" },
  { id: "personal-brand-for-career", label: "Build a personal brand for my career" },
  { id: "creative-outlet", label: "Pure creative outlet" },
];

const BLOCKER_OPTIONS: ReadonlyArray<{ id: Blocker; label: string }> = [
  { id: "consistency", label: "Posting consistently" },
  { id: "what-to-make", label: "Knowing what to make" },
  { id: "slow-growth", label: "Growth feels slow" },
  { id: "low-engagement", label: "Engagement is low" },
  { id: "no-monetization", label: "No monetization yet" },
  { id: "no-time", label: "Not enough time" },
  { id: "brand-deals-not-coming", label: "Brand deals aren't coming in" },
  { id: "unclear-niche", label: "My niche isn't clear" },
  { id: "burnout", label: "Burnout / motivation" },
];

const SERIOUSNESS_OPTIONS: ReadonlyArray<{
  id: SeriousnessLevel;
  label: string;
  tagline: string;
}> = [
  { id: "hobby", label: "Hobby", tagline: "Fun, no pressure." },
  { id: "side-hustle", label: "Side hustle", tagline: "Real income on the side." },
  {
    id: "transitioning-full-time",
    label: "Transitioning full-time",
    tagline: "Quitting the day job soon.",
  },
  { id: "already-full-time", label: "Already full-time", tagline: "This is my job." },
];

const SIX_TO_TWELVE_OPTIONS: ReadonlyArray<{
  id: SixToTwelveMonthChange;
  label: string;
}> = [
  { id: "hire-team", label: "Hire team / VA / editor" },
  { id: "launch-product", label: "Launch a product" },
  { id: "deprioritize-platform", label: "Deprioritize a platform" },
  { id: "focus-monetization-shift", label: "Shift my monetization focus" },
  { id: "scale-down-deal-volume", label: "Take fewer brand deals" },
  { id: "raise-rates", label: "Raise my rates" },
  { id: "less-content-more-strategy", label: "Less content, more strategy" },
];

const PLATFORM_OPTIONS: ReadonlyArray<{ id: Platform; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
];

const HIRING_READINESS_OPTIONS: ReadonlyArray<{
  id: HiringReadiness;
  label: string;
  tagline: string;
}> = [
  { id: "not-yet", label: "Not yet", tagline: "Solo for now." },
  { id: "considering", label: "Considering", tagline: "Thinking about it." },
  { id: "actively-looking", label: "Actively looking", tagline: "Ready to hire." },
  { id: "already-hired", label: "Already hired", tagline: "Team's in place." },
];

/* -------------------------------------------------------------------------- */
/* Step component                                                             */
/* -------------------------------------------------------------------------- */

export function QuestionsStep({
  state,
  setOnboardingState,
  onAdvance,
}: QuestionsStepProps) {
  const { answers, handles } = state;
  const totalFollowers = useMemo(() => totalFollowerCount(handles), [handles]);
  const kickoffSynth = useAction(kickoffSynthRef);
  /**
   * Wave 3: fire the synthesis job exactly once, the moment the creator
   * answers their last required question. The synth happens in parallel
   * with the user filling out ChannelStep + ComposioStep, so by the time
   * they reach DeployStep the picture is already cached.
   *
   * Guard: useRef prevents the kickoff from firing twice on React StrictMode
   * double-mount or on a mid-flow re-render where allRequiredAnswered flips
   * true → false → true (e.g. user retracts an answer).
   */
  const synthKickoffFiredRef = useRef(false);

  // Pre-seed the inferred career stage on first paint so the careerStage
  // bubble can show "Sound right?" instead of asking cold.
  useEffect(() => {
    if (answers.careerStage === null) {
      setOnboardingState(applyCareerStageInference(state, totalFollowers));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps: one-shot inference seed; reactivity not desired (deps would re-run every keystroke and clobber overrides)
  }, []);

  // Wave 3 — auto-fire the synthesis kickoff when all required Q's land.
  // We watch on `allRequiredAnswered(answers)`; once true we fire kickoff
  // exactly once. The kickoff returns the jobId immediately; the heavy
  // synth work happens in the background while the user picks a channel.
  useEffect(() => {
    if (!allRequiredAnswered(answers)) return;
    if (synthKickoffFiredRef.current) return;
    if (state.synthJobId !== null) {
      // Already kicked off in a prior session / refresh — nothing to do.
      synthKickoffFiredRef.current = true;
      return;
    }
    synthKickoffFiredRef.current = true;
    void (async () => {
      try {
        const result = await kickoffSynth({});
        if (result.ok && result.jobId) {
          setOnboardingState(setSynthJobId(state, result.jobId));
        }
        // Failure is non-fatal — DeployStep will retry inline.
      } catch {
        // Same — Deploy handles the inline-retry path.
      }
    })();
    // We intentionally only depend on whether the predicate flipped true.
    // Re-running on every keystroke would not help (the ref guards it),
    // but adding `setOnboardingState` / `state` would risk thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps: single-fire on predicate flip; ref guards re-entry
  }, [allRequiredAnswered(answers)]);

  const active = currentQuestion(state);
  const platformsList = handles.map((h) => h.platform).join(", ");

  // Helpers that wrap the reducer + push state up.
  const onAnswer = <K extends keyof AnswersState>(field: K, value: AnswersState[K]) => {
    setOnboardingState(answerQuestion(state, field, value));
  };
  const onSkip = (q: QuestionId) => {
    setOnboardingState(markQuestionSkipped(state, q));
  };

  return (
    <StepShell
      eyebrow="§03 · First conversation"
      title="Maya wants to ask you a few things."
      caption="She'll only ask once. After this everything she does is grounded in your accounts plus what you tell her here."
    >
      <div className="space-y-4">
        <Bubble>
          Hey — I just finished reading your{" "}
          <strong className="text-paper">{handles.length}</strong>{" "}
          {handles.length === 1 ? "account" : "accounts"} ({platformsList}). A few
          quick questions before I get to work.
        </Bubble>

        {/* Render every Q in order; skip the unanswered ones past the cursor.
            Wave 2: also skip Q's that don't apply to the active path so
            foundational creators never see senior tail bubbles and vice versa. */}
        {QUESTION_ORDER.map((qid, idx) => {
          const isVisible = idx <= state.currentQuestionIdx;
          const isSkipped = state.skippedQuestions.has(qid);
          if (!isVisible) return null;
          if (!questionAppliesToPath(qid, answers)) return null;
          return (
            <QuestionBlock
              key={qid}
              qid={qid}
              answers={answers}
              totalFollowers={totalFollowers}
              isActive={active === qid}
              isSkipped={isSkipped}
              onAnswer={onAnswer}
              onSkip={onSkip}
            />
          );
        })}
      </div>

      <StepFooter
        canAdvance={allRequiredAnswered(answers)}
        onAdvance={onAdvance}
        advanceLabel="Pick how Maya reaches you"
      />
    </StepShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-question renderer                                                      */
/* -------------------------------------------------------------------------- */

interface QuestionBlockProps {
  qid: QuestionId;
  answers: AnswersState;
  totalFollowers: number;
  isActive: boolean;
  isSkipped: boolean;
  onAnswer: <K extends keyof AnswersState>(field: K, value: AnswersState[K]) => void;
  onSkip: (q: QuestionId) => void;
}

function QuestionBlock({
  qid,
  answers,
  totalFollowers,
  isActive,
  isSkipped,
  onAnswer,
  onSkip,
}: QuestionBlockProps) {
  const answered = isQuestionAnswered(answers, qid);
  // careerStage is special: we ALWAYS render the chip selector (even when
  // pre-seeded by inference) so the creator can confirm or override with a
  // single tap. Without this, an answered/inferred careerStage would render
  // as a static chip with no edit affordance.
  const alwaysInteractive = qid === "careerStage";
  // Render: prompt bubble + (active answer input | answered chip | skipped chip).
  return (
    <div className="space-y-3">
      <Bubble>{PROMPTS[qid]}</Bubble>
      {answered && !isActive && !alwaysInteractive ? (
        <AnsweredChip qid={qid} answers={answers} />
      ) : isSkipped ? (
        <SkippedChip qid={qid} />
      ) : (
        <ActiveInput
          qid={qid}
          answers={answers}
          totalFollowers={totalFollowers}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      )}
    </div>
  );
}

const PROMPTS: Record<QuestionId, string> = {
  goal:
    "What are you actually trying to grow toward this year? One sentence is fine.",
  tone:
    "How do you want me to talk to you when things aren't going great? Soft, focused, or willing to call it like it is?",
  brandDealFloor:
    "What's your floor on a brand deal? Anything below this and I won't pitch you the email — I'll just say no for you. Leave it at 0 if you'd rather see everything first.",
  careerStage:
    "Based on your follower count, here's where I'd place you. Sound right?",
  location:
    "Where are you based? Just a city + state — helps me find local brands worth pitching to.",
  monthlyRevenue:
    "Roughly what are you making per month from creator work? Ranges are fine — I just need a sense.",
  revenueStreams:
    "What's already paying you? Pick everything that applies.",
  longTermGoals:
    "Anything bigger on the horizon — a course you've been thinking about, a brand you want to launch, a million-follower target? One sentence is enough.",
  // ─── Wave 2 — foundational tail ─────────────────────────────────────────
  primaryGoals:
    "Pick everything that matters to you right now. (No wrong answer — I'll calibrate to you.)",
  biggestBlockers:
    "Which of these is in your way? Pick all that apply.",
  ninetyDayPriority:
    "If you could only do ONE thing in the next 90 days, what would it be?",
  howSerious:
    "How serious are you about this?",
  brandTypes:
    "What kinds of brands do you want to work with? Comma-separate a few — or skip if you're not sure yet.",
  weeklyHoursAvailable:
    "Realistically, how many hours per week can you put into this?",
  // ─── Wave 2 — senior tail ───────────────────────────────────────────────
  sixToTwelveMonthChanges:
    "What's changing for you in the next 6–12 months? Pick all that apply.",
  deprioritizingPlatforms:
    "Anything you want to deprioritize? Skip if no.",
  hiringReadiness:
    "Are you ready to bring on help?",
};

/* -------------------------------------------------------------------------- */
/* Active input — branches per question                                       */
/* -------------------------------------------------------------------------- */

function ActiveInput({
  qid,
  answers,
  totalFollowers,
  onAnswer,
  onSkip,
}: {
  qid: QuestionId;
  answers: AnswersState;
  totalFollowers: number;
  onAnswer: <K extends keyof AnswersState>(field: K, value: AnswersState[K]) => void;
  onSkip: (q: QuestionId) => void;
}) {
  switch (qid) {
    case "goal":
      return <GoalInput value={answers.goal} onCommit={(v) => onAnswer("goal", v)} />;
    case "tone":
      return <ToneInput value={answers.tone} onCommit={(v) => onAnswer("tone", v)} />;
    case "brandDealFloor":
      return (
        <BrandDealFloorInput
          value={answers.brandDealFloorUsd}
          onCommit={(v) => onAnswer("brandDealFloorUsd", v)}
        />
      );
    case "careerStage":
      return (
        <CareerStageInput
          inferred={inferCareerStage(totalFollowers)}
          totalFollowers={totalFollowers}
          value={answers.careerStage}
          onCommit={(v) => onAnswer("careerStage", v)}
        />
      );
    case "location":
      return (
        <LocationInput
          value={answers.location}
          onCommit={(v) => onAnswer("location", v)}
        />
      );
    case "monthlyRevenue":
      return (
        <MonthlyRevenueInput
          onCommit={(bucket) => onAnswer("monthlyRevenueBucket", bucket)}
          onSkip={() => onSkip("monthlyRevenue")}
        />
      );
    case "revenueStreams":
      return (
        <RevenueStreamsInput
          value={answers.revenueStreams}
          onCommit={(v) => onAnswer("revenueStreams", v)}
        />
      );
    case "longTermGoals":
      return (
        <LongTermGoalsInput
          value={answers.longTermGoals}
          onCommit={(v) => onAnswer("longTermGoals", v)}
          onSkip={() => onSkip("longTermGoals")}
        />
      );
    // ─── Wave 2 — foundational tail ─────────────────────────────────────
    case "primaryGoals":
      return (
        <MultiSelectInput
          options={PRIMARY_GOAL_OPTIONS}
          value={answers.primaryGoals}
          onCommit={(v) => onAnswer("primaryGoals", v as PrimaryGoal[])}
          onSkip={() => onSkip("primaryGoals")}
          allowSkip
        />
      );
    case "biggestBlockers":
      return (
        <MultiSelectInput
          options={BLOCKER_OPTIONS}
          value={answers.biggestBlockers}
          onCommit={(v) => onAnswer("biggestBlockers", v as Blocker[])}
          onSkip={() => onSkip("biggestBlockers")}
          allowSkip
        />
      );
    case "ninetyDayPriority":
      return (
        <SingleSelectInput
          options={PRIMARY_GOAL_OPTIONS}
          value={answers.ninetyDayPriority}
          onCommit={(v) => onAnswer("ninetyDayPriority", v as PrimaryGoal)}
        />
      );
    case "howSerious":
      return (
        <SeriousnessInput
          value={answers.howSerious}
          onCommit={(v) => onAnswer("howSerious", v)}
        />
      );
    case "brandTypes":
      return (
        <BrandTypesInput
          value={answers.brandTypes}
          onCommit={(v) => onAnswer("brandTypes", v)}
          onSkip={() => onSkip("brandTypes")}
        />
      );
    case "weeklyHoursAvailable":
      return (
        <WeeklyHoursInput
          value={answers.weeklyHoursAvailable}
          onCommit={(v) => onAnswer("weeklyHoursAvailable", v)}
          onSkip={() => onSkip("weeklyHoursAvailable")}
        />
      );
    // ─── Wave 2 — senior tail ───────────────────────────────────────────
    case "sixToTwelveMonthChanges":
      return (
        <MultiSelectInput
          options={SIX_TO_TWELVE_OPTIONS}
          value={answers.sixToTwelveMonthChanges}
          onCommit={(v) =>
            onAnswer("sixToTwelveMonthChanges", v as SixToTwelveMonthChange[])
          }
          onSkip={() => onSkip("sixToTwelveMonthChanges")}
          allowSkip
        />
      );
    case "deprioritizingPlatforms":
      return (
        <MultiSelectInput
          options={PLATFORM_OPTIONS}
          value={answers.deprioritizingPlatforms}
          onCommit={(v) =>
            onAnswer("deprioritizingPlatforms", v as Platform[])
          }
          onSkip={() => onSkip("deprioritizingPlatforms")}
          allowSkip
        />
      );
    case "hiringReadiness":
      return (
        <HiringReadinessInput
          value={answers.hiringReadiness}
          onCommit={(v) => onAnswer("hiringReadiness", v)}
        />
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Per-question input components                                              */
/* -------------------------------------------------------------------------- */

function GoalInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <UserField>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim().length > 0 && onCommit(draft)}
        placeholder="e.g. 100K on IG by year end, then land my first $10K brand deal"
        className="h-24 w-full resize-none bg-transparent text-base text-paper outline-none placeholder:text-paper-faint sm:text-lg"
        aria-label="Your growth goal"
        maxLength={400}
      />
      <CommitButton
        disabled={draft.trim().length === 0}
        onClick={() => onCommit(draft)}
      />
    </UserField>
  );
}

function ToneInput({
  value,
  onCommit,
}: {
  value: Tone | null;
  onCommit: (v: Tone) => void;
}) {
  return (
    <div className="ml-auto grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-3">
      {TONE_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onCommit(opt.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
              active
                ? "border-lime bg-lime text-ink"
                : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
            }`}
          >
            <div className="font-display text-lg leading-tight">{opt.label}</div>
            <div className={`mt-0.5 text-xs ${active ? "text-ink/70" : "text-paper-faint"}`}>
              {opt.tagline}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BrandDealFloorInput({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value && value > 0 ? String(value) : "");
  const commit = () => onCommit(draft === "" ? 0 : parseInt(draft, 10));
  return (
    <UserField>
      <div className="flex w-full items-center gap-2">
        <span className="font-mono text-lg text-paper-faint">$</span>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commit}
          placeholder="0"
          className="h-12 w-full bg-transparent text-base text-paper outline-none placeholder:text-paper-faint sm:text-lg"
          aria-label="Brand deal floor in USD"
          maxLength={7}
        />
        <span className="text-sm text-paper-faint">/ deal</span>
      </div>
      <CommitButton disabled={false} onClick={commit} />
    </UserField>
  );
}

function CareerStageInput({
  inferred,
  totalFollowers,
  value,
  onCommit,
}: {
  inferred: CareerStage;
  totalFollowers: number;
  value: CareerStage | null;
  onCommit: (v: CareerStage) => void;
}) {
  const stages: CareerStage[] = ["just-starting", "building", "monetizing", "scaling"];
  return (
    <div className="ml-auto w-full max-w-md space-y-2">
      <p className="text-xs text-paper-faint">
        Reading {formatFollowers(totalFollowers)} followers across your accounts —
        looks like <strong className="text-paper">{CAREER_STAGE_LABEL[inferred]}</strong>{" "}
        to me.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((stage) => {
          const active = (value ?? inferred) === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() => onCommit(stage)}
              className={`rounded-2xl border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-lime bg-lime text-ink"
                  : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
              }`}
            >
              <div className="text-sm font-medium">{CAREER_STAGE_LABEL[stage]}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LocationInput({
  value,
  onCommit,
}: {
  value: LocationAnswer | null;
  onCommit: (v: LocationAnswer) => void;
}) {
  const [city, setCity] = useState(value?.city ?? "");
  const [stateCode, setStateCode] = useState(value?.state ?? "");
  const [country, setCountry] = useState(value?.country ?? "US");
  const valid = city.trim().length > 0 && stateCode.trim().length > 0;
  return (
    <UserField>
      <div className="flex w-full flex-col gap-2">
        <div className="flex w-full gap-2">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            className="h-12 flex-1 bg-transparent text-base text-paper outline-none placeholder:text-paper-faint"
            aria-label="City"
            maxLength={80}
          />
          <input
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
            placeholder="State"
            className="h-12 w-24 bg-transparent text-base text-paper outline-none placeholder:text-paper-faint"
            aria-label="State"
            maxLength={40}
          />
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="US"
            className="h-12 w-20 bg-transparent text-base text-paper outline-none placeholder:text-paper-faint"
            aria-label="Country"
            maxLength={4}
          />
        </div>
        <CommitButton
          disabled={!valid}
          onClick={() => onCommit({ city: city.trim(), state: stateCode.trim(), country: country.trim() || "US" })}
        />
      </div>
    </UserField>
  );
}

function MonthlyRevenueInput({
  onCommit,
  onSkip,
}: {
  onCommit: (b: RevenueBucket) => void;
  onSkip: () => void;
}) {
  return (
    <div className="ml-auto w-full max-w-md space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {REVENUE_BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onCommit(b.id)}
            className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-3 py-2 text-sm text-paper-dim transition-colors hover:border-lime hover:text-paper"
          >
            {b.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="text-xs text-paper-faint underline-offset-2 hover:underline"
      >
        Skip for now
      </button>
    </div>
  );
}

function RevenueStreamsInput({
  value,
  onCommit,
}: {
  value: ReadonlyArray<RevenueStream>;
  onCommit: (v: RevenueStream[]) => void;
}) {
  const [picked, setPicked] = useState<Set<RevenueStream>>(new Set(value));
  const toggle = (id: RevenueStream) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  return (
    <div className="ml-auto w-full max-w-md space-y-2">
      <div className="flex flex-wrap gap-2">
        {REVENUE_STREAMS.map((s) => {
          const active = picked.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-lime bg-lime text-ink"
                  : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <CommitButton
        disabled={picked.size === 0}
        onClick={() => onCommit(Array.from(picked))}
      />
    </div>
  );
}

function LongTermGoalsInput({
  value,
  onCommit,
  onSkip,
}: {
  value: LongTermGoalsAnswer | null;
  onCommit: (v: LongTermGoalsAnswer) => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState(value?.oneYear ?? "");
  return (
    <UserField>
      <div className="flex w-full flex-col gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. ship a course in Q3, or hit 1M followers in 2 years"
          className="h-12 w-full bg-transparent text-base text-paper outline-none placeholder:text-paper-faint"
          aria-label="Your long-term goal"
          maxLength={300}
        />
        <div className="flex items-center gap-3">
          <CommitButton
            disabled={draft.trim().length === 0}
            onClick={() => onCommit({ oneYear: draft.trim() })}
          />
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-paper-faint underline-offset-2 hover:underline"
          >
            Skip for now
          </button>
        </div>
      </div>
    </UserField>
  );
}

/* -------------------------------------------------------------------------- */
/* Wave 2 — generic multi/single select inputs + per-Q wrappers               */
/* -------------------------------------------------------------------------- */

interface OptionSpec<V extends string> {
  readonly id: V;
  readonly label: string;
}

function MultiSelectInput<V extends string>({
  options,
  value,
  onCommit,
  onSkip,
  allowSkip,
}: {
  options: ReadonlyArray<OptionSpec<V>>;
  value: ReadonlyArray<V>;
  onCommit: (v: V[]) => void;
  onSkip?: () => void;
  allowSkip?: boolean;
}) {
  const [picked, setPicked] = useState<Set<V>>(new Set(value));
  const toggle = (id: V) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  return (
    <div className="ml-auto w-full max-w-md space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = picked.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-lime bg-lime text-ink"
                  : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <CommitButton
          disabled={picked.size === 0}
          onClick={() => onCommit(Array.from(picked))}
        />
        {allowSkip && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-paper-faint underline-offset-2 hover:underline"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function SingleSelectInput<V extends string>({
  options,
  value,
  onCommit,
}: {
  options: ReadonlyArray<OptionSpec<V>>;
  value: V | null;
  onCommit: (v: V) => void;
}) {
  return (
    <div className="ml-auto grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onCommit(opt.id)}
            className={`rounded-2xl border px-3 py-2 text-left transition-colors ${
              active
                ? "border-lime bg-lime text-ink"
                : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
            }`}
          >
            <div className="text-sm font-medium">{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}

function SeriousnessInput({
  value,
  onCommit,
}: {
  value: SeriousnessLevel | null;
  onCommit: (v: SeriousnessLevel) => void;
}) {
  return (
    <div className="ml-auto grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
      {SERIOUSNESS_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onCommit(opt.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
              active
                ? "border-lime bg-lime text-ink"
                : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
            }`}
          >
            <div className="font-display text-base leading-tight">{opt.label}</div>
            <div className={`mt-0.5 text-xs ${active ? "text-ink/70" : "text-paper-faint"}`}>
              {opt.tagline}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function HiringReadinessInput({
  value,
  onCommit,
}: {
  value: HiringReadiness | null;
  onCommit: (v: HiringReadiness) => void;
}) {
  return (
    <div className="ml-auto grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
      {HIRING_READINESS_OPTIONS.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onCommit(opt.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
              active
                ? "border-lime bg-lime text-ink"
                : "border-[var(--hairline-strong)] bg-ink-2 text-paper-dim hover:text-paper"
            }`}
          >
            <div className="font-display text-base leading-tight">{opt.label}</div>
            <div className={`mt-0.5 text-xs ${active ? "text-ink/70" : "text-paper-faint"}`}>
              {opt.tagline}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function BrandTypesInput({
  value,
  onCommit,
  onSkip,
}: {
  value: ReadonlyArray<string>;
  onCommit: (v: string[]) => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  const commit = () => {
    const list = draft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length === 0) return;
    onCommit(list);
  };
  return (
    <UserField>
      <div className="flex w-full flex-col gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. fitness apparel, supplements, local cafes"
          className="h-12 w-full bg-transparent text-base text-paper outline-none placeholder:text-paper-faint"
          aria-label="Brand types"
          maxLength={300}
        />
        <div className="flex items-center gap-3">
          <CommitButton
            disabled={draft.trim().length === 0}
            onClick={commit}
          />
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-paper-faint underline-offset-2 hover:underline"
          >
            Skip for now
          </button>
        </div>
      </div>
    </UserField>
  );
}

function WeeklyHoursInput({
  value,
  onCommit,
  onSkip,
}: {
  value: number | null;
  onCommit: (v: number) => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState(
    value !== null && value > 0 ? String(value) : ""
  );
  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 0 || n > 168) return;
    onCommit(n);
  };
  return (
    <UserField>
      <div className="flex w-full items-center gap-2">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="10"
          className="h-12 w-20 bg-transparent text-base text-paper outline-none placeholder:text-paper-faint sm:text-lg"
          aria-label="Weekly hours available"
          maxLength={3}
        />
        <span className="text-sm text-paper-faint">hours / week</span>
        <CommitButton disabled={draft.trim().length === 0} onClick={commit} />
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-paper-faint underline-offset-2 hover:underline"
        >
          Skip
        </button>
      </div>
    </UserField>
  );
}

/* -------------------------------------------------------------------------- */
/* Answered + skipped chips                                                   */
/* -------------------------------------------------------------------------- */

function AnsweredChip({ qid, answers }: { qid: QuestionId; answers: AnswersState }) {
  const summary = summarizeAnswer(qid, answers);
  return (
    <div className="flex justify-end">
      <div className="rounded-[20px] rounded-br-[6px] border border-lime/40 bg-ink-3 px-4 py-2.5 text-sm text-paper">
        {summary}
      </div>
    </div>
  );
}

function SkippedChip({ qid }: { qid: QuestionId }) {
  if (!OPTIONAL_QUESTIONS.has(qid)) return null;
  return (
    <div className="flex justify-end">
      <div className="rounded-[20px] rounded-br-[6px] border border-[var(--hairline)] bg-ink-3 px-4 py-2.5 text-xs italic text-paper-faint">
        Skipped for now
      </div>
    </div>
  );
}

function summarizeAnswer(qid: QuestionId, answers: AnswersState): string {
  switch (qid) {
    case "goal":
      return answers.goal;
    case "tone":
      return answers.tone
        ? TONE_OPTIONS.find((t) => t.id === answers.tone)?.label ?? answers.tone
        : "—";
    case "brandDealFloor":
      if (answers.brandDealFloorUsd === null) return "—";
      return answers.brandDealFloorUsd > 0
        ? `$${answers.brandDealFloorUsd.toLocaleString()} / deal`
        : "No minimum";
    case "careerStage":
      return answers.careerStage ? CAREER_STAGE_LABEL[answers.careerStage] : "—";
    case "location": {
      const loc = answers.location;
      if (!loc) return "—";
      return [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
    }
    case "monthlyRevenue":
      return answers.monthlyRevenueBucket
        ? REVENUE_BUCKETS.find((b) => b.id === answers.monthlyRevenueBucket)?.label ?? "—"
        : "—";
    case "revenueStreams":
      return answers.revenueStreams
        .map((s) => REVENUE_STREAMS.find((r) => r.id === s)?.label ?? s)
        .join(", ");
    case "longTermGoals":
      return answers.longTermGoals?.oneYear ?? "—";
    // ─── Wave 2 ─────────────────────────────────────────────────────────
    case "primaryGoals":
      return answers.primaryGoals
        .map(
          (g) =>
            PRIMARY_GOAL_OPTIONS.find((o) => o.id === g)?.label ?? g
        )
        .join(", ");
    case "biggestBlockers":
      return answers.biggestBlockers
        .map((b) => BLOCKER_OPTIONS.find((o) => o.id === b)?.label ?? b)
        .join(", ");
    case "ninetyDayPriority":
      return answers.ninetyDayPriority
        ? PRIMARY_GOAL_OPTIONS.find((o) => o.id === answers.ninetyDayPriority)
            ?.label ?? answers.ninetyDayPriority
        : "—";
    case "howSerious":
      return answers.howSerious
        ? SERIOUSNESS_OPTIONS.find((o) => o.id === answers.howSerious)?.label ??
            answers.howSerious
        : "—";
    case "brandTypes":
      return answers.brandTypes.length > 0
        ? answers.brandTypes.join(", ")
        : "—";
    case "weeklyHoursAvailable":
      return answers.weeklyHoursAvailable !== null
        ? `${answers.weeklyHoursAvailable} hrs/week`
        : "—";
    case "sixToTwelveMonthChanges":
      return answers.sixToTwelveMonthChanges
        .map(
          (c) => SIX_TO_TWELVE_OPTIONS.find((o) => o.id === c)?.label ?? c
        )
        .join(", ");
    case "deprioritizingPlatforms":
      return answers.deprioritizingPlatforms
        .map((p) => PLATFORM_OPTIONS.find((o) => o.id === p)?.label ?? p)
        .join(", ");
    case "hiringReadiness":
      return answers.hiringReadiness
        ? HIRING_READINESS_OPTIONS.find(
            (o) => o.id === answers.hiringReadiness
          )?.label ?? answers.hiringReadiness
        : "—";
  }
}

/* -------------------------------------------------------------------------- */
/* Bubble + utility primitives                                                */
/* -------------------------------------------------------------------------- */

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-[88%] items-start gap-3">
      <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lime text-ink">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="rounded-[20px] rounded-bl-[6px] border border-[var(--hairline)] bg-ink-2 px-4 py-3 text-base leading-snug text-paper">
        {children}
      </div>
    </div>
  );
}

function UserField({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="w-full max-w-md rounded-[20px] rounded-br-[6px] border border-lime/40 bg-ink-3 px-4 py-3">
        {children}
      </div>
    </div>
  );
}

function CommitButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2 self-end rounded-full border border-lime bg-lime px-4 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
    >
      Send
    </button>
  );
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
