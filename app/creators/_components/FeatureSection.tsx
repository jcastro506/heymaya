"use client";

import type { ComponentType, ReactNode } from "react";

/**
 * A single pain-led feature section. Reused 12x in /creators with alternating
 * left/right layouts to keep the page reading like a magazine spread, not a
 * stamped-out feature grid.
 *
 * Structure (every section):
 *  - eyebrow tag (small uppercase category)
 *  - icon (lucide)
 *  - headline (pain-first or solution-first)
 *  - subhead (1-2 sentences with concrete mechanic)
 *  - visual (typically <IMessageCard /> showing a sample Maya message)
 *  - optional autonomy badge (e.g., "Manager tier")
 */
export function FeatureSection({
  eyebrow,
  Icon,
  headline,
  subhead,
  visual,
  reverse = false,
  badge,
}: {
  eyebrow: string;
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  headline: ReactNode;
  subhead: ReactNode;
  visual: ReactNode;
  reverse?: boolean;
  badge?: string;
}) {
  return (
    <section className="px-6 pt-24 sm:px-10 sm:pt-32">
      <div className="mx-auto max-w-7xl">
        <div
          className={`grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16 ${
            reverse ? "lg:[&>div:first-child]:order-2" : ""
          }`}
        >
          {/* Copy column */}
          <div className="lg:col-span-6">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 max-w-12 bg-[var(--hairline-strong)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                {eyebrow}
              </span>
              {badge ? (
                <span className="rounded-full bg-lime px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink">
                  {badge}
                </span>
              ) : null}
            </div>
            <div className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--hairline-strong)] text-lime">
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <h3 className="mt-5 font-display text-3xl leading-[1.08] tracking-tight text-paper sm:text-4xl lg:text-[2.625rem]">
              {headline}
            </h3>
            <div className="mt-5 max-w-xl text-base leading-relaxed text-paper-dim sm:text-[17px]">
              {subhead}
            </div>
          </div>

          {/* Visual column */}
          <div className="lg:col-span-6">
            <div className="mx-auto w-full max-w-md">{visual}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
