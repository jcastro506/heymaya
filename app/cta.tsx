"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track } from "./analytics";

/** A signup link that records where on the page it was clicked (plan §7 S1). */
export function CtaLink({ href, className, where, children }: { href: string; className?: string; where: string; children: ReactNode }) {
  return (
    <Link className={className} href={href} onClick={() => track("cta_click", { where })}>
      {children}
    </Link>
  );
}
