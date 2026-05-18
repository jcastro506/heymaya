"use client";

import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";

import { primaryCtaHref, primaryCtaLabel } from "../../_components/landingMode";

/**
 * Editorial hero: left-column headline + right-column "first message" receipt.
 *
 * Single primary CTA — "Start 7 days free" → /checkout?tier=manager&interval=monthly.
 * Manager is the headline experience; Assistant is offered later in pricing.
 * (Internal Plan enum value stays "coach" — see convex/lib/planFeatures.ts.)
 *
 * Headline avoids the word "AI" (operator constraint). Maya is positioned as
 * ONE social media manager, with autonomy as the variable, not personality.
 */
export function Hero() {
  return (
    <section className="relative px-6 pt-12 sm:px-10 sm:pt-20 lg:pt-28">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-10">
          {/* Headline column */}
          <div className="lg:col-span-7">
            <h1 className="font-display text-[clamp(2.5rem,7vw,5.5rem)] leading-[1.02] tracking-[-0.02em] text-paper">
              Your social media
              <br />
              manager.{" "}
              <span className="italic text-paper-dim">
                Lives in your iMessages.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-paper-dim">
              Maya plans your week so you stay consistent, turns your raw clips
              into something you can actually post, catches the trends that fit
              you, and tells you what&rsquo;s working — every day, in iMessage.
              Replaces eight tools and a manager you can&rsquo;t afford yet.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={primaryCtaHref("/checkout?tier=manager&interval=monthly")}
                className="btn btn-primary group !bg-paper !text-ink hover:!bg-white"
              >
                {primaryCtaLabel("Start 7 days free")}
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" />
              </Link>
              <a href="#features" className="btn btn-ghost">
                See what she does
              </a>
              <span className="ml-1 text-sm text-paper-faint">
                No card. Cancel anytime.
              </span>
            </div>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              TikTok creators today · more platforms soon
            </p>
          </div>

          {/* Quote / receipt column */}
          <aside className="lg:col-span-5">
            <div className="relative">
              {/* The little manila tag at the corner */}
              <div className="absolute -top-3 right-6 z-10 rounded-sm bg-lime px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink">
                Brief · 07:02
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-paper-faint">
                  <Sparkles className="h-3.5 w-3.5 text-lime" />
                  Maya · this morning
                </div>
                <p className="mt-5 font-display text-2xl italic leading-snug text-paper">
                  &ldquo;Your &lsquo;POV: I tried…&rsquo; on Monday hit 340K.
                  Wednesday&rsquo;s &lsquo;Day in my life&rsquo; flatlined at
                  8K. I drafted three new POV openers for Thursday — want to
                  see them?&rdquo;
                </p>
                <div className="mt-6 flex items-center justify-between border-t border-[var(--hairline)] pt-5 font-mono text-xs text-paper-faint">
                  <span>from your last week of posts</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                    grounded
                  </span>
                </div>
              </div>
              {/* shadow-tile behind, rotated, for editorial feel */}
              <div
                aria-hidden
                className="absolute -bottom-4 -right-4 -z-10 h-full w-full rounded-2xl border border-[var(--hairline)] bg-ink-3"
                style={{ transform: "rotate(2.5deg)" }}
              />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
