"use client";

import type { ReactNode } from "react";
import { track } from "./analytics";

/**
 * A "Get the app" link that records where on the page it was clicked (plan §7 S1). A plain
 * anchor: `/join` is a redirect to the App Store, so it must not be prefetched.
 */
export function CtaLink({ href, className, where, children, label }: { href: string; className?: string; where: string; children: ReactNode; label?: string }) {
  return (
    <a className={className} href={href} aria-label={label} onClick={() => track("cta_click", { where })}>
      {children}
    </a>
  );
}
