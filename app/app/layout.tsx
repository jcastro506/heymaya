"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OfflineBanner } from "../offline";
import { Flower } from "../onboarding/Shell";
import "./mission-control.css";

const TABS = [
  { href: "/app/today", label: "Today" },
  { href: "/app/ideas", label: "Ideas" },
  { href: "/app/lane", label: "Lane" },
  { href: "/app/results", label: "Results" },
  { href: "/app/plan", label: "Plan" },
  { href: "/app/settings", label: "Settings" },
];

/** The thin UI shell (plan §7 S4): six tabs, mobile-first, the chat is elsewhere. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="maya-control">
      <OfflineBanner />
      <header className="control-header">
        <Link href="/app/today" className="control-brand" aria-label="Maya Mission Control"><Flower />maya</Link>
        <div className="control-title"><span className="control-dot" aria-hidden="true" />Mission Control</div>
      </header>
      <main className="control-main">{children}</main>
      <nav className="control-nav" aria-label="Mission Control">
        <ul>
          {TABS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} aria-current={path?.startsWith(t.href) ? "page" : undefined}>{t.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
