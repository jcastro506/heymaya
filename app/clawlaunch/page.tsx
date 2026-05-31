"use client";

import type { Metadata } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { SiInstagram, SiReddit, SiTiktok } from "react-icons/si";

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
    "Maya — the GTM agent for builders Cursor unlocked.",
  description:
    "You shipped fast. Marketing is the wall. Maya finds where your users talk, drafts the replies, plans the week — so your signup graph stops being a flat line.",
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
      <PainQuote />
      <Channels />
      <AWeekWithMaya />
      <Compared />
      <NotThis />
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
          ClawLaunch
        </Link>
        <nav className="hidden gap-7 font-mono text-[11px] uppercase tracking-[0.22em] sm:flex">
          <a href="#what" className="opacity-60 hover:opacity-100">
            What she does
          </a>
          <a href="#week" className="opacity-60 hover:opacity-100">
            A week with her
          </a>
          <Link href="/sign-in" className="opacity-60 hover:opacity-100">
            Sign in
          </Link>
        </nav>
        <Link
          href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
          className="font-mono text-[11px] uppercase tracking-[0.22em] underline-offset-[6px] hover:underline sm:hidden"
        >
          Open Maya →
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
          <span className="hero-line font-display italic" style={{ animationDelay: "0.1s" }}>
            You built your dream app.
          </span>
          <span
            className="hero-line font-display italic block"
            style={{ animationDelay: "0.7s" }}
          >
            The internet didn&apos;t notice.
          </span>
        </h1>

        {/* Subhead + CTA */}
        <div
          className="hero-line mt-14 max-w-2xl lg:mt-20"
          style={{ animationDelay: "1.4s" }}
        >
          <p className="text-[18px] leading-[1.55] text-[#0a0a0a]/75 sm:text-[20px] sm:leading-[1.5]">
            We&apos;re the marketing team for your app. We find your audience
            on Reddit, TikTok, LinkedIn, Instagram, and X — write the content
            and ship it. You don&apos;t post a thing.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link
              href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
              className="cta-primary"
            >
              {primaryCtaLabel("Start ClawLaunch")}
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
 * PainQuote — the pull. Massive italic, single sentence. The room
 * goes quiet here.
 * ----------------------------------------------------------------- */
function PainQuote() {
  return (
    <section id="pain" className="relative px-6 sm:px-10">
      <div className="mx-auto max-w-7xl">
        {/* Beat 1 — the setup */}
        <div className="py-32 sm:py-44 lg:py-56">
          <RevealOnView>
            <p className="font-display italic text-[clamp(2.4rem,6vw,5.5rem)] leading-[1.05] tracking-tight max-w-5xl">
              You built it.
              <br />
              <span className="text-[#0a0a0a]/35">
                That was the easy part.
              </span>
            </p>
          </RevealOnView>
        </div>

        {/* Beat 2 — the punchline. Lives below enough vertical space
            that the user has to scroll between the two beats. */}
        <div className="py-32 sm:py-44 lg:py-56">
          <RevealOnView>
            <p className="font-display italic text-[clamp(2.4rem,6vw,5.5rem)] leading-[1.05] tracking-tight max-w-5xl">
              The hard part is getting users.
            </p>
          </RevealOnView>
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
 * canonical brand color; Instagram + TikTok get a wrapper for the
 * gradient / chromatic-aberration treatments the flat marks lack. */
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

/* Instagram — flat mark has no gradient, so wrap it: white glyph over
 * the canonical sunset gradient, rounded like the app icon. */
function InstagramLogo({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className ?? ""}`}
      style={{
        background:
          "linear-gradient(135deg, #FED373 0%, #F15245 28%, #D92E7F 60%, #9B36B7 100%)",
        borderRadius: "22%",
      }}
      aria-label="Instagram"
    >
      <SiInstagram className="size-[68%]" color="white" />
    </span>
  );
}

/* X — solid black mark. */
function XLogo({ className }: { className?: string }) {
  return <FaXTwitter className={className} color="#0a0a0a" aria-label="X" />;
}

/* TikTok mockup — a Brief card. Maya gives the operator the script,
 * hook, caption, and filming notes. She does NOT shoot the video. */
function TikTokMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      <div className="flex items-center justify-between border-b border-[#0a0a0a]/8 bg-[#0a0a0a] px-5 py-3 text-white">
        <div className="flex items-center gap-2">
          <SiTiktok className="size-4" color="white" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Brief
          </span>
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
          draft · for your approval
        </span>
      </div>
      <div className="space-y-5 px-5 py-5 text-[13px]">
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Hook · 0–3s
          </p>
          <p className="font-medium">
            &ldquo;three habit-tracker apps that all made the same
            mistake.&rdquo;
          </p>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Script · 5 beats
          </p>
          <ol className="space-y-1.5 leading-relaxed opacity-80">
            <li>1. open over your phone screen with the hook</li>
            <li>2. show app #1 — boring daily prompt</li>
            <li>3. show app #2 — overwhelming stats</li>
            <li>4. show app #3 — streak guilt</li>
            <li>5. then yours — &ldquo;one question. 9pm. that&apos;s it.&rdquo;</li>
          </ol>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Caption
          </p>
          <p className="leading-relaxed opacity-80">
            i tried all the habit apps. heres what they all got wrong (and
            what finally worked) #productivityapps #buildinpublic
          </p>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Filming
          </p>
          <p className="leading-relaxed opacity-60">
            screen recording only · no face needed · 28–35 sec
          </p>
        </div>
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

/* Instagram mockup — Brief card. Maya hands over angle, slide-by-
 * slide carousel notes, and caption. She does NOT shoot the carousel. */
function InstagramMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#0a0a0a]/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_-16px_rgba(0,0,0,0.16)]">
      <div className="flex items-center justify-between border-b border-[#0a0a0a]/8 px-5 py-3">
        <div className="flex items-center gap-2">
          <InstagramLogo className="size-4" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
            Brief
          </span>
        </div>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
          draft · for your approval
        </span>
      </div>
      <div className="space-y-5 px-5 py-5 text-[13px]">
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Angle
          </p>
          <p className="font-medium">&ldquo;habits that actually stuck&rdquo;</p>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Carousel · 6 slides
          </p>
          <ol className="space-y-1.5 leading-relaxed opacity-80">
            <li>1. hook — &ldquo;i tried 4 habit apps. only 1 worked.&rdquo;</li>
            <li>2. problem — &ldquo;they all do the same thing wrong&rdquo;</li>
            <li>3. screenshot — generic daily prompt</li>
            <li>4. screenshot — overwhelming stats</li>
            <li>5. solution — &ldquo;the one i built does one thing&rdquo;</li>
            <li>6. CTA — &ldquo;link in bio if you want to try it&rdquo;</li>
          </ol>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Caption
          </p>
          <p className="leading-relaxed opacity-80">
            i spent 6 months trying to build a habit. turns out the apps were
            the problem. heres the format that finally clicked 👇
            #productivityhacks #buildinpublic #indiehacker
          </p>
        </div>
        <div>
          <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] opacity-50">
            Visuals
          </p>
          <p className="leading-relaxed opacity-60">
            screenshots only · no face needed · consistent off-white
            background per slide
          </p>
        </div>
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
        <div className="grid grid-cols-12 gap-x-8 gap-y-12 lg:gap-y-0">
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
              One real example per platform — the kind of thing we&apos;d
              hand you, ready to ship.
            </p>
          </RevealOnView>
        </div>

        <div className="mt-10 sm:mt-14">
          <ChannelPane
            logo={<RedditLogo className="size-11" />}
            name="Reddit."
            tagline="Where your users are literally asking the question your app answers."
            body="We find the thread the second it lands. We write a reply that sounds like a real person — not a marketer with a quota. You hit send."
            mockupLabel="Here's what we'd send to this thread →"
            mockup={<RedditMockup />}
          />

          <ChannelPane
            logo={<TikTokLogo className="size-11" />}
            name="TikTok."
            tagline="Where your app gets demoed — even if you hate being on camera."
            body="We figure out the format that works for what you built — screen recording, voiceover, no-face. We write the script. We tell you what's worth filming and what to skip. You film the 30 seconds."
            mockupLabel="Here's the brief we'd hand you →"
            mockup={<TikTokMockup />}
          />

          <ChannelPane
            logo={<LinkedInLogo className="size-11" />}
            name="LinkedIn."
            tagline="Where the founders, operators, and buyers in your space actually hang out."
            body="We find the people who'd care. We draft the post they'd actually stop scrolling for. We tell you who to follow back and who to ignore."
            mockupLabel="Here's the post we'd draft →"
            mockup={<LinkedInMockup />}
          />

          <ChannelPane
            logo={<InstagramLogo className="size-11" />}
            name="Instagram."
            tagline="Where the visual product earns its first audience."
            body="We figure out the angle, draft the caption, queue the carousel order. We watch what's working in your niche and adjust week to week. No #motivation. Promise."
            mockupLabel="Here's the brief we'd hand you →"
            mockup={<InstagramMockup />}
          />

          <ChannelPane
            logo={<XLogo className="size-11" />}
            name="X."
            tagline="Where build-in-public actually turns into your first users."
            body="We find the conversations where your product fits. We write the reply, the founder post, the build update. We tell you when to jump in — not just to be loud."
            mockupLabel="Here's the post we'd draft →"
            mockup={<XMockup />}
          />
        </div>

        <div className="pb-28 sm:pb-40" aria-hidden="true" />
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
    body: "One short message: the two or three things worth doing today, and the single one that matters most. The writing's already done — you approve, you post, you get back to building.",
  },
  {
    day: "Mon",
    time: "11:20a",
    title: "Replies, ready to send",
    body: "She's been reading the places your future users hang out and found the conversations where they're describing the exact problem your app solves. Each one comes with a reply that sounds like you — not an ad. You just hit send.",
  },
  {
    day: "Tue",
    time: "8:00p",
    ping: true,
    title: "Evening check-in",
    body: "What went out today, and how it's actually doing. This morning's post is pulling comments; one reply already got a “where can I try this?” And when something flops, she tells you straight — no spin.",
  },
  {
    day: "Wed",
    time: "2:15p",
    ping: true,
    title: "Something's catching",
    body: "A post is moving faster than usual. She pings you while it's still hot — “this one's taking off, worth jumping back in?” You decide whether to ride it.",
  },
  {
    day: "Thu",
    time: "4:40p",
    ping: true,
    title: "A real buyer shows up",
    body: "A comment lands that reads like a customer, not a fan — “wait, how much is this?” She catches it, drafts your answer, hands it over in one line. You never go digging through notifications to find it.",
  },
  {
    day: "Sun",
    time: "6:00p",
    ping: true,
    title: "The week, reviewed",
    body: "How last week really went — what worked, what didn't, and what she figured out about your audience. Then next week's plan, already drafted. You start Monday knowing exactly what's happening.",
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
            She talks to you when she has something to say. The rest of the
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
 * NotThis — counter-positioning. Footnote-style list, mono prefix.
 * ----------------------------------------------------------------- */
const NOT_LIST = [
  {
    not: "Not a content scheduler.",
    body: "You still post manually. She drafts, you ship. Approval is the contract.",
  },
  {
    not: "Not a creator factory.",
    body: "She won't make you a brand. She finds the people already looking for what you built.",
  },
  {
    not: "Not a growth hack.",
    body: "No cold DMs, no follow-unfollow, no Reddit account farming. She refuses to recommend Reddit if your karma is too thin to participate.",
  },
  {
    not: "Not a dashboard.",
    body: "She lives in Telegram. The dashboard is the receipt. You read it on your phone, on the train.",
  },
  {
    not: "Not an autopilot.",
    body: "She drafts; you decide. If you go quiet for three days she asks if she should pause. She doesn't pretend you're still around.",
  },
];

/* -----------------------------------------------------------------
 * Compared — what she actually does. The four things that make her a
 * go-to-market manager, not a reply bot. Paper bg, so it contrasts the
 * dark "What she's not" that follows.
 * ----------------------------------------------------------------- */
const COMPARED_LIST: Array<{ her: string; body: string }> = [
  {
    her: "Finds your buyers wherever they are",
    body: "Your first hundred users are on Reddit, in HN threads, in a niche subreddit, on LinkedIn, on X. She works all of it — digs up the exact conversations where people have the problem you solve, and tells you which channel's worth your time this week.",
  },
  {
    her: "Writes it so it sounds like you",
    body: "She studies how you talk and how each room talks, then hands you replies you'd actually send — helpful first, never a pitch. You read it, tweak it if you want, post it.",
  },
  {
    her: "Keeps you native, not nuked",
    body: "Spray-and-pray posting gets accounts killed and products blacklisted. She stays native to each community — the right cadence, the right rooms — so you build a reputation instead of torching one.",
  },
  {
    her: "Tells you what actually converted",
    body: "Engagement isn't the goal — signups are. Every link she hands you is tracked, so you find out which post turned into a real user, and she leans into what's working.",
  },
];

function Compared() {
  return (
    <section
      id="compared"
      className="relative border-t border-[#0a0a0a]/10 px-6 py-28 sm:px-10 sm:py-40"
    >
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/50">
            What she actually does
          </p>
          <h2 className="mb-14 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl">
            She runs your go-to-market. You ship the product.
          </h2>
        </RevealOnView>
        <ul className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
          {COMPARED_LIST.map((item, i) => (
            <RevealOnView key={i} delay={0.1 + i * 0.06}>
              <li className="border-t border-[#0a0a0a]/15 pt-6">
                <p className="font-display italic text-[1.7rem] leading-[1.1]">
                  {item.her}
                </p>
                <p className="mt-4 text-[14px] leading-[1.55] text-[#0a0a0a]/65">
                  {item.body}
                </p>
              </li>
            </RevealOnView>
          ))}
        </ul>
      </div>
    </section>
  );
}

function NotThis() {
  return (
    <section className="relative bg-[#0a0a0a] px-6 py-28 text-[#fbfaf6] sm:px-10 sm:py-40">
      <div className="mx-auto max-w-7xl">
        <RevealOnView>
          <h2 className="mb-14 font-display italic text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.1] tracking-tight max-w-3xl">
            What she&apos;s not.
          </h2>
        </RevealOnView>
        <RevealOnView delay={0.08}>
          <p className="mb-20 max-w-3xl text-[17px] leading-[1.6] text-white/70 sm:text-[18px]">
            Tools for shipping fast multiplied.
            <br />
            Tools for finding the first hundred users didn&apos;t.
          </p>
        </RevealOnView>
        <ul className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
          {NOT_LIST.map((item, i) => (
            <RevealOnView key={i} delay={0.1 + i * 0.06}>
              <li className="border-t border-white/15 pt-6">
                <p className="font-display italic text-[1.7rem] leading-[1.1]">
                  {item.not}
                </p>
                <p className="mt-4 text-[14px] leading-[1.55] text-white/65">
                  {item.body}
                </p>
              </li>
            </RevealOnView>
          ))}
        </ul>
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
              href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
              className="cta-primary cta-primary-large"
            >
              {primaryCtaLabel("Open Maya")}
              <span className="cta-arrow">→</span>
            </Link>
            <p className="max-w-sm text-[15px] leading-[1.55] text-[#0a0a0a]/60">
              Four-minute setup. Connect a Telegram bot and your calendar.
              She takes it from there.
            </p>
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
        <span>ClawLaunch</span>
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
}: {
  children: React.ReactNode;
  delay?: number;
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
      className="reveal-on-view"
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
        animation: heroRise 2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
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
        font-family: var(--font-geist-mono), ui-monospace, monospace;
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
