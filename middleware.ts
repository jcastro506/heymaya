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

const isPublic = createRouteMatcher([
  "/",
  "/vibecoders",
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
  "/api/clerk/webhook",
]);

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
