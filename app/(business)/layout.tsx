/**
 * Business HQ shell — shared chrome around the 6 service-side screens
 * (Today, Jobs, Reviews, Posts, Customers, Profile) per Service Sprint
 * Plan § 12.
 *
 * Layout mirrors the creator HQ shell pattern in `app/(creator)/layout.tsx`:
 *   - Desktop (>=1024px): top brand row + left side nav, content fills the rest.
 *   - Tablet  (>=640px):  top brand row + content. Side nav collapses.
 *   - Mobile  (<640px):   top brand row + content + bottom nav (thumb-zone).
 *
 * Why a route group `(business)` (not `app/business-hq/...`):
 *   Route groups don't add to the URL, so the operator's HQ sits at clean
 *   root-ish paths (/jobs, /reviews, etc.) without a /hq prefix.
 *
 *   Path divergence from spec § 12: that section names Today at
 *   `app/(business)/page.tsx` (i.e. `/`). But `app/page.tsx` is the dual-
 *   track account-type selector landing and Next.js can't have two pages
 *   resolve to the same URL. The creator HQ hit the identical issue — see
 *   `app/(creator)/layout.tsx` — and parked Today at `/today`. We mirror
 *   that here: `app/(business)/today/page.tsx`. When the lead reorganizes
 *   marketing pages into a `(marketing)` route group, Today can move back
 *   to `/`. Until then, signed-in operators land at `/today` post-deploy.
 *
 * Auth: Clerk middleware protects every URL under this layout. Sprint 0
 * just renders shell + placeholder; Sprint 4 wires real Convex queries.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Camera,
  Hammer,
  LayoutDashboard,
  Sparkles,
  Star,
  UserCircle,
  Users,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: typeof LayoutDashboard;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/biz/today", label: "Today", short: "Today", icon: LayoutDashboard },
  { href: "/biz/jobs", label: "Jobs", short: "Jobs", icon: Hammer },
  { href: "/biz/reviews", label: "Reviews", short: "Reviews", icon: Star },
  { href: "/biz/posts", label: "Posts", short: "Posts", icon: Camera },
  { href: "/biz/customers", label: "Customers", short: "People", icon: Users },
  { href: "/biz/profile", label: "Profile", short: "You", icon: UserCircle },
];

export default function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-[var(--ink)] text-paper lg:flex-row">
      {/* Desktop side nav */}
      <SideNav />

      {/* Top bar (mobile + tablet + desktop) and main scroll area */}
      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="relative z-10 flex-1 pb-24 lg:pb-12">{children}</main>
      </div>

      {/* Mobile bottom nav — sits on top of the main scroll */}
      <BottomNav />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Side nav (desktop ≥ lg)                                                     */
/* -------------------------------------------------------------------------- */

function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r border-[var(--hairline)] bg-ink-2/40 lg:flex lg:flex-col">
      <Link
        href="/biz/today"
        className="group inline-flex items-center gap-2 px-6 pt-7"
        aria-label="HeyMaya home"
      >
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
          style={{
            boxShadow:
              "0 0 0 1px rgba(214,255,61,0.3), 0 6px 24px -6px rgba(214,255,61,0.5)",
          }}
        >
          <span className="font-display text-lg leading-none">m</span>
        </span>
        <span className="font-display text-xl tracking-tight text-paper">
          HeyMaya
        </span>
        <span className="ml-1 rounded-full border border-[var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-paper-dim">
          Trades
        </span>
      </Link>

      <nav className="mt-10 flex flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-ink-3 text-paper"
                  : "text-paper-dim hover:bg-ink-3/60 hover:text-paper"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  active
                    ? "text-lime"
                    : "text-paper-faint group-hover:text-paper-dim"
                }`}
                strokeWidth={1.75}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-6 pb-7">
        <div className="rounded-2xl border border-[var(--hairline)] bg-ink-3 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-paper-faint">
            <Sparkles className="h-3.5 w-3.5 text-lime" />
            Maya · grounded
          </div>
          <p className="mt-2 text-sm text-paper-dim">
            Every completed job is a marketing moment. Maya drafts. You
            approve.
          </p>
        </div>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Top bar — minimal, present on every breakpoint                              */
/* -------------------------------------------------------------------------- */

function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--ink)]/85 px-5 py-3.5 backdrop-blur sm:px-8 lg:hidden">
      <Link href="/biz/today" className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full bg-lime text-ink"
        >
          <span className="font-display text-base leading-none">m</span>
        </span>
        <span className="font-display text-lg tracking-tight text-paper">
          HeyMaya
        </span>
        <span className="rounded-full border border-[var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-paper-dim">
          Trades
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-[11px] uppercase tracking-widest text-paper-faint sm:inline">
          Sprint 0 · shell
        </span>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Bottom nav — mobile only                                                    */
/* -------------------------------------------------------------------------- */

function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-between border-t border-[var(--hairline)] bg-[var(--ink)]/92 px-1 py-1.5 backdrop-blur lg:hidden"
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-mono uppercase tracking-wider ${
              active ? "text-lime" : "text-paper-faint"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Active-segment match. Plain string match because route group doesn't show
 * up in the URL and our nav items are root-ish paths.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  // Treat `/biz/today` as default if the operator lands at bare `/biz`.
  // (Next.js will 404 on `/biz` since there's no page.tsx at that path —
  // this is just defensive in case Sprint 4 adds a redirect there.)
  if (
    href === "/biz/today" &&
    (pathname === "/biz" || pathname === "/biz/")
  ) {
    return true;
  }
  return false;
}
