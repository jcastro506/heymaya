import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Next 16 proxy (the file formerly called middleware). Public routes are listed
 * here and nowhere else; everything under /app requires a session. Webhooks are
 * NOT here: they are Convex HTTP routes with their own secret checks (scar tissue:
 * the Stripe webhook 404'd behind Clerk for months in the old product).
 */
const isPublic = createRouteMatcher([
  "/ops", "/ops/(.*)", "/", "/join", "/privacy", "/terms", "/sign-in(.*)", "/sign-up(.*)", "/api/health", "/onboarding-preview", "/mission-control-preview", "/o/(.*)", "/k/(.*)"]);

// Sign-up and onboarding live in the iPhone app now (app spec §5); the old web screens send people to it.
const isRetired = createRouteMatcher(["/sign-up(.*)", "/start(.*)", "/app(.*)"]);

export const proxy = clerkMiddleware(async (auth, req) => {
  if (isRetired(req)) return NextResponse.redirect(new URL("/join?where=web", req.url));
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
