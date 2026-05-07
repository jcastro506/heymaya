/**
 * Apple iCloud CalDAV wrappers (Sprint 9.8 Workstream B).
 *
 * Apple does not expose a clean OAuth flow for iCloud Calendar — the only
 * server-side path that gives read+write event access is CalDAV with an
 * app-specific password. Sign in with Apple grants identity only; the
 * iCloud calendar is gated behind the user generating a password at
 * appleid.apple.com → Sign-In and Security → App-Specific Passwords.
 *
 * The flow over iMessage:
 *   1. Maya sends the deep link `https://account.apple.com/account/manage/section/security`
 *   2. User generates an app password named "Maya"
 *   3. User pastes the password (`xxxx-xxxx-xxxx-xxxx`) back into iMessage
 *   4. The /lc_maya/apple_calendar_connect endpoint validates by listing
 *      calendars + stores the encrypted password in `appleCalendarConnections`
 *
 * Library: `tsdav` (TypeScript CalDAV client). iCloud server is
 * `https://caldav.icloud.com`. Auth is HTTP Basic.
 *
 * IMPORTANT — Apple has been rumored to be deprecating app-specific
 * passwords in favor of Sign in with Apple + 2FA. As of the Sprint 9.8
 * implementation date (2026-05-07) the flow still works, but this layer
 * is borrowed time. If Apple kills app-specific passwords, the only
 * remaining options are: (a) ship a native iOS app + use EventKit, or
 * (b) read-only via iCloud Public Calendar share URLs.
 *
 * Pure stateless wrappers — every function takes credentials and returns
 * parsed result. The orchestrating Convex actions own connection-row
 * decryption + DB writes.
 */

import { createDAVClient } from "tsdav";

const ICLOUD_CALDAV_SERVER = "https://caldav.icloud.com";

export interface AppleCredentials {
  /** Apple ID email (the email used for iCloud login). */
  appleId: string;
  /** App-specific password — looks like `xxxx-xxxx-xxxx-xxxx`. */
  appPassword: string;
}

export interface AppleCalendarRef {
  /** CalDAV calendar URL — used as the addressing handle for events. */
  url: string;
  /** Display name as shown in iCloud Calendar (e.g. "Home", "Work"). */
  displayName: string;
  /** Color hex if the calendar has one set. */
  color?: string;
  /** Component types this calendar holds. We filter to ones supporting VEVENT. */
  components: string[];
}

export class AppleCaldavError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AppleCaldavError";
  }
}

/**
 * Validate credentials by attempting a CalDAV login + calendar fetch.
 * Returns the discovered calendars on success; throws AppleCaldavError
 * on auth failure or network error. The orchestrator uses this both for
 * the initial connect-flow validation AND for re-validation after a
 * stored-password use that 401'd.
 */
export async function validateAndListCalendars(
  creds: AppleCredentials
): Promise<AppleCalendarRef[]> {
  let client: Awaited<ReturnType<typeof createDAVClient>>;
  try {
    client = await createDAVClient({
      serverUrl: ICLOUD_CALDAV_SERVER,
      credentials: { username: creds.appleId, password: creds.appPassword },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  } catch (err) {
    // tsdav's auth probe fails here when credentials are wrong. iCloud
    // returns 401 for bad credentials AND for a real Apple ID + the wrong
    // password kind (e.g. their actual Apple password instead of an app-
    // specific one). Surface the same error in both cases — operator
    // copy says "make sure it's an app-specific password, not your real
    // Apple ID password."
    throw new AppleCaldavError(
      "auth-failed: iCloud rejected the Apple ID + app password combo",
      err,
      401
    );
  }

  let calendars: Awaited<ReturnType<typeof client.fetchCalendars>>;
  try {
    calendars = await client.fetchCalendars();
  } catch (err) {
    throw new AppleCaldavError(
      "fetch-calendars-failed: connected but could not list iCloud calendars",
      err
    );
  }

  // iCloud returns calendars + reminders + other DAV collections. Filter
  // to ones that hold VEVENT (Maya only writes events; tasks/reminders
  // have a different component type and a different UX).
  return calendars
    .filter((c) =>
      Array.isArray(c.components) &&
      (c.components as string[]).some((comp) => comp === "VEVENT")
    )
    .map((c) => ({
      url: c.url,
      displayName: typeof c.displayName === "string" ? c.displayName : "(unnamed)",
      color: typeof c.calendarColor === "string" ? c.calendarColor : undefined,
      components: (c.components as string[]) ?? [],
    }));
}

export interface AppleEvent {
  /** UID is the canonical event identifier in iCalendar. We generate one
   *  per create call. The CalDAV object URL is derived from this. */
  uid: string;
  /** Filename in CalDAV — `<uid>.ics` is the iCloud convention. */
  filename: string;
  /** Display URL — the path within the calendar where this event lives. */
  url: string;
  /** Raw iCalendar text (RFC 5545). */
  ics: string;
  /** Parsed summary + start + end for downstream display. */
  summary?: string;
  startMs?: number;
  endMs?: number;
}

export interface CreateAppleEventInput {
  /** Calendar URL from validateAndListCalendars. Required — caller decides
   *  which calendar to write to. */
  calendarUrl: string;
  /** Event title shown in Calendar.app. */
  summary: string;
  /** ISO 8601 start with timezone, e.g. "2026-05-12T15:00:00-04:00". */
  startIso: string;
  /** ISO 8601 end. */
  endIso: string;
  description?: string;
  location?: string;
}

/**
 * Build a minimal RFC 5545 VCALENDAR + VEVENT for a new event.
 *
 * Times are normalized to UTC (`YYYYMMDDTHHMMSSZ`) to avoid the
 * VTIMEZONE-reference dance RFC 5545 requires for explicit-offset
 * datetimes. iCloud (and every other CalDAV client) renders UTC times
 * correctly in the user's local timezone — the only thing we lose is
 * the human-readable timezone name in the raw ics, which doesn't matter
 * since the user views events through Calendar.app.
 */
export function buildEventIcs(input: CreateAppleEventInput, uid: string): string {
  const dt = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//heymaya//Maya 1.0//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(input.startIso)}`,
    `DTEND:${dt(input.endIso)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    ...(input.description
      ? [`DESCRIPTION:${escapeIcsText(input.description)}`]
      : []),
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** RFC 5545 § 3.3.11 — escape commas, semicolons, backslashes, newlines. */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export async function createEvent(
  creds: AppleCredentials,
  input: CreateAppleEventInput
): Promise<AppleEvent> {
  const client = await createDAVClient({
    serverUrl: ICLOUD_CALDAV_SERVER,
    credentials: { username: creds.appleId, password: creds.appPassword },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  // Generate a UID + filename. iCloud expects `<uid>.ics` as the path.
  const uid = `${cryptoRandomUuid()}@heymaya.ai`;
  const filename = `${uid}.ics`;
  const ics = buildEventIcs(input, uid);

  try {
    // tsdav's createCalendarObject takes a calendar OBJECT — we synthesize a
    // minimal one from the URL since fetchCalendars returns them with
    // additional metadata we don't need to round-trip.
    const minimalCalendar = {
      url: input.calendarUrl,
      ctag: "",
      description: "",
      displayName: "",
      timezone: "",
      components: ["VEVENT"],
      reports: [],
      objects: [],
      resourcetype: ["collection", "calendar"],
      syncToken: "",
      // tsdav's DAVCalendar type has more fields but they're optional at
      // runtime — the call only uses `url`.
    } as unknown as Parameters<typeof client.createCalendarObject>[0]["calendar"];

    await client.createCalendarObject({
      calendar: minimalCalendar,
      filename,
      iCalString: ics,
    });
  } catch (err) {
    throw new AppleCaldavError("create-event-failed", err);
  }

  return {
    uid,
    filename,
    url: `${input.calendarUrl}${filename}`,
    ics,
    summary: input.summary,
    startMs: Date.parse(input.startIso),
    endMs: Date.parse(input.endIso),
  };
}

/** Convex runtime exposes `crypto.randomUUID`. */
function cryptoRandomUuid(): string {
  return crypto.randomUUID();
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

export const _internal = {
  buildEventIcs,
  escapeIcsText,
  ICLOUD_CALDAV_SERVER,
};
