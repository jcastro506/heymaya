/**
 * Google Calendar v3 and the OAuth token endpoints, as stateless wrappers (plan
 * §12.5). Every function takes an access token; connection rows, refresh and
 * consent live in `convex/calendar/`. Raw fetch, no googleapis package. Adapted from
 * legacy `convex/integrations/google/calendar.ts` (salvage verdict PORT) with the
 * calendar list, the `maya` extended property and token revoke added.
 */

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** Read at connect. `calendar.events` is what a confirmed block needs; the sensitive-scope verification covers both. */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"];

/** The marker on every event Maya writes, so hers are distinguishable from theirs. */
export const MAYA_EVENT_PROPERTY = { maya: "block" } as const;

export class GoogleCalendarApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: string) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}

async function readJsonOrThrow<T>(response: Response, op: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleCalendarApiError(response.status, `Google Calendar ${op} failed: ${response.status}`, text.slice(0, 400));
  }
  return (await response.json()) as T;
}

async function calendarFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${CALENDAR_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) } });
}

export interface GoogleEventTime { dateTime?: string; date?: string; timeZone?: string }
export interface GoogleEvent {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurringEventId?: string;
  htmlLink?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}
export interface GoogleCalendarListEntry { id: string; summary?: string; primary?: boolean; accessRole?: string; selected?: boolean }

export async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const res = await calendarFetch(accessToken, "/users/me/calendarList?minAccessRole=writer");
  const body = await readJsonOrThrow<{ items?: GoogleCalendarListEntry[] }>(res, "calendarList");
  return body.items ?? [];
}

export async function listEvents(accessToken: string, args: { calendarId: string; timeMin: string; timeMax: string; pageToken?: string }): Promise<{ items: GoogleEvent[]; nextPageToken?: string; timeZone?: string }> {
  const params = new URLSearchParams({ timeMin: args.timeMin, timeMax: args.timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
  if (args.pageToken) params.set("pageToken", args.pageToken);
  const res = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(args.calendarId)}/events?${params}`);
  const body = await readJsonOrThrow<{ items?: GoogleEvent[]; nextPageToken?: string; timeZone?: string }>(res, "events.list");
  return { items: body.items ?? [], nextPageToken: body.nextPageToken, timeZone: body.timeZone };
}

export async function createEvent(accessToken: string, args: { calendarId: string; summary: string; description?: string; start: string; end: string; timeZone: string }): Promise<{ id: string; htmlLink: string }> {
  const payload = {
    summary: args.summary,
    description: args.description,
    start: { dateTime: args.start, timeZone: args.timeZone },
    end: { dateTime: args.end, timeZone: args.timeZone },
    extendedProperties: { private: MAYA_EVENT_PROPERTY },
    reminders: { useDefault: true },
  };
  const res = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(args.calendarId)}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const ev = await readJsonOrThrow<GoogleEvent>(res, "events.insert");
  if (!ev.id || !ev.htmlLink) throw new GoogleCalendarApiError(500, "events.insert returned without id or htmlLink");
  return { id: ev.id, htmlLink: ev.htmlLink };
}

export async function patchEvent(accessToken: string, args: { calendarId: string; eventId: string; start: string; end: string; timeZone: string }): Promise<void> {
  const res = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start: { dateTime: args.start, timeZone: args.timeZone }, end: { dateTime: args.end, timeZone: args.timeZone } }),
  });
  await readJsonOrThrow(res, "events.patch");
}

/** 404 and 410 count as already gone. */
export async function deleteEvent(accessToken: string, args: { calendarId: string; eventId: string }): Promise<void> {
  const res = await calendarFetch(accessToken, `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(args.eventId)}`, { method: "DELETE" });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new GoogleCalendarApiError(res.status, `Google Calendar events.delete failed: ${res.status}`, (await res.text().catch(() => "")).slice(0, 400));
}

export interface GoogleTokenBundle { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string }

export async function exchangeCode(args: { code: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<GoogleTokenBundle> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: args.code, client_id: args.clientId, client_secret: args.clientSecret, redirect_uri: args.redirectUri, grant_type: "authorization_code" }),
  });
  const body = await readJsonOrThrow<GoogleTokenBundle>(res, "token exchange");
  if (!body.access_token) throw new GoogleCalendarApiError(500, "token exchange returned no access_token");
  return body;
}

/** Throws a 400 `invalid_grant` when the refresh token was revoked: the caller marks the connection `needs_reconnect`. */
export async function refreshAccessToken(args: { refreshToken: string; clientId: string; clientSecret: string }): Promise<GoogleTokenBundle> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: args.refreshToken, client_id: args.clientId, client_secret: args.clientSecret, grant_type: "refresh_token" }),
  });
  const body = await readJsonOrThrow<GoogleTokenBundle>(res, "token refresh");
  if (!body.access_token) throw new GoogleCalendarApiError(500, "token refresh returned no access_token");
  return body;
}

/** Best effort: Google answers 200 on success and 400 when the token is already dead. Both mean gone. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
}

export function buildAuthUrl(args: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent", // always re-prompt so a re-connect also yields a refresh token
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES.join(" "),
    state: args.state,
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

/** Google gives `dateTime` for timed events and `date` (YYYY-MM-DD) for all-day ones. */
export function eventBounds(ev: GoogleEvent): { start: number; end: number; allDay: boolean } | null {
  if (ev.start?.dateTime && ev.end?.dateTime) return { start: Date.parse(ev.start.dateTime), end: Date.parse(ev.end.dateTime), allDay: false };
  if (ev.start?.date && ev.end?.date) return { start: Date.parse(`${ev.start.date}T00:00:00Z`), end: Date.parse(`${ev.end.date}T00:00:00Z`), allDay: true };
  return null;
}
