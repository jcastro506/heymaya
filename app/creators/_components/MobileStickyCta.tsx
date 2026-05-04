"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/**
 * Mobile-only sticky bottom CTA. Hidden on md+ so the in-flow CTAs do the work.
 *
 * Defaults to tier=manager + monthly because both tiers ship the same 7-day
 * trial and Manager is the headline experience. The checkout route accepts
 * tier overrides via query string.
 *
 * Tap target: 56px tall (above the 48px floor) with safe-area inset padding so
 * the button never sits underneath an iOS home indicator.
 */
export function MobileStickyCta() {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--hairline-strong)] bg-ink/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-col">
          <span className="font-display text-[15px] leading-tight text-paper">
            Try Maya for 7 days
          </span>
          <span className="text-[11px] text-paper-faint">
            No card needed. Cancel anytime.
          </span>
        </div>
        <Link
          href="/checkout?tier=manager&interval=monthly"
          className="btn btn-primary h-12 px-4 text-sm"
        >
          Start free
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
