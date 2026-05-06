/**
 * Sprint 7 Slice B — iMessage-tap Google Calendar OAuth callback.
 *
 * The creator tapped a connect link Maya texted them. Their phone's
 * default browser is hitting this route — there is NO Clerk session
 * here. The state token in the query string is the only handoff: it
 * round-trips through the `oauthStateTokens` Convex table, was minted
 * by `POST /lc_maya/start_google_calendar_oauth` (single-use, 15-min
 * TTL), and resolves to the creatorId we should attach the tokens to.
 *
 * Flow:
 *   1. Read `state` + `code` from the query string.
 *   2. Exchange `code` for tokens with Google (direct OAuth — no Composio).
 *   3. Pull the lookahead events with the fresh access token.
 *   4. POST everything to `/lc_maya/complete_google_calendar_oauth` on
 *      Convex; that endpoint atomically consumes the state token and
 *      writes the connection to the creator's row.
 *
 * Failure modes (all render a minimal mobile-friendly page; this is
 * the operator's phone browser, not the app):
 *   - Missing / unknown / expired state token → "link expired"
 *   - Google denied / user cancelled         → "you cancelled"
 *   - Token exchange or storage failure       → "something went wrong"
 *
 * The success page does NOT include the app shell or "AI" terminology
 * — this is a one-shot completion screen.
 */

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

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

type LookaheadEvent = {
  providerEventId: string;
  title: string;
  description?: string;
  startMs: number;
  endMs: number;
  location?: string;
  recurring: boolean;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return renderResultPage({
      kind: "error",
      headline: "You cancelled the calendar connection",
      detail: "No worries — text Maya and she'll send a fresh link.",
    });
  }

  if (!code || !state) {
    return renderResultPage({
      kind: "error",
      headline: "That link is missing pieces",
      detail: "Part of the URL got chopped. Text Maya for a fresh link.",
    });
  }

  const convexHttpUrl = process.env.NEXT_PUBLIC_CONVEX_HTTP_URL;
  const internalSecret = process.env.WEBHOOK_INTERNAL_SECRET;
  if (!convexHttpUrl || !internalSecret) {
    return renderResultPage({
      kind: "error",
      headline: "Something went wrong",
      detail: "Calendar can't connect right now — text Maya and she'll resend the link.",
    });
  }

  // Exchange the code for tokens. Same shape as the Clerk-session
  // callback — we mirror the logic rather than import it because the
  // state-token path uses a different redirect_uri that has to match
  // Google's OAuth client config.
  let token: GoogleTokenResponse;
  try {
    token = await exchangeCode(req, code);
    if (!token.access_token) {
      throw new Error(token.error_description ?? token.error ?? "no-access-token");
    }
  } catch {
    return renderResultPage({
      kind: "error",
      headline: "Calendar didn't return a token",
      detail: "Try the connect link again — Google sometimes needs a second tap.",
    });
  }

  // Pull the lookahead window so Maya has something to plan around the
  // moment the connection lands. Non-fatal on failure: heartbeat will
  // retry the read later.
  let lookaheadEvents: LookaheadEvent[] = [];
  try {
    lookaheadEvents = (await listLookaheadEvents(token.access_token)).filter(
      (event): event is LookaheadEvent => event !== null
    );
  } catch {
    lookaheadEvents = [];
  }

  // Hand off to Convex. State token consumption + DB write happens
  // atomically inside `/lc_maya/complete_google_calendar_oauth`.
  try {
    const completionResponse = await fetch(
      `${convexHttpUrl.replace(/\/$/, "")}/lc_maya/complete_google_calendar_oauth`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: internalSecret,
          stateToken: state,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt:
            typeof token.expires_in === "number"
              ? Date.now() + token.expires_in * 1000
              : undefined,
          tokenType: token.token_type,
          scope: token.scope,
          lookaheadEvents,
        }),
      }
    );
    if (completionResponse.status === 410) {
      return renderResultPage({
        kind: "error",
        headline: "That link expired",
        detail: "Connect links last 15 minutes — text Maya for a fresh one.",
      });
    }
    if (!completionResponse.ok) {
      throw new Error(`completion-failed-${completionResponse.status}`);
    }
  } catch {
    return renderResultPage({
      kind: "error",
      headline: "We couldn't save the connection",
      detail: "Text Maya — she'll retry once the system catches up.",
    });
  }

  return renderResultPage({
    kind: "ok",
    headline: "Calendar connected",
    detail: "You can close this tab — Maya will pick it up from here.",
  });
}

async function exchangeCode(
  req: NextRequest,
  code: string
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("missing-google-oauth-env");
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
    throw new Error(body.error_description ?? body.error ?? "token-exchange-failed");
  }
  return body;
}

async function listLookaheadEvents(
  accessToken: string
): Promise<Array<LookaheadEvent | null>> {
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
  if (!response.ok) return [];
  const body = (await response.json()) as { items?: GoogleCalendarEvent[] };
  return (body.items ?? []).map(toLookaheadEvent);
}

function toLookaheadEvent(event: GoogleCalendarEvent): LookaheadEvent | null {
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
  const requestRedirect = new URL(
    "/api/google-calendar/callback-imessage",
    req.url
  );
  const configured = process.env.GOOGLE_CALENDAR_IMESSAGE_REDIRECT_URI;
  if (!configured) return requestRedirect.toString();
  const configuredUrl = new URL(configured);
  if (configuredUrl.host === req.nextUrl.host) return configuredUrl.toString();
  return requestRedirect.toString();
}

/* -------------------------------------------------------------------------- */
/* Minimal mobile result page                                                  */
/* -------------------------------------------------------------------------- */

interface ResultPageInput {
  kind: "ok" | "error";
  headline: string;
  detail: string;
}

function renderResultPage(input: ResultPageInput): NextResponse {
  const accent = input.kind === "ok" ? "#7CFFB2" : "#FFB47C";
  const status = input.kind === "ok" ? 200 : 400;
  // Deliberately no app shell, no Clerk references, no "AI" terminology.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HeyMaya — Calendar</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
        background: #0b0b0d;
        color: #f4f4f6;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      main {
        max-width: 360px;
        text-align: center;
      }
      .pill {
        display: inline-block;
        padding: 6px 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 13px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: ${accent};
        margin-bottom: 24px;
      }
      h1 {
        font-size: 28px;
        line-height: 1.2;
        margin: 0 0 16px;
      }
      p {
        font-size: 16px;
        line-height: 1.5;
        color: #b8b8c0;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="pill">${input.kind === "ok" ? "Connected" : "Heads up"}</div>
      <h1>${escapeHtml(input.headline)}</h1>
      <p>${escapeHtml(input.detail)}</p>
    </main>
  </body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
