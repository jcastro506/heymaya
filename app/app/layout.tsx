"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OfflineBanner } from "../offline";

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
    <div className="min-h-dvh max-w-md mx-auto flex flex-col">
      <OfflineBanner />
      <main className="flex-1 p-5 pb-24">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/90 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <ul className="max-w-md mx-auto grid grid-cols-6">
          {TABS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className={`block text-center py-3 text-xs ${path?.startsWith(t.href) ? "text-emerald-400" : "opacity-60"}`}>{t.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
