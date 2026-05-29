"use client";

/**
 * Mission Control layout — the third surface (web) alongside Telegram + Google
 * Calendar. Read-mostly, mobile-friendly. Side nav on desktop, bottom nav on
 * mobile. Tabs map to the operator's data (Today / Plan / Research / Drafts /
 * Results / Account). Auth is enforced by middleware + the Convex queries
 * (which return empty without a signed-in gtm-agent identity).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  FileText,
  TrendingUp,
  Telescope,
  Settings,
} from "lucide-react";

const BASE = "/clawlaunch/mission";
const NAV = [
  { href: BASE, label: "Today", icon: Activity },
  { href: `${BASE}/plan`, label: "Plan", icon: CalendarDays },
  { href: `${BASE}/research`, label: "Research", icon: Telescope },
  { href: `${BASE}/drafts`, label: "Drafts", icon: FileText },
  { href: `${BASE}/results`, label: "Results", icon: TrendingUp },
  { href: `${BASE}/account`, label: "Account", icon: Settings },
] as const;

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === BASE) return pathname === BASE || pathname === `${BASE}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MissionLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div data-surface="mission" className="min-h-screen bg-ink text-paper">
      {/* Desktop side nav */}
      <nav className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-paper-faint/15 bg-ink px-4 py-6 lg:flex">
        <Link
          href="/clawlaunch"
          className="font-mono text-xs uppercase tracking-[0.22em] text-paper"
        >
          ClawLaunch
        </Link>
        <p className="mt-1 font-display text-lg">Mission Control</p>
        <div className="mt-8 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-paper/10 text-paper"
                    : "text-paper-dim hover:bg-paper/5 hover:text-paper"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
        <p className="mt-auto text-xs leading-relaxed text-paper-faint">
          Everything still runs through your Telegram. This is the deep view.
        </p>
      </nav>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-paper-faint/15 bg-ink/95 px-5 py-3 backdrop-blur lg:hidden">
        <Link
          href="/clawlaunch"
          className="font-mono text-xs uppercase tracking-[0.22em] text-paper"
        >
          ClawLaunch
        </Link>
        <span className="font-display text-sm">Mission Control</span>
      </header>

      {/* Content */}
      <main className="pb-24 lg:pl-56 lg:pb-0">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-paper-faint/15 bg-ink/95 backdrop-blur lg:hidden">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] ${
                active ? "text-paper" : "text-paper-faint"
              }`}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
