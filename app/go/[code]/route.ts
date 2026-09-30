import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * A post from her engagement text (engage/links): note the open, then forward to the post. Public in
 * proxy.ts, and deliberately outside /o/* and /app/*, which the app claims (a claimed path would open
 * Maya instead of TikTok or Instagram). An unknown code, or the backend being down, lands on the home page.
 */
export const dynamic = "force-dynamic";

async function forward(req: NextRequest, code: string, count: boolean): Promise<NextResponse> {
  const backendUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const r = backendUrl
    ? await new ConvexHttpClient(backendUrl).mutation(api.engage.links.open, { code, userAgent: req.headers.get("user-agent") ?? undefined, count }).catch(() => null)
    : null;
  const res = NextResponse.redirect(r?.url ?? new URL("/", req.url), 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  return forward(req, (await params).code, true);
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  return forward(req, (await params).code, false);
}
