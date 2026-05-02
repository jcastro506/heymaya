import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_COOKIE = "creator_maya_google_calendar_oauth_state";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(signInUrl(req, "/creator-maya-v0"));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return redirectWithError(req, "missing_google_client_id");
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(req),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 10 * 60,
    path: "/",
  });
  return res;
}

function googleRedirectUri(req: NextRequest): string {
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    new URL("/api/google-calendar/callback", req.url).toString()
  );
}

function redirectWithError(req: NextRequest, error: string): NextResponse {
  const url = new URL("/creator-maya-v0", req.url);
  url.searchParams.set("googleCalendar", "error");
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function signInUrl(req: NextRequest, redirectPath: string): URL {
  const url = new URL("/sign-in", req.url);
  url.searchParams.set("redirect_url", redirectPath);
  return url;
}
