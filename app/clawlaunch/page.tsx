"use client";

/**
 * The landing page.
 *
 * ## The shape, and why
 *
 * Twelve things she does, one block each, agreed as a wireframe before any of
 * this was written — four rebuilds in an afternoon had proved that designing in
 * the editor and showing the result costs a full rewrite per disagreement.
 *
 * ⚠️ **No section numbers.** An earlier pass numbered them, which implied a
 * sequence the content does not have — she is not doing these in order, she
 * does all of them. Four quiet phase markers group them instead.
 *
 * ⭐ **The videos are the hero.** Every earlier version put them in a gallery
 * halfway down. Linear puts its product in the hero and lets it "make the
 * argument the headline starts", and this product IS video — burying it was the
 * single biggest mistake in the previous versions.
 *
 * ## What keeps twelve blocks from reading as chaos
 *
 * Rhythm, not fewer blocks. Every capability is the identical shape — art one
 * side, a three-to-six-word headline, ONE line — and the art alternates side to
 * side, so the eye learns the pattern by the third block and stops re-parsing
 * layout. One fade-up per block, nothing else moves.
 *
 * ## ⚠️ Nine blocks, not twelve
 *
 * Three capabilities are real and have no artifact yet: answering (needs one
 * real reply), House Rules (the account's four rules all name Reddit — which we
 * no longer run — or "AI", which `tests/marketingCopy.test.ts` forbids), and
 * experiments (nothing has concluded). They are left OUT rather than drawn
 * fake. §18.9.2 asks for "a real artifact, not a mockup", and an invented one on
 * the page that sells her honesty would be the product contradicting itself.
 *
 * Everything below is real, from the dogfood account on 2026-08-17.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SiInstagram, SiTiktok, SiYoutube } from "react-icons/si";

import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";

const CTA_HREF = "/sign-up?redirect_url=/onboarding/gtm";
const CTA_LABEL = "Put her to work";

export default function ClawLaunchLandingPage() {
  return (
    <main
      data-page="clawlaunch-landing"
      className="relative min-h-screen bg-[#fbfaf6] text-[#0a0a0a] font-sans antialiased"
    >
      <PageStyles />
      <Masthead />
      <Hero />

      <Phase>She learns</Phase>
      <ReadsYourSite />
      <WatchesMarket />
      <WatchesVideo />

      <Phase>She decides, and makes</Phase>
      <StartsFromReal />
      <MakesIt />
      <ShowsYouFirst />

      <Phase>She ships</Phase>
      <PostsIt />

      <Phase>She proves it</Phase>
      <WhatsBroken />
      <TracesIt />

      <TheMath />
      <Closer />
      <SiteFooter />
    </main>
  );
}

/* ===== SHELL ======================================================= */

function Masthead() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 sm:px-8">
        <Link href="/" className="font-display italic text-[20px]">
          HeyMaya
        </Link>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="rounded-full bg-[#0a0a0a] px-5 py-2.5 text-[14px] text-[#fbfaf6] transition-opacity hover:opacity-85"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </header>
  );
}

/**
 * ⭐ The videos sit above the fold and play on load. The headline starts the
 * argument; three vertical videos finish it before anyone reads a second line.
 */
function Hero() {
  return (
    <section className="px-6 pt-32 pb-20 sm:px-8 sm:pt-40 sm:pb-24">
      <div className="mx-auto max-w-6xl">
        <h1 className="max-w-[13ch] font-display italic text-[clamp(2.75rem,7.5vw,5.5rem)] leading-[1.02] tracking-[-0.02em]">
          Your app is good. Nobody knows it exists.
        </h1>
        <p className="mt-8 max-w-lg text-[18px] leading-[1.55] text-[#0a0a0a]/70 sm:text-[20px]">
          Maya is your content hire. She watches your market, makes the posts,
          and puts them out.
        </p>

        <div className="mt-14 grid gap-6 sm:grid-cols-3 sm:gap-5">
          {[
            ["tiktok", "POV: you finally cleared your camera roll in one sitting"],
            ["instagram", "3 apps tried to fix my camera roll. only one actually did."],
            ["youtube", "Built by hand. Marketed by Maya."],
          ].map(([platform, label]) => (
            <PlatformVideo
              key={platform}
              platform={platform as "tiktok" | "instagram" | "youtube"}
              label={label}
            />
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-6">
          <Link
            href={primaryCtaHref(CTA_HREF)}
            className="rounded-full bg-[#0a0a0a] px-8 py-4 text-[15px] text-[#fbfaf6] transition-opacity hover:opacity-85"
          >
            {primaryCtaLabel(CTA_LABEL)}
          </Link>
          <span className="text-[15px] text-[#0a0a0a]/60">$99 a month</span>
        </div>
      </div>
    </section>
  );
}

/* ===== SHE LEARNS ================================================== */

/** ⚠️ A real read, run against basecamp.com on 2026-08-17. */
function ReadsYourSite() {
  return (
    <Cap
      title="She reads your site first"
      line="And says what she couldn't work out."
      art={
        <Panel>
          <Field k="What you do" v="A project management and team collaboration tool." />
          <Field k="Who it's for" v="Teams, companies, and non-profits." />
          <Field
            k="What she couldn't tell"
            v="Exact pricing · the full feature list · which industries you target."
            dim
          />
        </Panel>
      }
    />
  );
}

/** ⚠️ Real observations. Velocity is engagement ÷ age — what's climbing. */
const FEED: Array<[string, string, string]> = [
  ["x", "55.9", "Most founders think the code is the only moat"],
  ["tiktok", "47.8", "Stop selling products. Start building a brand"],
  ["tiktok", "0.7", "The free marketing channels that got me to 10K downloads"],
  ["youtube", "0.2", "The Real Reason You Can Not Find Time For Marketing"],
];

function WatchesMarket() {
  return (
    <Cap
      flip
      title="Then she watches your market"
      line="Competitors, keywords, trends, comment sections — ranked by what's climbing."
      art={
        <Panel pad={false}>
          {FEED.map(([ch, v, text], i) => (
            <div
              key={text}
              className={`flex items-center gap-4 px-6 py-4 ${
                i === 0 ? "" : "border-t border-[#0a0a0a]/10"
              }`}
            >
              <Mark channel={ch} />
              <span className="flex-1 text-[15px] leading-[1.4]">{text}</span>
              <span
                className={`shrink-0 font-mono text-[12.5px] tabular-nums ${
                  Number(v) > 10 ? "text-[#0a0a0a]" : "text-[#0a0a0a]/60"
                }`}
              >
                {v}
              </span>
            </div>
          ))}
        </Panel>
      }
    />
  );
}

const BEATS: Array<[string, string]> = [
  ["0:00", "Dismisses the idea of a magic formula"],
  ["0:12", "Reframes it — time, intent, market fit"],
  ["0:32", "Warns against chasing the shortcut"],
  ["0:50", "Lands it — people still value the real thing"],
];

/** ⭐ The one dark block. §5.3's "single most differentiated capability". */
function WatchesVideo() {
  return (
    <Cap
      title="And she watches the video"
      line="Not the caption. Beat by beat, about twenty a week."
      art={
        <div className="rounded-2xl border border-[#1B2434] bg-[#0B0F15] p-7 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-[#1B2434] pb-4">
            <span className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[#94A6BD]">
              <SiTiktok className="size-3.5" /> watched in full
            </span>
            <span className="font-mono text-[12px] tabular-nums text-[#94A6BD]">
              17,385 views
            </span>
          </div>
          <p className="mt-6 font-display italic text-[22px] leading-[1.2] text-[#E9EEF6] sm:text-[26px]">
            &ldquo;Resist the Hack. Build Remarkable.&rdquo;
          </p>
          <ol className="mt-6 border-t border-[#1B2434] pt-4">
            {BEATS.map(([at, what], i) => (
              <li
                key={at}
                className={`grid grid-cols-[3.25rem_1fr] items-baseline gap-4 py-2.5 ${
                  i === 0 ? "" : "border-t border-[#1B2434]/70"
                }`}
              >
                <span className="font-mono text-[12px] tabular-nums text-[#94A6BD]">
                  {at}
                </span>
                <span className="text-[14.5px] leading-[1.4] text-[#C9D4E2]">
                  {what}
                </span>
              </li>
            ))}
          </ol>
        </div>
      }
    />
  );
}

/* ===== SHE DECIDES, AND MAKES ====================================== */

/** ⚠️ A real post from X, and the angle she actually banked from it. */
function StartsFromReal() {
  return (
    <Cap
      flip
      title="Every post starts with something someone said"
      line="No evidence, no post."
      art={
        <Panel>
          <p className="font-display italic text-[19px] leading-[1.45] sm:text-[21px]">
            &ldquo;I&rsquo;ve made no money. I don&rsquo;t know what I&rsquo;m
            doing marketing-wise.&rdquo;
          </p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[#0a0a0a]/60">
            found on X · link kept
          </p>
        </Panel>
      }
    />
  );
}

/** ⚠️ A real post she published. */
function MakesIt() {
  return (
    <Cap
      title="Then she writes it, in your voice"
      line="Grounded in the thing that started it."
      art={
        <Panel>
          <p className="text-[16px] leading-[1.6]">
            @nitprashant&rsquo;s line about going from &ldquo;a great product
            nobody knows&rdquo; to something people use hit the real problem.
          </p>
          <p className="mt-4 text-[16px] leading-[1.6]">
            for a solo founder, marketing isn&rsquo;t one task. it&rsquo;s the
            second job that keeps showing up while you&rsquo;re trying to build
            the first one.
          </p>
        </Panel>
      }
    />
  );
}

function ShowsYouFirst() {
  return (
    <Cap
      flip
      title="You see it before a penny is spent"
      line="Wrong shot? Costs nothing to fix here."
      art={
        <Panel>
          <p className="text-[16px] leading-[1.6] text-[#0a0a0a]/85">
            Had an idea. Something on TikTok caught my eye and the shape works
            for you.
          </p>
          <ol className="mt-5 space-y-2.5 border-t border-[#0a0a0a]/12 pt-5">
            {[
              ["the presenter", "You shipped it and nobody came."],
              ["your screenshot", "This is the paste."],
              ["your screenshot", "That's the dashboard, ten seconds later."],
            ].map(([what, line], i) => (
              <li key={i} className="flex gap-3.5 text-[15px] leading-[1.5]">
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-[#0a0a0a]/60">
                  0{i + 1}
                </span>
                <span>
                  <span className="text-[#0a0a0a]/60">{what} — </span>
                  &ldquo;{line}&rdquo;
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      }
    />
  );
}

/* ===== SHE SHIPS =================================================== */

function PostsIt() {
  return (
    <Cap
      title="She posts it"
      line="Show me first, or just go. Your switch, per channel."
      art={
        <Panel>
          <div className="flex flex-wrap gap-2.5">
            {[
              ["TikTok", "tiktok"],
              ["Instagram", "instagram"],
              ["YouTube", "youtube"],
              ["X", "x"],
            ].map(([label, ch]) => (
              <span
                key={label}
                className="flex items-center gap-2.5 rounded-full border border-[#0a0a0a]/15 px-4 py-2 text-[14.5px]"
              >
                <Mark channel={ch} />
                {label}
              </span>
            ))}
          </div>
        </Panel>
      }
    />
  );
}

/* ===== SHE PROVES IT =============================================== */

/** ⚠️ The live verdict from the dogfood account. */
const RUNGS: Array<[string, string, boolean]> = [
  ["Did we post?", "six this week", false],
  ["Did anyone see it?", "19 views", true],
  ["Did anyone care?", "", false],
  ["Did anyone come?", "", false],
  ["Did anyone convert?", "", false],
];

function WhatsBroken() {
  return (
    <Cap
      flip
      title="She tells you what's broken"
      line="Five questions. The first one that fails is the thing to fix."
      art={
        <Panel pad={false}>
          {RUNGS.map(([q, a, broken], i) => (
            <div
              key={q}
              className={`flex items-baseline justify-between gap-3 px-6 py-3.5 ${
                i === 0 ? "" : "border-t border-[#0a0a0a]/10"
              } ${broken ? "bg-[#0a0a0a]/[0.05]" : ""}`}
            >
              <span
                className={
                  broken
                    ? "font-display italic text-[19px]"
                    : "text-[15.5px] text-[#0a0a0a]/60"
                }
              >
                {q}
              </span>
              <span
                className={`font-mono text-[12px] ${
                  broken ? "text-[#0a0a0a]" : "text-[#0a0a0a]/60"
                }`}
              >
                {a || "—"}
              </span>
            </div>
          ))}
        </Panel>
      }
    />
  );
}

function TracesIt() {
  return (
    <Cap
      title="And traces a signup back to the post"
      line="What she can't account for, she says."
      art={
        <Panel>
          <ol>
            {[
              "1 signup, reported by your site",
              "they clicked your link",
              "from this post",
              "which came from a complaint someone posted",
            ].map((hop, i) => (
              <li
                key={hop}
                className="flex items-baseline gap-4 border-l border-[#0a0a0a]/20 py-2.5 pl-5"
              >
                <span className="font-mono text-[12px] tabular-nums text-[#0a0a0a]/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[15.5px] leading-[1.4]">{hop}</span>
              </li>
            ))}
          </ol>
        </Panel>
      }
    />
  );
}

/* ===== CLOSE ======================================================= */

/**
 * The operator's anchor, not a salary: $300 to a creator for a couple of posts
 * is a number this buyer has already paid.
 */
function TheMath() {
  return (
    <section className="px-6 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <RevealOnView>
          <div className="grid gap-12 border-y border-[#0a0a0a]/15 py-14 sm:grid-cols-2 sm:gap-10 sm:py-20">
            <div>
              <p className="font-display text-[clamp(3rem,8vw,5rem)] leading-[0.85] tracking-tight text-[#0a0a0a]/45 line-through decoration-[2px]">
                $300
              </p>
              <p className="mt-6 max-w-[24ch] text-[16px] leading-[1.55] text-[#0a0a0a]/65">
                A creator, for a couple of posts.
              </p>
            </div>
            <div className="sm:border-l sm:border-[#0a0a0a]/15 sm:pl-12">
              <p className="font-display italic text-[clamp(3rem,8vw,5rem)] leading-[0.85] tracking-tight">
                $99
              </p>
              <p className="mt-6 max-w-[24ch] text-[16px] leading-[1.55] text-[#0a0a0a]/75">
                Maya, every month.
              </p>
            </div>
          </div>
        </RevealOnView>
      </div>
    </section>
  );
}

function Closer() {
  return (
    <section className="px-6 py-24 sm:px-8 sm:py-36">
      <div className="mx-auto max-w-6xl">
        <RevealOnView>
          <h2 className="max-w-[13ch] font-display italic text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.02] tracking-[-0.02em]">
            Stop being your own marketing team.
          </h2>
          <Link
            href={primaryCtaHref(CTA_HREF)}
            className="mt-10 inline-block rounded-full bg-[#0a0a0a] px-8 py-4 text-[15px] text-[#fbfaf6] transition-opacity hover:opacity-85"
          >
            {primaryCtaLabel(CTA_LABEL)}
          </Link>
        </RevealOnView>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="px-6 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-4 text-[13px] text-[#0a0a0a]/60">
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

/* ===== THE RHYTHM ================================================== */

/**
 * ⭐ One shape, every time. Art one side, a short headline and ONE line the
 * other, alternating down the page.
 *
 * ⚠️ This is what lets twelve blocks read as a rhythm rather than as chaos —
 * the eye learns the pattern by the third and stops re-parsing layout. Earlier
 * versions gave each section its own arrangement, which is why the page felt
 * scattered no matter how good the individual blocks were.
 */
function Cap({
  title,
  line,
  art,
  flip = false,
}: {
  title: string;
  line: string;
  art: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <section className="px-6 py-12 sm:px-8 sm:py-16">
      <RevealOnView>
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className={flip ? "lg:order-2" : ""}>{art}</div>
          <div className={flip ? "lg:order-1" : ""}>
            <h2 className="max-w-[18ch] font-display italic text-[clamp(1.75rem,3.4vw,2.6rem)] leading-[1.12] tracking-[-0.01em]">
              {title}
            </h2>
            <p className="mt-4 max-w-sm text-[16.5px] leading-[1.55] text-[#0a0a0a]/65">
              {line}
            </p>
          </div>
        </div>
      </RevealOnView>
    </section>
  );
}

/**
 * ⚠️ A phase marker, NOT a number. Numbering implied a sequence the content
 * does not have — she is not doing these in order, she does all of them.
 */
function Phase({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 pt-16 sm:px-8 sm:pt-24">
      <div className="mx-auto max-w-6xl border-t border-[#0a0a0a]/15 pt-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/60">
          {children}
        </p>
      </div>
    </div>
  );
}

function Panel({
  children,
  pad = true,
}: {
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-[#0a0a0a]/12 bg-white ${
        pad ? "p-7 sm:p-8" : "py-1"
      }`}
    >
      {children}
    </div>
  );
}

function Field({ k, v, dim = false }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="border-b border-[#0a0a0a]/10 py-3.5 last:border-b-0 last:pb-0 first:pt-0">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#0a0a0a]/60">
        {k}
      </p>
      <p
        className={`mt-1.5 text-[15.5px] leading-[1.45] ${
          dim ? "text-[#0a0a0a]/65" : ""
        }`}
      >
        {v}
      </p>
    </div>
  );
}

function Mark({ channel }: { channel: string }) {
  const c = "size-3.5 shrink-0";
  if (channel === "tiktok") return <SiTiktok className={c} />;
  if (channel === "instagram") return <SiInstagram className={c} />;
  if (channel === "youtube") return <SiYoutube className={c} />;
  return <span className="w-3.5 shrink-0 text-center text-[13px] font-semibold">X</span>;
}

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

function PageStyles() {
  return (
    <style>{`
      [data-page="clawlaunch-landing"] .font-display {
        font-family: var(--font-instrument-serif), Georgia, serif;
      }
      [data-page="clawlaunch-landing"] .reveal-on-view {
        opacity: 0;
        transform: translateY(24px);
        transition:
          opacity 0.85s cubic-bezier(0.16, 1, 0.3, 1),
          transform 0.85s cubic-bezier(0.16, 1, 0.3, 1);
      }
      [data-page="clawlaunch-landing"] .reveal-on-view[data-visible="true"] {
        opacity: 1;
        transform: none;
      }
      @media (prefers-reduced-motion: reduce) {
        [data-page="clawlaunch-landing"] .reveal-on-view {
          opacity: 1; transform: none; transition: none;
        }
      }
    `}</style>
  );
}
