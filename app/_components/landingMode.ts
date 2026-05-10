/**
 * Sprint 12.5 — landing-mode helper.
 *
 * Production (heymaya.com): mode = "waitlist". The creator product is
 * pre-launch, so every signup/checkout CTA on a marketing landing should
 * point to /waitlist instead of /checkout or /sign-up.
 *
 * Staging / preview / dev: mode = "signup" (default). Keeps the
 * /checkout?tier=… and /sign-up CTAs live so we can keep onboarding
 * test creators against the staging Convex deployment.
 *
 * Toggled by NEXT_PUBLIC_HEYMAYA_LANDING_MODE in Vercel env. Read at
 * module-eval time — Next.js inlines NEXT_PUBLIC_* into the client
 * bundle, so a build is required to flip the mode.
 */
export type LandingMode = "waitlist" | "signup";

export const LANDING_MODE: LandingMode =
  (process.env.NEXT_PUBLIC_HEYMAYA_LANDING_MODE as LandingMode | undefined) ===
  "waitlist"
    ? "waitlist"
    : "signup";

/**
 * The href every "primary CTA" on a marketing landing should point at.
 * Signup mode honors the caller's preferred destination (e.g. checkout
 * with tier query). Waitlist mode collapses to /waitlist.
 */
export function primaryCtaHref(signupHref: string): string {
  return LANDING_MODE === "waitlist" ? "/waitlist" : signupHref;
}

/**
 * The label every "primary CTA" should render. Signup mode uses the
 * caller's preferred label ("Start 7 days free", "Hire Maya"); waitlist
 * mode collapses to "Join the Waitlist".
 */
export function primaryCtaLabel(signupLabel: string): string {
  return LANDING_MODE === "waitlist" ? "Join the Waitlist" : signupLabel;
}
