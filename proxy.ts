import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next 16 proxy (the file formerly called middleware). Public routes are listed
 * here and nowhere else; everything under /app requires a session. Webhooks are
 * NOT here: they are Convex HTTP routes with their own secret checks (scar tissue:
 * the Stripe webhook 404'd behind Clerk for months in the old product).
 */
const isPublic = createRouteMatcher(["/", "/privacy", "/terms", "/sign-in(.*)", "/sign-up(.*)", "/api/health"]);

export const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
