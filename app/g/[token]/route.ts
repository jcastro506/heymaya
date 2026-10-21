import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Connect Gmail from a text (2026-10-21): Maya's one-time link lands here and goes straight to Google's consent
 * page. Public in proxy.ts: the token is the credential, spent only at /g/callback, so a link preview fetching
 * this page never uses it up. A used, expired or unknown link lands on /g/done with a plain reason.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const backendUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const r = backendUrl ? await new ConvexHttpClient(backendUrl).query(api.partnerships.mailbox.linkTarget, { token }).catch(() => null) : null;
  const to = r?.ok ? r.url : new URL(`/g/done?state=${r ? r.reason : "failed"}`, req.url);
  const res = NextResponse.redirect(to, 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
