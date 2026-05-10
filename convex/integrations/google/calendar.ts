/**
 * Google Calendar API v3 wrappers (Sprint 12 Phase 1C).
 *
 * Pure stateless API surface — every function takes an access token and
 * returns parsed JSON. No Convex deps, no token refresh, no DB lookup.
 * The orchestrating Convex actions own connection-row resolution +
 * `refreshGoogleAccessToken` round-trips before calling these wrappers.
 *
 * Mirrors the shape of `convex/integrations/google/gmail.ts`. We use raw
 * `fetch` instead of the `googleapis` npm package for the same reasons
 * (size, dep count, existing pattern in `creatorMayaV0/backend.ts`).
 *
 * NOTE: `createGoogleCalendarEvent` and the read helper
 * `fetchGoogleCalendarEvents` already exist in
 * `convex/creatorMayaV0/backend.ts` for historical reasons. This module
 * adds:
 *   - `listCalendarEvents`           — public list helper (mirrors gmail's pattern)
 *   - `updateCalendarEvent`          — PATCH events.update
 *   - `deleteCalendarEvent`          — DELETE events.delete
 *   - `GoogleCalendarApiError`       — typed error so HTTP layer can map
 *                                       to clean status codes
 *
 * Scope: requires `https://www.googleapis.com/auth/calendar.events`
 * (read + write events). The unified Google OAuth scope list in
 * `convex/lcMaya/lcMayaHttp.ts` (`GOOGLE_OAUTH_SCOPES`) already requests
 * this.
 */

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}

async function calendarFetch(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${CALENDAR_BASE}${path}`;
  return await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function readJsonOrThrow<T>(response: Response, op: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleCalendarApiError(
      response.status,
      `Google Calendar ${op} failed: ${response.status}`,
      text.slice(0, 400)
    );
  }
  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface GoogleCalendarEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarEventTime;
  end?: GoogleCalendarEventTime;
  htmlLink?: string;
  status?: string;
  recurringEventId?: string;
  updated?: string;
}

export interface GoogleCalendarListResponse {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  timeZone?: string;
}

export interface GoogleCalendarEventCreatePayload {
  /** `summary` on the Google API. */
  summary: string;
  description?: string;
  location?: string;
  /** ISO 8601 with timezone (e.g. "2026-05-12T15:00:00-07:00"). */
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
}

export interface GoogleCalendarEventUpdatePayload {
  /** Any subset of the create payload — Google's PATCH semantics merge. */
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime: string; timeZone?: string };
  end?: { dateTime: string; timeZone?: string };
}

/* -------------------------------------------------------------------------- */
/* List events                                                                */
/* -------------------------------------------------------------------------- */

/**
 * List events in `[timeMin, timeMax)` for the given calendar id. Defaults
 * mirror the inline helper in `creatorMayaV0/backend.ts`:
 *   singleEvents = true (expand recurring → instances)
 *   orderBy      = startTime
 *   maxResults   = 100
 *
 * The caller can override any of these via `opts`.
 */
export async function listCalendarEvents(
  accessToken: string,
  args: {
    timeMin: string;
    timeMax: string;
    calendarId?: string;
    maxResults?: number;
    singleEvents?: boolean;
    orderBy?: "startTime" | "updated";
    pageToken?: string;
    q?: string;
  }
): Promise<GoogleCalendarListResponse> {
  const calendarId = args.calendarId ?? "primary";
  const params = new URLSearchParams({
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    singleEvents: String(args.singleEvents ?? true),
    orderBy: args.orderBy ?? "startTime",
    maxResults: String(args.maxResults ?? 100),
  });
  if (args.pageToken) params.set("pageToken", args.pageToken);
  if (args.q) params.set("q", args.q);

  const response = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
  );
  const body = await readJsonOrThrow<{
    items?: GoogleCalendarEvent[];
    nextPageToken?: string;
    timeZone?: string;
  }>(response, "list-events");
  return {
    items: body.items ?? [],
    nextPageToken: body.nextPageToken,
    timeZone: body.timeZone,
  };
}

/* -------------------------------------------------------------------------- */
/* Create event                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Create an event. Returns the created event's id + htmlLink so Maya can
 * text the operator a confirm.
 *
 * Inputs intentionally narrow: only fields a creator can request via
 * natural language ("block 3pm Tuesday for filming"). For attendees,
 * conferencing, recurrence — extend the payload type rather than passing
 * a raw record (defense-in-depth against accidentally leaking arbitrary
 * payloads to Google).
 */
export async function createCalendarEvent(
  accessToken: string,
  args: {
    calendarId?: string;
    payload: GoogleCalendarEventCreatePayload;
  }
): Promise<{ id: string; htmlLink: string; event: GoogleCalendarEvent }> {
  const calendarId = args.calendarId ?? "primary";
  const response = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.payload),
    }
  );
  const event = await readJsonOrThrow<GoogleCalendarEvent>(
    response,
    "create-event"
  );
  if (!event.id || !event.htmlLink) {
    throw new GoogleCalendarApiError(
      500,
      "Google Calendar create returned without id or htmlLink — refusing to surface partial result."
    );
  }
  return { id: event.id, htmlLink: event.htmlLink, event };
}

/* -------------------------------------------------------------------------- */
/* Update event                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Update an existing event. Uses PATCH (events.patch) — Google merges
 * the supplied fields onto the existing event, leaving omitted fields
 * untouched. Pass only the fields you want to change.
 *
 * NOTE: Google's PATCH on `start`/`end` requires the FULL nested object
 * (you can't patch just `start.dateTime`). The caller should always send
 * a complete `{ dateTime, timeZone? }` block when changing times.
 */
export async function updateCalendarEvent(
  accessToken: string,
  args: {
    eventId: string;
    calendarId?: string;
    payload: GoogleCalendarEventUpdatePayload;
  }
): Promise<{ id: string; htmlLink: string; event: GoogleCalendarEvent }> {
  const calendarId = args.calendarId ?? "primary";
  if (!args.eventId) {
    throw new GoogleCalendarApiError(400, "updateCalendarEvent: eventId required.");
  }
  const response = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
      args.eventId
    )}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.payload),
    }
  );
  const event = await readJsonOrThrow<GoogleCalendarEvent>(
    response,
    "update-event"
  );
  if (!event.id) {
    throw new GoogleCalendarApiError(
      500,
      "Google Calendar update returned without id — refusing to surface partial result."
    );
  }
  return {
    id: event.id,
    htmlLink: event.htmlLink ?? "",
    event,
  };
}

/* -------------------------------------------------------------------------- */
/* Delete event                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Delete an event. Google returns 204 No Content on success. We surface
 * `{ ok: true, eventId }` so the HTTP layer can echo back the same id
 * Maya passed in (lets the caller correlate without parsing 204).
 *
 * Idempotency: deleting an already-deleted event returns 410 Gone or
 * 404 Not Found depending on how long ago it was deleted. We surface
 * those as `GoogleCalendarApiError` so the caller can decide whether to
 * treat as success.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  args: { eventId: string; calendarId?: string }
): Promise<{ ok: true; eventId: string }> {
  const calendarId = args.calendarId ?? "primary";
  if (!args.eventId) {
    throw new GoogleCalendarApiError(400, "deleteCalendarEvent: eventId required.");
  }
  const response = await calendarFetch(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(
      args.eventId
    )}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleCalendarApiError(
      response.status,
      `Google Calendar delete-event failed: ${response.status}`,
      text.slice(0, 400)
    );
  }
  // 204 No Content is the happy path. 200 is also valid (rare).
  return { ok: true, eventId: args.eventId };
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

export const _internal = {
  CALENDAR_BASE,
};
