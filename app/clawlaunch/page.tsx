"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import {
  SiInstagram,
  SiReddit,
  SiTelegram,
  SiTiktok,
  SiYcombinator,
  SiYoutube,
} from "react-icons/si";

import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";

/**
 * Sprint 2.31 — landing page redesign.
 *
 * Editorial-newsroom aesthetic. White paper, black ink, single lime
 * accent (Maya's signature) — used only for the scroll-tracked line
 * and the primary CTA hover. Type does the heavy lifting:
 *   - Instrument Serif (italic + roman) for display
 *   - Geist Sans for body
 *   - Geist Mono for eyebrows + labels (the "developer voice")
 *
 * ICP locked to vibe coders: builders Cursor / Claude / v0 / Lovable /
 * Bolt unlocked, who shipped fast and now stare at flat signup graphs.
 *
 * Signature element: a horizontal "marketing graph" line that travels
 * down the page with the scroll, flat through every section, then
 * bending upward at the CTA. The metaphor is the empty signup graph
 * becoming non-empty.
 *
 * Animations are typography-driven: letter-mask reveals on the hero,
 * IntersectionObserver fades on each section, sticky compression on
 * the headline. All respect prefers-reduced-motion.
 *
 * Note: this file declares its own page-scoped styles via a global
 * <style> block keyed to `data-page="clawlaunch-landing"`, so the
 * white-mode treatment never leaks into the dark-theme creator app.
 */

// Note: metadata exports are only valid in server components. Since
// this page is a client component, metadata is set via the parent
// (app/page.tsx re-export, or a separate route segment layout). For
// now we re-export an unused placeholder; app/page.tsx imports its
// own metadata from a server boundary.
export const landingMetadata: Metadata = {
  title:
    "Maya — the marketing hire for builders Cursor unlocked.",
  description:
    "You shipped fast. Marketing is the wall. Maya finds where your customers are, writes AND posts the content for you, and tracks which posts are actually driving traffic, so your signup graph stops being a flat line.",
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
      <Hero />
      <Channels />
      <AWeekWithMaya />
      <TelegramSection />
      <Attribution />
      <BanSafety />
      <StaysCurrent />
      <Pricing />
      <FinalCTA />
      <Footer />
    </main>
  );
}

/* -----------------------------------------------------------------
 * Masthead — Geist Mono eyebrow strip across the top. Hairline below.
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
        <nav className="hidden items-center gap-7 font-mono text-[11px] uppercase tracking-[0.22em] sm:flex">
          <a href="#what" className="opacity-60 hover:opacity-100">
            Channels
          </a>
          <a href="#week" className="opacity-60 hover:opacity-100">
            A week
          </a>
          <a href="#proof" className="opacity-60 hover:opacity-100">
            Proof
          </a>
          <a href="#safe" className="opacity-60 hover:opacity-100">
            Ban-safe
          </a>
          <Link href="/sign-in" className="opacity-60 hover:opacity-100">
            Sign in
          </Link>
          <Link
            prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
            className="rounded-full bg-[#0a0a0a] px-4 py-2 text-[#fbfaf6] transition-colors hover:bg-[#0a0a0a]/85"
          >
            {primaryCtaLabel("Get started")} →
          </Link>
        </nav>
        <Link
          prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
          className="font-mono text-[11px] uppercase tracking-[0.22em] underline-offset-[6px] hover:underline sm:hidden"
        >
          {primaryCtaLabel("Get started")} →
        </Link>
      </div>
    </header>
  );
}

/* -----------------------------------------------------------------
 * Hero — letter-mask reveal on the italic headline. Asymmetric grid:
 * headline left-weighted; right column carries the eyebrow + meta
 * datum (mono, like the colophon of a magazine).
 * ----------------------------------------------------------------- */
function Hero() {
  return (
    <section className="relative px-6 pt-24 pb-32 sm:px-10 sm:pt-36 sm:pb-48 lg:pt-44 lg:pb-56">
      <div className="mx-auto max-w-7xl">
        {/* The headline */}
        <h1 className="hero-headline">
          <span className="hero-line font-display italic" style={{ animationDelay: "0.2s" }}>
            You built your dream app.
          </span>
          <span
            className="hero-line font-display italic block"
            style={{ animationDelay: "1.6s" }}
          >
            Now you can&apos;t get a customer.
          </span>
        </h1>

        {/* Subhead + CTA */}
        <div
          className="hero-line mt-14 max-w-2xl lg:mt-20"
          style={{ animationDelay: "3.6s" }}
        >
          <p className="text-[18px] leading-[1.55] text-[#0a0a0a]/75 sm:text-[20px] sm:leading-[1.5]">
            Maya finds the people already looking for what you built. She writes
            like a person, posts from your accounts without getting them banned,
            and shows you which post got the signup.{" "}
            <span className="italic text-[#0a0a0a] pr-[0.12em]">You approve the plan.
            She does the rest.</span>
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link
              prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
              className="cta-primary"
            >
              {primaryCtaLabel("Start HeyMaya")}
              <span className="cta-arrow">→</span>
            </Link>
            <a
              href="#what"
              className="font-mono text-[11px] uppercase tracking-[0.22em] underline-offset-[6px] hover:underline"
            >
              See how it works ↓
            </a>
          </div>
        </div>
      </div>

    </section>
  );
}

/* -----------------------------------------------------------------
 * WhatSheDoes — three vertical editorial columns. No boxes, no
 * cards. Just type, a numeral, and a verb.
 * ----------------------------------------------------------------- */
/* -----------------------------------------------------------------
 * Channels — the showstopper. Each platform gets its own pane with
 * (a) the real platform logo, (b) plain-English explanation of what
 * we do, and (c) a native-looking mockup of the actual work product
 * — the reply, the post, the brief — so the reader can SEE what
 * ClawLaunch hands them, not just read about it.
 * ----------------------------------------------------------------- */

/* Brand logos — Simple Icons via react-icons. Each carries its
 * canonical brand color; TikTok gets a wrapper for the
 * chromatic-aberration treatment the flat mark lacks. */
function RedditLogo({ className }: { className?: string }) {
  return <SiReddit className={className} color="#FF4500" aria-label="Reddit" />;
}

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

      {/* Our drafted reply */}
      <div className="relative bg-[#fbfaf6] px-5 py-4 pl-7">
        <div className="absolute bottom-4 left-4 top-4 w-[2px] bg-[#FF4500]/35" />
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-semibold">u/yourname</span>
          <span className="opacity-40">· just now</span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed">
          had this exact problem with mine — what worked was switching the
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

/* Hacker News — orange mark. */
function HackerNewsLogo({ className }: { className?: string }) {
  return <SiYcombinator className={className} color="#FF6600" aria-label="Hacker News" />;
}

function HackerNewsMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      {/* HN header */}
      <div className="flex items-center gap-3 border-b border-[#0a0a0a]/8 bg-[#FF6600] px-4 py-2.5">
        <SiYcombinator className="size-4" color="white" />
        <span className="text-[12px] font-semibold text-white">Hacker News</span>
      </div>

      {/* Thread */}
      <div className="border-b border-[#0a0a0a]/8 px-5 py-4">
        <p className="text-[14px] font-semibold leading-snug">
          Ask HN: Best way to get feedback on a new B2B tool nobody&apos;s heard of?
        </p>
        <p className="mt-1.5 text-[11px] text-[#0a0a0a]/45">
          142 points · 3 hours ago · 67 comments
        </p>
      </div>

      {/* Top reply — Maya drafted */}
      <div className="px-5 py-4">
        <p className="mb-2 text-[11px] font-semibold text-[#0a0a0a]/45">
          yourname · 1 hour ago · 34 points
        </p>
        <p className="text-[13px] leading-relaxed">
          The thing that actually worked for me: stop asking for feedback and
          start showing up in the conversations where people already have the
          problem. Found 3 threads this week where people described exactly
          what my app solves — replied with what I learned building it, linked
          it at the end. My first real users came from that, not cold outreach.
        </p>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-[#0a0a0a]/40">
          <span>reply</span>
          <span>flag</span>
          <span>hide</span>
        </div>
      </div>
    </div>
  );
}

/* TikTok — chromatic-aberration: cyan + magenta marks offset behind a
 * black mark, the brand's signature glitch. Wrapper sizes the stack. */
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

/* LinkedIn — native blue square mark. */
function LinkedInLogo({ className }: { className?: string }) {
  return (
    <FaLinkedin className={className} color="#0A66C2" aria-label="LinkedIn" />
  );
}

/* YouTube — canonical red mark. */
function YouTubeLogo({ className }: { className?: string }) {
  return <SiYoutube className={className} color="#FF0000" aria-label="YouTube" />;
}

/* X — solid black mark. */
function XLogo({ className }: { className?: string }) {
  return <FaXTwitter className={className} color="#0a0a0a" aria-label="X" />;
}

/* Instagram — brand gradient mark. */
function InstagramLogo({ className }: { className?: string }) {
  return <SiInstagram className={className} color="#E4405F" aria-label="Instagram" />;
}

/* -----------------------------------------------------------------
 * Demo videos — the differentiator made visible. Maya MAKES the video
 * (TikTok + Reels), not just posts it. Drop the founder-facing clips at
 * the paths below and fill these in; until set, a clean placeholder
 * frame renders (no fake content, no 404s).
 *   public/demos/tiktok.mp4   (+ optional tiktok.jpg poster)
 *   public/demos/instagram.mp4
 * ----------------------------------------------------------------- */
const DEMO_VIDEOS: Record<
  "tiktok" | "instagram" | "youtube",
  { src: string | null; poster: string | null }
> = {
  tiktok: { src: "/demos/tiktok.mp4", poster: "/demos/tiktok.jpg" },
  // Reuse the real avatar testimonial Maya cut for HeyMaya (also the YouTube pane).
  instagram: { src: "/demos/youtube.mp4", poster: "/demos/youtube.jpg" },
  // The avatar testimonial Maya cut for HeyMaya itself — a Short, dogfooded.
  youtube: { src: "/demos/youtube.mp4", poster: "/demos/youtube.jpg" },
};

/* A 9:16 phone showing the actual video Maya made. Real <video> when the
 * clip is wired; a tasteful "made by Maya" placeholder until then. */
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
                  "radial-gradient(circle at 50% 36%, rgba(214,255,61,0.14), transparent 58%)",
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-[#d6ff3d]">
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

/* LinkedIn mockup — native-feeling founder post. */
function LinkedInMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-3 border-b border-[#0a0a0a]/8 px-5 py-4">
        <div className="size-11 shrink-0 rounded-full bg-gradient-to-br from-[#d8dde7] to-[#a8b0c0]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Your Name</p>
          <p className="text-[11px] opacity-60">
            Founder · building [your habit-tracker app]
          </p>
          <p className="text-[11px] opacity-50">Now · 🌐</p>
        </div>
        <div className="text-[12px] font-semibold text-[#0A66C2]">+ Follow</div>
      </div>
      <div className="px-5 py-5">
        <p className="whitespace-pre-line text-[14px] leading-[1.55]">
          {`3 months ago I was trying to build a habit.

I had 4 different apps open at any given time.

None of them stuck.

So I built one that asks me one specific question every night at 9pm. That's it. No streaks. No charts. No "your streak is at risk" notifications.

Just one question.

I'm 47 days in. Longest I've ever gone with any habit tracker.

Sometimes the answer is making it simpler, not adding another feature.`}
        </p>
        <p className="mt-3 text-[13px] font-semibold text-[#0A66C2]">
          #buildinpublic #productivity
        </p>
      </div>
      <div className="flex items-center justify-between border-t border-[#0a0a0a]/8 px-5 py-2.5 text-[11px] opacity-60">
        <span>👍 ❤️ 🎉 &nbsp;142</span>
        <span>28 comments · 12 reposts</span>
      </div>
    </div>
  );
}

/* X mockup — a native-feeling tweet draft. */
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

interface ChannelPaneProps {
  logo: React.ReactNode;
  name: string;
  tagline: string;
  body: string;
  mockupLabel: string;
  mockup: React.ReactNode;
}

function ChannelPane({
  logo,
  name,
  tagline,
  body,
  mockupLabel,
  mockup,
}: ChannelPaneProps) {
  return (
    <article className="border-b border-[#0a0a0a]/10 py-28 first:pt-6 sm:py-40 sm:first:pt-10 lg:py-48 lg:first:pt-12 last:border-b-0">
      <RevealOnView>
        <div className="grid grid-cols-12 gap-y-12 lg:gap-x-8 lg:gap-y-0">
          {/* LEFT — text */}
          <div className="col-span-12 lg:col-span-5">
            <div className="mb-5">{logo}</div>
            <h3 className="font-display italic text-[clamp(2.8rem,7vw,5rem)] leading-[1] tracking-tight">
              {name}
            </h3>
            <p className="mt-3 font-display italic text-[clamp(1.4rem,2.4vw,1.9rem)] leading-[1.2] tracking-tight text-[#0a0a0a]/85">
              {tagline}
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-[1.65] text-[#0a0a0a]/70">
              {body}
            </p>
          </div>

          {/* RIGHT — mockup */}
          <div className="col-span-12 lg:col-span-7 lg:pl-8">
            <p className="mb-5 text-[13px] italic text-[#0a0a0a]/55">
              {mockupLabel}
            </p>
            {mockup}
          </div>
        </div>
      </RevealOnView>
    </article>
  );
}

function Channels() {
  return (
    <section
      id="what"
      className="relative border-t border-[#0a0a0a]/10 px-6 sm:px-10"
    >
      <div className="mx-auto max-w-7xl">
        <div className="pt-28 sm:pt-40">
          <RevealOnView>
            <h2 className="mb-8 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl">
              Here&apos;s how it looks, channel by channel.
            </h2>
          </RevealOnView>
          <RevealOnView delay={0.15}>
            <p className="max-w-2xl text-[16px] leading-[1.6] text-[#0a0a0a]/70">
              Plenty of tools will post for you. Maya{" "}
              <span className="italic text-[#0a0a0a] pr-[0.12em]">makes</span> the content
              first — writes the posts, films the videos — then posts it. One
              real example per platform.
            </p>
          </RevealOnView>
        </div>

        <div className="mt-10 sm:mt-14">
          <ChannelPane
            logo={<XLogo className="size-11" />}
            name="X."
            tagline="Where build-in-public actually turns into your first users."
            body="She finds the conversations where your product fits. She writes the reply, the founder post, the build update, and posts it for you. She tells you when to jump in, not just when to be loud."
            mockupLabel="Here's the post she'd publish →"
            mockup={<XMockup />}
          />

          <ChannelPane
            logo={<LinkedInLogo className="size-11" />}
            name="LinkedIn."
            tagline="Where the founders, operators, and buyers in your space actually hang out."
            body="She finds the people who'd care. She writes the post they'd actually stop scrolling for and publishes it in your voice. She tells you who to follow back and who to ignore."
            mockupLabel="Here's the post she'd publish →"
            mockup={<LinkedInMockup />}
          />

          <ChannelPane
            logo={<TikTokLogo className="size-11" />}
            name="TikTok."
            tagline="Where the right 15 seconds turns a stranger into your next signup."
            body="Here's the part no one else does: she doesn't hand you a brief to go film. She makes the actual video, with your real product in it, captioned and on brand, then posts it. You never open a camera or an editor."
            mockupLabel="Here's the video she'd post →"
            mockup={<PlatformVideo platform="tiktok" label="POV: you finally cleared your camera roll in one sitting" />}
          />

          <ChannelPane
            logo={<InstagramLogo className="size-11" />}
            name="Instagram."
            tagline="Where Reels put your product in front of people who've never heard of you."
            body="Same idea, made for Reels. She turns what's working in your niche into a real short-form video built from your actual screens, then posts it to your grid. The content gets made for you, not just scheduled."
            mockupLabel="Here's the Reel she'd post →"
            mockup={<PlatformVideo platform="instagram" label="3 apps tried to fix my camera roll. only one actually did." />}
          />

          <ChannelPane
            logo={<RedditLogo className="size-11" />}
            name="Reddit."
            tagline="Where your users are literally asking the question your app answers."
            body="She finds the thread the second it lands. She writes the reply so it sounds like a real person, then posts it for you."
            mockupLabel="Here's what she'd send to this thread →"
            mockup={<RedditMockup />}
          />

          <ChannelPane
            logo={<HackerNewsLogo className="size-11" />}
            name="Hacker News."
            tagline="Where the founders who'd pay for your tool are already asking for it."
            body="She finds the Ask HN threads, Show HN launches, and comment chains where your ICP is describing the exact problem you solved. She writes the reply that sounds like a founder who built the thing and hands it to you ready to paste, one tap straight to the thread. (HN has no posting API, so this is the one channel where you hit submit. Everything else she posts for you.)"
            mockupLabel="Here's the reply she'd hand you →"
            mockup={<HackerNewsMockup />}
          />

          <ChannelPane
            logo={<YouTubeLogo className="size-11" />}
            name="YouTube."
            tagline="Where your buyers already explained the problem, in the comments."
            body="She mines comment sections across your niche's top videos to find the exact language your buyers use when they describe the problem. That becomes the script. Then she makes the Short, your real product in it, and uploads it to your channel."
            mockupLabel="Here's one she made →"
            mockup={<PlatformVideo platform="youtube" label="Built by hand. Marketed by Maya." />}
          />
        </div>

        <div className="pb-28 sm:pb-40" aria-hidden="true" />
      </div>
    </section>
  );
}



/* -----------------------------------------------------------------
 * Pricing — three ways to let her run it. Editorial three-column,
 * not boxy SaaS cards. Same operator + same proof on every tier;
 * the columns differ only in breadth (channels) and whether she
 * also films it. The Studio column carries the lime accent.
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
            <span
              className={`mt-1 inline-block size-1.5 shrink-0 rounded-full ${
                accent ? "bg-[#d6ff3d]" : "bg-[#0a0a0a]/40"
              }`}
            />
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
          className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] transition-colors ${
            accent
              ? "bg-[#0a0a0a] text-[#d6ff3d] hover:bg-[#0a0a0a]/85"
              : "border border-[#0a0a0a]/20 text-[#0a0a0a] hover:bg-[#0a0a0a] hover:text-[#fbfaf6]"
          }`}
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
    <section
      id="pricing"
      className="relative border-t border-[#0a0a0a]/10 px-6 py-28 sm:px-10 sm:py-40"
    >
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
            Pricing
          </p>
          <h2 className="mb-6 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl">
            Three ways to let her run it.
          </h2>
          <p className="mb-16 max-w-2xl text-[16px] leading-[1.6] text-[#0a0a0a]/70">
            Same always-on operator on every tier — she watches your market,
            finds the right conversations, writes in your voice, and proves
            which post produced a customer. You&apos;re only choosing how many
            channels she runs, and whether she films it too.
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
              line="She gets you customers."
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
              line="More surface, same proof."
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
              line="Everything above, and she films it."
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
 * AWeekWithMaya — the typographic shooting schedule. Each row reads
 * like a printed call sheet. Lime tick on rows where Maya pings you.
 * ----------------------------------------------------------------- */
const WEEK_ROWS: Array<{
  day: string;
  time: string;
  title: string;
  body: string;
  ping?: boolean;
}> = [
  {
    day: "Mon",
    time: "7:00a",
    ping: true,
    title: "Your morning text",
    body: "One short message: what's landing today, what's worth your attention, and what she already shipped while you were asleep. You get back to building.",
  },
  {
    day: "Mon",
    time: "11:20a",
    title: "Posts and replies, out the door",
    body: "She found the conversations where people are describing the exact problem your app solves, and wrote the replies. She drafted the original posts for the channels where your audience lives. All of it goes live. You don't touch a thing.",
  },
  {
    day: "Tue",
    time: "8:00p",
    ping: true,
    title: "Evening check-in",
    body: "What went out today, and how it's actually doing. This morning's post is pulling comments; one reply already got a “where can I try this?” And when something flops, she tells you straight. No spin.",
  },
  {
    day: "Wed",
    time: "2:15p",
    ping: true,
    title: "Something's catching",
    body: "Something she posted is moving faster than usual. She pings you while it’s still hot. Worth jumping in before it cools? You decide.",
  },
  {
    day: "Thu",
    time: "4:40p",
    ping: true,
    title: "A real buyer shows up",
    body: "A comment lands that reads like a customer, not a fan. “Wait, how much is this?” She catches it, drafts your answer, hands it over in one line. You never go digging through notifications to find it.",
  },
  {
    day: "Sun",
    time: "6:00p",
    ping: true,
    title: "The week, reviewed",
    body: "How last week really went. What worked, what didn't, and what she figured out about your audience. Then next week's plan, already drafted. You start Monday knowing exactly what's happening.",
  },
];

function AWeekWithMaya() {
  return (
    <section
      id="week"
      className="relative border-t border-[#0a0a0a]/10 px-6 py-28 sm:px-10 sm:py-40"
    >
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <h2 className="mb-10 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl">
            A normal week with her.
          </h2>
        </RevealOnView>
        <RevealOnView delay={0.1}>
          <p className="mb-16 max-w-2xl text-[16px] leading-[1.6] text-[#0a0a0a]/70">
            Maya talks to you when she has something to say. The rest of the
            time she&apos;s working.
          </p>
        </RevealOnView>

        <ol className="border-t border-[#0a0a0a]/15">
          {WEEK_ROWS.map((row, i) => (
            <RevealOnView key={i} delay={0.05 + i * 0.06}>
              <li className="grid grid-cols-12 items-baseline border-b border-[#0a0a0a]/15 py-7 sm:py-8">
                {/* day */}
                <div className="col-span-2 font-mono text-[11px] uppercase tracking-[0.22em] opacity-60 sm:col-span-1">
                  {row.day}
                </div>
                {/* time */}
                <div className="col-span-2 font-mono text-[11px] tabular-nums tracking-[0.05em] opacity-50 sm:col-span-1">
                  {row.time}
                </div>
                {/* title */}
                <div className="col-span-7 flex items-baseline gap-3 sm:col-span-4">
                  <span className="font-display italic text-[1.4rem] leading-[1.1] sm:text-[1.7rem]">
                    {row.title}
                  </span>
                  {row.ping && (
                    <span
                      className="inline-block size-2 shrink-0 rounded-full bg-[#0a0a0a]"
                      aria-label="Maya pings you"
                    />
                  )}
                </div>
                {/* body */}
                <p className="col-span-12 mt-4 text-[14px] leading-[1.55] text-[#0a0a0a]/70 sm:col-span-6 sm:mt-0">
                  {row.body}
                </p>
              </li>
            </RevealOnView>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * TelegramSection — how the whole experience reaches you. Phone
 * mockup showing a real Maya conversation thread.
 * ----------------------------------------------------------------- */
function TelegramPhone() {
  const messages: Array<{ from: "maya" | "you"; time: string; text: string }> = [
    {
      from: "maya",
      time: "7:04",
      text: "Morning. Your r/SaaS reply yesterday pulled 14 clicks to your page, your best yet. Three posts going live today. I'll handle all of it.",
    },
    { from: "you", time: "7:05", text: "love it, go" },
    {
      from: "maya",
      time: "11:22",
      text: "Both Reddit posts are live. Your HN reply is the one I can't post for you (no API), so it's drafted and ready. Tap the link, paste, hit reply. 20 seconds, link's below 👇",
    },
    {
      from: "maya",
      time: "2:15",
      text: "This thread's climbing faster than usual, worth jumping in before it cools? hey-maya.ai/p/r-saas",
    },
    { from: "you", time: "2:16", text: "on it 🔥" },
    {
      from: "maya",
      time: "8:00",
      text: "Recap: 5 posts live, 61 clicks to your page. Reddit r/SaaS drove the most, and your Stripe logged 2 new signups today.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[320px]">
      {/* iPhone shell — light screen, clean dark bezel */}
      <div className="relative overflow-hidden rounded-[2.75rem] border-[5px] border-[#1b1b1d] bg-[#1b1b1d] shadow-[0_32px_80px_-20px_rgba(0,0,0,0.35)]">
        {/* Notch */}
        <div className="absolute left-1/2 top-[5px] z-20 h-[22px] w-28 -translate-x-1/2 rounded-b-2xl bg-[#1b1b1d]" />

        {/* Status bar (iOS light) */}
        <div className="flex items-center justify-between bg-white px-6 pt-3 pb-1.5 text-[#0a0a0a]">
          <span className="text-[12px] font-semibold">9:41</span>
          <div className="flex items-center gap-1.5">
            <div className="flex items-end gap-[2px]">
              <div className="h-[5px] w-[2px] rounded-sm bg-[#0a0a0a]" />
              <div className="h-[7px] w-[2px] rounded-sm bg-[#0a0a0a]" />
              <div className="h-[9px] w-[2px] rounded-sm bg-[#0a0a0a]" />
              <div className="h-[11px] w-[2px] rounded-sm bg-[#0a0a0a]/30" />
            </div>
            <div className="ml-0.5 flex h-[12px] w-[22px] items-center rounded-[3px] border border-[#0a0a0a]/40 p-[1.5px]">
              <div className="h-full w-2/3 rounded-[1px] bg-[#0a0a0a]" />
            </div>
          </div>
        </div>

        {/* Telegram chat header (light) */}
        <div className="flex items-center gap-2.5 border-b border-[#0a0a0a]/8 bg-white px-3.5 py-2.5">
          <span className="text-[22px] leading-none text-[#3390ec]">&#8249;</span>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5eb5f7] to-[#1e88e5]">
            <span className="text-[14px] font-semibold text-white">M</span>
          </div>
          <div className="flex-1 leading-tight">
            <p className="text-[14px] font-semibold text-[#0a0a0a]">Maya</p>
            <p className="text-[11px] text-[#3390ec]">online</p>
          </div>
          <SiTelegram className="size-5 shrink-0" color="#229ED9" aria-label="Telegram" />
        </div>

        {/* Messages — Telegram light chat */}
        <div className="space-y-1.5 bg-[#e9eef2] px-3 py-4">
          {messages.map((msg, i) => {
            const mine = msg.from === "you";
            return (
              <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[82%] px-3 py-2 shadow-[0_1px_1.5px_rgba(0,0,0,0.08)] ${
                    mine
                      ? "rounded-2xl rounded-br-md bg-[#3390ec] text-white"
                      : "rounded-2xl rounded-bl-md bg-white text-[#0a0a0a]"
                  }`}
                >
                  <p className="text-[12.5px] leading-[1.4]">{msg.text}</p>
                  <span
                    className={`mt-0.5 block text-right text-[9px] ${
                      mine ? "text-white/70" : "text-[#0a0a0a]/35"
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2 border-t border-[#0a0a0a]/8 bg-white px-3 pt-2.5 pb-3">
          <div className="flex-1 rounded-full bg-[#f0f2f5] px-4 py-2">
            <span className="text-[12px] text-[#0a0a0a]/35">Message</span>
          </div>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#3390ec]">
            <span className="text-[13px] leading-none text-white">&#8593;</span>
          </div>
        </div>
        {/* Home indicator */}
        <div className="flex justify-center bg-white pb-2">
          <div className="h-1 w-28 rounded-full bg-[#0a0a0a]/25" />
        </div>
      </div>
    </div>
  );
}

function TelegramSection() {
  return (
    <section className="relative border-t border-[#0a0a0a]/10 px-6 py-28 sm:px-10 sm:py-40">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-12 items-center gap-y-16 lg:gap-x-8 lg:gap-y-0">
          {/* LEFT — text */}
          <div className="col-span-12 lg:col-span-6">
            <RevealOnView>
              <p className="mb-5 text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
                No new app to open
              </p>
              <h2 className="mb-6 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-xl">
                Maya lives in Telegram. Everything happens in your messages.
              </h2>
              <p className="mb-8 max-w-md text-[16px] leading-[1.65] text-[#0a0a0a]/65">
                Set her up once. She texts you in the morning, pings you when
                something&apos;s worth seeing, and handles everything else
                without asking. No dashboard to check, no tool to log into. If
                you use your phone, you&apos;re already set up.
              </p>
              <div className="flex flex-col gap-3">
                {[
                  "Morning brief lands at 7am",
                  "Posts go live without you",
                  "Buyer signals surface in real time",
                  "Weekly plan delivered every Sunday",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <span className="inline-block size-1.5 shrink-0 rounded-full bg-[#0a0a0a]" />
                    <span className="text-[14px] text-[#0a0a0a]/70">{item}</span>
                  </div>
                ))}
              </div>
            </RevealOnView>
          </div>

          {/* RIGHT — phone */}
          <div className="col-span-12 flex justify-center lg:col-span-6 lg:justify-end">
            <RevealOnView delay={0.15}>
              <TelegramPhone />
            </RevealOnView>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * Attribution — the proof section. Per-post CLICK tracking is what Maya
 * does automatically (every link wrapped); signups are an aggregate read
 * from the founder's connected analytics (Stripe/PostHog), never an
 * end-to-end per-post claim we can't back.
 * ----------------------------------------------------------------- */
function AttributionMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_64px_-24px_rgba(0,0,0,0.18)]">
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-[#0a0a0a]/8 bg-[#0a0a0a] px-5 py-3.5">
        <span className="inline-block size-2 rounded-full bg-[#d6ff3d]" />
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/60">
          Maya · Monday · 7:04am
        </span>
      </div>

      {/* Attribution rows */}
      <div className="divide-y divide-[#0a0a0a]/8">
        {/* Row 1 — winner */}
        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5">
              <SiReddit className="size-3.5 shrink-0" color="#FF4500" />
              <span className="text-[11px] font-semibold opacity-50">r/SaaS · reply · 9h ago</span>
            </div>
            <p className="text-[13px] leading-snug opacity-80 line-clamp-2">
              &ldquo;Has anyone actually solved cold discovery for a solo B2B tool?&rdquo;
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[14px] font-semibold tabular-nums">14 clicks</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
              to your page
            </p>
          </div>
        </div>

        {/* Row 2 */}
        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5">
              <FaLinkedin className="size-3.5 shrink-0" color="#0A66C2" />
              <span className="text-[11px] font-semibold opacity-50">LinkedIn · post · 2d ago</span>
            </div>
            <p className="text-[13px] leading-snug opacity-80 line-clamp-2">
              &ldquo;I built it in a weekend with Cursor. Getting users is the actual job.&rdquo;
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[14px] font-semibold tabular-nums">61 clicks</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
              to your page
            </p>
          </div>
        </div>

        {/* Row 3 — no conversion */}
        <div className="flex items-start justify-between gap-6 px-5 py-4 opacity-50">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-1.5">
              <FaXTwitter className="size-3.5 shrink-0" color="#0a0a0a" />
              <span className="text-[11px] font-semibold">X · thread · 3d ago</span>
            </div>
            <p className="text-[13px] leading-snug line-clamp-2">
              &ldquo;The real reason your indie app has zero users...&rdquo;
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[13px] tabular-nums">284 impressions</p>
            <p className="mt-0.5 text-[12px] tabular-nums opacity-60">9 clicks</p>
          </div>
        </div>

        {/* Insight bar */}
        <div className="bg-[#d6ff3d]/15 px-5 py-4">
          <p className="text-[13px] leading-[1.5]">
            <span className="font-semibold">Reddit drove your most clicks this week.</span>
            <span className="text-[#0a0a0a]/65"> Your Stripe logged 2 new signups. Pulling back on X, doubling Reddit.</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Attribution() {
  return (
    <section id="proof" className="relative border-t border-[#0a0a0a]/10 px-6 py-28 sm:px-10 sm:py-40">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-12 gap-y-16 lg:gap-x-8 lg:gap-y-0">
          {/* LEFT — text */}
          <div className="col-span-12 lg:col-span-5 lg:pt-4">
            <RevealOnView>
              <p className="mb-5 text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
                The loop nobody else closes
              </p>
              <h2 className="mb-6 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight">
                Maya tracks which post drove the click, not which got the
                likes.
              </h2>
              <p className="max-w-md text-[16px] leading-[1.65] text-[#0a0a0a]/65">
                Every link she posts is wrapped and tagged. She knows exactly
                which reply, which channel, which post sent someone to your
                page, and the same clicks show up in{" "}
                <span className="text-[#0a0a0a]">your own</span> PostHog or
                Stripe, attributed to the post. You never just take her word for
                it. Then she closes the loop on what converted: read from your
                analytics, or confirmed with you.
              </p>
            </RevealOnView>
          </div>

          {/* RIGHT — mockup */}
          <div className="col-span-12 lg:col-span-7 lg:pl-8">
            <RevealOnView delay={0.15}>
              <p className="mb-5 text-[13px] italic text-[#0a0a0a]/55">
                Here&apos;s what lands in your brief every morning &rarr;
              </p>
              <AttributionMockup />
            </RevealOnView>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * BanSafety — the account health moat. Pre-post safety review mockup
 * shows the checks Maya runs before anything goes live.
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

function BanSafety() {
  return (
    <section id="safe" className="relative border-t border-[#0a0a0a]/10 px-6 py-28 sm:px-10 sm:py-40">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-12 gap-y-16 lg:gap-x-8 lg:gap-y-0">
          {/* LEFT — mockup first on this one for visual variety */}
          <div className="col-span-12 lg:col-span-7">
            <RevealOnView>
              <p className="mb-5 text-[13px] italic text-[#0a0a0a]/55">
                Every post, before it goes live &rarr;
              </p>
              <BanSafetyMockup />
            </RevealOnView>
          </div>

          {/* RIGHT — text */}
          <div className="col-span-12 lg:col-span-5 lg:pt-4">
            <RevealOnView delay={0.15}>
              <p className="mb-5 text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
                Your accounts stay safe
              </p>
              <h2 className="mb-6 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight">
                Maya checks every post before it goes live. No spam, no bans.
              </h2>
              <p className="max-w-md text-[16px] leading-[1.65] text-[#0a0a0a]/65">
                Tools that blast every community get accounts suspended and
                products blacklisted. Before anything posts, Maya checks that
                it fits the room, matches your voice, and isn&apos;t pitching
                too hard too often. Your Reddit, your LinkedIn, your X — they
                build value over time. She never burns them for a shortcut.
              </p>
            </RevealOnView>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * StaysCurrent — the platforms change their rules constantly; Maya keeps
 * up so the founder never has to. Dark band for contrast.
 * ----------------------------------------------------------------- */
function StaysCurrent() {
  return (
    <section className="relative bg-[#0a0a0a] px-6 py-28 text-[#fbfaf6] sm:px-10 sm:py-40">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/50">
            Maya keeps up so you don&apos;t
          </p>
          <h2 className="mb-6 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl">
            The algorithms change every month. Maya already read the memo.
          </h2>
        </RevealOnView>
        <RevealOnView delay={0.1}>
          <p className="mb-14 max-w-2xl text-[16px] leading-[1.6] text-white/70 sm:text-[18px]">
            Every month Maya researches what&apos;s actually working on each
            channel and bakes it into your plan. You never have to read a
            thinkpiece again.
          </p>
        </RevealOnView>
        <RevealOnView delay={0.15}>
          <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3 md:grid-cols-6">
            {["Reddit", "Hacker News", "TikTok", "Instagram", "YouTube", "X", "LinkedIn"].map(
              (p) => (
                <div
                  key={p}
                  className="border-t border-white/15 pt-4 font-display italic text-[1.3rem] leading-tight"
                >
                  {p}
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                    refreshed monthly
                  </span>
                </div>
              )
            )}
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}

/* -----------------------------------------------------------------
 * FinalCTA — the ending. The flat line bends upward here.
 * ----------------------------------------------------------------- */
function FinalCTA() {
  return (
    <section className="relative border-t border-[#0a0a0a]/10 px-6 py-32 sm:px-10 sm:py-44">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <h2 className="font-display italic text-[clamp(2.8rem,8vw,7rem)] leading-[1] tracking-tight">
            Stop staring
            <br />
            at the flat line.
          </h2>
        </RevealOnView>
        <RevealOnView delay={0.2}>
          <div className="mt-16 flex flex-wrap items-center gap-6">
            <Link
              prefetch={false}
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
              className="cta-primary cta-primary-large"
            >
              {primaryCtaLabel("Get started")}
              <span className="cta-arrow">→</span>
            </Link>
            <div className="max-w-sm">
              <p className="text-[15px] leading-[1.55] text-[#0a0a0a]/60">
                Four-minute setup. Connect Telegram and the channels you want
                her on. She takes it from there.
              </p>
              <p className="mt-3 text-[13px] text-[#0a0a0a]/40">
                7 days free &mdash; plans from $99/mo. Cancel any time.
              </p>
            </div>
          </div>
        </RevealOnView>

        {/* The bend — the flat line resolves upward */}
        <div className="mt-32">
          <RisingGraph />
        </div>
      </div>
    </section>
  );
}

function RisingGraph() {
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
          stroke="#0a0a0a"
          strokeWidth="1.5"
          fill="none"
          className="rising-path"
        />
        <circle cx={1200} cy={12} r={5} fill="#0a0a0a" />
      </svg>
    </div>
  );
}

/* -----------------------------------------------------------------
 * Footer — micro, mono.
 * ----------------------------------------------------------------- */
function Footer() {
  return (
    <footer className="border-t border-[#0a0a0a]/10 px-6 py-10 sm:px-10">
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
 * lime dot tracked to scroll progress. The signature ambient element.
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
      { threshold: 0.25, rootMargin: "0px 0px -120px 0px" }
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
            rgba(214, 255, 61, 0.06),
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

      /* Hero letter-mask reveal — each line is a span with the
         hero-line class. They slide up and fade in on page load. */
      [data-page="clawlaunch-landing"] .hero-headline {
        font-size: clamp(2.5rem, 8.5vw, 6.5rem);
        line-height: 1;
        letter-spacing: -0.025em;
        font-weight: 400;
      }
      [data-page="clawlaunch-landing"] .hero-line {
        display: block;
        opacity: 0;
        transform: translateY(48px);
        animation: heroRise 3.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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

      /* CTA — pill, black, lime hover state. */
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
        background: #d6ff3d;
        color: #0a0a0a;
      }
      [data-page="clawlaunch-landing"] .cta-primary:active {
        transform: translateY(1px);
      }
      [data-page="clawlaunch-landing"] .cta-primary-large {
        padding: 1.4rem 2.1rem;
        font-size: 12px;
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
