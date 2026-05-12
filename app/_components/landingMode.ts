/**
 * Landing-mode helper.
 *
 * Default: "waitlist". Both products are pre-launch on production, so
 * every primary CTA on a marketing landing (nav, hero, pricing, final
 * CTA) collapses to "Join the Waitlist" → /waitlist (Convex-backed form
 * at `convex/waitlist/mayaProductWaitlist.ts`).
 *
 * Staging / dev opt-in: set NEXT_PUBLIC_HEYMAYA_LANDING_MODE=signup to
 * restore the /checkout + /sign-up CTAs for onboarding test creators
 * against the staging Convex deployment. Any other value (or unset)
 * falls through to waitlist mode.
 *
 * Read at module-eval time — Next.js inlines NEXT_PUBLIC_* into the
 * client bundle, so a build is required to flip the mode.
 */
export type LandingMode = "waitlist" | "signup";

export const LANDING_MODE: LandingMode =
  process.env.NEXT_PUBLIC_HEYMAYA_LANDING_MODE === "signup"
    ? "signup"
    : "waitlist";

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
