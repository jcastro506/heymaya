/**
 * Calendar HTTP endpoints (Sprint 12 Phase 1C).
 *
 * Maya-callable surface for calendar CRUD across BOTH connected providers:
 *   - Google Calendar (OAuth, token-resolved via resolveGoogleAccessTokenForCreator)
 *   - Apple iCloud Calendar (CalDAV, password-resolved via the apple-side query)
 *
 * Surface (Google):
 *   POST /lc_maya/calendar_list_events    — list events in a window
 *   POST /lc_maya/calendar_create_event   — create event
 *   POST /lc_maya/calendar_update_event   — update event (PATCH)
 *   POST /lc_maya/calendar_delete_event   — delete event
 *
 * Surface (Apple):
 *   POST /lc_maya/apple_calendar_list_calendars  — list iCloud calendars
 *   POST /lc_maya/apple_calendar_list_events     — list events in a window
 *   POST /lc_maya/apple_calendar_create_event    — create event
 *   POST /lc_maya/apple_calendar_update_event    — update event
 *   POST /lc_maya/apple_calendar_delete_event    — delete event
 *
 * Status codes:
 *   200 — happy path
 *   400 — malformed body
 *   401 — wrong webhook secret
 *   403 — connection missing required scope (Google) or revoked (Apple)
 *   404 — creator has no connection (connect flow not completed)
 *   500 — provider API error or token refresh failed
 *
 * Phase 2 content-plan flow will write planned-content events here. Get
 * this surface verified before that lands.
 */

import { httpAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { assertWebhookSecret } from "../lib/webhookSecret";
import { decrypt } from "../lib/encryption";
import {
  GoogleCalendarApiError,
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
  type GoogleCalendarEventCreatePayload,
  type GoogleCalendarEventUpdatePayload,
} from "../integrations/google/calendar";
import {
  AppleCaldavError,
  createEvent as appleCreateEvent,
  deleteEvent as appleDeleteEvent,
  listEvents as appleListEvents,
  updateEvent as appleUpdateEvent,
  validateAndListCalendars as appleListCalendars,
} from "../integrations/apple/caldav";

const CALENDAR_REQUIRED_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CommonPayload {
  secret: unknown;
  creatorId: unknown;
}

function parseCommon(raw: unknown): { secret: string; creatorId: string } {
  if (!raw || typeof raw !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const obj = raw as CommonPayload;
  if (typeof obj.secret !== "string") {
    throw new Error("secret must be a string.");
  }
  if (typeof obj.creatorId !== "string" || obj.creatorId.length === 0) {
    throw new Error("creatorId is required.");
  }
  return { secret: obj.secret, creatorId: obj.creatorId };
}

/* -------------------------------------------------------------------------- */
/* Google error mapper (mirrors gmailHttp pattern)                            */
/* -------------------------------------------------------------------------- */

function googleErrToResponse(err: unknown): Response {
  const rawMsg = (err as Error).message ?? "internal-error";
  const has = (tag: string): boolean => rawMsg.includes(tag);
  if (has("no-connection")) {
    return jsonResponse(
      {
        error: "no-google-connection",
        hint: "Creator has not completed the Google connect flow. Send the OAuth link via /lc_maya/start_oauth provider=gmail.",
      },
      404
    );
  }
  if (has("no-refresh-token")) {
    return jsonResponse(
      {
        error: "no-refresh-token",
        hint: "Connection exists but the refresh token is missing — re-consent required.",
      },
      403
    );
  }
  if (has("scope-missing")) {
    return jsonResponse(
      {
        error: "scope-missing",
        requiredScope: CALENDAR_REQUIRED_SCOPE,
        hint: "Creator's connection doesn't include calendar.events. They need to re-consent through the unified Google OAuth flow.",
      },
      403
    );
  }
  if (has("missing-google-creds")) {
    return jsonResponse(
      {
        error: "missing-google-creds",
        hint: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set in Convex env.",
      },
      500
    );
  }
  if (has("refresh-failed")) {
    return jsonResponse({ error: "refresh-failed", detail: rawMsg }, 500);
  }
  if (err instanceof GoogleCalendarApiError) {
    return jsonResponse(
      {
        error: "google-calendar-api-error",
        status: err.status,
        message: err.message,
        body: err.body,
      },
      err.status >= 400 && err.status < 600 ? err.status : 500
    );
  }
  return jsonResponse({ error: rawMsg }, 500);
}

/* -------------------------------------------------------------------------- */
/* Apple connection resolver                                                   */
/* -------------------------------------------------------------------------- */

/** Internal lookup — fetch the active Apple calendar connection for a creator.
 *  Returns the row (still encrypted); the action layer decrypts. */
export const latestAppleCalendarConnectionForCreator = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("appleCalendarConnections")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.creatorId))
      .collect();
    return rows[rows.length - 1] ?? null;
  },
});

async function resolveAppleCreds(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  creatorId: Id<"creators">
): Promise<{
  appleId: string;
  appPassword: string;
  defaultCalendarUrl?: string;
}> {
  const row = (await ctx.runQuery(
    internal.lcMaya.calendarHttp.latestAppleCalendarConnectionForCreator,
    { creatorId }
  )) as {
    appleId: string;
    encryptedAppPassword: string;
    defaultCalendarUrl?: string;
    status: "active" | "revoked";
  } | null;
  if (!row) throw new Error("apple-no-connection");
  if (row.status !== "active") throw new Error("apple-revoked");
  const appPassword = await decrypt(row.encryptedAppPassword);
  return {
    appleId: row.appleId,
    appPassword,
    defaultCalendarUrl: row.defaultCalendarUrl,
  };
}

function appleErrToResponse(err: unknown): Response {
  const rawMsg = (err as Error).message ?? "internal-error";
  if (rawMsg === "apple-no-connection") {
    return jsonResponse(
      {
        error: "no-apple-connection",
        hint: "Creator has not completed the Apple Calendar connect flow. Use /lc_maya/apple_calendar_connect.",
      },
      404
    );
  }
  if (rawMsg === "apple-revoked") {
    return jsonResponse(
      {
        error: "apple-revoked",
        hint: "Apple connection is marked revoked. Creator must re-paste an app-specific password via /lc_maya/apple_calendar_connect.",
      },
      403
    );
  }
  if (err instanceof AppleCaldavError) {
    return jsonResponse(
      {
        error: "apple-caldav-error",
        status: err.status,
        message: err.message,
      },
      err.status === 401 ? 403 : 500
    );
  }
  return jsonResponse({ error: rawMsg }, 500);
}

/* -------------------------------------------------------------------------- */
/* Google: list_events                                                         */
/* -------------------------------------------------------------------------- */

export const calendarListEventsHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let args: {
    timeMin: string;
    timeMax: string;
    calendarId?: string;
    maxResults?: number;
    q?: string;
  };
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.timeMin !== "string" || typeof raw.timeMax !== "string") {
      throw new Error("timeMin and timeMax (ISO 8601) are required.");
    }
    args = {
      timeMin: raw.timeMin,
      timeMax: raw.timeMax,
      calendarId:
        typeof raw.calendarId === "string" ? raw.calendarId : undefined,
      maxResults:
        typeof raw.maxResults === "number" ? raw.maxResults : undefined,
      q: typeof raw.q === "string" ? raw.q : undefined,
    };
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: CALENDAR_REQUIRED_SCOPE,
      }
    );
    const result = await listCalendarEvents(accessToken, args);
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    return googleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Google: create_event                                                        */
/* -------------------------------------------------------------------------- */

export const calendarCreateEventHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let calendarId: string | undefined;
  let payload: GoogleCalendarEventCreatePayload;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.summary !== "string" || raw.summary.length === 0) {
      throw new Error("summary is required.");
    }
    if (
      !raw.start ||
      typeof raw.start !== "object" ||
      typeof (raw.start as { dateTime?: unknown }).dateTime !== "string"
    ) {
      throw new Error("start.dateTime (ISO 8601) is required.");
    }
    if (
      !raw.end ||
      typeof raw.end !== "object" ||
      typeof (raw.end as { dateTime?: unknown }).dateTime !== "string"
    ) {
      throw new Error("end.dateTime (ISO 8601) is required.");
    }
    calendarId =
      typeof raw.calendarId === "string" ? raw.calendarId : undefined;
    payload = {
      summary: raw.summary,
      description:
        typeof raw.description === "string" ? raw.description : undefined,
      location: typeof raw.location === "string" ? raw.location : undefined,
      start: raw.start as GoogleCalendarEventCreatePayload["start"],
      end: raw.end as GoogleCalendarEventCreatePayload["end"],
    };
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: CALENDAR_REQUIRED_SCOPE,
      }
    );
    const result = await createCalendarEvent(accessToken, {
      calendarId,
      payload,
    });
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    return googleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Google: update_event                                                        */
/* -------------------------------------------------------------------------- */

export const calendarUpdateEventHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let eventId: string;
  let calendarId: string | undefined;
  let payload: GoogleCalendarEventUpdatePayload;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.eventId !== "string" || raw.eventId.length === 0) {
      throw new Error("eventId is required.");
    }
    eventId = raw.eventId;
    calendarId =
      typeof raw.calendarId === "string" ? raw.calendarId : undefined;
    payload = {};
    if (typeof raw.summary === "string") payload.summary = raw.summary;
    if (typeof raw.description === "string")
      payload.description = raw.description;
    if (typeof raw.location === "string") payload.location = raw.location;
    if (
      raw.start &&
      typeof raw.start === "object" &&
      typeof (raw.start as { dateTime?: unknown }).dateTime === "string"
    ) {
      payload.start = raw.start as GoogleCalendarEventUpdatePayload["start"];
    }
    if (
      raw.end &&
      typeof raw.end === "object" &&
      typeof (raw.end as { dateTime?: unknown }).dateTime === "string"
    ) {
      payload.end = raw.end as GoogleCalendarEventUpdatePayload["end"];
    }
    if (Object.keys(payload).length === 0) {
      throw new Error(
        "At least one updatable field (summary/description/location/start/end) is required."
      );
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: CALENDAR_REQUIRED_SCOPE,
      }
    );
    const result = await updateCalendarEvent(accessToken, {
      eventId,
      calendarId,
      payload,
    });
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (err) {
    return googleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Google: delete_event                                                        */
/* -------------------------------------------------------------------------- */

export const calendarDeleteEventHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let eventId: string;
  let calendarId: string | undefined;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.eventId !== "string" || raw.eventId.length === 0) {
      throw new Error("eventId is required.");
    }
    eventId = raw.eventId;
    calendarId =
      typeof raw.calendarId === "string" ? raw.calendarId : undefined;
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { accessToken } = await ctx.runAction(
      internal.integrations.google.tokenResolver
        .resolveGoogleAccessTokenForCreator,
      {
        creatorId: body.creatorId as Id<"creators">,
        requiredScope: CALENDAR_REQUIRED_SCOPE,
      }
    );
    const result = await deleteCalendarEvent(accessToken, {
      eventId,
      calendarId,
    });
    return jsonResponse(result, 200);
  } catch (err) {
    return googleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Apple: list_calendars                                                       */
/* -------------------------------------------------------------------------- */

export const appleCalendarListCalendarsHttp = httpAction(
  async (ctx, request) => {
    let body: { secret: string; creatorId: string };
    try {
      const raw = (await request.json()) as Record<string, unknown>;
      body = parseCommon(raw);
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
    try {
      assertWebhookSecret(body.secret);
    } catch {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    try {
      const creds = await resolveAppleCreds(
        ctx,
        body.creatorId as Id<"creators">
      );
      const calendars = await appleListCalendars({
        appleId: creds.appleId,
        appPassword: creds.appPassword,
      });
      return jsonResponse(
        {
          ok: true,
          defaultCalendarUrl: creds.defaultCalendarUrl,
          calendars: calendars.map((c) => ({
            url: c.url,
            displayName: c.displayName,
            color: c.color,
          })),
        },
        200
      );
    } catch (err) {
      return appleErrToResponse(err);
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Apple: list_events                                                          */
/* -------------------------------------------------------------------------- */

export const appleCalendarListEventsHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let timeRangeStartIso: string;
  let timeRangeEndIso: string;
  let calendarUrl: string | undefined;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (
      typeof raw.timeRangeStartIso !== "string" ||
      typeof raw.timeRangeEndIso !== "string"
    ) {
      throw new Error(
        "timeRangeStartIso and timeRangeEndIso (ISO 8601) are required."
      );
    }
    timeRangeStartIso = raw.timeRangeStartIso;
    timeRangeEndIso = raw.timeRangeEndIso;
    calendarUrl =
      typeof raw.calendarUrl === "string" ? raw.calendarUrl : undefined;
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const creds = await resolveAppleCreds(
      ctx,
      body.creatorId as Id<"creators">
    );
    const targetUrl = calendarUrl ?? creds.defaultCalendarUrl;
    if (!targetUrl) {
      return jsonResponse(
        {
          error: "no-default-calendar",
          hint: "Provide calendarUrl explicitly or run /lc_maya/apple_calendar_connect to set a default.",
        },
        400
      );
    }
    const events = await appleListEvents(
      { appleId: creds.appleId, appPassword: creds.appPassword },
      {
        calendarUrl: targetUrl,
        timeRangeStartIso,
        timeRangeEndIso,
      }
    );
    return jsonResponse(
      {
        ok: true,
        events: events.map((e) => ({
          uid: e.uid,
          url: e.url,
          summary: e.summary,
          startMs: e.startMs,
          endMs: e.endMs,
        })),
      },
      200
    );
  } catch (err) {
    return appleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Apple: create_event                                                         */
/* -------------------------------------------------------------------------- */

export const appleCalendarCreateEventHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let summary: string;
  let startIso: string;
  let endIso: string;
  let description: string | undefined;
  let location: string | undefined;
  let calendarUrl: string | undefined;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.summary !== "string" || raw.summary.length === 0) {
      throw new Error("summary is required.");
    }
    if (typeof raw.startIso !== "string" || typeof raw.endIso !== "string") {
      throw new Error("startIso and endIso (ISO 8601) are required.");
    }
    summary = raw.summary;
    startIso = raw.startIso;
    endIso = raw.endIso;
    description =
      typeof raw.description === "string" ? raw.description : undefined;
    location = typeof raw.location === "string" ? raw.location : undefined;
    calendarUrl =
      typeof raw.calendarUrl === "string" ? raw.calendarUrl : undefined;
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const creds = await resolveAppleCreds(
      ctx,
      body.creatorId as Id<"creators">
    );
    const targetUrl = calendarUrl ?? creds.defaultCalendarUrl;
    if (!targetUrl) {
      return jsonResponse(
        {
          error: "no-default-calendar",
          hint: "Provide calendarUrl explicitly or set a default via /lc_maya/apple_calendar_connect.",
        },
        400
      );
    }
    const event = await appleCreateEvent(
      { appleId: creds.appleId, appPassword: creds.appPassword },
      {
        calendarUrl: targetUrl,
        summary,
        startIso,
        endIso,
        description,
        location,
      }
    );
    return jsonResponse(
      {
        ok: true,
        event: {
          uid: event.uid,
          url: event.url,
          summary: event.summary,
          startMs: event.startMs,
          endMs: event.endMs,
        },
      },
      200
    );
  } catch (err) {
    return appleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Apple: update_event                                                         */
/* -------------------------------------------------------------------------- */

export const appleCalendarUpdateEventHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let eventUrl: string;
  let uid: string;
  let summary: string;
  let startIso: string;
  let endIso: string;
  let description: string | undefined;
  let location: string | undefined;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.eventUrl !== "string" || raw.eventUrl.length === 0) {
      throw new Error("eventUrl is required.");
    }
    if (typeof raw.uid !== "string" || raw.uid.length === 0) {
      throw new Error("uid is required.");
    }
    if (typeof raw.summary !== "string" || raw.summary.length === 0) {
      throw new Error("summary is required.");
    }
    if (typeof raw.startIso !== "string" || typeof raw.endIso !== "string") {
      throw new Error("startIso and endIso (ISO 8601) are required.");
    }
    eventUrl = raw.eventUrl;
    uid = raw.uid;
    summary = raw.summary;
    startIso = raw.startIso;
    endIso = raw.endIso;
    description =
      typeof raw.description === "string" ? raw.description : undefined;
    location = typeof raw.location === "string" ? raw.location : undefined;
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const creds = await resolveAppleCreds(
      ctx,
      body.creatorId as Id<"creators">
    );
    const event = await appleUpdateEvent(
      { appleId: creds.appleId, appPassword: creds.appPassword },
      {
        eventUrl,
        uid,
        summary,
        startIso,
        endIso,
        description,
        location,
      }
    );
    return jsonResponse(
      {
        ok: true,
        event: {
          uid: event.uid,
          url: event.url,
          summary: event.summary,
          startMs: event.startMs,
          endMs: event.endMs,
        },
      },
      200
    );
  } catch (err) {
    return appleErrToResponse(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Apple: delete_event                                                         */
/* -------------------------------------------------------------------------- */

export const appleCalendarDeleteEventHttp = httpAction(async (ctx, request) => {
  let body: { secret: string; creatorId: string };
  let eventUrl: string;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    body = parseCommon(raw);
    if (typeof raw.eventUrl !== "string" || raw.eventUrl.length === 0) {
      throw new Error("eventUrl is required.");
    }
    eventUrl = raw.eventUrl;
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 400);
  }

  try {
    assertWebhookSecret(body.secret);
  } catch {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const creds = await resolveAppleCreds(
      ctx,
      body.creatorId as Id<"creators">
    );
    const result = await appleDeleteEvent(
      { appleId: creds.appleId, appPassword: creds.appPassword },
      { eventUrl }
    );
    return jsonResponse(result, 200);
  } catch (err) {
    return appleErrToResponse(err);
  }
});
