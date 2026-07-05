/**
 * Creator HQ shell — shared chrome around the 6 screens (Today, Performance,
 * Plan, Trends, Deals, Profile).
 *
 * Layout:
 *   - Desktop (>=1024px): top brand row + left side nav, content fills the rest.
 *   - Tablet  (>=640px):  top brand row + content. Side nav collapses.
 *   - Mobile  (<640px):   top brand row + content + bottom nav (thumb-zone).
 *
 * Why a route group `(creator)` (not `app/dashboard/...`):
 *   The Sprint 4 spec calls for `app/(creator)/page.tsx` for Today. Route
 *   groups don't add to the URL, so the creator's HQ sits at clean root-ish
 *   paths (/today, /performance, etc.) without a /dashboard prefix.
 *
 *   The literal spec says Today should be at `/`, but `app/page.tsx` is the
 *   marketing landing — and the Sprint 4 prompt explicitly says don't import
 *   or refactor the landing page. So Today lives at `/today` for v0; the
 *   lead can either (a) redirect signed-in users from `/` → `/today` in the
 *   middleware or (b) move the landing under `(marketing)/` later.
 *
 * Auth: every URL under this layout is protected by `proxy.ts` — Clerk
 * redirects unauth visitors to /sign-in. The layout itself doesn't need an
 * extra auth gate; the queries each fail-closed if `getUserIdentity()` is
 * null.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { UserButton } from "@clerk/nextjs";
import {
  CalendarDays,
  Handshake,
  LayoutDashboard,
  LineChart,
  Sparkles,
  TrendingUp,
  UserCircle,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: typeof LayoutDashboard;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/today", label: "Today", short: "Today", icon: LayoutDashboard },
  { href: "/performance", label: "Performance", short: "Stats", icon: LineChart },
  { href: "/plan", label: "Plan", short: "Plan", icon: CalendarDays },
  { href: "/trends", label: "Trends", short: "Trends", icon: TrendingUp },
  { href: "/deals", label: "Deals", short: "Deals", icon: Handshake },
  { href: "/profile", label: "Profile", short: "You", icon: UserCircle },
];

export default function CreatorLayout({
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
        href="/today"
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
                  active ? "text-lime" : "text-paper-faint group-hover:text-paper-dim"
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
            Push, don&rsquo;t pull. The dashboard is your receipt — Maya pings
            you when something matters.
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
  const me = useQuery(api.creators.me);
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--ink)]/85 px-5 py-3.5 backdrop-blur sm:px-8 lg:hidden">
      <Link href="/today" className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full bg-lime text-ink"
        >
          <span className="font-display text-base leading-none">m</span>
        </span>
        <span className="font-display text-lg tracking-tight text-paper">
          HeyMaya
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <span className="hidden font-mono text-[11px] uppercase tracking-widest text-paper-faint sm:inline">
          {me?.plan ? `${me.plan} plan` : "—"}
        </span>
        <UserButton
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
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
 * Active-segment match. Exact match is the common case; we also treat the
 * Today route as a "default" fallback for the bare root in case the lead
 * later wires `/` → `/today` redirect.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  if (href === "/today" && (pathname === "/" || pathname === "")) return true;
  return false;
}
