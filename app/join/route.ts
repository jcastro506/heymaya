import { NextRequest, NextResponse } from "next/server";
import { appLink, campaignToken, joinDestination } from "@/lib/appLink";

const ATTRIBUTION_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "where"]);

/**
 * Every "Get the app" tap and every QR code lands here (W1, app spec §5.4). It records the
 * campaign, then sends the visitor to the App Store with Apple's campaign token, to the
 * TestFlight beta before the listing is live, or to the web sign-up while neither exists.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const link = appLink();
  const campaign = campaignToken(params.get("utm_campaign") ?? params.get("ref") ?? params.get("where"));
  const target = joinDestination(link, campaign);
  const response = NextResponse.redirect(link.kind === "none" ? new URL(target, request.url) : target);
  const attribution: Record<string, string> = {};
  for (const [key, value] of params) {
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
