/**
 * Shared marketing nav.
 *
 * Used on every public landing (/, /creators, /business, /waitlist) so
 * cross-product navigation is always visible. Active route gets a subtle
 * highlight; the rightmost CTA is mode-gated by the shared
 * `LANDING_MODE` helper:
 *
 *   - waitlist (production default): "Join the Waitlist"
 *   - signup   (staging opt-in):    "Sign in" + "Sign up"
 *
 * The creator product is the single public surface (`/` always renders the
 * creator landing; the discontinued trades landing at `/business`
 * redirects home). A second "For VibeCoders" vertical is in planning and
 * will add its own tab when it ships.
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
  const isCreators =
    pathname === "/" ||
    pathname === "/creators" ||
    pathname.startsWith("/creators/");

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
