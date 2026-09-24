import { NextRequest, NextResponse } from "next/server";

const ATTRIBUTION_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"]);

/** Branded QR/campaign entrance. Attribution survives the Clerk and Stripe redirects. */
export function GET(request: NextRequest) {
  const destination = new URL("/sign-up", request.url);
  const response = NextResponse.redirect(destination);
  const attribution: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (ATTRIBUTION_KEYS.has(key) && value.length <= 160) attribution[key] = value;
  }
  if (Object.keys(attribution).length > 0) {
    response.cookies.set("maya_attribution", JSON.stringify(attribution), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }
  return response;
}
