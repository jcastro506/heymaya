"use client";

import Link from "next/link";

import { primaryCtaHref, primaryCtaLabel } from "../../_components/landingMode";

/**
 * Hero — Linear/Vercel-coded restraint.
 *
 * Leads with the consistency promise (the one thing creators fear losing)
 * and the four daily jobs Maya owns: plans the week, tells you what's
 * trending, reminds you what to film today, flags what matters. One CTA.
 * One flat sample message — a morning brief, the behavior every creator
 * gets every day. Lime appears once, on the "grounded" dot.
 */
export function Hero() {
  return (
    <section className="relative px-6 pt-16 sm:px-10 sm:pt-24 lg:pt-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-12 lg:gap-12">
          {/* Headline column */}
          <div className="lg:col-span-7">
            <h1 className="font-display text-[clamp(2.75rem,7vw,5.25rem)] leading-[1.02] tracking-[-0.025em] text-paper">
              Maya keeps you posting.{" "}
              <span className="italic text-paper-dim">
                Without thinking about it.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-paper-dim">
              She plans your week, tells you what to film today, watches
              what&rsquo;s trending in your niche, and texts you what
              matters &mdash; before you have time to spiral. In iMessage,
              like a real manager would.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href={primaryCtaHref("/checkout?tier=manager&interval=monthly")}
                className="inline-flex h-11 items-center rounded-md bg-paper px-5 text-sm font-medium text-ink transition hover:bg-white"
              >
                {primaryCtaLabel("Start 7 days free")}
              </Link>
              <span className="text-sm text-paper-faint">
                No card. Cancel anytime.
              </span>
            </div>
          </div>

          {/* Sample message column — a morning brief, the every-day behavior */}
          <aside className="lg:col-span-5">
            <div className="relative overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-ink-2 p-7">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
                Maya · 7:02 am
              </div>
              <p className="mt-5 font-display text-2xl italic leading-snug text-paper">
                &ldquo;Today: the POV we wrote Tuesday (you&rsquo;re free
                6:30-7pm tonight) and the candle launch caption. New
                comment from Glossier &mdash; worth reading before
                lunch.&rdquo;
              </p>
              <div className="mt-7 flex items-center justify-between border-t border-[var(--hairline)] pt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-faint">
                <span>your morning brief, every day</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                  grounded
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
