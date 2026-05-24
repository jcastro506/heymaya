import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Sprint 9 — GTM Calendar OAuth start route.
 *
 * Mirrors /app/api/google-calendar/start (creator path) but uses
 * Convex-stored state tokens (gtmOauthStateTokens) instead of HTTP
 * cookies, so the same flow works whether the user starts OAuth from
 * the web app, Telegram, or a future iMessage handoff. The state
 * token is single-use + 15-min TTL.
 *
 * Redirects:
 *   - unauth → /sign-in?redirect_url=<callback>
 *   - missing GOOGLE_CLIENT_ID → /onboarding/gtm?error=missing_google_client_id
 *   - happy path → Google OAuth consent screen
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.redirect(
      new URL(
        `/sign-in?redirect_url=${encodeURIComponent(
          "/onboarding/gtm?step=calendar"
        )}`,
        req.url
      )
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return redirectWithError(req, "missing_google_client_id");
  }

  // Issue a Convex-side state token bound to the caller. We don't need
  // a separate cookie — the callback resolves accountId from the token.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return redirectWithError(req, "missing_convex_url");
  }
  const client = new ConvexHttpClient(convexUrl);
  const clerkToken = await getToken({ template: "convex" });
  if (!clerkToken) {
    return redirectWithError(req, "missing_clerk_token");
  }
  client.setAuth(clerkToken);

  let stateToken: string;
  try {
    const result = await client.mutation(
      api.gtmMaya.calendarOAuth.issueGtmOauthStateToken,
      {}
    );
    stateToken = result.token;
  } catch (err) {
    console.error("[gtm-oauth-start] issueGtmOauthStateToken failed", err);
    return redirectWithError(req, "state_token_issue_failed");
  }

  const redirectUri = gtmCallbackRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: stateToken,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}

function gtmCallbackRedirectUri(req: NextRequest): string {
  const requestRedirect = new URL(
    "/api/google-calendar-gtm/callback",
    req.url
  );
  const configured = process.env.GOOGLE_CALENDAR_GTM_REDIRECT_URI;
  if (!configured) return requestRedirect.toString();
  // Honor the configured URI but keep the path consistent so
  // Google Cloud's whitelist stays simple.
  return configured;
}

function redirectWithError(req: NextRequest, error: string): NextResponse {
  const dest = new URL("/onboarding/gtm", req.url);
  dest.searchParams.set("calendar_error", error);
  return NextResponse.redirect(dest);
}
