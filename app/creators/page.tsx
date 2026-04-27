"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Calendar,
  Inbox,
  LineChart,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type Billing = "monthly" | "annual";

type Tier = {
  name: string;
  monthly: number;
  annual: number;
  headline: string;
  bullets: string[];
  recommended?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    monthly: 19.99,
    annual: 199,
    headline: "1 platform, web + SMS, manual deal entry. Maya's daily core.",
    bullets: [
      "1 connected platform",
      "Web chat + SMS",
      "Morning brief, evening recap, weekly review",
      "200 chat turns / mo",
    ],
  },
  {
    name: "Pro",
    monthly: 39.99,
    annual: 399,
    headline:
      "Up to 3 platforms, every channel, full Gmail deal desk. The default.",
    bullets: [
      "Up to 3 platforms",
      "iMessage, WhatsApp, SMS, web",
      "All 17 proactive behaviors",
      "Full Gmail brand-deal triage",
      "Calendar-aware content arcs",
      "5 named competitors watched",
      "Unlimited chat",
    ],
    recommended: true,
  },
  {
    name: "Studio",
    monthly: 79.99,
    annual: 799,
    headline:
      "Up to 5 platforms, brand outreach, multi-account. For the full-time creator.",
    bullets: [
      "Up to 5 platforms",
      "Priority routing & faster cadence",
      "Brand outreach via Apollo / Hunter",
      "10 named competitors watched",
      "Up to 3 personas",
      "On-demand readiness packets",
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does Maya post for me?",
    a: "No. Maya prepares everything — hook, script, caption, suggested time, per-platform variant — for you to post in one tap. We've kept the moment-of-publishing in your hands deliberately. Your account, your voice, your call.",
  },
  {
    q: "How does the 14-day Pro trial work?",
    a: "No card required. You get full Pro for 14 days. On day 12, Maya nudges you to add a card. If you don't, the account quietly downgrades to Starter limits — you keep your data, you keep your Maya, you just lose the Pro-only behaviors.",
  },
  {
    q: "Which messengers does Maya live in?",
    a: "iMessage (recommended for iPhone), WhatsApp (recommended for Android), SMS as a fallback, and web chat from your dashboard. You pick at onboarding, you can change it any time. Maya routes outbound messages to whatever you've set.",
  },
  {
    q: "What does Maya actually see about my accounts?",
    a: "Public post data, public audience demographics, your own comments, and whatever you explicitly connect — Gmail, Stripe, Calendar. She never logs in as you. She reads through ScrapeCreators (a public-data layer), and writes only through OAuth scopes you grant per provider.",
  },
  {
    q: "Will Maya sound like a robot pretending to be me?",
    a: "She isn't trying to be you. She's trying to manage you. Maya has her own voice — direct, grounded, not flattering — and references your work specifically. You set the tone (supportive / strategic / tough-love) at onboarding and can re-tune any time from Profile.",
  },
  {
    q: "What happens if I cancel?",
    a: "Maya stops at the end of the period. Your data export is one click — posts, plans, deals, briefs, all of it. We don't hold creator data hostage; you can take Maya's full memory of your career with you.",
  },
];

export default function Home() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <Nav />
      <main className="relative z-10 flex-1">
        <Hero />
        <Marquee />
        <Features />
        <ConversationShowcase />
        <Pricing billing={billing} setBilling={setBilling} />
        <Faq />
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
      <div className="mx-auto flex max-w-7xl items-center justify-between">
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
          <a href="#how" className="transition-colors hover:text-paper">
            How she works
          </a>
          <a href="#showcase" className="transition-colors hover:text-paper">
            Conversation
          </a>
          <a href="#pricing" className="transition-colors hover:text-paper">
            Pricing
          </a>
          <a href="#faq" className="transition-colors hover:text-paper">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden text-sm text-paper-dim transition-colors hover:text-paper sm:inline"
          >
            Sign in
          </Link>
          <Link href="/sign-up?plan=pro&trial=true" className="btn btn-primary h-10 px-4 text-sm">
            Hire Maya
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
      style={{ boxShadow: "0 0 0 1px rgba(214,255,61,0.3), 0 6px 24px -6px rgba(214,255,61,0.5)" }}
    >
      <span className="font-display text-lg leading-none">m</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  HERO                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative px-6 pt-16 sm:px-10 sm:pt-24 lg:pt-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-10">
          {/* Headline column */}
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] px-3 py-1 text-xs uppercase tracking-[0.18em] text-paper-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              Now in beta — 5K to 500K creators
            </div>
            <h1 className="mt-6 font-display text-[clamp(2.75rem,7vw,5.75rem)] leading-[1.02] tracking-[-0.02em] text-paper">
              Your AI creator
              <br />
              manager.{" "}
              <span className="italic text-paper-dim">
                Hire her in 4 minutes.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-paper-dim">
              Maya plans your week, watches your performance, triages your brand
              emails, and tells you what to post next — every day, in your
              messages. Not an app you open. A manager you reply to.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up?plan=pro&trial=true"
                className="btn btn-primary group"
              >
                Hire Maya
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" />
              </Link>
              <a href="#how" className="btn btn-ghost">
                How she works
              </a>
              <span className="ml-1 text-sm text-paper-faint">
                14-day Pro trial · no card required
              </span>
            </div>
          </div>

          {/* Quote / receipt column */}
          <aside className="lg:col-span-5">
            <div className="relative">
              {/* The little manila tag at the corner */}
              <div className="absolute -top-3 right-6 z-10 rounded-sm bg-lime px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-ink">
                Brief · 07:02
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-paper-faint">
                  <Sparkles className="h-3.5 w-3.5 text-lime" />
                  Maya · this morning
                </div>
                <p className="mt-5 font-display text-2xl italic leading-snug text-paper">
                  &ldquo;Your &lsquo;POV: I tried…&rsquo; hook on Monday hit
                  340K. Wednesday&rsquo;s &lsquo;Day in my life&rsquo; flatlined
                  at 8K. I drafted three new POV openers for Thursday — want to
                  see them?&rdquo;
                </p>
                <div className="mt-6 flex items-center justify-between border-t border-[var(--hairline)] pt-5 text-xs font-mono text-paper-faint">
                  <span>cited · @yourhandle/posts/9382, /9407</span>
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

/* ─────────────────────────────────────────────────────────────────────────── */
/*                              MARQUEE STRIP                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function Marquee() {
  const items = [
    "TikTok",
    "Instagram",
    "YouTube",
    "LinkedIn",
    "X",
    "Threads",
    "Pinterest",
    "Reddit",
    "Snapchat",
    "Twitch",
    "Bluesky",
    "Substack",
  ];
  // Doubled list so the loop is seamless.
  const loop = [...items, ...items];

  return (
    <section
      aria-label="Supported platforms"
      className="mt-24 border-y border-[var(--hairline)] bg-ink-2/40 py-5 sm:mt-32"
    >
      <div className="flex items-center gap-8">
        <span className="ml-6 hidden shrink-0 font-mono text-[11px] uppercase tracking-widest text-paper-faint sm:inline">
          Reads · 27 platforms
        </span>
        <div className="relative flex-1 overflow-hidden">
          <div className="marquee-track flex w-max gap-12">
            {loop.map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="font-display text-2xl tracking-tight text-paper-dim"
              >
                {item}{" "}
                <span className="text-paper-faint">·</span>
              </span>
            ))}
          </div>
          {/* edge fades */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[var(--ink)] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[var(--ink)] to-transparent" />
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                FEATURES                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    no: "01",
    icon: Calendar,
    title: "Content strategy",
    body: "She watches your top 30 posts, finds your hooks that worked, and plans next week around them. Calendar-aware: got a wedding, trip, or launch coming up? Maya plans content arcs around your real life — build-up, day-of, recap.",
    tag: "Plans, doesn't post",
  },
  {
    no: "02",
    icon: Inbox,
    title: "Deal desk",
    body: "Brand emails come in, Maya drafts 4 reply variants tuned to your floor rate, flags red-flag contracts, and books shoots in your calendar. You approve, she sends.",
    tag: "Drafts, you approve",
  },
  {
    no: "03",
    icon: LineChart,
    title: "Accountability",
    body: "Morning brief at 7am, evening recap at 7pm, Sunday weekly review. She tells you what's working, what's not, and what to fix — honestly, not flatteringly.",
    tag: "Honest, not flattering",
  },
] as const;

function Features() {
  return (
    <section
      id="how"
      className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              §01 · What she does
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              The operational layer of a creator career — handled by someone
              who&rsquo;s{" "}
              <span className="italic text-paper-dim">always paying attention.</span>
            </h2>
          </div>
          <div className="lg:col-span-8">
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-[var(--hairline)] sm:grid-cols-1">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <li
                    key={f.no}
                    className="group relative flex flex-col gap-5 bg-ink-2 p-7 transition-colors hover:bg-ink-3 sm:flex-row sm:items-start sm:gap-7 sm:p-9"
                  >
                    <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
                      <span className="font-mono text-xs text-paper-faint">
                        {f.no}
                      </span>
                      <span className="grid h-10 w-10 place-items-center rounded-full border border-[var(--hairline-strong)] text-lime">
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h3 className="font-display text-2xl text-paper sm:text-3xl">
                          {f.title}
                        </h3>
                        <span className="rounded-full border border-[var(--hairline-strong)] px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-wider text-paper-dim">
                          {f.tag}
                        </span>
                      </div>
                      <p className="mt-3 max-w-2xl text-base leading-relaxed text-paper-dim">
                        {f.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                       CONVERSATION SHOWCASE (CENTERPIECE)                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function ConversationShowcase() {
  return (
    <section
      id="showcase"
      className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              §02 · How Maya talks to you
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              Not an app you open. A{" "}
              <span className="italic text-paper-dim">manager you reply to.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-paper-dim">
              Maya pushes the things that matter to your phone the moment they
              matter. Specific. Cited. Grounded in what she actually saw on your
              accounts.
            </p>
            <ul className="mt-8 space-y-4 text-paper-dim">
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">Push, don&rsquo;t pull.</strong>{" "}
                  She tells you. You don&rsquo;t check a dashboard.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">Grounded or silent.</strong>{" "}
                  Every claim cites the post, the metric, the email.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">You publish.</strong> Maya
                  prepares; you press post. Always.
                </span>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-7">
            <Phone />
          </div>
        </div>
      </div>
    </section>
  );
}

function Phone() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Decorative date stamp */}
      <div className="absolute -left-6 top-10 hidden -rotate-90 origin-left font-mono text-[10px] uppercase tracking-[0.3em] text-paper-faint lg:block">
        Mon · 7:02 am · iMessage
      </div>

      {/* Device frame */}
      <div
        className="relative rounded-[42px] border border-[var(--hairline-strong)] bg-black p-2 shadow-[0_50px_120px_-30px_rgba(0,0,0,0.8),inset_0_0_0_1px_rgba(255,255,255,0.04)]"
        style={{ aspectRatio: "9 / 19" }}
      >
        {/* Dynamic Island */}
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />

        {/* Screen */}
        <div className="relative h-full w-full overflow-hidden rounded-[34px] bg-[#000]">
          {/* iMessage status / chat-header bar */}
          <div className="flex items-center justify-between px-5 pb-3 pt-12 text-[11px] text-white/70">
            <span className="font-medium">9:41</span>
            <div className="flex items-center gap-1">
              <SignalIcon />
              <WifiIcon />
              <BatteryIcon />
            </div>
          </div>
          <div className="flex flex-col items-center border-b border-white/[0.06] px-5 pb-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-lime text-ink">
              <span className="font-display text-xl leading-none">m</span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-white/60">
              <span className="font-medium text-white">Maya</span>
              <ArrowUpRight className="h-3 w-3" />
            </div>
          </div>

          {/* Message stream */}
          <div className="flex flex-col gap-2.5 overflow-hidden px-3 py-4">
            <TimeStamp>Today · 7:02 AM</TimeStamp>

            <Bubble side="left" delay={0}>
              Morning. Quick read on the weekend before today gets weird.
            </Bubble>

            <Bubble side="left" delay={120}>
              Your &ldquo;POV: I tried…&rdquo; on Monday hit{" "}
              <strong className="font-semibold">340K</strong>. The
              &ldquo;Day in my life&rdquo; on Wed plateaued at{" "}
              <strong className="font-semibold">8K</strong>. Same niche, same
              length — different opener.
            </Bubble>

            <Bubble side="left" delay={240}>
              Saves on the 340K post are{" "}
              <strong className="font-semibold">9.4%</strong>. That&rsquo;s
              algorithm fuel for the next 72h. Lean into POV format Thurs &amp; Fri.
            </Bubble>

            <Bubble side="left" delay={360}>
              <span className="block">Drafted 3 POV openers for Thursday:</span>
              <span className="mt-2 block rounded-2xl bg-black/40 px-3 py-2 text-[12px] leading-relaxed text-white/90">
                1. &ldquo;POV: my therapist said one sentence and broke me&rdquo;
                <br />
                2. &ldquo;POV: you finally booked the trip&rdquo;
                <br />
                3. &ldquo;POV: 31 and starting over&rdquo;
              </span>
            </Bubble>

            <Bubble side="left" delay={480}>
              Want me to write the scripts? Also — Glossier&rsquo;s reply is
              sitting in Gmail, $4K offer, below your floor. I drafted a
              counter.
            </Bubble>

            <div className="reveal-up" style={{ animationDelay: "640ms" }}>
              <div className="ml-auto mt-1 flex max-w-[78%] justify-end">
                <div className="rounded-[20px] rounded-br-[6px] bg-[var(--imessage-blue)] px-3.5 py-2 text-[14px] leading-snug text-white shadow-[0_1px_0_rgba(0,0,0,0.2)]">
                  yes scripts. send the counter.
                </div>
              </div>
            </div>

            <div className="reveal-up flex items-center gap-1 px-2" style={{ animationDelay: "820ms" }}>
              <Dot />
              <Dot delay={150} />
              <Dot delay={300} />
              <span className="ml-1 text-[10px] text-white/40">Maya</span>
            </div>
          </div>

          {/* Chat input bar */}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-white/[0.06] bg-black/80 px-3 py-2.5 backdrop-blur">
            <button
              aria-label="Add"
              className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/70"
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="flex h-8 flex-1 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[12px] text-white/40">
              iMessage
            </div>
            <button
              aria-label="Send"
              className="grid h-7 w-7 place-items-center rounded-full bg-[var(--imessage-blue)] text-white"
            >
              <ArrowUpRight className="h-4 w-4 -rotate-45" />
            </button>
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-1 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/40" />
        </div>
      </div>

      {/* Small caption under device */}
      <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-paper-faint">
        Real conversation shape · iMessage shown · WhatsApp / SMS / web also
      </p>
    </div>
  );
}

function Bubble({
  children,
  side,
  delay,
}: {
  children: React.ReactNode;
  side: "left" | "right";
  delay: number;
}) {
  const isLeft = side === "left";
  return (
    <div
      className={`reveal-up flex ${isLeft ? "justify-start" : "justify-end"}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={`max-w-[82%] rounded-[20px] px-3.5 py-2 text-[14px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.2)] ${
          isLeft
            ? "rounded-bl-[6px] bg-[var(--imessage-gray)] text-white"
            : "rounded-br-[6px] bg-[var(--imessage-blue)] text-white"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-white/60"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

function TimeStamp({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center text-[10px] font-medium uppercase tracking-wider text-white/40">
      {children}
    </div>
  );
}

function SignalIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" aria-hidden>
      <rect x="0" y="7" width="2" height="3" rx="0.5" />
      <rect x="4" y="5" width="2" height="5" rx="0.5" />
      <rect x="8" y="3" width="2" height="7" rx="0.5" />
      <rect x="12" y="0" width="2" height="10" rx="0.5" />
    </svg>
  );
}
function WifiIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" aria-hidden>
      <path d="M7 9.5a1 1 0 100-2 1 1 0 000 2zm0-4.2c1.4 0 2.7.5 3.6 1.5l1.1-1.1A6.6 6.6 0 007 4.2a6.6 6.6 0 00-4.7 1.6L3.4 6.8A4.6 4.6 0 017 5.3zm0-3.5c2.4 0 4.6.9 6.3 2.4L14.4 3a8.6 8.6 0 00-14.8 0l1 1.1A8.6 8.6 0 017 1.8z" />
    </svg>
  );
}
function BatteryIcon() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="18" height="9" rx="2" stroke="currentColor" opacity="0.5" />
      <rect x="2" y="2" width="14" height="6" rx="1" fill="currentColor" />
      <rect x="20" y="3" width="2" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  PRICING                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function Pricing({
  billing,
  setBilling,
}: {
  billing: Billing;
  setBilling: (b: Billing) => void;
}) {
  return (
    <section id="pricing" className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              §03 · Pricing
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              Flat tiers. No credits.{" "}
              <span className="italic text-paper-dim">No metering theatre.</span>
            </h2>
          </div>
          <BillingToggle billing={billing} setBilling={setBilling} />
        </div>

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-[var(--hairline)] lg:grid-cols-3">
          {TIERS.map((t) => (
            <PricingCard key={t.name} tier={t} billing={billing} />
          ))}
        </div>

        <p className="mt-6 flex items-center gap-2 text-sm text-paper-faint">
          <ShieldCheck className="h-4 w-4 text-lime" />
          Plan changes prorate. Cancel anytime. Your data exports in one click.
        </p>
      </div>
    </section>
  );
}

function BillingToggle({
  billing,
  setBilling,
}: {
  billing: Billing;
  setBilling: (b: Billing) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-strong)] bg-ink-2 p-1 text-sm"
    >
      <button
        role="tab"
        aria-selected={billing === "monthly"}
        onClick={() => setBilling("monthly")}
        className={`rounded-full px-4 py-1.5 transition-colors ${
          billing === "monthly"
            ? "bg-paper text-ink"
            : "text-paper-dim hover:text-paper"
        }`}
      >
        Monthly
      </button>
      <button
        role="tab"
        aria-selected={billing === "annual"}
        onClick={() => setBilling("annual")}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 transition-colors ${
          billing === "annual"
            ? "bg-paper text-ink"
            : "text-paper-dim hover:text-paper"
        }`}
      >
        Annual
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${
            billing === "annual"
              ? "bg-ink text-lime"
              : "bg-[var(--hairline-strong)] text-lime"
          }`}
        >
          −17%
        </span>
      </button>
    </div>
  );
}

function PricingCard({ tier, billing }: { tier: Tier; billing: Billing }) {
  const price = billing === "monthly" ? tier.monthly : tier.annual / 12;
  const totalAnnual = tier.annual;
  const formattedPrice =
    billing === "monthly"
      ? `$${tier.monthly.toFixed(2)}`
      : `$${price.toFixed(2)}`;

  return (
    <div
      className={`relative flex flex-col gap-6 p-7 sm:p-9 ${
        tier.recommended ? "bg-ink-3" : "bg-ink-2"
      }`}
    >
      {tier.recommended && (
        <div className="absolute right-7 top-7 rounded-full bg-lime px-2.5 py-0.5 text-[11px] font-mono uppercase tracking-wider text-ink">
          14-day free trial
        </div>
      )}
      <div>
        <div className="flex items-center gap-3">
          <h3 className="font-display text-3xl text-paper">{tier.name}</h3>
          {tier.recommended && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
              Most chosen
            </span>
          )}
        </div>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-paper-dim">
          {tier.headline}
        </p>
      </div>

      <div className="flex items-end gap-2">
        <span className="font-display text-5xl leading-none tracking-tight text-paper">
          {formattedPrice}
        </span>
        <span className="pb-1 text-sm text-paper-dim">/ mo</span>
      </div>
      <div className="-mt-3 text-xs text-paper-faint">
        {billing === "annual"
          ? `billed $${totalAnnual} / year · no card for trial`
          : "no card required for trial"}
      </div>

      <ul className="mt-2 space-y-2.5 text-sm text-paper-dim">
        {tier.bullets.map((b) => (
          <li key={b} className="flex items-start gap-3">
            <span className="mt-2 h-1 w-3 shrink-0 bg-lime" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/sign-up?plan=${tier.name.toLowerCase()}${
          tier.recommended ? "&trial=true" : ""
        }`}
        className={`btn mt-auto w-full ${
          tier.recommended ? "btn-primary" : "btn-ghost"
        }`}
      >
        {tier.recommended ? "Start with Pro free" : `Choose ${tier.name}`}
      </Link>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                    FAQ                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section id="faq" className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              §04 · FAQ
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              Common questions,{" "}
              <span className="italic text-paper-dim">straight answers.</span>
            </h2>
            <p className="mt-6 text-paper-dim">
              Anti-sycophancy is non-negotiable. That goes for our marketing
              copy too — if it&rsquo;s not honest, it&rsquo;s not on this page.
            </p>
          </div>
          <div className="lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-[var(--hairline-strong)]">
              {FAQ.map((item, i) => (
                <details
                  key={item.q}
                  className={`group bg-ink-2 ${
                    i !== FAQ.length - 1 ? "border-b border-[var(--hairline)]" : ""
                  }`}
                >
                  <summary className="flex items-start justify-between gap-6 p-6 sm:p-7">
                    <span className="font-display text-xl leading-snug text-paper sm:text-2xl">
                      {item.q}
                    </span>
                    <span
                      aria-hidden
                      className="faq-plus mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-paper-dim"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </span>
                  </summary>
                  <div className="px-6 pb-7 pr-14 text-paper-dim sm:px-7">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  FOOTER                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="relative z-10 mt-32 border-t border-[var(--hairline)] px-6 pb-10 pt-16 sm:px-10">
      <div className="mx-auto max-w-7xl">
        {/* Giant wordmark — editorial closer */}
        <div className="overflow-hidden">
          <h3 className="font-display text-[clamp(4rem,18vw,18rem)] leading-[0.9] tracking-[-0.04em] text-paper">
            Hey<span className="italic text-paper-dim">Maya</span>.
          </h3>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-10 border-t border-[var(--hairline)] pt-10 text-sm sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-paper-dim">
              Your AI creator manager before you can afford a human one.
            </p>
            <p className="mt-4 font-mono text-xs uppercase tracking-widest text-paper-faint">
              © {new Date().getFullYear()} HeyMaya
            </p>
          </div>
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Product
            </h4>
            <ul className="mt-3 space-y-2 text-paper-dim">
              <li>
                <a className="hover:text-paper" href="#how">
                  How she works
                </a>
              </li>
              <li>
                <a className="hover:text-paper" href="#pricing">
                  Pricing
                </a>
              </li>
              <li>
                <a className="hover:text-paper" href="#faq">
                  FAQ
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Company
            </h4>
            <ul className="mt-3 space-y-2 text-paper-dim">
              <li>
                <a className="hover:text-paper" href="/terms">
                  Terms
                </a>
              </li>
              <li>
                <a className="hover:text-paper" href="/privacy">
                  Privacy
                </a>
              </li>
              <li>
                <a
                  className="hover:text-paper"
                  href="mailto:hi@heymaya.app"
                >
                  hi@heymaya.app
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              Elsewhere
            </h4>
            <ul className="mt-3 space-y-2 text-paper-dim">
              <li>
                <a
                  className="inline-flex items-center gap-1 hover:text-paper"
                  href="https://x.com/heymaya"
                  target="_blank"
                  rel="noreferrer"
                >
                  X / Twitter <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-1 hover:text-paper"
                  href="https://tiktok.com/@heymaya"
                  target="_blank"
                  rel="noreferrer"
                >
                  TikTok <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-1 hover:text-paper"
                  href="https://instagram.com/heymaya"
                  target="_blank"
                  rel="noreferrer"
                >
                  Instagram <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
