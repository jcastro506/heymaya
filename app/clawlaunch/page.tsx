"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiTiktok, SiYoutube } from "react-icons/si";

import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";
import { DemoRead } from "../_components/DemoRead";

/**
 * Landing redesign — "a portfolio of one week of Maya's work."
 *
 * The page is a sequence of ARTIFACTS — her texts, her posts, her
 * dashboard — with marketing prose shrunk to captions. Canvas alternates
 * PAPER (cream editorial) and ARTIFACT (phone-glass / dark objects); no
 * uniform hairline dividers between sections — transitions come from
 * canvas changes and whitespace.
 *
 * Visual identity kept from the previous edition:
 *   - cream paper ground (#fbfaf6) + paper-grain overlay
 *   - Instrument Serif italic display headlines
 *   - Geist Mono eyebrows / labels
 *   - hero letter-mask rise, IntersectionObserver reveals, scroll line
 *
 * Beats: Hero (notification stack) → the problem in their words →
 * day one (dark glass) → the job hour by hour (chat bubbles) →
 * the work (gallery: videos + posts) → the receipts (dark glass,
 * Mission Control) → guardrails strip → pricing → dark closer.
 *
 * All primary CTAs route through landingMode (waitlist by default).
 */

// Note: metadata exports are only valid in server components. app/page.tsx
// owns the real <head> metadata; this export is the reference copy.
export const landingMetadata: Metadata = {
  title: "HeyMaya — Maya runs your organic social.",
  description:
    "Your app is good. Nobody knows it exists. Maya runs your organic social — the hire you can't afford yet, for $99/mo.",
};

export default function ClawLaunchLandingPage() {
  return (
    <main
      data-page="clawlaunch-landing"
      className="relative min-h-screen bg-[#fbfaf6] text-[#0a0a0a] font-sans antialiased"
    >
      <PageStyles />
      <ScrollLine />
      <Masthead />
      <StickyCTA />
      <Hero />
      {/* ⭐ §18.9.2 block ② — the live URL-read demo, and Sprint 11's exit
          criterion verbatim: "a visitor can paste a URL on the landing page and
          watch her be specifically right about their company, in under 20
          seconds, without signing up."

          ⚠️ The component, the API route and all four guardrails (IP limit, URL
          cache, daily spend cap, graceful degrade) were built and live on
          /start — and the landing page never imported it. The one block that
          demonstrates the product instead of describing it was the one block
          missing from the page whose whole job is to acquire users.

          Placed directly after the hero on purpose: every competitor CLAIMS to
          understand your business, and this proves it on the visitor's own site
          before they give us anything. Below the fold it is a feature; here it
          is the argument. */}
      <DemoSection />
      <ProblemQuotes />
      <DayOne />
      <WeekBubbles />
      <WorkGallery />
      <Receipts />
      <InlineCTA
        kicker="This was one week"
        line="Yours starts in four minutes."
      />
      <Pricing />
      <Closer />
      <Footer />
    </main>
  );
}

/* -----------------------------------------------------------------
 * The live read — §18.9.2 block ②.
 * ----------------------------------------------------------------- */

function DemoSection() {
  return (
    <section className="relative px-6 py-16 sm:px-10 sm:py-24">
      <div className="mx-auto max-w-3xl">
        {/* ⚠️ Eyebrow only. `DemoRead` carries its own headline and its own
            "no signup" promise — caught by rendering the page rather than by
            reading the diff, which showed the visitor the same sentence twice
            in slightly different words. The component is shared with /start, so
            the wrapper defers to it rather than the other way round. */}
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#0a0a0a]/50">
          Try it on your own site
        </p>
        <div className="mt-6">
          <DemoRead />
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Masthead — Geist Mono eyebrow strip across the top.
 * ----------------------------------------------------------------- */
function Masthead() {
  return (
    <header className="relative z-10 border-b border-[#0a0a0a]/10">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-10">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-[0.22em]"
        >
          HeyMaya
        </Link>
        <nav className="hidden items-center gap-6 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.22em] md:flex lg:gap-7">
          <a href="#week" className="opacity-60 hover:opacity-100">
            Her week
          </a>
          <a href="#work" className="opacity-60 hover:opacity-100">
            The work
          </a>
          <a href="#receipts" className="opacity-60 hover:opacity-100">
            Receipts
          </a>
          <a href="#pricing" className="opacity-60 hover:opacity-100">
            Pricing
          </a>
          <Link href="/sign-in" className="opacity-60 hover:opacity-100">
            Sign in
          </Link>
          <Link
            prefetch={false}
            href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
            className="rounded-full bg-[#0a0a0a] px-4 py-2 text-[#fbfaf6] transition-colors hover:bg-[#0a0a0a]/85"
          >
            {primaryCtaLabel("Put her to work")} →
          </Link>
        </nav>
        <Link
          prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
          className="font-mono text-[11px] uppercase tracking-[0.22em] underline-offset-[6px] hover:underline md:hidden"
        >
          {primaryCtaLabel("Put her to work")} →
        </Link>
      </div>
    </header>
  );
}

/* -----------------------------------------------------------------
 * StickyCTA — slim bar that fades in once the hero scrolls out, so a
 * "sold at any scroll depth" visitor always has a button.
 * ----------------------------------------------------------------- */
function StickyCTA() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 0.9);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      aria-hidden={!shown}
      className={`fixed inset-x-0 top-0 z-30 border-b border-[#0a0a0a]/10 bg-[#fbfaf6]/90 backdrop-blur transition-all duration-300 ${
        shown ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3 sm:px-10">
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.22em] sm:block">
          HeyMaya
        </span>
        <p className="min-w-0 flex-1 truncate font-display italic text-[15px] sm:flex-none sm:text-[17px]">
          The flat line doesn&rsquo;t fix itself.
        </p>
        <Link
          prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
          tabIndex={shown ? 0 : -1}
          className="shrink-0 rounded-full bg-[#0a0a0a] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#fbfaf6] transition-opacity hover:opacity-85"
        >
          {primaryCtaLabel("Put her to work")} →
        </Link>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
 * InlineCTA — a mid-page capture point at a peak-desire moment.
 * ----------------------------------------------------------------- */
function InlineCTA({ kicker, line }: { kicker: string; line: string }) {
  return (
    <section className="relative px-6 py-16 sm:px-10 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <div className="flex flex-col items-start gap-6 border-y border-[#0a0a0a]/15 py-12 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
                {kicker}
              </p>
              <p className="font-display italic text-[clamp(1.6rem,3.2vw,2.6rem)] leading-[1.1] tracking-tight">
                {line}
              </p>
            </div>
            <Link
              prefetch={false}
              href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
              className="cta-primary shrink-0"
            >
              {primaryCtaLabel("Put her to work")}
              <span className="cta-arrow">→</span>
            </Link>
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 1 — HERO [paper]. Two-line display headline, one caption, and
 * the first artifact: an iPhone-style notification stack. Three days
 * of her pings, before a single paragraph of marketing.
 * ----------------------------------------------------------------- */
const HERO_NOTIFICATIONS: Array<{
  time: string;
  text: string;
  tilt: string;
  offset: string;
  delay: string;
}> = [
  {
    time: "7:00 AM",
    text: "Morning. 4 threads worth hitting today. Plan’s in your dashboard.",
    tilt: "-rotate-[1.5deg]",
    offset: "sm:mr-6",
    delay: "2.3s",
  },
  {
    time: "11:07 AM",
    text: "Someone’s asking for exactly your app. Reply’s ready.",
    tilt: "rotate-[1deg]",
    offset: "sm:ml-8",
    delay: "2.55s",
  },
  {
    time: "8:01 PM",
    text: "2 signups today. Both from the Reddit reply.",
    tilt: "-rotate-[0.75deg]",
    offset: "sm:mr-1",
    delay: "2.8s",
  },
];

function NotificationStack() {
  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col gap-3">
      {HERO_NOTIFICATIONS.map((n) => (
        <div
          key={n.time}
          className={`hero-line ${n.tilt} ${n.offset} rounded-[1.35rem] border border-[#0a0a0a]/10 bg-white/80 px-4 py-3.5 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_18px_44px_-18px_rgba(0,0,0,0.22)] backdrop-blur`}
          style={{ animationDelay: n.delay }}
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#0a0a0a]">
              <span className="font-display italic text-[17px] leading-none text-[#fbfaf6]">
                M
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#0a0a0a]/55">
                  Maya
                </span>
                <span className="font-mono text-[10px] tabular-nums text-[#0a0a0a]/40">
                  {n.time}
                </span>
              </div>
              <p className="mt-1 text-[13.5px] leading-[1.45] text-[#0a0a0a]/85">
                {n.text}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative px-6 pt-20 pb-24 sm:px-10 sm:pt-32 sm:pb-36 lg:pt-40">
      <div className="mx-auto max-w-7xl">
        {/* The headline */}
        <h1 className="hero-headline">
          <span
            className="hero-line font-display italic"
            style={{ animationDelay: "0.2s" }}
          >
            Your app is good.
          </span>
          <span
            className="hero-line font-display italic block"
            style={{ animationDelay: "1.1s" }}
          >
            Nobody knows it exists.
          </span>
        </h1>

        <div className="mt-14 grid grid-cols-12 gap-y-14 lg:mt-20 lg:gap-x-8">
          {/* One-liner + CTAs */}
          <div
            className="hero-line col-span-12 lg:col-span-6"
            style={{ animationDelay: "2s" }}
          >
            <p className="max-w-xl text-[18px] leading-[1.55] text-[#0a0a0a]/75 sm:text-[20px] sm:leading-[1.5]">
              Maya runs your organic social — the hire you can&rsquo;t afford
              yet, for $99/mo.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <Link
                prefetch={false}
                href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
                className="cta-primary"
              >
                {primaryCtaLabel("Put her to work")}
                <span className="cta-arrow">→</span>
              </Link>
              <a
                href="#week"
                className="font-mono text-[11px] uppercase tracking-[0.22em] underline-offset-[6px] hover:underline"
              >
                See her week ↓
              </a>
            </div>
          </div>

          {/* Hero artifact — her pings, stacked like a lock screen */}
          <div className="col-span-12 lg:col-span-5 lg:col-start-8">
            <NotificationStack />
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 2 — THE PROBLEM, IN THEIR WORDS [paper]. Three pull-quote
 * cards, cited with a subreddit chip. One caption line under them.
 * ----------------------------------------------------------------- */
const PROBLEM_QUOTES: Array<{ quote: string; source: string; lift: string }> = [
  {
    quote: "We can build SaaS products. But who’s going to sell them?",
    source: "r/SaaS",
    lift: "",
  },
  {
    quote:
      "The crickets after 30 emails make me want to tuck my little app back in for a nap.",
    source: "r/indiehackers",
    lift: "lg:mt-10",
  },
  {
    quote:
      "As a solo founder the problem is lack of time for marketing — and for testing the marketing.",
    source: "r/SideProject",
    lift: "lg:mt-4",
  },
];

function ProblemQuotes() {
  return (
    <section className="relative px-6 py-20 sm:px-10 sm:py-28">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-10 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
            You&rsquo;ve typed one of these
          </p>
        </RevealOnView>
        <div className="grid gap-6 sm:grid-cols-3 sm:gap-7">
          {PROBLEM_QUOTES.map((q, i) => (
            <RevealOnView key={q.source} delay={0.08 + i * 0.1} className={q.lift}>
              <figure className="flex h-full flex-col justify-between rounded-2xl border border-[#0a0a0a]/8 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-20px_rgba(0,0,0,0.18)] sm:p-7">
                <blockquote className="font-display italic text-[clamp(1.25rem,1.8vw,1.5rem)] leading-[1.3] tracking-tight">
                  &ldquo;{q.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#0a0a0a]/12 bg-[#fbfaf6] px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-[#0a0a0a]/60">
                    <RedditLogo className="size-3" />
                    {q.source}
                  </span>
                </figcaption>
              </figure>
            </RevealOnView>
          ))}
        </div>
        <RevealOnView delay={0.2}>
          <p className="mt-12 max-w-2xl text-[15px] leading-[1.6] text-[#0a0a0a]/60">
            Maya pulled these in her first 20 minutes on the job. Your buyers
            talk like this every day. She listens.
          </p>
        </RevealOnView>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 3 — DAY ONE [glass]. A dark slab on the paper. Inside: the
 * phone-message rendering of her first plan text.
 * ----------------------------------------------------------------- */
function DayOne() {
  return (
    <section className="relative px-6 py-16 sm:px-10 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <div className="rounded-[2rem] border border-[#1B2434] bg-[#0B0F15] px-6 py-14 shadow-[0_48px_120px_-48px_rgba(10,15,25,0.6)] sm:rounded-[2.5rem] sm:px-12 sm:py-20 lg:px-16">
            <div className="grid grid-cols-12 gap-y-10 lg:items-center lg:gap-x-10">
              <div className="col-span-12 lg:col-span-5">
                <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#5D6E85]">
                  Day one
                </p>
                <h2 className="font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight text-[#E9EEF6]">
                  20 minutes in, you get this.
                </h2>
              </div>
              <div className="col-span-12 lg:col-span-7">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#5D6E85]">
                  Maya · her first text
                </p>
                <div className="max-w-xl rounded-2xl rounded-bl-md bg-[#26303F] px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                  <p className="text-[14.5px] leading-[1.6] text-[#E9EEF6] sm:text-[15px]">
                    Foundation&rsquo;s done. Your buyer: solo devs who shipped
                    and heard crickets. Your channels: Reddit first (they vent
                    in exact problem language — three live threads match you
                    today), X second (build-in-public is their feed). Six
                    angles locked. First move: a reply to &lsquo;who&rsquo;s
                    going to sell them?&rsquo; — drafted, waiting on your tap.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 4 — THE JOB, HOUR BY HOUR [paper]. Six phone bubbles from
 * Maya, day/time chips, minimal prose around them.
 * ----------------------------------------------------------------- */
const WEEK_BUBBLES: Array<{ stamp: string; text: string; shift: string }> = [
  {
    stamp: "Mon · 7:00a",
    text: "Morning. 4 threads today, 2 drafts ready. Top one’s a r/SaaS thread that’s 2 hours old and rising.",
    shift: "",
  },
  {
    stamp: "Mon · 11:07a",
    text: "Someone just asked for exactly your app. Eight minutes old. Reply’s drafted, in your voice.",
    shift: "sm:ml-12",
  },
  {
    stamp: "Tue · 8:00p",
    text: "Both posts out. The Reddit one’s pulling comments — one asked ‘where can I try this?’ The X one flopped. Wrong hook, my fault. Fixed for next time.",
    shift: "",
  },
  {
    stamp: "Wed · 2:15p",
    text: "Your reply is at 5× its normal pace. Worth jumping in while it’s hot?",
    shift: "sm:ml-12",
  },
  {
    stamp: "Thu · 4:40p",
    text: "A buyer just commented: ‘wait, how much is this?’ Draft answer’s ready.",
    shift: "",
  },
  {
    stamp: "Sun · 6:00p",
    text: "Week review: 7 signups, 5 from Reddit. Reddit converts. X doesn’t yet. Doubling Reddit.",
    shift: "sm:ml-12",
  },
];

function WeekBubbles() {
  return (
    <section id="week" className="relative px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
            A week with her
          </p>
          <h2 className="mb-14 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl sm:mb-20">
            The job, hour by hour.
          </h2>
        </RevealOnView>
        <div className="max-w-2xl space-y-8 sm:space-y-9">
          {WEEK_BUBBLES.map((b, i) => (
            <RevealOnView key={b.stamp} delay={0.05 + (i % 2) * 0.08}>
              <div className={b.shift}>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
                  {b.stamp}
                </p>
                <div className="inline-block max-w-full rounded-2xl rounded-bl-md border border-[#0a0a0a]/8 bg-white px-5 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_30px_-16px_rgba(0,0,0,0.14)]">
                  <p className="text-[14.5px] leading-[1.55] text-[#0a0a0a]/85">
                    {b.text}
                  </p>
                </div>
              </div>
            </RevealOnView>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Platform logos — Simple Icons via react-icons, canonical brand
 * colors. TikTok gets the chromatic-aberration treatment.
 * ----------------------------------------------------------------- */
function RedditLogo({ className }: { className?: string }) {
  return <SiReddit className={className} color="#FF4500" aria-label="Reddit" />;
}

function TikTokLogo({ className }: { className?: string }) {
  return (
    <span
      className={`relative inline-block ${className ?? ""}`}
      aria-label="TikTok"
    >
      <SiTiktok
        className="absolute left-0 top-0 size-full"
        color="#25F4EE"
        style={{ transform: "translate(-1.5px, 1.5px)" }}
      />
      <SiTiktok
        className="absolute left-0 top-0 size-full"
        color="#FE2C55"
        style={{ transform: "translate(1.5px, -1.5px)" }}
      />
      <SiTiktok className="absolute left-0 top-0 size-full" color="#0a0a0a" />
    </span>
  );
}

function YouTubeLogo({ className }: { className?: string }) {
  return <SiYoutube className={className} color="#FF0000" aria-label="YouTube" />;
}

function XLogo({ className }: { className?: string }) {
  return <FaXTwitter className={className} color="#0a0a0a" aria-label="X" />;
}

function InstagramLogo({ className }: { className?: string }) {
  return <SiInstagram className={className} color="#E4405F" aria-label="Instagram" />;
}

/* -----------------------------------------------------------------
 * Demo videos — the operator's clips. Drop files at the paths below;
 * until set, a clean "made by maya" placeholder frame renders.
 *   public/demos/tiktok.mp4   (+ optional tiktok.jpg poster)
 *   public/demos/instagram.mp4
 *   public/demos/youtube.mp4
 * ----------------------------------------------------------------- */
const DEMO_VIDEOS: Record<
  "tiktok" | "instagram" | "youtube",
  { src: string | null; poster: string | null }
> = {
  tiktok: { src: "/demos/tiktok.mp4", poster: "/demos/tiktok.jpg" },
  instagram: { src: "/demos/instagram.mp4", poster: "/demos/instagram.jpg" },
  // The avatar testimonial Maya cut for HeyMaya itself — a Short, dogfooded.
  youtube: { src: "/demos/youtube.mp4", poster: "/demos/youtube.jpg" },
};

/* A 9:16 phone showing the actual video Maya made. */
function PlatformVideo({
  platform,
  label,
}: {
  platform: "tiktok" | "instagram" | "youtube";
  label: string;
}) {
  const v = DEMO_VIDEOS[platform];
  const Logo =
    platform === "tiktok"
      ? TikTokLogo
      : platform === "instagram"
        ? InstagramLogo
        : YouTubeLogo;
  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem] border border-[#0a0a0a]/12 bg-[#0a0a0a] shadow-[0_2px_4px_rgba(0,0,0,0.06),0_24px_60px_-24px_rgba(0,0,0,0.35)]">
        {v.src ? (
          <video
            className="size-full object-cover"
            src={v.src}
            poster={v.poster ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            controls
            preload="metadata"
          />
        ) : (
          <div className="absolute inset-0">
            <div className="absolute inset-0 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a]" />
            <div
              className="absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(circle at 50% 36%, rgba(251,250,246,0.16), transparent 58%)",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-[#fbfaf6]">
                <span className="ml-1 border-y-[9px] border-l-[15px] border-y-transparent border-l-[#0a0a0a]" />
              </div>
            </div>
            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
              <Logo className="size-5" />
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/55">
                made by maya
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0 p-4">
              <p className="text-[13px] font-medium leading-[1.35] text-white/90">
                {label}
              </p>
              <div className="mt-2 h-1 w-2/3 rounded-full bg-white/25" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
 * Post mockups — the written work, rendered native.
 * ----------------------------------------------------------------- */
function RedditMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      {/* OP post */}
      <div className="border-b border-[#0a0a0a]/8 px-5 py-4">
        <div className="flex items-center gap-2 text-[11px]">
          <SiReddit className="size-4" color="#FF4500" />
          <span className="font-semibold">r/getdisciplined</span>
          <span className="opacity-40">·</span>
          <span className="opacity-50">posted by u/winterhabits · 3h</span>
        </div>
        <h4 className="mt-2.5 text-[16px] font-semibold leading-snug">
          How do you actually remember to check your habit tracker at the end
          of the day?
        </h4>
        <p className="mt-2 text-[13px] leading-relaxed opacity-65">
          Tried 4 different ones. None of them stick because I forget to open
          them at night. Anyone solved this?
        </p>
        <div className="mt-3.5 flex items-center gap-5 text-[11px] opacity-50">
          <span className="font-semibold">↑ 89</span>
          <span>24 comments</span>
          <span>share</span>
        </div>
      </div>

      {/* Her drafted reply */}
      <div className="relative bg-[#fbfaf6] px-5 py-4 pl-7">
        <div className="absolute bottom-4 left-4 top-4 w-[2px] bg-[#FF4500]/35" />
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold">u/yourname</span>
          <span className="opacity-40">· just now</span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed">
          had this exact problem with mine. what worked was switching the
          evening check-in from a generic &ldquo;log your habits&rdquo;
          notification to one specific question, like &ldquo;did you do the
          thing today.&rdquo; built a small app last month that does this if
          you want to try it. happy to share what i learned either way.
        </p>
        <div className="mt-3 flex items-center gap-4 text-[11px] opacity-50">
          <span className="font-semibold">↑ 12</span>
          <span>↓</span>
          <span>reply</span>
        </div>
      </div>
    </div>
  );
}

function XMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="size-11 shrink-0 rounded-full bg-gradient-to-br from-[#dddddd] to-[#b6b6b6]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <p className="text-[14px] font-semibold">Your Name</p>
              <p className="text-[13px] opacity-50">@yourname · Now</p>
            </div>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-[1.5]">
              {`spent 6 months trying to build a habit.

tried 4 habit apps. none stuck because they all asked the same generic "log your habits" question.

so i built one that asks me ONE specific question at 9pm. that's it.

47 days in. longest streak i've ever had.

sometimes the fix is removing features, not adding them.`}
            </p>
            <div className="mt-3.5 flex items-center gap-6 text-[12px] opacity-50">
              <span>💬 18</span>
              <span>🔁 47</span>
              <span>❤️ 284</span>
              <span>📊 12.4K</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
 * BanSafetyMockup — the pre-post check she runs before anything
 * goes live. Shown in the gallery as one more piece of the work.
 * ----------------------------------------------------------------- */
function BanSafetyMockup() {
  const checks = [
    { label: "Helpful first, no direct pitch", pass: true },
    { label: "4 days since last post in this community", pass: true },
    { label: "Voice match: 0.86", pass: true },
    { label: "Thread relevance: high", pass: true },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#0a0a0a]/8 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-[#16a34a]" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-[#0a0a0a]/50">
            Pre-post check · r/SaaS reply
          </span>
        </div>
      </div>

      {/* Check rows */}
      <div className="divide-y divide-[#0a0a0a]/6 px-5">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center justify-between py-3.5">
            <span className="text-[13px] text-[#0a0a0a]/75">{c.label}</span>
            <span className="ml-4 shrink-0 text-[13px] font-semibold text-[#16a34a]">✓</span>
          </div>
        ))}
      </div>

      {/* Result */}
      <div className="border-t border-[#0a0a0a]/8 bg-[#0a0a0a] px-5 py-4">
        <p className="text-[13px] font-semibold text-white">Going live.</p>
        <p className="mt-0.5 text-[11px] text-white/50">
          Your account stays native. Your reputation compounds.
        </p>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
 * Beat 5 — THE WORK [gallery]. Mixed artifacts: the three videos she
 * films (Studio), the Reddit reply, the X post, the pre-post check.
 * ----------------------------------------------------------------- */
function StudioVideo({
  platform,
  label,
}: {
  platform: "tiktok" | "instagram" | "youtube";
  label: string;
}) {
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <PlatformVideo platform={platform} label={label} />
      <span className="absolute -top-2.5 right-1 z-10 rotate-2 rounded-full border border-[#0a0a0a]/15 bg-[#fbfaf6] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
        Studio
      </span>
    </div>
  );
}

function GalleryLabel({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <p className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/50">
      {icon}
      {text}
    </p>
  );
}

function WorkGallery() {
  return (
    <section id="work" className="relative px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
            The work
          </p>
          <h2 className="mb-14 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl sm:mb-20">
            Your voice. Native everywhere.
          </h2>
        </RevealOnView>

        {/* The videos she films — Studio tier */}
        <RevealOnView delay={0.1}>
          <div className="grid gap-12 sm:grid-cols-3 sm:gap-8">
            <StudioVideo
              platform="tiktok"
              label="POV: you finally cleared your camera roll in one sitting"
            />
            <StudioVideo
              platform="instagram"
              label="3 apps tried to fix my camera roll. only one actually did."
            />
            <StudioVideo
              platform="youtube"
              label="Built by hand. Marketed by Maya."
            />
          </div>
        </RevealOnView>

        {/* The posts she writes */}
        <div className="mt-16 grid gap-12 sm:mt-20 lg:grid-cols-2 lg:gap-10">
          <RevealOnView delay={0.05}>
            <GalleryLabel
              icon={<RedditLogo className="size-3.5" />}
              text="Reddit · her drafted reply"
            />
            <RedditMockup />
          </RevealOnView>
          <div className="flex flex-col gap-12">
            <RevealOnView delay={0.12}>
              <GalleryLabel
                icon={<XLogo className="size-3.5" />}
                text="X · founder post"
              />
              <XMockup />
            </RevealOnView>
            <RevealOnView delay={0.18}>
              <GalleryLabel
                icon={
                  <span className="inline-block size-2 rounded-full bg-[#16a34a]" />
                }
                text="Before anything goes live"
              />
              <BanSafetyMockup />
            </RevealOnView>
          </div>
        </div>

        <RevealOnView delay={0.1}>
          <p className="mt-14 max-w-2xl text-[15px] leading-[1.6] text-[#0a0a0a]/60">
            Reddit &amp; TikTok always wait for your one tap. That tap is why
            your accounts never get flagged.
          </p>
        </RevealOnView>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 6 — THE RECEIPTS [glass]. Dark slab holding the actual
 * product: a live-styled miniature of Mission Control's Results tab.
 * Palette matches the shipped app (mission.css tokens).
 * ----------------------------------------------------------------- */
function AttributionMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#243044] bg-[#0B0F15] shadow-[0_1px_2px_rgba(0,0,0,0.2),0_32px_80px_-24px_rgba(10,15,25,0.55)]">
      {/* App chrome */}
      <div className="flex items-center justify-between border-b border-[#1B2434] px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#5D6E85]">
          Mission Control · Results
        </span>
        <span className="font-mono text-[10px] text-[#5D6E85]">This week</span>
      </div>

      <div className="grid grid-cols-5 gap-3 p-4">
        {/* Hero KPI */}
        <div className="col-span-3 rounded-xl border border-[#1B2434] bg-gradient-to-b from-[#18212F] to-[#111823] p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#5D6E85]">
            Signups · attributed
          </p>
          <p className="mt-1 text-[38px] font-extrabold leading-none tracking-tight text-[#E9EEF6] tabular-nums">
            7
          </p>
          <p className="mt-1 text-[11px] font-semibold text-[#2EBD85] tabular-nums">▲ 4 vs last week</p>
          <svg className="mt-2" width="150" height="26" viewBox="0 0 150 26" aria-hidden="true">
            <polyline
              points="2,22 27,20 52,21 77,15 102,17 127,8 148,4"
              fill="none" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round"
            />
            <circle cx="148" cy="4" r="3" fill="#38BDF8" />
          </svg>
        </div>
        {/* Funnel */}
        <div className="col-span-2 rounded-xl border border-[#1B2434] bg-[#111823] p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#5D6E85]">Funnel</p>
          <div className="mt-2.5 space-y-2">
            {[
              { k: "Posts", w: "100%", v: "11" },
              { k: "Clicks", w: "64%", v: "96" },
              { k: "Signups", w: "14%", v: "7" },
            ].map((s) => (
              <div key={s.k} className="flex items-center gap-2">
                <span className="w-11 text-[10px] text-[#8FA0B5]">{s.k}</span>
                <span
                  className="h-3.5 rounded-[3px] bg-gradient-to-r from-[#155E86] to-[#0C86C4]"
                  style={{ width: s.w, minWidth: 6 }}
                />
                <span className="ml-auto text-[11px] font-bold text-[#E9EEF6] tabular-nums">{s.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Receipt rows */}
        <div className="col-span-5 divide-y divide-[#1B2434] rounded-xl border border-[#1B2434] bg-[#111823]">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <SiReddit className="size-3.5 shrink-0" color="#D95F27" />
              <p className="truncate text-[12px] text-[#E9EEF6]">
                &ldquo;Most indie apps die from zero distribution&rdquo;
              </p>
            </div>
            <p className="shrink-0 text-[12px] tabular-nums text-[#8FA0B5]">
              41 clicks · <span className="font-bold text-[#2EBD85]">3 signups</span>
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FaXTwitter className="size-3.5 shrink-0" color="#8FA0B5" />
              <p className="truncate text-[12px] text-[#E9EEF6]">
                Reply: &ldquo;shipped 14 projects, zero users&rdquo;
              </p>
            </div>
            <p className="shrink-0 text-[12px] tabular-nums text-[#8FA0B5]">
              19 clicks · <span className="font-bold text-[#2EBD85]">2 signups</span>
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 opacity-45">
            <div className="flex min-w-0 items-center gap-2">
              <FaLinkedin className="size-3.5 shrink-0" color="#5E77E8" />
              <p className="truncate text-[12px] text-[#E9EEF6]">
                &ldquo;Built it in a weekend. Users are the job.&rdquo;
              </p>
            </div>
            <p className="shrink-0 text-[12px] tabular-nums text-[#8FA0B5]">6 clicks · 0</p>
          </div>
        </div>
      </div>

      {/* Insight bar */}
      <div className="border-t border-[#1B2434] bg-[#0d1420] px-5 py-3">
        <p className="text-[12px] leading-snug text-[#8FA0B5]">
          <span className="font-semibold text-[#E9EEF6]">Reddit converts. X doesn&apos;t yet.</span>{" "}
          Doubling Reddit this week.
        </p>
      </div>
    </div>
  );
}

function Receipts() {
  return (
    <section id="receipts" className="relative px-6 py-16 sm:px-10 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <div className="rounded-[2rem] border border-[#1B2434] bg-[#0B0F15] px-6 py-14 shadow-[0_48px_120px_-48px_rgba(10,15,25,0.6)] sm:rounded-[2.5rem] sm:px-12 sm:py-20 lg:px-16">
            <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#5D6E85]">
              The receipts
            </p>
            <h2 className="mb-12 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight text-[#E9EEF6] sm:mb-14">
              Not likes. Signups.
            </h2>
            <div className="max-w-3xl">
              <AttributionMockup />
            </div>
            <p className="mt-8 max-w-2xl text-[15px] leading-[1.6] text-[#8FA0B5]">
              Every link tracked, click → signup. Sundays she re-weights the
              plan by what converted.
            </p>
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 7 — GUARDRAILS [paper]. One strip, three chips. No section
 * weight — it reads on the way to pricing.
 * ----------------------------------------------------------------- */
/* -----------------------------------------------------------------
 * Beat 8 — PRICING [paper]. Editorial three-column, not boxy SaaS
 * cards. The header does the selling; the columns are the receipt.
 * ----------------------------------------------------------------- */
function PriceColumn({
  accent,
  price,
  cadence,
  annual,
  name,
  line,
  features,
  footnote,
}: {
  accent: boolean;
  price: string;
  cadence: string;
  annual: string;
  name: string;
  line: string;
  features: string[];
  footnote: string;
}) {
  return (
    <div
      className={`flex h-full flex-col border-t pt-8 ${
        accent ? "border-[#0a0a0a]" : "border-[#0a0a0a]/15"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display italic text-[clamp(2.6rem,5vw,4rem)] leading-[0.9] tracking-tight">
          {price}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
          {cadence}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] tracking-[0.05em] text-[#0a0a0a]/40">
        {annual}
      </p>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
        {name}
      </p>
      <p className="mt-2 max-w-sm font-display italic text-[1.35rem] leading-[1.15] tracking-tight">
        {line}
      </p>
      <ul className="mt-7 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-baseline gap-3">
            <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-[#0a0a0a]/40" />
            <span className="text-[15px] leading-[1.5] text-[#0a0a0a]/75">
              {f}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-8">
        <Link
          prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
          className="inline-flex items-center gap-2 rounded-full border border-[#0a0a0a]/20 px-5 py-2.5 text-[14px] text-[#0a0a0a] transition-colors hover:bg-[#0a0a0a] hover:text-[#fbfaf6]"
        >
          {primaryCtaLabel("Start free")}
          <span>→</span>
        </Link>
        <p className="mt-5 text-[13px] text-[#0a0a0a]/45">{footnote}</p>
      </div>
    </div>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="relative px-6 py-24 sm:px-10 sm:py-36">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
            Pricing
          </p>
          <h2 className="mb-16 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.15] tracking-tight max-w-3xl sm:mb-20">
            A human social media manager: $5,000/mo. Maya:
          </h2>
        </RevealOnView>
        <RevealOnView delay={0.05}>
          <p className="mb-14 font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
            Every plan · ban-safe by design · your voice, always · you approve
            everything
          </p>
        </RevealOnView>
        <div className="grid grid-cols-12 gap-y-14 sm:gap-x-12">
          <RevealOnView delay={0.05} className="col-span-12 sm:col-span-4">
            <PriceColumn
              accent={false}
              price="$99"
              cadence="/mo"
              annual="or $999/yr"
              name="HeyMaya Starter"
              line="She writes and posts."
              features={[
                "Up to 3 channels, run for you",
                "Finds where your buyers already are",
                "Writes posts + replies in your learned voice",
                "Designs grounded slideshows from your real screens",
                "Posts for you, ban safe, on the channels you connect",
                "Proves which post drove the click, not just likes",
              ]}
              footnote="7 days free, then $99/mo. Cancel anytime."
            />
          </RevealOnView>
          <RevealOnView delay={0.1} className="col-span-12 sm:col-span-4">
            <PriceColumn
              accent={false}
              price="$149"
              cadence="/mo"
              annual="or $1,499/yr"
              name="HeyMaya Growth"
              line="More surface, images too."
              features={[
                "Up to 6 channels, run for you",
                "Everything in Starter, across twice the surface",
                "She works every channel your audience actually lives on",
                "One voice, one operator, coordinated across all of them",
                "Same click-level attribution on every post",
              ]}
              footnote="7 days free, then $149/mo. Upgrade or downgrade anytime."
            />
          </RevealOnView>
          <RevealOnView delay={0.15} className="col-span-12 sm:col-span-4">
            <PriceColumn
              accent
              price="$199"
              cadence="/mo · Studio"
              annual="or $1,999/yr"
              name="HeyMaya Studio"
              line="She films it."
              features={[
                "Up to 6 channels, run for you",
                "Everything in Growth, plus:",
                "~15 short-form videos a month, made for you",
                "Copies the video format already winning your niche",
                "Built from your real product, never a fake UI",
                "Posted and click-tracked, like everything else",
              ]}
              footnote="7 days free, then $199/mo. Upgrade or downgrade anytime."
            />
          </RevealOnView>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Beat 9 — CLOSER [dark]. Full ink. The flat line bends upward.
 * ----------------------------------------------------------------- */
function Closer() {
  return (
    <section className="relative bg-[#0a0a0a] px-6 py-28 text-[#fbfaf6] sm:px-10 sm:py-40">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <h2 className="font-display italic text-[clamp(2.8rem,8vw,7rem)] leading-[1] tracking-tight">
            The flat line
            <br />
            doesn&rsquo;t fix itself.
          </h2>
        </RevealOnView>
        <RevealOnView delay={0.2}>
          <div className="mt-16 flex flex-wrap items-center gap-6">
            <Link
              prefetch={false}
              href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
              className="cta-primary cta-primary-inverted cta-primary-large"
            >
              {primaryCtaLabel("Put her to work")}
              <span className="cta-arrow">→</span>
            </Link>
            <div className="max-w-sm">
              <p className="text-[15px] leading-[1.55] text-[#fbfaf6]/65">
                Four-minute setup. Connect the channels you want her on. She
                takes it from there.
              </p>
              <p className="mt-3 text-[13px] text-[#fbfaf6]/40">
                7 days free, plans from $99/mo. Cancel any time.
              </p>
            </div>
          </div>
        </RevealOnView>

        {/* The bend — the flat line resolves upward */}
        <RevealOnView delay={0.3}>
          <div className="mt-28 sm:mt-32">
            <RisingGraph color="#fbfaf6" />
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}

function RisingGraph({ color = "#0a0a0a" }: { color?: string }) {
  return (
    <div data-rising-graph>
      <svg
        viewBox="0 0 1200 200"
        className="w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M 0 160 L 600 160 Q 800 160 900 110 T 1200 12"
          stroke={color}
          strokeWidth="1.5"
          fill="none"
          className="rising-path"
        />
        <circle cx={1200} cy={12} r={5} fill={color} />
      </svg>
    </div>
  );
}

/* -----------------------------------------------------------------
 * Footer — micro, mono.
 * ----------------------------------------------------------------- */
function Footer() {
  return (
    <footer className="px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-4 font-mono text-[10px] uppercase tracking-[0.22em] opacity-50">
        <span>HeyMaya</span>
        <div className="flex gap-6">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:josh@heymaya.com">Contact</a>
        </div>
      </div>
    </footer>
  );
}

/* -----------------------------------------------------------------
 * ScrollLine — fixed vertical hairline on the left margin with a
 * dot tracked to scroll progress. The signature ambient element.
 * ----------------------------------------------------------------- */
function ScrollLine() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    function onScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const next = max > 0 ? window.scrollY / max : 0;
      setProgress(Math.max(0, Math.min(1, next)));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div
      className="pointer-events-none fixed left-4 top-0 z-20 hidden h-screen w-px sm:left-6 sm:block"
      aria-hidden="true"
    >
      <div className="relative h-full w-px bg-[#0a0a0a]/12">
        <div
          className="absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-[#0a0a0a]"
          style={{
            top: `${progress * 100}%`,
            transition: "top 0.15s ease-out",
          }}
        />
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
 * RevealOnView — IntersectionObserver wrapper. Adds data-visible
 * once the element enters the viewport. CSS handles the rest.
 * ----------------------------------------------------------------- */
function RevealOnView({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  /** Extra classes (e.g. grid col-span) so the reveal wrapper can BE the item. */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        }
      },
      // Fire early and easy: tall artifact blocks (quote grids, galleries)
      // never satisfy a high threshold on short viewports and sat invisible —
      // a scroller met blank paper (live finding, 2026-07-16). 8% visible with
      // a light bottom margin reveals just before the eye arrives.
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal-on-view ${className}`.trim()}
      data-visible={visible ? "true" : "false"}
      style={{ transitionDelay: visible ? `${delay}s` : "0s" }}
    >
      {children}
    </div>
  );
}

/* -----------------------------------------------------------------
 * Page-scoped styles. Lives inline so the white-mode treatment
 * doesn't leak into the dark theme used elsewhere in the app.
 * Selectors target [data-page="clawlaunch-landing"] descendants.
 * ----------------------------------------------------------------- */
function PageStyles() {
  return (
    <style jsx global>{`
      [data-page="clawlaunch-landing"] {
        /* Paper texture — subtle off-white wash. Drawn in CSS so
           there's no asset request. */
        background-color: #fbfaf6;
        background-image: radial-gradient(
            circle at 10% 0%,
            rgba(10, 10, 10, 0.025),
            transparent 38%
          ),
          radial-gradient(
            circle at 90% 100%,
            rgba(10, 10, 10, 0.03),
            transparent 42%
          );
      }

      /* Add a paper-grain noise on top. Tiny, almost-imperceptible
         flecking that breaks up flat color. */
      [data-page="clawlaunch-landing"]::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>");
        opacity: 0.5;
        mix-blend-mode: multiply;
      }

      /* Anchored sections clear the sticky bar on jump. */
      [data-page="clawlaunch-landing"] section[id] {
        scroll-margin-top: 72px;
      }

      /* Hero letter-mask reveal — each line is a span with the
         hero-line class. They slide up and fade in on page load. */
      [data-page="clawlaunch-landing"] .hero-headline {
        font-size: clamp(2.5rem, 8.5vw, 6.5rem);
        line-height: 1;
        letter-spacing: -0.025em;
        font-weight: 400;
      }
      [data-page="clawlaunch-landing"] .hero-line {
        opacity: 0;
        transform: translateY(48px);
        animation: heroRise 3.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      [data-page="clawlaunch-landing"] .hero-headline .hero-line {
        display: block;
      }
      @keyframes heroRise {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* IntersectionObserver-driven reveals. */
      [data-page="clawlaunch-landing"] .reveal-on-view {
        opacity: 0;
        transform: translateY(36px);
        transition:
          opacity 1.8s cubic-bezier(0.16, 1, 0.3, 1),
          transform 1.8s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: opacity, transform;
      }
      [data-page="clawlaunch-landing"] .reveal-on-view[data-visible="true"] {
        opacity: 1;
        transform: translateY(0);
      }

      /* CTA — pill, black, ink hover state. */
      [data-page="clawlaunch-landing"] .cta-primary {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.95rem 1.5rem;
        border-radius: 999px;
        background: #0a0a0a;
        color: #fbfaf6;
        font-family: var(--font-geist-sans), ui-sans-serif, sans-serif;
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        transition:
          background 0.25s ease,
          color 0.25s ease,
          transform 0.15s ease;
      }
      [data-page="clawlaunch-landing"] .cta-primary:hover {
        background: #2e2e2e;
        color: #fbfaf6;
      }
      [data-page="clawlaunch-landing"] .cta-primary:active {
        transform: translateY(1px);
      }
      [data-page="clawlaunch-landing"] .cta-primary-large {
        padding: 1.4rem 2.1rem;
        font-size: 12px;
      }
      /* Inverted variant for the dark closer. */
      [data-page="clawlaunch-landing"] .cta-primary-inverted {
        background: #fbfaf6;
        color: #0a0a0a;
      }
      [data-page="clawlaunch-landing"] .cta-primary-inverted:hover {
        background: #eae7dd;
        color: #0a0a0a;
      }
      [data-page="clawlaunch-landing"] .cta-arrow {
        transition: transform 0.25s ease;
      }
      [data-page="clawlaunch-landing"] .cta-primary:hover .cta-arrow {
        transform: translateX(4px);
      }

      /* Rising-graph path draws itself on view. */
      [data-page="clawlaunch-landing"] .rising-path {
        stroke-dasharray: 2200;
        stroke-dashoffset: 2200;
        transition: stroke-dashoffset 1.8s cubic-bezier(0.22, 1, 0.36, 1);
      }
      [data-page="clawlaunch-landing"]
        .reveal-on-view[data-visible="true"]
        .rising-path,
      [data-page="clawlaunch-landing"]
        [data-rising-graph].is-visible
        .rising-path {
        stroke-dashoffset: 0;
      }

      /* Reduced motion — disable everything that moves. */
      @media (prefers-reduced-motion: reduce) {
        [data-page="clawlaunch-landing"] .hero-line {
          opacity: 1;
          transform: none;
          animation: none;
        }
        [data-page="clawlaunch-landing"] .reveal-on-view {
          opacity: 1;
          transform: none;
          transition: none;
        }
        [data-page="clawlaunch-landing"] .rising-path {
          stroke-dashoffset: 0;
          transition: none;
        }
      }
    `}</style>
  );
}
