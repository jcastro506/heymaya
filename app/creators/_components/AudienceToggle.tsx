"use client";

import Link from "next/link";

const BUSINESS_PRODUCT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_BUSINESS_PRODUCT === "true";

export function AudienceToggle() {
  if (!BUSINESS_PRODUCT_ENABLED) return null;

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
