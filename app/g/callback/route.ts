import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/** Google's answer for a Gmail link (2026-10-21): store the connection on the backend, then a plain page. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const code = q.get("code"), state = q.get("state");
  let outcome = "failed";
  if (q.get("error")) outcome = "denied";
  else if (code && state && process.env.NEXT_PUBLIC_CONVEX_URL) {
    outcome = await new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL).action(api.partnerships.mailbox.finishLink, { code, state }).then(() => "connected", () => "failed");
  }
  const res = NextResponse.redirect(new URL(`/g/done?state=${outcome}`, req.url), 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
