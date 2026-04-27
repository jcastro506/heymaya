/**
 * Root landing page.
 *
 * Behavior is gated by `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` (see
 * `middleware.ts` for the full feature-flag contract):
 *
 *   - flag !== "true" (default): server-renders the service-business landing
 *     in-place at `/`. No redirect hop — `/` IS the service marketing surface.
 *     The account-type selector and creator landing are unreachable but
 *     preserved on disk (one env flip restores them).
 *
 *   - flag === "true": renders the dual-track account-type selector built in
 *     Sprint 0 (Service). Creator and service tracks both reachable.
 *
 * Why server-rendered (not redirect): a 308 from `/` to `/business` would
 * burn an extra round-trip on the canonical landing URL. Co-locating the
 * service landing component as the body of `/` makes `/` the service home in
 * the URL bar without losing the option to re-expose the picker later.
 *
 * Metadata: SEO/OG title is set per-flag-state below so the head reflects the
 * actual product visible at `/`.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Sparkles } from "lucide-react";
import BusinessHome from "./business/page";

const CREATOR_PRODUCT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true";

export const metadata: Metadata = CREATOR_PRODUCT_ENABLED
  ? {
      title: "HeyMaya — AI manager for creators and service businesses",
      description:
        "One Maya per operator. Pick your track: creator (5K–500K followers) or service business (trades, home services).",
    }
  : {
      title:
        "HeyMaya — your AI marketing manager before you can afford a human one",
      description:
        "Maya turns every completed job into local marketing. Built for plumbers, HVAC, roofers, electricians, cleaners, landscapers.",
    };

export default function Home() {
  if (!CREATOR_PRODUCT_ENABLED) {
    // Service-only mode. The business landing is a client component; rendering
    // it here makes `/` the canonical service marketing surface without the
    // visible URL changing to /business.
    return <BusinessHome />;
  }

  // Dual-track mode (creator product re-enabled): the original Sprint-0
  // account-type picker.
  return <AccountTypePicker />;
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                       ACCOUNT-TYPE PICKER (flag-on)                        */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * The dual-track entry point built in Sprint 0 (Service). Routes the visitor
 * to /creators or /business; doesn't persist anything (account type is set
 * server-side at sign-up).
 *
 * Kept inline here (rather than imported from a separate file) so flipping
 * the flag back on is a zero-file-shuffle exercise.
 */
function AccountTypePicker() {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <Nav />
      <main className="relative z-10 flex flex-1 items-center px-6 py-16 sm:px-10 sm:py-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="max-w-3xl">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              Pick your track
            </span>
            <h1 className="mt-4 font-display text-[clamp(2.5rem,6.5vw,5rem)] leading-[1.02] tracking-[-0.02em] text-paper">
              An AI manager for the work{" "}
              <span className="italic text-paper-dim">you actually do.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-paper-dim">
              HeyMaya is a single-agent manager that lives in your messages — not
              another dashboard you open. One Maya per operator. Two flavors,
              same operating principle: push, don&rsquo;t pull. Grounded or
              silent.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-[var(--hairline-strong)] bg-[var(--hairline)] lg:grid-cols-2">
            <SelectorCard
              eyebrow="01 · For creators"
              kicker="5K–500K followers"
              title={
                <>
                  Maya for{" "}
                  <span className="italic text-paper-dim">creators.</span>
                </>
              }
              body="Your AI creator manager before you can afford a human one. Maya plans your week, watches your performance, triages brand emails, and tells you what to post next — every day, in your messages."
              bullets={[
                "TikTok, Instagram, YouTube, LinkedIn, X",
                "Morning brief, evening recap, weekly review",
                "Drafts brand-deal replies; you approve",
                "From $19.99 / mo · 14-day Pro trial",
              ]}
              ctaLabel="I'm a creator"
              ctaHref="/creators"
            />
            <SelectorCard
              eyebrow="02 · For service businesses"
              kicker="Plumbing · HVAC · roofing · cleaning · landscaping"
              title={
                <>
                  Maya for the{" "}
                  <span className="italic text-paper-dim">trades.</span>
                </>
              }
              body="Your AI marketing manager before you can afford a human one — for the trades. Maya turns every completed job into local marketing: review requests, GBP posts, social drafts, lead-response nudges."
              bullets={[
                "Google Business Profile + Facebook + Instagram",
                "Every completed job → review request + post draft",
                "Drafts replies for every review; you approve",
                "From $99 / mo · 14-day Pro trial",
              ]}
              ctaLabel="I'm a service business"
              ctaHref="/business"
              recommended
            />
          </div>

          <p className="mt-10 max-w-2xl text-sm text-paper-faint">
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="text-paper-dim underline-offset-4 hover:text-paper hover:underline"
            >
              Sign in
            </Link>
            . Account type is set at sign-up and locked thereafter — picking
            here just routes you to the right product page.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  NAV                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="relative z-20 px-6 pt-6 sm:px-10 sm:pt-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link
          href="/"
          className="group inline-flex items-center gap-2"
          aria-label="HeyMaya home"
        >
          <Logo />
          <span className="font-display text-xl tracking-tight text-paper">
            HeyMaya
          </span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-paper-dim md:flex">
          <Link href="/creators" className="transition-colors hover:text-paper">
            For creators
          </Link>
          <Link href="/business" className="transition-colors hover:text-paper">
            For trades
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden text-sm text-paper-dim transition-colors hover:text-paper sm:inline"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
      style={{
        boxShadow:
          "0 0 0 1px rgba(214,255,61,0.3), 0 6px 24px -6px rgba(214,255,61,0.5)",
      }}
    >
      <span className="font-display text-lg leading-none">m</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  CARD                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function SelectorCard({
  eyebrow,
  kicker,
  title,
  body,
  bullets,
  ctaLabel,
  ctaHref,
  recommended = false,
}: {
  eyebrow: string;
  kicker: string;
  title: React.ReactNode;
  body: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
  recommended?: boolean;
}) {
  return (
    <Link
      href={ctaHref}
      className={`group relative flex flex-col gap-7 p-8 transition-colors sm:p-10 ${
        recommended ? "bg-ink-3 hover:bg-ink-3/80" : "bg-ink-2 hover:bg-ink-3"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            {eyebrow}
          </span>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-paper-dim">
            {kicker}
          </p>
        </div>
        {recommended && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-wider text-ink">
            <Sparkles className="h-3 w-3" />
            New
          </span>
        )}
      </div>

      <h2 className="font-display text-4xl leading-[1.02] tracking-tight text-paper sm:text-5xl">
        {title}
      </h2>

      <p className="max-w-md text-base leading-relaxed text-paper-dim">
        {body}
      </p>

      <ul className="space-y-2.5 text-sm text-paper-dim">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-3">
            <span className="mt-2 h-1 w-3 shrink-0 bg-lime" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <span
        className={`btn mt-auto w-full ${
          recommended ? "btn-primary" : "btn-ghost"
        }`}
      >
        {ctaLabel}
        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" />
      </span>
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  FOOTER                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="relative z-10 mt-20 border-t border-[var(--hairline)] px-6 pb-10 pt-12 sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <p className="text-sm text-paper-dim">
          Your AI manager before you can afford a human one.
        </p>
        <div className="flex items-center gap-6 text-sm text-paper-dim">
          <Link href="/creators" className="hover:text-paper">
            Creators
          </Link>
          <Link href="/business" className="hover:text-paper">
            Service businesses
          </Link>
          <a className="hover:text-paper" href="mailto:hi@heymaya.app">
            hi@heymaya.app
          </a>
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-paper-faint">
          © {new Date().getFullYear()} HeyMaya
        </p>
      </div>
    </footer>
  );
}
