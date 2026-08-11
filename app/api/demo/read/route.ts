import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { createHash } from "node:crypto";
import { api } from "@/convex/_generated/api";

/**
 * ⭐ The pre-signup demo's public door (§18.9.2, Sprint 11).
 *
 * Sprint 11's exit is *"without signing up"*, so this is the one endpoint in
 * the product that is genuinely open. Everything that makes that safe —
 * routability, per-IP limit, global spend cap, cache — lives in
 * `convex/maya/demo.ts`. This layer does one thing the Convex action cannot:
 * it can see the caller's IP.
 */

export const runtime = "nodejs";

/**
 * ⚠️ The raw IP never reaches a Convex row.
 *
 * A rate limiter only needs to know "same visitor or not", which a hash
 * answers. Storing the address itself would put personal data in a table that
 * exists to count requests — and one salted with a server-side secret can't be
 * reversed by anyone reading the rows.
 */
function ipKeyOf(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  // Left-most is the client; the rest are proxies we added.
  const ip = forwarded.split(",")[0].trim() || "unknown";
  const salt = process.env.DEMO_IP_SALT ?? process.env.RENDER_SHARED_SECRET ?? "";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

export async function POST(request: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, detail: "expected JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json(
      { ok: false, detail: "paste your site's address and I'll read it" },
      { status: 400 }
    );
  }
  /**
   * A cheap length bound before anything else touches it. The action validates
   * properly; this just stops an absurd payload reaching it.
   */
  if (url.length > 2048) {
    return NextResponse.json(
      { ok: false, detail: "that address is too long to be real" },
      { status: 400 }
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("[demo] NEXT_PUBLIC_CONVEX_URL is not set");
    return NextResponse.json(
      { ok: false, detail: "the demo is having a moment — try again shortly" },
      { status: 503 }
    );
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const secret = process.env.DEMO_SHARED_SECRET ?? "";
    const result = await client.action(api.maya.demo.readPublic, {
      url,
      ipKey: ipKeyOf(request),
      secret,
    });
    /**
     * ⚠️ Always HTTP 200, even when the read failed.
     *
     * `ok: false` here is an ANSWER — "that page needs a login", "that page
     * loads with JavaScript" — not an error. Returning 4xx would make the
     * browser treat a useful, honest response as a failure and show a generic
     * message instead of the specific one, which is the whole value.
     */
    return NextResponse.json(result, {
      // A shared cache must never serve one visitor's read to another under a
      // different rate-limit identity.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(`[demo] read failed: ${String(error)}`);
    return NextResponse.json(
      { ok: false, detail: "couldn't read that just now — try again in a moment" },
      { status: 200 }
    );
  }
}
