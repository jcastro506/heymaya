"use client";

/**
 * The landing page.
 *
 * ## The rule
 *
 * §18.9.2: **"The artifact is the argument. The copy is a caption."** Every
 * section is one real thing and a headline over it. Nothing else — no kickers,
 * no section numbers, no explanatory paragraph underneath.
 *
 * ⚠️ An earlier pass added numbered sections and a caption under every block.
 * It was more structure, not more clarity: the eye reads the scaffolding
 * before it reads the work, and a caption under a video is a paragraph
 * explaining a thing the visitor is already looking at. Both are gone.
 *
 * ## The argument
 *
 * The operator's framing, and it is sharper than a feature list: **they can
 * build the app now; they cannot get customers.** Building got easy and
 * distribution didn't.
 *
 * So: what she makes → try her on your own site → how she knew what to make →
 * what she can't do → what it replaces. Proof first, because §19 is right that
 * *"founders don't doubt that software can write. They doubt that it knows
 * anything."*
 *
 * ⚠️ Every artifact is REAL. The format card is pulled from the dogfood
 * account's own library, beats and all — a mockup there would be the product
 * contradicting itself on the page where it claims it never fabricates.
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
      <Work />
      <TryIt />
      <SheWatches />
      <Limits />
      <TheMath />
      <Closer />
      <Footer />
    </main>
  );
}

function Masthead() {
  return (
    <header className="absolute inset-x-0 top-0 z-40">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 sm:px-8">
        <Link href="/" className="font-display italic text-[19px]">
          HeyMaya
        </Link>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="text-[14px] underline decoration-[#0a0a0a]/25 underline-offset-[5px] transition-colors hover:decoration-[#0a0a0a]"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </header>
  );
}

/**
 * ⚠️ Names the cause, not the symptom. "Your app is good, nobody knows it
 * exists" is true and describes a feeling. This describes the moment they are
 * actually standing in — building got easy, selling didn't — which is the
 * thing that makes someone read the next line.
 */
function Hero() {
  return (
    <section className="px-6 pt-40 pb-28 sm:px-8 sm:pt-48 sm:pb-36">
      <div className="mx-auto max-w-6xl">
        <h1 className="max-w-[15ch] font-display text-[clamp(3rem,9vw,7.5rem)] leading-[0.94] tracking-[-0.025em]">
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
          className="hero-line mt-14 flex flex-col gap-8 sm:mt-16"
          style={{ animationDelay: "1.5s" }}
        >
          <p className="max-w-lg text-[19px] leading-[1.5] text-[#0a0a0a]/70 sm:text-[21px]">
            Maya is your content hire. She watches your niche, makes the posts,
            and puts them out.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link
              href={primaryCtaHref(CTA_HREF)}
              className="rounded-full bg-[#0a0a0a] px-8 py-4 text-[15px] text-[#fbfaf6] transition-opacity hover:opacity-85"
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

/** Real videos she cut. No caption — they are not ambiguous. */
function Work() {
  return (
    <Block title="This is what she makes.">
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

/** `DemoRead` carries its own copy — anything here would repeat it. */
function TryIt() {
  return (
    <Block title="Try her on your own site.">
      <div className="max-w-2xl">
        <DemoRead />
      </div>
    </Block>
  );
}

/**
 * ⭐ §5.3: "the single most differentiated capability in the product."
 *
 * ⚠️ Real, from the dogfood library on 2026-08-17. A competitor can copy this
 * layout in an afternoon and cannot produce its contents.
 */
const BEATS = [
  ["0:00", "Dismisses the idea of a magic formula"],
  ["0:12", "Reframes it — time, intent, market fit"],
  ["0:20", "Names the real cost: days, weeks, months"],
  ["0:32", "Warns against chasing the shortcut"],
  ["0:44", "Build something you'd be proud of"],
  ["0:50", "Lands it — people still value the real thing"],
];

function SheWatches() {
  return (
    <Block title="She watches the video. Not the caption.">
      <div className="grid overflow-hidden rounded-2xl border border-[#0a0a0a]/12 lg:grid-cols-2">
        <div className="border-b border-[#0a0a0a]/12 p-8 sm:p-11 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-[13px] text-[#0a0a0a]/45">
            <SiTiktok className="size-3.5" />
            <span>17,385 views</span>
          </div>
          <p className="mt-8 font-display italic text-[30px] leading-[1.15] sm:text-[36px]">
            &ldquo;Resist the Hack. Build Remarkable.&rdquo;
          </p>
          <p className="mt-8 text-[16px] leading-[1.55] text-[#0a0a0a]/65">
            Straight to camera from a car. Title fixed top-center, captions
            below, key words boxed as they land.
          </p>
        </div>

        <div className="p-8 sm:p-11">
          <ol>
            {BEATS.map(([at, what], i) => (
              <li
                key={at}
                className={`grid grid-cols-[3.5rem_1fr] gap-5 py-3.5 ${
                  i === 0 ? "" : "border-t border-[#0a0a0a]/8"
                }`}
              >
                <span className="text-[14px] tabular-nums text-[#0a0a0a]/35">
                  {at}
                </span>
                <span className="text-[16px] leading-[1.45] text-[#0a0a0a]/80">
                  {what}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-8 border-t border-[#0a0a0a]/12 pt-8 font-display italic text-[20px] leading-[1.4]">
            So yours opens by rejecting the shortcut everyone&rsquo;s selling,
            then shows the slower thing that works.
          </p>
        </div>
      </div>
    </Block>
  );
}

/**
 * ⚠️ On the page, not in a FAQ. §12: honest limits are told before they are
 * discovered, and a visitor who reads a real limit believes the rest.
 */
const LIMITS: Array<[string, string]> = [
  ["Posts", "TikTok, Instagram, YouTube, X"],
  ["Answers comments", "Instagram, YouTube, X. TikTok has no API for it."],
  ["Links in the post", "YouTube and X. The others are bio-link platforms."],
  ["Needs a real shot of your product", "She won't invent one."],
];

function Limits() {
  return (
    <Block title="What she can't do.">
      <dl className="max-w-3xl">
        {LIMITS.map(([k, v], i) => (
          <div
            key={k}
            className={`grid gap-1.5 py-6 sm:grid-cols-[20rem_1fr] sm:gap-10 ${
              i === 0 ? "" : "border-t border-[#0a0a0a]/12"
            }`}
          >
            <dt className="font-display italic text-[21px] leading-tight">
              {k}
            </dt>
            <dd className="text-[16px] leading-[1.5] text-[#0a0a0a]/60">{v}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}

/**
 * ⭐ The comparison IS the argument, so it gets no headline and no explanation.
 *
 * The spec anchors on a salary; the operator's anchor is the number this buyer
 * has actually paid — $300 to a UGC creator for a couple of posts. A salary is
 * abstract to someone who has never hired. An invoice they already paid is not.
 */
function TheMath() {
  return (
    <section className="px-6 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-14 border-y border-[#0a0a0a]/15 py-16 sm:grid-cols-2 sm:gap-10 sm:py-20">
          <div>
            <p className="font-display text-[clamp(3rem,9vw,6rem)] leading-[0.85] tracking-[-0.02em] text-[#0a0a0a]/25 line-through decoration-[2px]">
              $300
            </p>
            <p className="mt-6 max-w-[26ch] text-[17px] leading-[1.5] text-[#0a0a0a]/50">
              A creator, for a couple of posts. Then you brief them again next
              week.
            </p>
          </div>
          <div>
            <p className="font-display italic text-[clamp(3rem,9vw,6rem)] leading-[0.85] tracking-[-0.02em]">
              $99
            </p>
            <p className="mt-6 max-w-[26ch] text-[17px] leading-[1.5] text-[#0a0a0a]/70">
              Maya, every month. She briefs herself.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Closer() {
  return (
    <section className="px-6 py-28 sm:px-8 sm:py-40">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-[13ch] font-display italic text-[clamp(2.5rem,7vw,5.5rem)] leading-[1] tracking-[-0.02em]">
          Stop being your own marketing team.
        </h2>
        <Link
          href={primaryCtaHref(CTA_HREF)}
          className="mt-12 inline-block rounded-full bg-[#0a0a0a] px-8 py-4 text-[15px] text-[#fbfaf6] transition-opacity hover:opacity-85"
        >
          {primaryCtaLabel(CTA_LABEL)}
        </Link>
      </div>
    </section>
  );
}

/**
 * One headline, one artifact. That is the entire section grammar.
 *
 * ⚠️ No number, no kicker, no caption. Scaffolding that repeats on every
 * section stops being rhythm and becomes furniture the eye has to step over.
 */
function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-6 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-12 max-w-3xl font-display italic text-[clamp(1.9rem,4vw,3rem)] leading-[1.1] tracking-[-0.015em] sm:mb-16">
          {title}
        </h2>
        {children}
      </div>
    </section>
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
