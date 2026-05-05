import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Creator-product feature flag.
 *
 * The service-business product is the only public surface in v0. The creator
 * product is preserved-but-hidden behind `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT`:
 *
 *   - flag === "true"  → dual-track behavior: `/` is the account-type picker,
 *                        `/creators`, `/onboarding/maya`, and the creator HQ
 *                        screens (`/today`, `/performance`, `/plan`,
 *                        `/trends`, `/deals`, `/profile`) all render normally.
 *   - flag !== "true"  → service-only: every creator surface 308-redirects to
 *                        the matching service surface. `/` itself is rewritten
 *                        in `app/page.tsx` (server-rendered service landing,
 *                        no hop). All creator code, tests, schema, and Convex
 *                        functions stay untouched — re-enabling is one env flip.
 *
 * Why 308 (Permanent Redirect, method-preserving):
 *   - Signals to crawlers that the creator URLs aren't the canonical home for
 *     v0 without burning the URL itself (we may un-suppress later).
 *   - Preserves POST/etc. — though all redirected paths here are GETs, this
 *     keeps the door open for any future flow that might POST to a creator URL.
 *
 * IMPORTANT: read at module-eval time. Next.js inlines `NEXT_PUBLIC_*` env at
 * build time for client bundles, but middleware runs server-side at request
 * time, so this picks up the deployed env without a rebuild flip.
 */
const CREATOR_PRODUCT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true";

/**
 * URL-path → service-equivalent redirect targets. These are URL paths the
 * creator product renders at, NOT route-group filesystem paths. e.g. the
 * creator HQ lives in `app/(creator)/today/page.tsx` but resolves to `/today`.
 */
const CREATOR_HQ_PREFIXES = [
  "/today",
  "/performance",
  "/plan",
  "/trends",
  "/deals",
  "/profile",
] as const;

const isPublic = createRouteMatcher([
  "/",
  "/creators",
  "/creator-maya-v0(.*)",
  "/business",
  "/business-maya-v0(.*)",
  "/growth",
  "/privacy",
  "/terms",
  "/tiktok9iwZOtsyHO9kZG4DFCD2AMpXjKs4jtyO.txt",
  "/account/delete",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/clerk/webhook",
  "/api/google-calendar/start",
  "/api/google-calendar/callback",
  "/api/account/delete/request-from-imessage",
  "/api/account/delete/from-imessage",
]);

export default clerkMiddleware(async (auth, req) => {
  // Feature-flag gate runs BEFORE auth.protect() so unauth visitors hitting
  // creator URLs get redirected to /business (a public route) instead of
  // /sign-in (which would land them in a flow that ultimately routes to
  // creator HQ once Clerk completes).
  if (CREATOR_PRODUCT_ENABLED) {
    // When the creator product is the active surface, the bare root URL
    // is the creator landing. /business stays available for visitors who
    // explicitly came for the service product. Future: `/` becomes a
    // proper split-router with both products visible side-by-side; for
    // now we route to the creator landing because that's the active focus.
    if (req.nextUrl.pathname === "/") {
      const dest = new URL("/creators", req.url);
      return NextResponse.redirect(dest, 307);
    }
  }
  if (!CREATOR_PRODUCT_ENABLED) {
    const { pathname, search } = req.nextUrl;

    // /creators (and any future sub-paths like /creators/case-studies) → /business
    if (pathname === "/creators" || pathname.startsWith("/creators/")) {
      const dest = new URL("/business", req.url);
      return NextResponse.redirect(dest, 308);
    }

    // /onboarding/maya (creator's conversational onboarding) → /onboarding/business
    if (pathname === "/onboarding/maya" || pathname.startsWith("/onboarding/maya/")) {
      const dest = new URL("/onboarding/business", req.url);
      return NextResponse.redirect(dest, 308);
    }

    // Creator HQ paths → /business (signed-in service operators get sent
    // to the marketing landing for now; Sprint 1 wires `/biz/today` redirect).
    for (const prefix of CREATOR_HQ_PREFIXES) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        const dest = new URL("/business", req.url);
        return NextResponse.redirect(dest, 308);
      }
    }

    // Bare /onboarding (no track suffix) → service onboarding. The creator
    // flow is the only thing that ever lived at /onboarding/maya, so a hit
    // on bare /onboarding while flag is off is treated as a service intent.
    if (pathname === "/onboarding") {
      const dest = new URL("/onboarding/business", req.url);
      return NextResponse.redirect(dest, 308);
    }

    // Suffix `?from=creator-suppressed` so analytics can attribute redirects.
    // (Disabled by default — comment back in if needed for funnel debugging.)
    // dest.searchParams.set("from", "creator-suppressed");
    void search; // suppress unused-binding lint while the analytics flag is off
  }

  if (!isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
