"use client";

import type { ReactNode } from "react";

import { ScrollReveal } from "./ScrollReveal";

/**
 * A single pain-led feature section.
 *
 * Linear/Vercel-coded restraint: hairline top border, generous breathing
 * room, tight typography. The copy and visual columns each fade in
 * independently on scroll via ScrollReveal — the visual gets a small
 * extra delay so it lands a moment after the headline, giving the eye
 * something to follow rather than a hard simultaneous reveal.
 */
export function FeatureSection({
  headline,
  subhead,
  visual,
  reverse = false,
  badge,
}: {
  headline: ReactNode;
  subhead: ReactNode;
  visual: ReactNode;
  reverse?: boolean;
  badge?: string;
}) {
  return (
    <section className="border-t border-[var(--hairline)] px-6 pt-24 sm:px-10 sm:pt-32 lg:pt-40">
      <div className="mx-auto max-w-7xl">
        <div
          className={`grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-20 ${
            reverse ? "lg:[&>div:first-child]:order-2" : ""
          }`}
        >
          {/* Copy column */}
          <ScrollReveal className="lg:col-span-6">
            {badge ? (
              <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                {badge}
              </div>
            ) : null}
            <h3 className="font-display text-3xl leading-[1.06] tracking-[-0.02em] text-paper sm:text-4xl lg:text-[2.5rem]">
              {headline}
            </h3>
            <div className="mt-5 max-w-lg text-[17px] leading-relaxed text-paper-dim">
              {subhead}
            </div>
          </ScrollReveal>

          {/* Visual column — small extra delay so it lands after the headline */}
          <ScrollReveal className="lg:col-span-6" delayMs={120}>
            <div className="mx-auto w-full max-w-md">{visual}</div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
