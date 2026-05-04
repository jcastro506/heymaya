"use client";

import Link from "next/link";

/**
 * Top-of-page audience switcher. "For creators" is the selected state on this
 * route; "For businesses" 308-redirects via /business.
 *
 * Design: pill-shaped segmented control matching the BillingToggle visual DNA.
 * Selected state uses paper-on-ink, unselected uses paper-dim.
 */
export function AudienceToggle() {
  return (
    <div
      role="tablist"
      aria-label="Audience"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-strong)] bg-ink-2 p-1 text-[13px]"
    >
      <span
        role="tab"
        aria-selected="true"
        className="rounded-full bg-paper px-3.5 py-1.5 text-ink"
      >
        For creators
      </span>
      <Link
        role="tab"
        aria-selected="false"
        href="/business"
        className="rounded-full px-3.5 py-1.5 text-paper-dim transition-colors hover:text-paper"
      >
        For businesses
      </Link>
    </div>
  );
}
