/**
 * maya-calendar-write — pure-logic NL parser + guard validation for
 * creating Google Calendar events.
 *
 * Sprint 7 Slice B. The orchestrator owns the actual `events.insert` HTTP
 * call (via `createGoogleCalendarEvent` in
 * `convex/creatorMayaV0/backend.ts`). This file owns:
 *
 *   1. `parseEventIntent`         — natural-language → ProposedEvent
 *   2. `buildEventCreatePayload`  — ProposedEvent → Google API request shape
 *   3. `validateEventBeforeWrite` — guard checks (past-time, duration cap, banned topic)
 *
 * Determinism is a feature: tests run without any clock dependency
 * (callers pass `nowMs` + `tz`).
 */

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface ProposedEvent {
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly description?: string;
  readonly location?: string;
  /** IANA timezone — used to set Google's `timeZone` field. */
  readonly timeZone: string;
}

export interface GoogleCalendarEventCreate {
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly start: { dateTime: string; timeZone?: string };
  readonly end: { dateTime: string; timeZone?: string };
}

export interface CreatorPicture {
  readonly boundaries?: {
    readonly banned_topics?: ReadonlyArray<string>;
  };
  /**
   * Sprint 7 Slice B accepts both shapes — the actual Convex schema uses
   * `doNotSuggest` on `creatorMayaV0CreatorPictures`, but the spec calls
   * it `boundaries.banned_topics`. We honor either.
   */
  readonly doNotSuggest?: ReadonlyArray<string>;
}

export type ParseResult =
  | { readonly ok: true; readonly event: ProposedEvent }
  | { readonly ok: false; readonly ambiguous: true; readonly reason: string }
  | { readonly ok: false; readonly ambiguous?: false; readonly reason: string };

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: ReadonlyArray<string> };

/* -------------------------------------------------------------------------- */
/* parseEventIntent                                                            */
/* -------------------------------------------------------------------------- */

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
type DayName = (typeof DAY_NAMES)[number];

const DAY_TO_INDEX: Record<DayName, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

interface ParsedTime {
  readonly hour: number; // 0..23
  readonly minute: number; // 0..59
}

interface ParsedTimeRange {
  readonly start: ParsedTime;
  /** Optional — if absent, caller defaults to 1h after start. */
  readonly end?: ParsedTime;
}

/**
 * Parses "block 3pm Tuesday for filming" / "schedule batch recording
 * 9-11am Wednesday" / "put a hold on Saturday morning for the wedding
 * shoot" into a ProposedEvent.
 *
 * Heuristic-only — favors clear refusal over creative inference. If the
 * phrasing is ambiguous in a way Maya should confirm with the creator
 * (e.g., "next Tuesday" mid-week), returns `ambiguous: true` and the
 * orchestrator surfaces a confirm question.
 */
export function parseEventIntent(
  text: string,
  nowMs: number,
  tz: string
): ParseResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "empty-intent" };
  }
  if (!Number.isFinite(nowMs)) {
    return { ok: false, reason: "invalid-now" };
  }
  if (typeof tz !== "string" || tz.length === 0) {
    return { ok: false, reason: "invalid-timezone" };
  }

  const lowered = text.toLowerCase().trim();

  // --- 1) Find a day-of-week token ----------------------------------------
  const dayMatch = findDayOfWeek(lowered);
  if (!dayMatch) {
    return { ok: false, reason: "no-day-of-week-found" };
  }

  // "next Tuesday" mid-week is ambiguous — defer to caller.
  if (dayMatch.qualifier === "next-ambiguous") {
    return {
      ok: false,
      ambiguous: true,
      reason: "next-vs-this-week-ambiguous",
    };
  }

  // --- 2) Find a time range -----------------------------------------------
  const timeRange = findTimeRange(lowered);
  if (!timeRange) {
    return { ok: false, reason: "no-time-found" };
  }

  // --- 3) Resolve to absolute startMs / endMs in the creator's timezone ---
  const dayDate = resolveDayOfWeek(nowMs, tz, dayMatch.day, dayMatch.qualifier);
  const startMs = combineDateAndTime(dayDate, timeRange.start, tz);
  const endTime: ParsedTime = timeRange.end ?? {
    hour: timeRange.start.hour + 1,
    minute: timeRange.start.minute,
  };
  const endMs = combineDateAndTime(dayDate, endTime, tz);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { ok: false, reason: "time-resolution-failed" };
  }

  // --- 4) Extract the title ("for X" / "to X") ----------------------------
  const title = extractTitle(text);
  if (!title) {
    return { ok: false, reason: "no-title-found" };
  }

  return {
    ok: true,
    event: {
      title,
      startMs,
      endMs,
      timeZone: tz,
    },
  };
}

interface DayMatch {
  readonly day: DayName;
  readonly qualifier: "this" | "next" | "next-ambiguous";
}

function findDayOfWeek(lowered: string): DayMatch | null {
  for (const day of DAY_NAMES) {
    const idx = lowered.indexOf(day);
    if (idx === -1) continue;

    // Look back ~10 chars for "this" / "next".
    const window = lowered.slice(Math.max(0, idx - 10), idx);
    if (/\bnext\b\s*$/.test(window)) {
      // "next Tuesday" — ambiguous IF today is Sunday/Monday/Tuesday
      // (could mean this week or following). We'd need today's day to
      // disambiguate confidently; defer to ambiguous flag — caller asks.
      return { day, qualifier: "next-ambiguous" };
    }
    if (/\bthis\b\s*$/.test(window)) {
      return { day, qualifier: "this" };
    }
    return { day, qualifier: "this" }; // bare "Tuesday" = this/next, default to this
  }
  return null;
}

const TIME_RANGE_PATTERN =
  /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

const SINGLE_TIME_PATTERN = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;

const NAMED_TIME_OF_DAY: Record<string, ParsedTime> = {
  morning: { hour: 9, minute: 0 },
  afternoon: { hour: 14, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 20, minute: 0 },
};

function findTimeRange(lowered: string): ParsedTimeRange | null {
  // Range first: "9-11am", "9am-11am", "3pm to 5pm"
  const rangeMatch = TIME_RANGE_PATTERN.exec(lowered);
  if (rangeMatch) {
    const startMer = rangeMatch[3] ?? rangeMatch[6];
    const endMer = rangeMatch[6];
    const start = parseClock(rangeMatch[1], rangeMatch[2], startMer);
    const end = parseClock(rangeMatch[4], rangeMatch[5], endMer);
    if (start && end) return { start, end };
  }

  // Single point: "3pm", "9am", "11:30am"
  const singleMatch = SINGLE_TIME_PATTERN.exec(lowered);
  if (singleMatch) {
    const start = parseClock(singleMatch[1], singleMatch[2], singleMatch[3]);
    if (start) return { start };
  }

  // Named time of day
  for (const [name, time] of Object.entries(NAMED_TIME_OF_DAY)) {
    if (new RegExp(`\\b${name}\\b`).test(lowered)) {
      return { start: time };
    }
  }

  return null;
}

function parseClock(
  hourStr: string,
  minuteStr: string | undefined,
  meridiem: string | undefined
): ParsedTime | null {
  let hour = Number(hourStr);
  if (!Number.isFinite(hour)) return null;
  if (hour < 0 || hour > 23) return null;
  const minute = minuteStr ? Number(minuteStr) : 0;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  if (meridiem) {
    const m = meridiem.toLowerCase();
    if (m === "pm" && hour < 12) hour += 12;
    else if (m === "am" && hour === 12) hour = 0;
  }
  if (hour > 23) return null;
  return { hour, minute };
}

/**
 * Resolve a day-of-week + qualifier into a calendar date in the caller's
 * timezone. Returns a `{ year, month, day }` triple anchored to the
 * timezone's local calendar.
 */
function resolveDayOfWeek(
  nowMs: number,
  tz: string,
  dayName: DayName,
  qualifier: "this" | "next" | "next-ambiguous"
): { year: number; month: number; day: number } {
  // Read "today" in the caller's tz.
  const parts = formatLocalDateParts(nowMs, tz);
  const todayDow = weekdayInTz(nowMs, tz);
  const targetDow = DAY_TO_INDEX[dayName];

  let dayDelta = (targetDow - todayDow + 7) % 7;
  if (dayDelta === 0) dayDelta = 7; // "this Tuesday" when today is Tuesday → next Tuesday
  if (qualifier === "next") dayDelta += 7;

  const baseUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day);
  const targetUtcMs = baseUtcMs + dayDelta * 24 * 60 * 60 * 1000;
  const target = new Date(targetUtcMs);
  return {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
  };
}

function formatLocalDateParts(
  ms: number,
  tz: string
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const lookup = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
  };
}

function weekdayInTz(ms: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  const name = fmt.format(new Date(ms)).toLowerCase();
  return DAY_TO_INDEX[name as DayName] ?? 0;
}

/**
 * Combine a calendar date + clock time into an absolute unix-ms instant
 * in the caller's timezone. Uses the offset-iteration trick because the
 * JS standard library doesn't ship a tz→ms converter.
 */
function combineDateAndTime(
  date: { year: number; month: number; day: number },
  time: ParsedTime,
  tz: string
): number {
  // Anchor: midnight UTC for the date.
  const utcAnchor = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    0,
    0
  );
  // Compute the offset between the anchor's wall-clock time in the target
  // tz and what we asked for. Subtract the offset to land on the
  // wall-clock target.
  const tzWallParts = readWallParts(utcAnchor, tz);
  const wallUtcMs = Date.UTC(
    tzWallParts.year,
    tzWallParts.month - 1,
    tzWallParts.day,
    tzWallParts.hour,
    tzWallParts.minute,
    0,
    0
  );
  const offset = wallUtcMs - utcAnchor;
  return utcAnchor - offset;
}

function readWallParts(
  ms: number,
  tz: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const lookup = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = lookup("hour");
  // Some Intl impls return "24" for midnight in en-US — normalize.
  if (hour === 24) hour = 0;
  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour,
    minute: lookup("minute"),
  };
}

/**
 * Extract the title from "block X for Y" / "block X to Y" / "schedule Y
 * X" patterns. Falls back to the substring after the last "for" if any.
 */
function extractTitle(text: string): string | null {
  const lowered = text.toLowerCase();
  const forMatch = /\bfor\s+(?:the\s+|a\s+|an\s+)?([a-z][\w\s'-]{1,80}?)(?:\s*[.!?]?$|\s+(?:on|at|in|tomorrow|today|this|next))/i.exec(
    text
  );
  if (forMatch && forMatch[1].trim().length > 0) {
    return cleanTitle(forMatch[1]);
  }
  const toMatch = /\bto\s+(?:the\s+|a\s+|an\s+)?([a-z][\w\s'-]{1,80}?)(?:\s*[.!?]?$|\s+(?:on|at|in|tomorrow|today|this|next))/i.exec(
    text
  );
  if (toMatch && toMatch[1].trim().length > 0) {
    return cleanTitle(toMatch[1]);
  }
  // Pattern: "schedule batch recording 9-11am Wednesday" — title between
  // the verb and the time/day token.
  const verbMatch = /^(?:please\s+)?(?:block|schedule|put\s+(?:a\s+)?hold(?:\s+on)?|hold)\s+(.+?)(?:\s+\d|\s+(?:on|at|this|next|tomorrow|today)\b|\s+(?:morning|afternoon|evening|night)\b|\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b)/i.exec(
    lowered
  );
  if (verbMatch && verbMatch[1].trim().length > 0) {
    const cleaned = cleanTitle(verbMatch[1]);
    // Reject if the cleaned title is just a clock or duration noise.
    if (!/^\d/.test(cleaned)) return cleaned;
  }
  return null;
}

function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
}

/* -------------------------------------------------------------------------- */
/* buildEventCreatePayload                                                     */
/* -------------------------------------------------------------------------- */

export function buildEventCreatePayload(
  event: ProposedEvent
): GoogleCalendarEventCreate {
  if (!Number.isFinite(event.startMs) || !Number.isFinite(event.endMs)) {
    throw new Error("ProposedEvent.startMs / endMs must be finite numbers.");
  }
  if (event.endMs <= event.startMs) {
    throw new Error("ProposedEvent.endMs must be strictly greater than startMs.");
  }
  const payload: {
    -readonly [K in keyof GoogleCalendarEventCreate]: GoogleCalendarEventCreate[K];
  } = {
    summary: event.title,
    start: {
      dateTime: new Date(event.startMs).toISOString(),
      timeZone: event.timeZone,
    },
    end: {
      dateTime: new Date(event.endMs).toISOString(),
      timeZone: event.timeZone,
    },
  };
  if (event.description) payload.description = event.description;
  if (event.location) payload.location = event.location;
  return payload;
}

/* -------------------------------------------------------------------------- */
/* validateEventBeforeWrite                                                    */
/* -------------------------------------------------------------------------- */

const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

export function validateEventBeforeWrite(
  event: ProposedEvent,
  picture: CreatorPicture,
  nowMs: number = Date.now()
): ValidationResult {
  const reasons: string[] = [];

  if (!Number.isFinite(event.startMs) || !Number.isFinite(event.endMs)) {
    reasons.push("invalid-times");
    return { ok: false, reasons };
  }
  if (event.startMs < nowMs) {
    reasons.push("past-start-time");
  }
  if (event.endMs - event.startMs > MAX_DURATION_MS) {
    reasons.push("duration-exceeds-cap");
  }
  if (event.endMs <= event.startMs) {
    reasons.push("non-positive-duration");
  }

  // Banned-topic gate. Honors both the spec's `boundaries.banned_topics`
  // shape and the actual schema's `doNotSuggest` array.
  const banned = collectBannedTopics(picture);
  if (banned.length > 0 && titleMatchesBanned(event.title, banned)) {
    reasons.push("banned-topic-title");
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

function collectBannedTopics(picture: CreatorPicture): string[] {
  const out: string[] = [];
  if (picture.boundaries?.banned_topics) {
    out.push(...picture.boundaries.banned_topics);
  }
  if (picture.doNotSuggest) {
    out.push(...picture.doNotSuggest);
  }
  return out
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

function titleMatchesBanned(title: string, banned: ReadonlyArray<string>): boolean {
  const haystack = title.toLowerCase();
  return banned.some((needle) => haystack.includes(needle));
}
