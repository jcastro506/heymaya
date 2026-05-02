export type CreatorStage =
  | "just_starting"
  | "growing_consistently"
  | "monetizing"
  | "trying_full_time"
  | "already_full_time";

export type CreatorMayaTone = "supportive" | "strategic" | "tough_love";

export interface CreatorMayaIntakeAnswers {
  ninetyDayGoal: string;
  creatorStage: CreatorStage;
  biggestBlocker: string;
  weeklyHoursAvailable: number;
  tone: CreatorMayaTone;
  doNotSuggest: ReadonlyArray<string>;
}

export interface InferredCreatorSignals {
  inferredNiche: string;
  strongestPattern: string;
  weakestPattern: string;
  calendarReality: string;
  audienceHypothesis: string;
}

export interface CreatorReadback {
  stage: CreatorStage;
  goal: string;
  niche: string;
  audience: string;
  currentReality: string;
  planBias: string;
  blocker: string;
  weeklyHoursAvailable: number;
  tone: CreatorMayaTone;
  doNotSuggest: ReadonlyArray<string>;
}

export interface CreatorReadbackCorrections {
  stage?: CreatorStage;
  goal?: string;
  niche?: string;
  audience?: string;
  currentReality?: string;
  planBias?: string;
  blocker?: string;
  weeklyHoursAvailable?: number;
  tone?: CreatorMayaTone;
  doNotSuggest?: ReadonlyArray<string>;
}

export function requiredCreatorMayaIntakeQuestions(): ReadonlyArray<string> {
  return [
    "What are you trying to accomplish in the next 90 days?",
    "Where are you right now as a creator?",
    "What is your biggest blocker?",
    "How many hours can you realistically spend on content each week?",
    "What should Maya never suggest?",
    "What tone do you want from Maya?",
  ];
}

export function buildCreatorReadback(
  inferred: InferredCreatorSignals,
  answers: CreatorMayaIntakeAnswers
): CreatorReadback {
  return {
    stage: answers.creatorStage,
    goal: answers.ninetyDayGoal,
    niche: inferred.inferredNiche,
    audience: inferred.audienceHypothesis,
    currentReality: inferred.calendarReality,
    planBias: `Bias toward ${inferred.strongestPattern}; avoid ${inferred.weakestPattern}.`,
    blocker: answers.biggestBlocker,
    weeklyHoursAvailable: Math.max(0, answers.weeklyHoursAvailable),
    tone: answers.tone,
    doNotSuggest: [...answers.doNotSuggest],
  };
}

export function applyCreatorReadbackCorrections(
  readback: CreatorReadback,
  corrections: CreatorReadbackCorrections
): CreatorReadback {
  return {
    ...readback,
    ...withoutUndefined(corrections),
    doNotSuggest: corrections.doNotSuggest
      ? [...corrections.doNotSuggest]
      : readback.doNotSuggest,
  };
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}
