import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_COOKIE = "creator_maya_google_calendar_oauth_state";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithError(req, "invalid_google_oauth_state");
  }

  const { getToken, userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(signInUrl(req));
  }

  try {
    const token = await exchangeCode(req, code);
    if (!token.access_token) {
      throw new Error(token.error_description ?? token.error ?? "missing access token");
    }

    const events = await listLookaheadEvents(token.access_token);
    const convexToken = await getToken({ template: "convex" });
    if (!convexToken) {
      throw new Error("missing Convex auth token");
    }

    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(convexToken);
    const result = await convex.mutation(
      api.creatorMayaV0.backend.storeGoogleCalendarOAuthConnection,
      {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt:
          typeof token.expires_in === "number"
            ? Date.now() + token.expires_in * 1000
            : undefined,
        tokenType: token.token_type,
        scope: token.scope,
        lookaheadEvents: events,
      }
    );

    const next = new URL("/creator-maya-v0", req.url);
    next.searchParams.set("googleCalendar", "connected");
    next.searchParams.set("imported", String(result.lookaheadImported));
    const res = NextResponse.redirect(next);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (error) {
    const next = redirectWithError(
      req,
      error instanceof Error ? error.message : "google_calendar_callback_failed"
    );
    next.cookies.delete(STATE_COOKIE);
    return next;
  }
}

async function exchangeCode(
  req: NextRequest,
  code: string
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("missing Google OAuth client env");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(req),
    }),
  });
  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(body.error_description ?? body.error ?? "Google token exchange failed");
  }
  return body;
}

async function listLookaheadEvents(accessToken: string) {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar list failed: ${response.status} ${text.slice(0, 160)}`);
  }
  const body = (await response.json()) as { items?: GoogleCalendarEvent[] };
  return (body.items ?? []).map(toLookaheadEvent).filter((event) => event !== null);
}

function toLookaheadEvent(event: GoogleCalendarEvent) {
  const startMs = calendarTimeToMs(event.start);
  const endMs = calendarTimeToMs(event.end);
  if (!event.id || startMs === null || endMs === null) return null;
  return {
    providerEventId: event.id,
    title: event.summary ?? "Untitled calendar event",
    description: event.description,
    startMs,
    endMs,
    location: event.location,
    recurring: Boolean(event.recurringEventId),
  };
}

function calendarTimeToMs(time: { dateTime?: string; date?: string } | undefined) {
  const raw = time?.dateTime ?? time?.date;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function googleRedirectUri(req: NextRequest): string {
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    new URL("/api/google-calendar/callback", req.url).toString()
  );
}

function redirectWithError(req: NextRequest, error: string): NextResponse {
  const next = new URL("/creator-maya-v0", req.url);
  next.searchParams.set("googleCalendar", "error");
  next.searchParams.set("error", error.slice(0, 180));
  return NextResponse.redirect(next);
}

function signInUrl(req: NextRequest): URL {
  const url = new URL("/sign-in", req.url);
  url.searchParams.set(
    "redirect_url",
    `${req.nextUrl.pathname}${req.nextUrl.search}`
  );
  return url;
}
