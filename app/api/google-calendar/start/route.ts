import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Calendar connect, step one (plan §7 S2 screen 5, §12.5). Issues a single-use
 * state token bound to the signed-in creator, then sends them to Google's consent
 * screen. The callback route resolves the token back to the creator, so the same
 * flow works from Settings or from a link Maya texts.
 *
 * The redirect URI must match Google Cloud's allow-list exactly; locally that is
 * http://localhost:3000/api/google-calendar/callback (GOOGLE_CALENDAR_REDIRECT_URI).
 */
export async function GET(req: NextRequest) {
  const { userId, getToken } = await auth();
  if (!userId) return NextResponse.redirect(new URL(`/sign-in?redirect_url=${encodeURIComponent("/api/google-calendar/start")}`, req.url));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!clientId || !convexUrl) return fail(req, "not_configured");

  const clerkToken = await getToken({ template: "convex" });
  if (!clerkToken) return fail(req, "no_session");
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(clerkToken);

  let state: string;
  try {
    state = (await client.mutation(api.calendar.oauth.issueState, { returnTo: new URL(req.url).searchParams.get("return") ?? undefined })).token;
  } catch {
    return fail(req, "no_account");
  }

  const redirectUri = callbackUri(req);
  const url = await client.query(api.calendar.oauth.authUrl, { redirectUri, state });
  return NextResponse.redirect(url);
}

export function callbackUri(req: NextRequest): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? new URL("/api/google-calendar/callback", req.url).toString();
}

function fail(req: NextRequest, reason: string): NextResponse {
  const dest = new URL("/app/settings", req.url);
  dest.searchParams.set("calendar_error", reason);
  return NextResponse.redirect(dest);
}
