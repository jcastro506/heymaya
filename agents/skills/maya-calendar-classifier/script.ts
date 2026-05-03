/**
 * maya-calendar-classifier — heuristic + LLM-prompt builder.
 *
 * Sprint 3.5. Privacy-protective by construction. The LLM call itself happens
 * in the calling Convex action (which routes through the Maya model router
 * with `taskTag: 'morning_brief'` at medium thinking — closest matching tag
 * in v0; consider adding a dedicated `calendar_classify` tag in S4).
 *
 * This file owns:
 *   1. Heuristic first-pass (cheap, deterministic, catches the obvious 80%)
 *   2. LLM prompt assembly for the ambiguous 20%
 *   3. Privacy-violation enforcement at the input boundary
 */

export type Classification =
  | "creator-relevant-life-event"
  | "creator-shoot"
  | "work-meeting"
  | "recurring-noise"
  | "personal-private";

export type ContentArcShape =
  | "build-up-day-of-recap"
  | "day-of-only"
  | "recap-only"
  | "none";

export interface CalendarEvent {
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly attendees: number;
  readonly description: string;
  readonly isPrivate: boolean;
}

export interface ClassifierInput {
  readonly event: CalendarEvent;
}

export interface ClassifierResult {
  readonly classification: Classification;
  readonly contentArcShape?: ContentArcShape;
  readonly confidence: number;
  readonly reasoningRedacted: string;
}

export class PrivacyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyViolationError";
  }
}

const RECURRING_NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /\bstandup\b/i,
  /\b1:1\b/,
  /\b1-on-1\b/i,
  /\bone[-\s]on[-\s]one\b/i,
  /\bdentist\b/i,
  /\bdoctor\b/i,
  /\b(?:weekly|daily) sync\b/i,
  /\bgym\b/i,
  /\blunch with\b/i,
  /\bcoffee with\b/i,
  /\bteam meeting\b/i,
  /\bsync\b/i,
];

const CREATOR_SHOOT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bshoot\b/i,
  /\bfilming\b/i,
  /\brecording\b/i,
  /\bcontent day\b/i,
  /\bphotoshoot\b/i,
  /\bb[-\s]?roll\b/i,
];

const WORK_MEETING_PATTERNS: ReadonlyArray<RegExp> = [
  /\bcall\b/i,
  /\binterview\b/i,
  /\bpitch\b/i,
  /\bbusiness review\b/i,
  /\bquarterly\b/i,
];

const LIFE_EVENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bwedding\b/i,
  /\banniversary\b/i,
  /\bbirthday\b/i,
  /\bgraduation\b/i,
  /\btrip\b/i,
  /\bvacation\b/i,
  /\blaunch\b/i,
  /\bconcert\b/i,
  /\bfestival\b/i,
  /\bconference\b/i,
  /\btalk\b/i,
  /\bkeynote\b/i,
];

function enforcePrivacyContract(event: CalendarEvent): void {
  if (event.isPrivate) {
    if (event.description.trim().length > 0) {
      throw new PrivacyViolationError(
        "Private event must have a blanked description before this skill is invoked. Caller MUST redact."
      );
    }
    if (event.attendees !== 0) {
      throw new PrivacyViolationError(
        "Private event must have attendees count set to 0 before this skill is invoked. Caller MUST redact."
      );
    }
  }
}

function arcForLifeEvent(event: CalendarEvent, now: number): ContentArcShape {
  const daysUntil = Math.floor((event.start - now) / (24 * 60 * 60 * 1000));
  if (daysUntil >= 5) return "build-up-day-of-recap";
  if (daysUntil >= 1) return "day-of-only";
  if (daysUntil >= -1) return "recap-only";
  return "none";
}

export function classifyByHeuristic(
  event: CalendarEvent,
  now: number = Date.now()
): ClassifierResult | { kind: "unknown" } {
  enforcePrivacyContract(event);

  const t = event.title;

  // Private + blank description + ≤3-word title = personal-private fast path.
  if (event.isPrivate && t.trim().split(/\s+/).length <= 3) {
    return {
      classification: "personal-private",
      contentArcShape: "none",
      confidence: 0.95,
      reasoningRedacted:
        "Private event with short generic title — defaults to personal-private. Maya will not propose content around this.",
    };
  }

  const matchedShoot = CREATOR_SHOOT_PATTERNS.some((r) => r.test(t));
  const matchedNoise = RECURRING_NOISE_PATTERNS.some((r) => r.test(t));
  const matchedWork = WORK_MEETING_PATTERNS.some((r) => r.test(t));
  const matchedLife = LIFE_EVENT_PATTERNS.some((r) => r.test(t));

  // Conflicting signals → defer to LLM
  const matches = [matchedShoot, matchedNoise, matchedWork, matchedLife].filter(
    Boolean
  );
  if (matches.length > 1) {
    return { kind: "unknown" };
  }

  if (matchedNoise) {
    return {
      classification: "recurring-noise",
      contentArcShape: "none",
      confidence: 0.9,
      reasoningRedacted: `Title matches a recurring-noise pattern. No content arc proposed.`,
    };
  }
  if (matchedShoot) {
    return {
      classification: "creator-shoot",
      contentArcShape: "day-of-only",
      confidence: 0.85,
      reasoningRedacted: `Title matches a creator-shoot pattern. Content arc: day-of capture plan.`,
    };
  }
  if (matchedWork) {
    return {
      classification: "work-meeting",
      contentArcShape: "none",
      confidence: 0.8,
      reasoningRedacted: `Title matches a work-meeting pattern. No content arc proposed.`,
    };
  }
  if (matchedLife) {
    return {
      classification: "creator-relevant-life-event",
      contentArcShape: arcForLifeEvent(event, now),
      confidence: 0.85,
      reasoningRedacted: `Title matches a life-event pattern. Suggested arc derived from days-until-event.`,
    };
  }

  return { kind: "unknown" };
}

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export function buildClassifierPrompt(
  event: CalendarEvent
): ReadonlyArray<ChatMessage> {
  enforcePrivacyContract(event);

  const system =
    "You classify creator calendar events for Maya, an AI creator manager. " +
    "Pick exactly one of: creator-relevant-life-event, creator-shoot, work-meeting, recurring-noise, personal-private. " +
    "DO NOT reason about attendee identities (you don't have them). " +
    "DO NOT speculate about content beyond what the title and description say. " +
    "If the event is ambiguous, prefer 'personal-private' as the privacy-safe default. " +
    "Output JSON: { classification, contentArcShape, confidence (0-1), reasoningRedacted }.";
  const user =
    `Event title: ${event.title}\n` +
    `Start: ${new Date(event.start).toISOString()}\n` +
    `Duration min: ${Math.round((event.end - event.start) / 60000)}\n` +
    `Attendees count: ${event.attendees}\n` +
    `Description (may be blank if private): ${event.description}\n` +
    `Is private: ${event.isPrivate}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export type ClassifierDispatch =
  | { readonly kind: "heuristic"; readonly result: ClassifierResult }
  | { readonly kind: "needs-llm"; readonly prompt: ReadonlyArray<ChatMessage> };

export function dispatch(input: ClassifierInput, now: number = Date.now()): ClassifierDispatch {
  const heuristic = classifyByHeuristic(input.event, now);
  if ("kind" in heuristic && heuristic.kind === "unknown") {
    return { kind: "needs-llm", prompt: buildClassifierPrompt(input.event) };
  }
  return { kind: "heuristic", result: heuristic as ClassifierResult };
}
