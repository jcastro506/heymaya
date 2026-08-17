"use client";

/**
 * The landing page — twelve capabilities, four acts.
 *
 * ## Why it is long
 *
 * §18.9.2's rule is **"the artifact is the argument, the copy is a caption"** —
 * a rule about SHOWING rather than telling. It says nothing about how many
 * things to show, and an earlier pass here wrongly turned "don't write
 * paragraphs" into "cut features".
 *
 * For this buyer, volume of specificity IS the argument. They have been burned
 * by tools that claim to "learn your brand"; twelve concrete things with
 * receipts attached is what makes someone think this is a different category.
 * Long is fine. Twelve sections of PROSE would not be.
 *
 * ## ⚠️ Everything here is real
 *
 * Every artifact below was pulled from the dogfood account on 2026-08-17 —
 * the format card and its beats, the idea and the founder's own quote, the
 * ladder verdict, the House Rules in the operator's own words. §18.9.2 asks
 * for "a real artifact, not a mockup", and inventing one on the page that
 * claims she never invents things would be the product contradicting itself.
 *
 * ⚠️ And the page obeys her own House Rules. One of them, verbatim: *"never
 * call it an AI or an AI hire — say what it does instead."* There is no "AI"
 * on this page, deliberately.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SiInstagram, SiTiktok, SiYoutube } from "react-icons/si";

import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";
import { DemoRead } from "../_components/DemoRead";

export const metadataStub: Metadata | undefined = undefined;

const CTA_HREF = "/sign-up?redirect_url=/onboarding/gtm";
const CTA_LABEL = "Put her to work";

/* ----------------------------------------------------------------- */

export default function ClawLaunchLandingPage() {
  return (
    <main
      data-page="clawlaunch-landing"
      className="relative min-h-screen bg-[#fbfaf6] text-[#0a0a0a] font-sans antialiased"
    >
      <PageStyles />
      <Masthead />
      <Hero />

      <Act n="One" title="She learns.">
        <LearnsBusiness />
        <WatchesMarket />
        <WatchesVideo />
      </Act>

      <Act n="Two" title="She decides, and makes.">
        <TheIdea />
        <TheWork />
        <TheStoryboard />
      </Act>

      <Act n="Three" title="She ships, and remembers.">
        <ShePosts />
        <SheAnswers />
        <SheRemembers />
      </Act>

      <Act n="Four" title="She proves it.">
        <TheLadder />
        <TheTrace />
        <TheExperiment />
      </Act>

      <TheMath />
      <Closer />
      <Footer />
    </main>
  );
}

function Masthead() {
  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-7">
        <Link href="/" className="font-display italic text-[19px]">
          HeyMaya
        </Link>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="text-[14px] underline decoration-[#0a0a0a]/25 underline-offset-[5px] hover:decoration-[#0a0a0a]"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 pt-40 pb-24 sm:pt-52 sm:pb-32">
      <div className="mx-auto max-w-5xl">
        <h1 className="max-w-[14ch] font-display text-[clamp(3rem,8.5vw,6.75rem)] leading-[0.95] tracking-[-0.025em]">
          <span className="hero-line block" style={{ animationDelay: "0.1s" }}>
            You built it.
          </span>
          <span
            className="hero-line block italic"
            style={{ animationDelay: "0.75s" }}
          >
            Now somebody has to sell it.
          </span>
        </h1>
        <div
          className="hero-line mt-12 flex flex-col gap-8"
          style={{ animationDelay: "1.5s" }}
        >
          <p className="max-w-lg text-[19px] leading-[1.5] text-[#0a0a0a]/70 sm:text-[21px]">
            Maya is your content hire. She watches your market all day, makes
            the posts, puts them out, and tells you what actually worked.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link
              href={primaryCtaHref(CTA_HREF)}
              className="rounded-full bg-[#0a0a0a] px-8 py-4 text-[15px] text-[#fbfaf6] hover:opacity-85"
            >
              {primaryCtaLabel(CTA_LABEL)}
            </Link>
            <span className="text-[15px] text-[#0a0a0a]/45">$99 a month</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===== ACT ONE ===================================================== */

function LearnsBusiness() {
  return (
    <Block
      title="She reads your site first."
      note="And tells you what she couldn't work out."
    >
      <div className="max-w-2xl">
        <DemoRead />
      </div>
    </Block>
  );
}

/**
 * ⚠️ Real observations from a real sweep. `velocity` is engagement ÷ age, which
 * is why the top of the list is what's CLIMBING rather than what's already big.
 */
const FEED: Array<[string, string, string]> = [
  ["x", "55.9", "Most founders think the code is the only moat"],
  ["tiktok", "47.8", "Stop selling products. Start building a brand"],
  ["tiktok", "0.7", "The free marketing channels that got me to 10K downloads"],
  ["youtube", "0.2", "The Real Reason You Can Not Find Time For Marketing"],
  ["youtube", "0.1", "Praying for Referrals Is Not a Marketing Plan"],
];

function WatchesMarket() {
  return (
    <Block
      title="Then she watches your market. All day."
      note="Competitors, keywords, trends, comment sections. Ranked by what's climbing, not what's already big."
    >
      <ol className="max-w-3xl overflow-hidden rounded-2xl border border-[#0a0a0a]/12">
        {FEED.map(([ch, v, text], i) => (
          <li
            key={text}
            className={`flex items-baseline gap-4 px-6 py-4 sm:gap-6 sm:px-8 ${
              i === 0 ? "" : "border-t border-[#0a0a0a]/8"
            }`}
          >
            <ChannelMark channel={ch} />
            <span className="flex-1 text-[16px] leading-[1.45]">{text}</span>
            <span className="shrink-0 tabular-nums text-[13px] text-[#0a0a0a]/35">
              {v}
            </span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

const BEATS: Array<[string, string]> = [
  ["0:00", "Dismisses the idea of a magic formula"],
  ["0:12", "Reframes it — time, intent, market fit"],
  ["0:20", "Names the real cost: days, weeks, months"],
  ["0:32", "Warns against chasing the shortcut"],
  ["0:44", "Build something you'd be proud of"],
  ["0:50", "Lands it — people still value the real thing"],
];

function WatchesVideo() {
  return (
    <Block
      title="And she watches the video. Not the caption."
      note="About twenty a week, before she writes anything."
    >
      <div className="grid overflow-hidden rounded-2xl border border-[#0a0a0a]/12 lg:grid-cols-2">
        <div className="border-b border-[#0a0a0a]/12 p-8 sm:p-10 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-[13px] text-[#0a0a0a]/45">
            <SiTiktok className="size-3.5" />
            <span>17,385 views</span>
          </div>
          <p className="mt-7 font-display italic text-[28px] leading-[1.15] sm:text-[33px]">
            &ldquo;Resist the Hack. Build Remarkable.&rdquo;
          </p>
          <p className="mt-7 text-[16px] leading-[1.55] text-[#0a0a0a]/65">
            Straight to camera from a car. Title fixed top-center, captions
            below, key words boxed as they land.
          </p>
        </div>
        <div className="p-8 sm:p-10">
          <ol>
            {BEATS.map(([at, what], i) => (
              <li
                key={at}
                className={`grid grid-cols-[3.25rem_1fr] gap-5 py-3 ${
                  i === 0 ? "" : "border-t border-[#0a0a0a]/8"
                }`}
              >
                <span className="tabular-nums text-[14px] text-[#0a0a0a]/35">
                  {at}
                </span>
                <span className="text-[15.5px] leading-[1.45] text-[#0a0a0a]/80">
                  {what}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Block>
  );
}

/* ===== ACT TWO ===================================================== */

function TheIdea() {
  return (
    <Block
      title="Every post starts with something a real person said."
      note="No evidence, no post. That's the rule."
    >
      <figure className="max-w-3xl rounded-2xl border border-[#0a0a0a]/12 p-8 sm:p-10">
        <blockquote className="font-display italic text-[21px] leading-[1.45] sm:text-[24px]">
          &ldquo;I&rsquo;m building stuff without validating it first. Adding
          more features regularly. I&rsquo;ve made no money. I don&rsquo;t know
          what I&rsquo;m doing marketing-wise.&rdquo;
        </blockquote>
        <figcaption className="mt-5 text-[14px] text-[#0a0a0a]/40">
          Found on X · she kept the link
        </figcaption>
        <p className="mt-8 border-t border-[#0a0a0a]/12 pt-8 text-[16.5px] leading-[1.5]">
          <span className="text-[#0a0a0a]/40">So she writes: </span>
          You&rsquo;ve shipped more features, made $0, and still don&rsquo;t
          know what to do marketing-wise — that&rsquo;s not three problems.
          It&rsquo;s one.
        </p>
      </figure>
    </Block>
  );
}

function TheWork() {
  return (
    <Block
      title="Then she makes it."
      note="Vertical video, carousels, posts. Your product, your voice, a shape that already worked."
    >
      <div className="grid gap-8 sm:grid-cols-3 sm:gap-6">
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
    </Block>
  );
}

/**
 * ⚠️ The storyboard text is the real `storyboardMessage` output shape, not
 * marketing copy written to look like it.
 */
function TheStoryboard() {
  return (
    <Block
      title="You see it before a penny is spent."
      note="Wrong screenshot? Say so. Costs nothing to fix at this point."
    >
      <div className="max-w-2xl rounded-2xl border border-[#0a0a0a]/12 bg-white/50 p-7 sm:p-9">
        <p className="text-[16.5px] leading-[1.6]">
          Had an idea. Something on TikTok caught my eye and I think the shape
          works for you — opens by rejecting the shortcut everyone&rsquo;s
          selling, then shows the slower thing that works.
        </p>
        <p className="mt-5 text-[16.5px] leading-[1.6] text-[#0a0a0a]/55">
          Here&rsquo;s how yours would go:
        </p>
        <ol className="mt-4 space-y-2.5">
          {[
            ["the presenter", "You shipped it and nobody came."],
            ["your screenshot", "This is the paste."],
            ["your screenshot", "That's the dashboard, ten seconds later."],
          ].map(([what, line], i) => (
            <li key={what + i} className="text-[16px] leading-[1.5]">
              <span className="tabular-nums text-[#0a0a0a]/35">{i + 1}. </span>
              <span className="text-[#0a0a0a]/45">{what} — </span>
              <span>&ldquo;{line}&rdquo;</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[16px] leading-[1.5] text-[#0a0a0a]/55">
          Nothing&rsquo;s been made yet — say go and I&rsquo;ll build it, or
          tell me which shot is wrong.
        </p>
      </div>
    </Block>
  );
}

/* ===== ACT THREE =================================================== */

function ShePosts() {
  return (
    <Block
      title="She posts it."
      note="Show me first, or just go. One switch per channel — your call, not hers."
    >
      <div className="flex flex-wrap gap-3">
        {[
          ["TikTok", "tiktok"],
          ["Instagram", "instagram"],
          ["YouTube", "youtube"],
          ["X", "x"],
        ].map(([label, ch]) => (
          <span
            key={label}
            className="flex items-center gap-2.5 rounded-full border border-[#0a0a0a]/15 px-5 py-2.5 text-[15px]"
          >
            <ChannelMark channel={ch} />
            {label}
          </span>
        ))}
      </div>
    </Block>
  );
}

/**
 * ⚠️ The TikTok limit is stated in the same breath as the capability. §12: an
 * honest limit told before it is discovered is what makes the rest believable —
 * and TikTok genuinely exposes no comment API to anyone.
 */
function SheAnswers() {
  return (
    <Block
      title="And answers everyone who replies."
      note="Comments, mentions, DMs — in your voice, within the hour."
    >
      <p className="max-w-2xl text-[17px] leading-[1.55] text-[#0a0a0a]/65">
        Instagram, YouTube and X. On TikTok she can post but not reply —
        there&rsquo;s no way to, for anyone. She&rsquo;ll tell you what came in
        instead of pretending she handled it.
      </p>
    </Block>
  );
}

/**
 * ⚠️ REAL House Rules, verbatim from the dogfood account — including the one
 * this page itself obeys.
 */
function SheRemembers() {
  return (
    <Block
      title="Tell her once."
      note="Stored word for word, dated, and still true after a redeploy."
    >
      <dl className="max-w-3xl overflow-hidden rounded-2xl border border-[#0a0a0a]/12">
        {/**
          * ⚠️ Two REAL rules from the dogfood account, chosen for a reason. The
          * account's other rules are about not calling her an AI — true, useful,
          * and unquotable here: `tests/marketingCopy.test.ts` forbids the word
          * in rendered copy, and printing it inside quotation marks still puts
          * it in front of a skimming visitor. The guard caught exactly that.
          *
          * ⭐ These are better artifacts anyway. "One more time so it sticks" is
          * a founder repeating himself, which is the whole reason House Rules
          * exist — and she wrote it down verbatim, exasperation included.
          */}
        {[
          [
            "important correction: we don't do Reddit or LinkedIn anymore. HeyMaya runs TikTok, Instagram, YouTube and X only.",
            "channels",
          ],
          [
            "one more time so it sticks: we do NOT use Reddit or LinkedIn. Only TikTok, Instagram, YouTube and X.",
            "channels",
          ],
        ].map(([rule, kind], i) => (
          <div
            key={rule}
            className={`flex flex-wrap items-baseline justify-between gap-3 px-6 py-5 sm:px-8 ${
              i === 0 ? "" : "border-t border-[#0a0a0a]/8"
            }`}
          >
            <dt className="font-display italic text-[19px] leading-snug">
              &ldquo;{rule}&rdquo;
            </dt>
            <dd className="text-[13px] text-[#0a0a0a]/35">{kind}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

/* ===== ACT FOUR ==================================================== */

const RUNGS: Array<[string, string, boolean]> = [
  ["Did we post?", "Six this week", false],
  ["Did anyone see it?", "19 views — almost nobody", true],
  ["Did anyone care?", "—", false],
  ["Did anyone come?", "—", false],
  ["Did anyone convert?", "—", false],
];

function TheLadder() {
  return (
    <Block
      title="She tells you which part is broken."
      note="Five questions, in order. The first one that fails is the thing to fix."
    >
      <ol className="max-w-3xl overflow-hidden rounded-2xl border border-[#0a0a0a]/12">
        {RUNGS.map(([q, a, broken], i) => (
          <li
            key={q}
            className={`flex flex-wrap items-baseline justify-between gap-3 px-6 py-4 sm:px-8 ${
              i === 0 ? "" : "border-t border-[#0a0a0a]/8"
            } ${broken ? "bg-[#0a0a0a]/[0.045]" : ""}`}
          >
            <span
              className={`text-[16.5px] ${broken ? "font-display italic text-[19px]" : "text-[#0a0a0a]/70"}`}
            >
              {q}
            </span>
            <span
              className={`text-[15px] ${broken ? "" : "text-[#0a0a0a]/35"}`}
            >
              {a}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-8 max-w-2xl font-display italic text-[20px] leading-[1.45] sm:text-[23px]">
        &ldquo;Almost nobody saw them, so this is a format problem, not a topic
        one.&rdquo;
      </p>
    </Block>
  );
}

function TheTrace() {
  return (
    <Block
      title="And follows a signup back to the post that caused it."
      note="What she can't account for, she says so — instead of rounding up."
    >
      <ol className="max-w-2xl">
        {[
          "1 signup, reported by your site",
          "they clicked your link",
          "from this post",
          "which came from a complaint someone posted",
        ].map((hop, i) => (
          <li
            key={hop}
            className="flex items-baseline gap-4 border-l border-[#0a0a0a]/15 py-3 pl-6"
          >
            <span className="tabular-nums text-[13px] text-[#0a0a0a]/30">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-[16.5px] leading-[1.45]">{hop}</span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

/**
 * ⚠️ Describes the MECHANISM, not a result. No experiment has concluded on a
 * real account yet, and showing an invented verdict here would be the exact
 * thing §2.7 forbids — on the page that sells her honesty.
 */
function TheExperiment() {
  return (
    <Block
      title="She runs one experiment at a time."
      note="Two weeks, one question, then a straight answer."
    >
      <p className="max-w-2xl text-[17px] leading-[1.55] text-[#0a0a0a]/65">
        One hypothesis, two arms, two weeks. Then she calls it — including
        &ldquo;two weeks wasn&rsquo;t enough to tell, and that&rsquo;s still an
        open question, not a no.&rdquo;
      </p>
    </Block>
  );
}

/* ===== CLOSE ======================================================= */

function TheMath() {
  return (
    <section className="px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-14 border-y border-[#0a0a0a]/15 py-16 sm:grid-cols-2 sm:gap-10 sm:py-20">
          <div>
            <p className="font-display text-[clamp(3rem,9vw,5.5rem)] leading-[0.85] tracking-[-0.02em] text-[#0a0a0a]/25 line-through decoration-[2px]">
              $300
            </p>
            <p className="mt-6 max-w-[26ch] text-[17px] leading-[1.5] text-[#0a0a0a]/50">
              A creator, for a couple of posts. Then you brief them again next
              week.
            </p>
          </div>
          <div>
            <p className="font-display italic text-[clamp(3rem,9vw,5.5rem)] leading-[0.85] tracking-[-0.02em]">
              $99
            </p>
            <p className="mt-6 max-w-[26ch] text-[17px] leading-[1.5] text-[#0a0a0a]/70">
              All of the above, every month. She briefs herself.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Closer() {
  return (
    <section className="px-6 py-28 sm:py-40">
      <div className="mx-auto max-w-5xl">
        <h2 className="max-w-[13ch] font-display italic text-[clamp(2.5rem,6.5vw,5rem)] leading-[1] tracking-[-0.02em]">
          Stop being your own marketing team.
        </h2>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="mt-12 inline-block rounded-full bg-[#0a0a0a] px-8 py-4 text-[15px] text-[#fbfaf6] hover:opacity-85"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </section>
  );
}

/* ===== FURNITURE =================================================== */

/**
 * An act is three capabilities under one promise. Twelve sections in a flat
 * list is a spec sheet; twelve in four acts is a story with a shape, and the
 * reader always knows where they are.
 */
function Act({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-baseline gap-5 border-t border-[#0a0a0a]/15 pb-4 pt-10">
          <span className="text-[13px] uppercase tracking-[0.2em] text-[#0a0a0a]/30">
            {n}
          </span>
          <h2 className="font-display italic text-[clamp(1.6rem,3.2vw,2.4rem)] leading-tight tracking-[-0.01em]">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

/** One headline, one line, one real thing. */
function Block({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-14 sm:py-20">
      <h3 className="max-w-2xl font-display text-[clamp(1.5rem,3vw,2.1rem)] leading-[1.2] tracking-[-0.01em]">
        {title}
      </h3>
      {note ? (
        <p className="mt-3 max-w-xl text-[16.5px] leading-[1.5] text-[#0a0a0a]/50">
          {note}
        </p>
      ) : null}
      <div className="mt-9 sm:mt-11">{children}</div>
    </div>
  );
}

function ChannelMark({ channel }: { channel: string }) {
  if (channel === "tiktok") return <SiTiktok className="size-3.5 shrink-0" />;
  if (channel === "instagram")
    return <SiInstagram className="size-3.5 shrink-0" />;
  if (channel === "youtube") return <SiYoutube className="size-3.5 shrink-0" />;
  return (
    <span className="w-3.5 shrink-0 text-center text-[13px] font-semibold">
      X
    </span>
  );
}

/* --- Preserved: the real videos and the page's motion system --- */

const DEMO_VIDEOS: Record<
  "tiktok" | "instagram" | "youtube",
  { src: string | null; poster: string | null }
> = {
  tiktok: { src: "/demos/tiktok.mp4", poster: "/demos/tiktok.jpg" },
  instagram: { src: "/demos/instagram.mp4", poster: "/demos/instagram.jpg" },
  // The avatar testimonial Maya cut for HeyMaya itself — a Short, dogfooded.
  youtube: { src: "/demos/youtube.mp4", poster: "/demos/youtube.jpg" },
};


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

function InstagramLogo({ className }: { className?: string }) {
  return <SiInstagram className={className} color="#E4405F" aria-label="Instagram" />;
}

function YouTubeLogo({ className }: { className?: string }) {
  return <SiYoutube className={className} color="#FF0000" aria-label="YouTube" />;
}

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
