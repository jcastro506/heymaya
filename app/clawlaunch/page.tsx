"use client";

/**
 * ⭐ THE CUTTING ROOM — the landing page.
 *
 * ## The direction, and why this one
 *
 * The previous version was cream paper and a serif italic. It was *fine*, and
 * it was the default editorial look every Substack already uses — so it read
 * as a newsletter about software rather than as software. It also fought the
 * product: three vertical videos floating on cream look like stock photos.
 *
 * Maya's entire world is 9:16 video, comment sections and timecodes. Her most
 * differentiated capability is watching a video and writing down what happens
 * at 0:12. So the page is an **editing bay**:
 *
 * | | |
 * |---|---|
 * | Ground | near-black with film grain — the videos become the light source |
 * | Display | Bodoni Moda, a high-contrast didone that survives at scale on dark |
 * | Technical | JetBrains Mono for every timecode, metric and label |
 * | Accent | one signal green, used only where something is LIVE or BROKEN |
 * | Motif | the timeline — timecode ticks, running heads, beats as a real strip |
 *
 * ⚠️ The accent is rationed on purpose. A colour that appears everywhere stops
 * meaning anything; here it appears on the live indicator, the broken rung and
 * the CTA, so it always reads as "this is the thing".
 *
 * ## ⚠️ Everything shown is real
 *
 * The format card and its beats, the founder's own quote behind an idea, the
 * ladder verdict, the House Rules — all pulled from the dogfood account on
 * 2026-08-17. §18.9.2 asks for "a real artifact, not a mockup", and inventing
 * one on the page that claims she never invents things would be the product
 * contradicting itself in public.
 *
 * ⚠️ And it obeys her own House Rule — *"never call it an AI or an AI hire"* —
 * which `tests/marketingCopy.test.ts` enforces.
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

/* ================================================================== */

export default function ClawLaunchLandingPage() {
  return (
    <main
      data-page="clawlaunch-landing"
      className="relative min-h-screen overflow-hidden bg-[#08080A] text-[#EDEDE8] antialiased"
    >
      <PageStyles />
      <Grain />
      <Masthead />
      <Hero />

      <Reel />

      <Act n="01" title="She learns.">
        <Beat title="Reads your site" note="And says what she couldn't work out.">
          <div className="max-w-2xl"><DemoRead /></div>
        </Beat>
        <Beat
          title="Watches your market"
          note="Competitors, keywords, trends, comment sections — ranked by what's climbing."
        >
          <Feed />
        </Beat>
        <Beat
          title="Watches the video itself"
          note="Not the caption. About twenty a week, before she writes anything."
        >
          <FormatCard />
        </Beat>
      </Act>

      <Act n="02" title="She decides, and makes.">
        <Beat title="Starts from something real" note="No evidence, no post.">
          <TheQuote />
        </Beat>
        <Beat title="Shows you before spending" note="Wrong shot? Costs nothing to fix here.">
          <Storyboard />
        </Beat>
      </Act>

      <Act n="03" title="She ships, and remembers.">
        <Beat title="Posts it" note="Show me first, or just go. One switch per channel.">
          <Channels />
        </Beat>
        <Beat title="Answers everyone" note="Comments, mentions, DMs — in your voice.">
          <p className="max-w-2xl text-[17px] leading-[1.6] text-[#EDEDE8]/55">
            Instagram, YouTube and X. On TikTok she can post but not reply —
            there&rsquo;s no way to, for anyone. She tells you what came in
            rather than pretending she handled it.
          </p>
        </Beat>
        <Beat title="Remembers, word for word" note="Tell her once. Still true after a redeploy.">
          <HouseRules />
        </Beat>
      </Act>

      <Act n="04" title="She proves it.">
        <Beat title="Names the part that's broken" note="Five questions in order. The first failure is the fix.">
          <Ladder />
        </Beat>
        <Beat title="Traces a signup to the post" note="What she can't account for, she says.">
          <Trace />
        </Beat>
        <Beat title="Runs one experiment at a time" note="Two weeks, one question, a straight answer.">
          <p className="max-w-2xl text-[17px] leading-[1.6] text-[#EDEDE8]/55">
            One hypothesis, two arms, two weeks. Then she calls it — including
            &ldquo;two weeks wasn&rsquo;t enough to tell, and that&rsquo;s still
            an open question, not a no.&rdquo;
          </p>
        </Beat>
      </Act>

      <TheMath />
      <Closer />
      <Footer />
    </main>
  );
}

/* ===== ATMOSPHERE ================================================== */

/** Film grain. Two frames of animated noise — enough to feel, not to see. */
function Grain() {
  return <div aria-hidden className="grain pointer-events-none fixed inset-0 z-50" />;
}

function Masthead() {
  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8">
        <Link href="/" className="font-display text-[20px] tracking-tight">
          HeyMaya
        </Link>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="mono text-[11px] uppercase tracking-[0.2em] text-[#EDEDE8]/60 transition-colors hover:text-[#C8FF2E]"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </header>
  );
}

/* ===== HERO ======================================================== */

function Hero() {
  return (
    <section className="relative px-6 pt-40 pb-24 sm:pt-52 sm:pb-28">
      {/* A single soft bloom, off-centre — the light in the room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-0 h-[46rem] w-[46rem] rounded-full opacity-[0.16] blur-[130px]"
        style={{ background: "radial-gradient(circle, #C8FF2E, transparent 66%)" }}
      />
      <div className="relative mx-auto max-w-6xl">
        <p className="rise mono mb-10 flex items-center gap-3 text-[11px] uppercase tracking-[0.24em] text-[#EDEDE8]/40">
          <span className="live-dot" /> watching 4 channels
        </p>
        <h1 className="font-display text-[clamp(3.25rem,10vw,9rem)] leading-[0.86] tracking-[-0.03em]">
          <span className="rise block" style={{ animationDelay: "0.1s" }}>
            You built it.
          </span>
          <span className="rise block italic" style={{ animationDelay: "0.28s" }}>
            Now somebody
          </span>
          <span className="rise block italic" style={{ animationDelay: "0.42s" }}>
            has to sell it.
          </span>
        </h1>
        <div
          className="rise mt-16 flex flex-col gap-9"
          style={{ animationDelay: "0.62s" }}
        >
          <p className="max-w-xl text-[19px] leading-[1.55] text-[#EDEDE8]/60 sm:text-[21px]">
            Maya is your content hire. She watches your market all day, makes
            the posts, puts them out, and tells you what actually worked.
          </p>
          <div className="flex flex-wrap items-center gap-7">
            <Link href={primaryCtaHref(CTA_HREF)} className="cta">
              {primaryCtaLabel(CTA_LABEL)}
            </Link>
            <span className="mono text-[12px] uppercase tracking-[0.18em] text-[#EDEDE8]/35">
              $99 / month
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===== THE REEL — videos as the light source ======================= */

function Reel() {
  return (
    <section className="relative py-10 sm:py-16">
      <Rule label="the work" />
      <div className="mx-auto mt-14 grid max-w-6xl gap-10 px-6 sm:grid-cols-3 sm:gap-7">
        {[
          ["tiktok", "POV: you finally cleared your camera roll in one sitting"],
          ["instagram", "3 apps tried to fix my camera roll. only one actually did."],
          ["youtube", "Built by hand. Marketed by Maya."],
        ].map(([platform, label], i) => (
          <div key={platform} className="glow" style={{ animationDelay: `${i * 0.12}s` }}>
            <StudioVideo
              platform={platform as "tiktok" | "instagram" | "youtube"}
              label={label}
            />
          </div>
        ))}
      </div>
      <p className="mono mx-auto mt-12 max-w-6xl px-6 text-[12px] uppercase tracking-[0.2em] text-[#EDEDE8]/35">
        one vertical asset · three channels
      </p>
    </section>
  );
}

/* ===== ACT ONE ===================================================== */

const FEED: Array<[string, string, string]> = [
  ["x", "55.9", "Most founders think the code is the only moat"],
  ["tiktok", "47.8", "Stop selling products. Start building a brand"],
  ["tiktok", "0.7", "The free marketing channels that got me to 10K downloads"],
  ["youtube", "0.2", "The Real Reason You Can Not Find Time For Marketing"],
  ["youtube", "0.1", "Praying for Referrals Is Not a Marketing Plan"],
];

function Feed() {
  return (
    <div className="max-w-3xl overflow-hidden rounded-lg border border-white/8 bg-white/[0.02]">
      <div className="mono flex items-center justify-between border-b border-white/8 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-[#EDEDE8]/30">
        <span>this morning</span>
        <span>velocity</span>
      </div>
      {FEED.map(([ch, v, text], i) => (
        <div
          key={text}
          className={`flex items-center gap-4 px-5 py-4 sm:gap-6 ${
            i === 0 ? "" : "border-t border-white/6"
          }`}
        >
          <ChannelMark channel={ch} />
          <span className="flex-1 text-[15.5px] leading-[1.4] text-[#EDEDE8]/85">
            {text}
          </span>
          <span
            className={`mono shrink-0 text-[13px] tabular-nums ${
              Number(v) > 10 ? "text-[#C8FF2E]" : "text-[#EDEDE8]/25"
            }`}
          >
            {v}
          </span>
        </div>
      ))}
    </div>
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

/** ⭐ The beats as an actual strip. This is the product's thinking, drawn. */
function FormatCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-white/8 bg-white/[0.02]">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-white/8 px-6 py-4 sm:px-8">
        <span className="mono flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] text-[#EDEDE8]/40">
          <SiTiktok className="size-3.5" /> watched in full
        </span>
        <span className="mono text-[12px] tabular-nums text-[#EDEDE8]/40">
          17,385 views
        </span>
      </div>

      <div className="px-6 py-8 sm:px-8 sm:py-10">
        <p className="font-display text-[clamp(1.75rem,3.6vw,2.6rem)] leading-[1.12]">
          &ldquo;Resist the Hack. Build Remarkable.&rdquo;
        </p>
        <p className="mt-5 max-w-xl text-[15.5px] leading-[1.55] text-[#EDEDE8]/50">
          Straight to camera from a car. Title fixed top-center, captions below,
          key words boxed as they land.
        </p>
      </div>

      <ol className="border-t border-white/8">
        {BEATS.map(([at, what], i) => (
          <li
            key={at}
            className={`grid grid-cols-[4.5rem_1fr] items-baseline gap-4 px-6 py-3.5 sm:px-8 ${
              i === 0 ? "" : "border-t border-white/6"
            }`}
          >
            <span className="mono text-[12.5px] tabular-nums text-[#C8FF2E]/70">
              {at}
            </span>
            <span className="text-[15.5px] leading-[1.45] text-[#EDEDE8]/80">
              {what}
            </span>
          </li>
        ))}
      </ol>

      <div className="border-t border-white/8 px-6 py-7 sm:px-8">
        <p className="mono mb-2.5 text-[10px] uppercase tracking-[0.2em] text-[#EDEDE8]/30">
          so yours can
        </p>
        <p className="font-display text-[19px] italic leading-[1.4] sm:text-[22px]">
          Open by rejecting the shortcut everyone&rsquo;s selling, then show the
          slower thing that works.
        </p>
      </div>
    </div>
  );
}

/* ===== ACT TWO ===================================================== */

function TheQuote() {
  return (
    <figure className="max-w-3xl rounded-lg border border-white/8 bg-white/[0.02] p-8 sm:p-10">
      <blockquote className="font-display text-[21px] italic leading-[1.5] text-[#EDEDE8]/90 sm:text-[25px]">
        &ldquo;I&rsquo;m building stuff without validating it first. Adding more
        features regularly. I&rsquo;ve made no money. I don&rsquo;t know what
        I&rsquo;m doing marketing-wise.&rdquo;
      </blockquote>
      <figcaption className="mono mt-6 text-[11px] uppercase tracking-[0.18em] text-[#EDEDE8]/30">
        found on X · she kept the link
      </figcaption>
      <p className="mt-8 border-t border-white/8 pt-8 text-[16.5px] leading-[1.55] text-[#EDEDE8]/75">
        <span className="text-[#EDEDE8]/35">so she writes — </span>
        You&rsquo;ve shipped more features, made $0, and still don&rsquo;t know
        what to do marketing-wise. That&rsquo;s not three problems. It&rsquo;s
        one.
      </p>
    </figure>
  );
}

function Storyboard() {
  return (
    <div className="max-w-2xl rounded-lg border border-white/8 bg-white/[0.02] p-7 sm:p-9">
      <p className="text-[16.5px] leading-[1.6] text-[#EDEDE8]/85">
        Had an idea. Something on TikTok caught my eye and I think the shape
        works for you — opens by rejecting the shortcut everyone&rsquo;s
        selling, then shows the slower thing that works.
      </p>
      <ol className="mt-7 space-y-3 border-t border-white/8 pt-7">
        {[
          ["the presenter", "You shipped it and nobody came."],
          ["your screenshot", "This is the paste."],
          ["your screenshot", "That's the dashboard, ten seconds later."],
        ].map(([what, line], i) => (
          <li key={i} className="flex gap-4 text-[16px] leading-[1.5]">
            <span className="mono shrink-0 text-[12.5px] tabular-nums text-[#EDEDE8]/30">
              0{i + 1}
            </span>
            <span>
              <span className="text-[#EDEDE8]/40">{what} — </span>
              <span className="text-[#EDEDE8]/85">&ldquo;{line}&rdquo;</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-7 text-[15.5px] leading-[1.5] text-[#EDEDE8]/45">
        Nothing&rsquo;s been made yet — say go and I&rsquo;ll build it, or tell
        me which shot is wrong.
      </p>
    </div>
  );
}

/* ===== ACT THREE =================================================== */

function Channels() {
  return (
    <div className="flex flex-wrap gap-3">
      {[
        ["TikTok", "tiktok"],
        ["Instagram", "instagram"],
        ["YouTube", "youtube"],
        ["X", "x"],
      ].map(([label, ch]) => (
        <span
          key={label}
          className="flex items-center gap-2.5 rounded-full border border-white/12 px-5 py-2.5 text-[15px] text-[#EDEDE8]/80"
        >
          <ChannelMark channel={ch} />
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * ⚠️ Real rules, verbatim. The account's other rules are about not calling her
 * an AI — true, and unquotable here: `tests/marketingCopy.test.ts` forbids the
 * word in rendered copy, and quotation marks don't help a skimming reader.
 * These are better artifacts anyway: "one more time so it sticks" is a founder
 * repeating himself, which is the entire reason House Rules exist.
 */
const RULES = [
  "important correction: we don't do Reddit or LinkedIn anymore. HeyMaya runs TikTok, Instagram, YouTube and X only.",
  "one more time so it sticks: we do NOT use Reddit or LinkedIn. Only TikTok, Instagram, YouTube and X.",
];

function HouseRules() {
  return (
    <div className="max-w-3xl overflow-hidden rounded-lg border border-white/8 bg-white/[0.02]">
      {RULES.map((rule, i) => (
        <div
          key={rule}
          className={`flex items-start gap-5 px-6 py-6 sm:px-8 ${
            i === 0 ? "" : "border-t border-white/6"
          }`}
        >
          <span className="mono shrink-0 pt-1 text-[11px] tabular-nums text-[#EDEDE8]/25">
            0{i + 1}
          </span>
          <p className="font-display text-[19px] italic leading-[1.45] text-[#EDEDE8]/90 sm:text-[21px]">
            &ldquo;{rule}&rdquo;
          </p>
        </div>
      ))}
    </div>
  );
}

/* ===== ACT FOUR ==================================================== */

const RUNGS: Array<[string, string, boolean]> = [
  ["Did we post?", "six this week", false],
  ["Did anyone see it?", "19 views — almost nobody", true],
  ["Did anyone care?", "—", false],
  ["Did anyone come?", "—", false],
  ["Did anyone convert?", "—", false],
];

function Ladder() {
  return (
    <>
      <ol className="max-w-3xl overflow-hidden rounded-lg border border-white/8 bg-white/[0.02]">
        {RUNGS.map(([q, a, broken], i) => (
          <li
            key={q}
            className={`flex flex-wrap items-baseline justify-between gap-3 px-6 py-4 sm:px-8 ${
              i === 0 ? "" : "border-t border-white/6"
            } ${broken ? "bg-[#C8FF2E]/[0.06]" : ""}`}
          >
            <span className="flex items-center gap-3.5">
              <span
                className={`size-1.5 rounded-full ${
                  broken ? "bg-[#C8FF2E]" : "bg-[#EDEDE8]/15"
                }`}
              />
              <span
                className={`text-[16.5px] ${
                  broken ? "text-[#EDEDE8]" : "text-[#EDEDE8]/45"
                }`}
              >
                {q}
              </span>
            </span>
            <span
              className={`mono text-[13px] ${
                broken ? "text-[#C8FF2E]" : "text-[#EDEDE8]/20"
              }`}
            >
              {a}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-9 max-w-2xl font-display text-[21px] italic leading-[1.45] sm:text-[26px]">
        &ldquo;Almost nobody saw them, so this is a format problem, not a topic
        one.&rdquo;
      </p>
    </>
  );
}

function Trace() {
  return (
    <ol className="max-w-2xl">
      {[
        "1 signup, reported by your site",
        "they clicked your link",
        "from this post",
        "which came from a complaint someone posted",
      ].map((hop, i) => (
        <li key={hop} className="flex items-baseline gap-5 border-l border-white/12 py-3.5 pl-6">
          <span className="mono text-[12px] tabular-nums text-[#C8FF2E]/50">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="text-[16.5px] leading-[1.45] text-[#EDEDE8]/85">
            {hop}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ===== CLOSE ======================================================= */

function TheMath() {
  return (
    <section className="px-6 py-28 sm:py-40">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-16 border-y border-white/10 py-16 sm:grid-cols-2 sm:gap-10 sm:py-24">
          <div>
            <p className="mono mb-6 text-[11px] uppercase tracking-[0.22em] text-[#EDEDE8]/30">
              a creator, per drop
            </p>
            <p className="font-display text-[clamp(3.25rem,9vw,6rem)] leading-[0.85] text-[#EDEDE8]/25 line-through">
              $300
            </p>
            <p className="mt-7 max-w-[26ch] text-[16.5px] leading-[1.5] text-[#EDEDE8]/40">
              For a couple of posts. Then you brief them again next week.
            </p>
          </div>
          <div>
            <p className="mono mb-6 text-[11px] uppercase tracking-[0.22em] text-[#C8FF2E]/70">
              maya, per month
            </p>
            <p className="font-display text-[clamp(3.25rem,9vw,6rem)] italic leading-[0.85]">
              $99
            </p>
            <p className="mt-7 max-w-[26ch] text-[16.5px] leading-[1.5] text-[#EDEDE8]/70">
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
    <section className="relative px-6 py-32 sm:py-44">
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 h-[34rem] w-[52rem] -translate-x-1/2 rounded-full opacity-[0.13] blur-[140px]"
        style={{ background: "radial-gradient(circle, #C8FF2E, transparent 68%)" }}
      />
      <div className="relative mx-auto max-w-6xl text-center">
        <h2 className="mx-auto max-w-[15ch] font-display text-[clamp(2.5rem,7.5vw,6rem)] italic leading-[0.98] tracking-[-0.02em]">
          Stop being your own marketing team.
        </h2>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="cta mt-14 inline-block"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </section>
  );
}

/* ===== FURNITURE =================================================== */

/** A hairline with a running head — the timeline motif, as a section break. */
function Rule({ label }: { label: string }) {
  return (
    <div className="mx-auto flex max-w-6xl items-center gap-6 px-6">
      <span className="mono shrink-0 text-[10px] uppercase tracking-[0.24em] text-[#EDEDE8]/30">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

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
    <section className="px-6 pt-24 sm:pt-32">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline gap-6 border-t border-white/10 pt-7">
          <span className="mono text-[11px] tabular-nums tracking-[0.2em] text-[#C8FF2E]/60">
            {n}
          </span>
          <h2 className="font-display text-[clamp(1.75rem,3.6vw,2.75rem)] italic leading-tight">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Beat({
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
      <h3 className="font-display text-[clamp(1.4rem,2.8vw,2rem)] leading-[1.2]">
        {title}
      </h3>
      {note ? (
        <p className="mt-3 max-w-xl text-[16px] leading-[1.5] text-[#EDEDE8]/40">
          {note}
        </p>
      ) : null}
      <div className="mt-9 sm:mt-11">{children}</div>
    </div>
  );
}

function ChannelMark({ channel }: { channel: string }) {
  const c = "size-3.5 shrink-0 opacity-70";
  if (channel === "tiktok") return <SiTiktok className={c} />;
  if (channel === "instagram") return <SiInstagram className={c} />;
  if (channel === "youtube") return <SiYoutube className={c} />;
  return (
    <span className="mono w-3.5 shrink-0 text-center text-[13px] opacity-70">
      X
    </span>
  );
}

/* ===== STYLE ======================================================= */

function PageStyles() {
  return (
    <style>{`
      [data-page="clawlaunch-landing"] .font-display {
        font-family: var(--font-display), Georgia, serif;
        font-weight: 400;
      }
      [data-page="clawlaunch-landing"] .mono {
        font-family: var(--font-mono-tech), ui-monospace, monospace;
      }

      /* One orchestrated entrance. Everything else stays still — motion that
         happens constantly stops being motion and becomes noise. */
      [data-page="clawlaunch-landing"] .rise {
        opacity: 0;
        transform: translateY(14px);
        animation: rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes rise {
        to { opacity: 1; transform: none; }
      }

      /* The videos are the light source: a faint bloom behind each one so it
         reads as lit rather than pasted onto the dark. */
      [data-page="clawlaunch-landing"] .glow {
        position: relative;
      }
      [data-page="clawlaunch-landing"] .glow::before {
        content: "";
        position: absolute;
        inset: -14% -8% -6%;
        background: radial-gradient(ellipse at 50% 45%, rgba(237,237,232,0.10), transparent 62%);
        filter: blur(30px);
        z-index: 0;
      }
      [data-page="clawlaunch-landing"] .glow > * { position: relative; z-index: 1; }

      [data-page="clawlaunch-landing"] .live-dot {
        width: 6px; height: 6px; border-radius: 999px;
        background: #C8FF2E;
        box-shadow: 0 0 0 0 rgba(200,255,46,0.55);
        animation: pulse 2.4s ease-out infinite;
      }
      @keyframes pulse {
        70% { box-shadow: 0 0 0 9px rgba(200,255,46,0); }
        100% { box-shadow: 0 0 0 0 rgba(200,255,46,0); }
      }

      [data-page="clawlaunch-landing"] .cta {
        display: inline-block;
        background: #C8FF2E;
        color: #08080A;
        padding: 1rem 2.25rem;
        border-radius: 999px;
        font-size: 15px;
        font-weight: 500;
        transition: transform 0.25s cubic-bezier(0.16,1,0.3,1), box-shadow 0.25s;
      }
      [data-page="clawlaunch-landing"] .cta:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 40px -12px rgba(200,255,46,0.55);
      }

      /* Grain. Cheap, static, and the thing that stops a flat dark page from
         looking like an empty div. */
      [data-page="clawlaunch-landing"] .grain {
        opacity: 0.16;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
      }

      @media (prefers-reduced-motion: reduce) {
        [data-page="clawlaunch-landing"] .rise {
          opacity: 1; transform: none; animation: none;
        }
        [data-page="clawlaunch-landing"] .live-dot { animation: none; }
      }
    `}</style>
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

