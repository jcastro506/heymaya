import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Route auth.
 *
 * Sprint 0 removed the creator-suppression apparatus that used to live here.
 * It 308-redirected `/creators/*`, `/onboarding/maya` and the creator HQ paths
 * to `/business` and `/onboarding/business` — routes that no longer exist, so
 * every one of those redirects now lands on a 404. Both products behind it
 * (Creator Maya, Maya for service businesses) were deleted, along with the
 * `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` flag that gated them.
 *
 * What's left is the real job: decide which routes are public, and force auth
 * on Mission Control.
 */

// Mission Control (the signed-in operator UI) lives under /clawlaunch, which is
// otherwise public marketing — so it needs an explicit auth gate.
const isMissionControl = createRouteMatcher(["/clawlaunch/mission(.*)"]);

/**
 * ⭐ Routes reached by a machine, never a browser — each gated by its own
 * credential, and each therefore required to be public *at the Clerk layer*.
 *
 * Exported so a test can assert every one of them is actually listed below.
 * The whole point of this file's failure mode is that a missing entry is
 * indistinguishable from a route that doesn't exist, so "we remembered" is not
 * a mechanism. Adding a server-to-server route means adding it here, and the
 * test fails until it is also public.
 */
/**
 * ⭐ Browser-called AND unauthenticated — the demo, and only the demo.
 *
 * A third category, because the existing two don't describe it. Server-to-
 * server routes carry their own credential; browser-called routes carry a Clerk
 * session. This carries neither: Sprint 11's exit is explicitly *"without
 * signing up"*, so a stranger with no account must reach it.
 *
 * ⚠️ Kept separate from `SERVER_TO_SERVER_ROUTES` rather than folded in, so the
 * list of things reachable by an anonymous stranger is one short, readable
 * array. Its guards — SSRF, per-IP limit, global spend cap — live in
 * `convex/maya/demo.ts`, and nothing else belongs here without the same.
 */
export const PUBLIC_BROWSER_ROUTES = ["/api/demo/read"] as const;

export const SERVER_TO_SERVER_ROUTES = [
  /** Clerk user lifecycle → Convex. Verifies a Svix signature. */
  "/api/clerk/webhook",
  /** Stripe billing events. Verifies an HMAC over the raw body. */
  "/api/billing/stripe-webhook",
  /** Convex → SVG rasteriser. Verifies a bearer token. */
  "/api/render/slide",
] as const;

export const PUBLIC_ROUTES = [
  "/",
  "/vibecoders",
  /**
   * ⚠️ The demo block's own page. Public for the same reason the endpoint is:
   * Sprint 11's exit is "without signing up", and Clerk answers an unlisted
   * page with 404 — so a marketing surface left off this list is invisible in
   * exactly the way a broken deploy is.
   */
  "/demo",
  /**
   * ⭐ The on-ramp (§18.9.25 ①②③), and it MUST be public.
   *
   * §6.0: the live read "delivers value **before** asking for anything — which
   * is what makes the pairing ask convert." Gate this route and the read moves
   * behind signup, which inverts the one design decision the whole flow is
   * built on. The page is public; the mutations it calls
   * (`onramp.startFromRead`, `pairing.createPairingLink`) each require an
   * identity of their own, so "public" here means the door, not the safe.
   */
  "/start",
  "/waitlist",
  "/builders",
  "/clawlaunch(.*)",
  // Founder God-view — gated server-side by ADMIN_DASH_TOKEN (the Convex
  // queries fail closed without it). No Clerk role exists for this, so the
  // route is "public" at the middleware layer and the token IS the gate.
  "/founder(.*)",
  "/privacy",
  "/terms",
  "/tiktok9iwZOtsyHO9kZG4DFCD2AMpXjKs4jtyO.txt",
  "/account/delete",
  "/sign-in(.*)",
  "/sign-up(.*)",
  /**
   * ⚠️ Server-to-server callers, each gated by its OWN credential.
   *
   * "Public" here means *Clerk does not gate it* — not that it is open. Every
   * entry below rejects an unauthenticated request itself, and none of them can
   * ever carry a Clerk session because no browser is involved.
   *
   * This distinction is load-bearing because `auth.protect()` answers an
   * unauthenticated API request with **404, not 401** — deliberately, so it
   * doesn't leak which routes exist. The consequence is that a missing entry
   * here looks exactly like a route that was never deployed: the handler never
   * runs, nothing is logged, and the caller sees a plain Next.js 404 page.
   *
   * Two were missing, and both were invisible for the same reason.
   *
   * `stripe-webhook` has NEVER been listed — `git log -S` finds no commit that
   * ever added it. It survived only because no real subscription has been
   * processed yet: the first paying customer's `checkout.session.completed`
   * would have 404'd, Stripe would have retried for three days and given up,
   * and the account would sit unactivated with the payment taken. It verifies
   * its own HMAC over the raw body, which is a stronger gate than a session.
   *
   * `render/slide` is called by Convex with a bearer token and would have
   * failed the same way the moment anything tried to render a carousel.
   */
  ...SERVER_TO_SERVER_ROUTES,
  ...PUBLIC_BROWSER_ROUTES,
];

const isPublic = createRouteMatcher(PUBLIC_ROUTES);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req) || isMissionControl(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|mov|webm|m4v)).*)",
    "/(api|trpc)(.*)",
  ],
};
