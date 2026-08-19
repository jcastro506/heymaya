"use client";

/**
 * Mission Control layout — the web receipt for a manager who lives in your
 * Telegram. Four tabs, one founder question each, plus a settings gear:
 *
 *   Today    → what needs me, and what is she doing right now?
 *   Results  → is it working? (signups, not likes)
 *   Brain    → what does she know and believe, and can I correct it?
 *   Activity → the live play-by-play + our conversation
 *
 * Phone-first: floating bottom tab bar on mobile, side rail on desktop,
 * gear top-right. Everything below subscribes to Convex live queries, so
 * Maya's writes stream straight into the page.
 */

import "./mission.css";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  CalendarDays,
  Clapperboard,
  ScrollText,
  Brain,
  Settings,
  Sun,
  TrendingUp,
} from "lucide-react";

const BASE = "/clawlaunch/mission";

const NAV = [
  { href: BASE, label: "Today", icon: Sun },
  /**
   * ⭐ Videos sits second, above Results. It is the artifact the founder is
   * paying for, and on a UGC product it is the thing they open this to see.
   */
  { href: `${BASE}/videos`, label: "Videos", icon: Clapperboard },
  { href: `${BASE}/results`, label: "Results", icon: TrendingUp },
  { href: `${BASE}/brain`, label: "Brain", icon: Brain },
  /**
   * ⚠️ Activity removed 2026-08-19 — see app/clawlaunch/mission/activity.
   * v2 activity IS the placement ledger, already Today's ticker and the Videos
   * screen; a separate feed is the activity theatre §12 rules out.
   */
  /**
   * ⭐ §16.2 gives House Rules a top-level slot even though it isn't data:
   * seeing your own sentences listed back with dates is "the single cheapest
   * trust-building screen in the product."
   */
  { href: `${BASE}/house-rules`, label: "Rules", icon: ScrollText },
  /**
   * ⚠️ PLAN WAS BUILT AND UNREACHABLE. §16.75 restored the screen with the
   * argument that cutting it "was wrong: the strategy is the most interesting
   * thing she produces, and it's invisible" — and then it was left out of this
   * array, so it stayed invisible. A route with no link is a screen nobody
   * sees, and unlike the other five off-nav routes (which are deliberate v3-IA
   * redirects) this one renders real content.
   */
  { href: `${BASE}/plan`, label: "Plan", icon: CalendarDays },
] as const;

const SETTINGS_HREF = `${BASE}/settings`;

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === BASE) return pathname === BASE || pathname === `${BASE}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MissionLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const settingsActive = isActive(pathname, SETTINGS_HREF);

  return (
    <div data-surface="mission" className="min-h-screen bg-ink text-paper">
      {/* ── Desktop side rail ─────────────────────────────────────────── */}
      <nav className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-paper-faint/15 bg-ink px-4 py-6 lg:flex">
        <Link
          href="/clawlaunch"
          className="px-3 font-mono text-[11px] uppercase tracking-[0.24em] text-paper transition-opacity hover:opacity-75"
        >
          HeyMaya
        </Link>
        <p className="mt-1 px-3 font-display text-xl">Mission Control</p>

        <div className="mt-9 flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-paper/8 text-paper"
                    : "text-paper-dim hover:bg-paper/5 hover:text-paper"
                }`}
              >
                <span
                  className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-lime transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                <Icon
                  className={`size-4 transition-colors ${
                    active
                      ? "text-lime"
                      : "text-paper-faint group-hover:text-paper-dim"
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col gap-4">
          <Link
            href={SETTINGS_HREF}
            aria-label="Settings"
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              settingsActive
                ? "bg-paper/8 text-paper"
                : "text-paper-dim hover:bg-paper/5 hover:text-paper"
            }`}
          >
            <Settings
              className={`size-4 ${settingsActive ? "text-lime" : "text-paper-faint"}`}
            />
            Settings
          </Link>
          <p className="px-3 text-xs leading-relaxed text-paper-faint">
            Everything still runs through your Telegram. This is the deep view.
          </p>
        </div>
      </nav>

      {/* ── Mobile top bar ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-paper-faint/15 bg-ink/90 px-5 py-3 backdrop-blur-md lg:hidden">
        <Link
          href="/clawlaunch"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-paper"
        >
          HeyMaya
        </Link>
        <Link
          href={SETTINGS_HREF}
          aria-label="Settings"
          className={`-mr-2 rounded-full p-2 transition-colors ${
            settingsActive ? "text-lime" : "text-paper-dim hover:text-paper"
          }`}
        >
          <Settings className="size-5" />
        </Link>
      </header>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <main className="lg:pl-60">{children}</main>

      {/* ── Mobile floating tab bar ───────────────────────────────────── */}
      <nav
        className="fixed inset-x-4 bottom-4 z-20 flex rounded-2xl border border-paper-faint/20 bg-ink-2/90 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-1 rounded-2xl py-2.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                active ? "mc-tab-active text-paper" : "text-paper-faint"
              }`}
            >
              <Icon className={`size-5 ${active ? "text-lime" : ""}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
