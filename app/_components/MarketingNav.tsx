/**
 * Sprint 12.5 — shared marketing nav.
 *
 * Used on every public landing (/, /creators, /business, /waitlist) so
 * the cross-product navigation is always visible. Active route gets a
 * subtle highlight; the rightmost CTA is mode-gated:
 *
 *   - LANDING_MODE === "waitlist" (production): "Join the Waitlist"
 *   - LANDING_MODE === "signup"  (default / staging): "Sign in" + "Sign up"
 *     so we can keep onboarding test creators against staging Convex.
 *
 * Renders client-side so we can read the current path with usePathname()
 * for the active-tab highlight without burning a server roundtrip.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type LandingMode = "waitlist" | "signup";
const LANDING_MODE: LandingMode =
  (process.env.NEXT_PUBLIC_HEYMAYA_LANDING_MODE as LandingMode | undefined) ===
  "waitlist"
    ? "waitlist"
    : "signup";

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "transition-colors " +
        (active ? "text-paper" : "text-paper-dim hover:text-paper")
      }
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

export function MarketingNav() {
  const pathname = usePathname() ?? "/";
  const isCreators = pathname === "/creators" || pathname.startsWith("/creators/");
  const isBusiness = pathname === "/business" || pathname.startsWith("/business/");

  return (
    <header className="relative z-20 px-6 pt-6 sm:px-10 sm:pt-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link
          href="/"
          className="font-display text-xl tracking-tight text-paper"
          aria-label="HeyMaya home"
        >
          HeyMaya
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <NavLink href="/creators" active={isCreators}>
            For Creators
          </NavLink>
          <NavLink href="/business" active={isBusiness}>
            For Businesses
          </NavLink>
          {LANDING_MODE === "waitlist" ? (
            <Link
              href="/waitlist"
              className="inline-flex min-h-10 items-center rounded-md bg-paper px-4 text-sm font-medium text-black transition hover:bg-white"
            >
              Join the Waitlist
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="text-paper-dim hover:text-paper">
                Sign in
              </Link>
              <Link
                href="/sign-up?redirect_url=/creator-maya-v0"
                className="inline-flex min-h-10 items-center rounded-md bg-paper px-4 text-sm font-medium text-black transition hover:bg-white"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
