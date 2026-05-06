/**
 * maya-calendar-read — pure-logic glue around the Google Calendar v3 read
 * helpers in `convex/creatorMayaV0/backend.ts`.
 *
 * Sprint 7 Slice B. The orchestrating action owns the HTTP call + token
 * refresh. This file owns:
 *
 *   1. Building the request shape (`buildEventsQuery`)
 *   2. Defensive parsing of the response (`parseGoogleEvents`)
 *   3. Heuristic content-signal extraction (`extractContentSignals`)
 *   4. Cross-tick dedupe (`dedupeAcrossPulls`)
 *
 * Determinism is a feature: every test in `__tests__/` runs without any
 * network or Convex interaction.
 */

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface NormalizedEvent {
  readonly id: string;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly location?: string;
  readonly description?: string;
  /** COUNT only — caller MUST strip identities before invoking this skill. */
  readonly attendees?: number;
}

export interface GoogleCalendarQuery {
  readonly calendarId: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly q?: string;
  readonly singleEvents: true;
  readonly orderBy: "startTime";
  readonly maxResults: number;
}

export interface ContentSignals {
  readonly lifeEvents: ReadonlyArray<NormalizedEvent>;
  readonly potentialFilmingDays: ReadonlyArray<NormalizedEvent>;
}

/* -------------------------------------------------------------------------- */
/* buildEventsQuery                                                            */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_RESULTS = 100;

/**
 * Composes the request shape that `fetchGoogleCalendarEvents` (in
 * `convex/creatorMayaV0/backend.ts`) expects. Validates inputs at the
 * boundary so the orchestrator catches bad windows before issuing a
 * network call.
 */
export function buildEventsQuery(args: {
  calendarId: string;
  sinceMs: number;
  untilMs: number;
  q?: string;
}): GoogleCalendarQuery {
  if (!args.calendarId || args.calendarId.trim().length === 0) {
    throw new Error("calendarId must be a non-empty string.");
  }
  if (!Number.isFinite(args.sinceMs) || !Number.isFinite(args.untilMs)) {
    throw new Error("sinceMs and untilMs must be finite numbers.");
  }
  if (args.untilMs <= args.sinceMs) {
    throw new Error("untilMs must be strictly greater than sinceMs.");
  }
  if (args.q !== undefined && typeof args.q !== "string") {
    throw new Error("q must be a string when provided.");
  }
  return {
    calendarId: args.calendarId,
    timeMin: new Date(args.sinceMs).toISOString(),
    timeMax: new Date(args.untilMs).toISOString(),
    q: args.q && args.q.length > 0 ? args.q : undefined,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: DEFAULT_MAX_RESULTS,
  };
}

/* -------------------------------------------------------------------------- */
/* parseGoogleEvents                                                           */
/* -------------------------------------------------------------------------- */

const eventTimeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});

const googleEventSchema = z.object({
  id: z.string().min(1),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  attendees: z
    .array(z.object({ email: z.string().optional() }).passthrough())
    .optional(),
});

const responseSchema = z.object({
  items: z.array(z.unknown()).optional(),
});

/**
 * Defensive parse. Drops malformed entries silently — Maya prefers a
 * partial calendar over a blank one. Never throws on per-row failures.
 */
export function parseGoogleEvents(raw: unknown): NormalizedEvent[] {
  const parsedShell = responseSchema.safeParse(raw);
  if (!parsedShell.success) return [];
  const items = parsedShell.data.items ?? [];

  const out: NormalizedEvent[] = [];
  for (const item of items) {
    const parsed = googleEventSchema.safeParse(item);
    if (!parsed.success) continue;
    const normalized = normalizeEvent(parsed.data);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeEvent(
  event: z.infer<typeof googleEventSchema>
): NormalizedEvent | null {
  const startMs = calendarTimeToMs(event.start, "start");
  const endMs = calendarTimeToMs(event.end, "end");
  if (startMs === null || endMs === null) return null;
  // Filter out negative-duration events (data corruption defense).
  if (endMs < startMs) return null;

  const out: {
    -readonly [K in keyof NormalizedEvent]: NormalizedEvent[K];
  } = {
    id: event.id,
    title: event.summary && event.summary.length > 0 ? event.summary : "Untitled event",
    startMs,
    endMs,
  };
  if (event.location && event.location.length > 0) out.location = event.location;
  if (event.description && event.description.length > 0) {
    out.description = event.description;
  }
  if (event.attendees && Array.isArray(event.attendees)) {
    out.attendees = event.attendees.length;
  }
  return out;
}

/**
 * Coerces Google's polymorphic time field into a unix-ms instant.
 *
 *   - `dateTime` → `Date.parse` directly
 *   - `date` (all-day events) → midnight UTC for `start`, end-of-day for `end`
 *
 * This loses calendar-local-time fidelity for all-day events, which is
 * acceptable for the lookahead surface. The classifier downstream uses
 * `daysUntil` math, not timezone-anchored windows.
 */
function calendarTimeToMs(
  time: { dateTime?: string; date?: string } | undefined,
  position: "start" | "end"
): number | null {
  if (!time) return null;
  if (time.dateTime) {
    const ms = Date.parse(time.dateTime);
    return Number.isFinite(ms) ? ms : null;
  }
  if (time.date) {
    // YYYY-MM-DD → 00:00 UTC for start, 23:59:59.999 UTC for end.
    const ms = Date.parse(`${time.date}T00:00:00.000Z`);
    if (!Number.isFinite(ms)) return null;
    if (position === "end") return ms + 24 * 60 * 60 * 1000 - 1;
    return ms;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* extractContentSignals                                                       */
/* -------------------------------------------------------------------------- */

const LIFE_EVENT_KEYWORDS: ReadonlyArray<RegExp> = [
  /\bwedding\b/i,
  /\btrip\b/i,
  /\bvacation\b/i,
  /\blaunch\b/i,
  /\banniversary\b/i,
  /\bbirthday\b/i,
  /\bgraduation\b/i,
  /\bconference\b/i,
  /\bkeynote\b/i,
  /\bmove[\s-]?in\b/i,
];

const FILMING_KEYWORDS: ReadonlyArray<RegExp> = [
  /\bshoot day\b/i,
  /\bshoot\b/i,
  /\bfilming\b/i,
  /\bfilm day\b/i,
  /\brecording\b/i,
  /\bcontent day\b/i,
  /\bb[-\s]?roll\b/i,
  /\bphotoshoot\b/i,
];

/**
 * Heuristic-only candidate selection. The classifier downstream
 * (`maya-calendar-classifier`) makes the actual decision — this is just
 * the fast nomination layer. Keep additions here behavior-conservative:
 * a false positive at this layer is corrected by the classifier; a false
 * negative means the event is invisible to the planner.
 */
export function extractContentSignals(
  events: ReadonlyArray<NormalizedEvent>
): ContentSignals {
  const lifeEvents: NormalizedEvent[] = [];
  const potentialFilmingDays: NormalizedEvent[] = [];

  for (const event of events) {
    const haystack = [event.title, event.description ?? ""].join(" ");
    if (LIFE_EVENT_KEYWORDS.some((r) => r.test(haystack))) {
      lifeEvents.push(event);
    }
    if (FILMING_KEYWORDS.some((r) => r.test(haystack))) {
      potentialFilmingDays.push(event);
    }
  }

  return { lifeEvents, potentialFilmingDays };
}

/* -------------------------------------------------------------------------- */
/* dedupeAcrossPulls                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Set-difference dedupe. Keeps consecutive heartbeat ticks from
 * re-surfacing the same row to the content arc planner. The caller is
 * responsible for persisting the new id set after a tick fires.
 */
export function dedupeAcrossPulls(
  events: ReadonlyArray<NormalizedEvent>,
  previousIds: Set<string>
): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const event of events) {
    if (!previousIds.has(event.id)) out.push(event);
  }
  return out;
}
