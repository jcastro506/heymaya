/**
 * Shared marketing nav.
 *
 * Sprint 0: the cross-product tabs (For Creators / For Businesses) pointed at
 * `/creators` and `/business`, and the sign-up CTA sent people to
 * `/creator-maya-v0` — all deleted with the creator and service-business
 * products, so every one of them was live navigation into a 404.
 *
 * One product now, so the nav is just: home, the vibecoders landing, and the
 * mode-gated CTA (waitlist in production, sign-in/up on staging).
 *
 * Renders client-side so usePathname() can drive the active-tab highlight
 * without burning a server roundtrip.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LANDING_MODE } from "./landingMode";

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
  const isVibeCoders =
    pathname === "/vibecoders" || pathname.startsWith("/vibecoders/");

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
          <NavLink href="/vibecoders" active={isVibeCoders}>
            For VibeCoders
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
                href="/sign-up?redirect_url=/onboarding/gtm"
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
