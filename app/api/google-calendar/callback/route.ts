import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Calendar connect, step two. Google returns `code` and our `state`. The state
 * token is the authentication here (single use, 15 minutes, bound to one creator),
 * so this route needs no Clerk session: the exchange happens server-side in a
 * Convex action that claims the token, trades the code, encrypts the bundle and
 * schedules the first sync. A denied consent lands back on Settings with a reason.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied) return fail(req, denied === "access_denied" ? "denied" : `google_${denied}`);
  if (!code || !state) return fail(req, "missing_code");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return fail(req, "not_configured");
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? new URL("/api/google-calendar/callback", req.url).toString();

  const client = new ConvexHttpClient(convexUrl);
  const result = await client.action(api.calendar.oauth.exchange, { code, state, redirectUri }).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message.slice(0, 120) : "exchange_threw" }));
  if (!result.ok) return fail(req, result.reason);

  const dest = new URL(result.returnTo ?? "/app/settings", req.url);
  dest.searchParams.set("calendar", "connected");
  return NextResponse.redirect(dest);
}

function fail(req: NextRequest, reason: string): NextResponse {
  const dest = new URL("/app/settings", req.url);
  dest.searchParams.set("calendar_error", reason);
  return NextResponse.redirect(dest);
}
