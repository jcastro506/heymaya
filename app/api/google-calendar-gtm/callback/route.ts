import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@/convex/_generated/api";

/**
 * Sprint 9 — GTM Calendar OAuth callback route.
 *
 * Receives Google's auth code + state token. Resolves the state token →
 * accountId via Convex (atomic claim), then dispatches the code-for-tokens
 * exchange via exchangeGtmOauthCode (internal action). On success redirects
 * to /onboarding/gtm?step=research; on failure surfaces ?calendar_error=<reason>.
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return redirectWithError(req, `google_${errorParam}`);
  }
  if (!code || !state) {
    return redirectWithError(req, "missing_code_or_state");
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return redirectWithError(req, "missing_convex_url");
  const client = new ConvexHttpClient(convexUrl);
  // Internal calls — we use the same Convex deployment but the state-token
  // claim doesn't need Clerk auth (the token IS the auth).

  let accountId: string;
  try {
    const claim = await client.mutation(
      internal.gtmMaya.calendarOAuth.claimGtmOauthStateToken as never,
      { token: state } as never
    );
    accountId = (claim as { accountId: string }).accountId;
  } catch (err) {
    console.error("[gtm-oauth-callback] state claim failed", err);
    return redirectWithError(req, "bad_state_token");
  }

  const redirectUri =
    process.env.GOOGLE_CALENDAR_GTM_REDIRECT_URI ??
    new URL("/api/google-calendar-gtm/callback", req.url).toString();

  // Default to UTC for the connection's timezone; the onboarding UI
  // captures the user's tz separately and we sync it during the first
  // calendar write.
  const timezone = url.searchParams.get("tz") ?? "UTC";

  try {
    const result = await client.action(
      internal.gtmMaya.calendarOAuth.exchangeGtmOauthCode as never,
      { code, redirectUri, accountId, timezone } as never
    );
    const out = result as { ok: boolean; reason?: string };
    if (!out.ok) {
      console.error(
        "[gtm-oauth-callback] exchange failed:",
        out.reason
      );
      return redirectWithError(req, out.reason ?? "exchange_failed");
    }
  } catch (err) {
    console.error("[gtm-oauth-callback] exchange threw", err);
    return redirectWithError(req, "exchange_threw");
  }

  const dest = new URL("/onboarding/gtm", req.url);
  dest.searchParams.set("step", "research");
  dest.searchParams.set("calendar_connected", "1");
  return NextResponse.redirect(dest);
}

function redirectWithError(req: NextRequest, reason: string): NextResponse {
  const dest = new URL("/onboarding/gtm", req.url);
  dest.searchParams.set("calendar_error", reason);
  return NextResponse.redirect(dest);
}
