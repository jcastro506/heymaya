"use client";

/**
 * Service-business marketing landing.
 *
 * Mirrors the creator landing's structure (Hero / Features / Showcase / Pricing
 * / FAQ / Footer) but with the trades-shaped story. Pricing is locked per
 * Service Sprint Plan § 3:
 *   Starter $99/mo  ($999/yr)
 *   Pro     $149/mo ($1,499/yr)  — 14-day Pro trial → auto-downgrade to Starter
 *   Studio  $199/mo ($1,999/yr)
 *
 * Headline + subline are spec-locked:
 *   H: "Your AI marketing manager before you can afford a human one — for the trades."
 *   S: "Maya turns every completed job into local marketing."
 *
 * Sprint 2 will wire up the actual onboarding flow at /onboarding/business.
 * For now, the CTA routes to the Sprint-0 placeholder there.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Camera,
  ClipboardCheck,
  MessageCircle,
  Mic,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";

import { MarketingNav } from "../_components/MarketingNav";
import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";

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
    monthly: 99,
    annual: 999,
    headline:
      "1 GBP, text-only Maya, manual review approval. The daily core for solo operators.",
    bullets: [
      "1 Google Business Profile",
      "Web chat + SMS",
      "Morning brief, job-completion review queue, lead alarms",
      "200 chat turns / mo",
      "Manual approval on every send",
    ],
  },
  {
    name: "Pro",
    monthly: 149,
    annual: 1499,
    headline:
      "1 GBP + 2 social, full Gmail deal desk, CRM-aware. The default for growing crews.",
    bullets: [
      "1 GBP + Facebook + Instagram",
      "iMessage, WhatsApp, SMS, web",
      "All 15 proactive behaviors",
      "1,000 chat turns / mo",
      "Full Gmail brand-deal triage",
      "CRM integration (Jobber / HCP / QBO)",
      "30 voice min / mo",
    ],
    recommended: true,
  },
  {
    name: "Studio",
    monthly: 199,
    annual: 1999,
    headline:
      "Up to 5 GBPs, ServiceTitan, content rejuvenation, full voice. For multi-location.",
    bullets: [
      "Up to 5 GBP locations",
      "All channels including voice",
      "Unlimited chat",
      "ServiceTitan integration",
      "Content rejuvenation + video editing",
      "100 voice min / mo · $0.15 / min overage",
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does Maya post to my GBP automatically?",
    a: "No. Every reply, post, and review request lands as a draft for you to approve. Google's review-reply moderation rejects AI-flavored replies that bypass operator approval — and your name is on the work, not ours. You approve, Maya sends.",
  },
  {
    q: "How does the 14-day Pro trial work?",
    a: "No card required. You get full Pro for 14 days. On day 12, Maya nudges you to add a card. If you don't, the account quietly downgrades to Starter limits — you keep your data, you keep your Maya, you just lose the Pro-only behaviors.",
  },
  {
    q: "Which CRMs do you support?",
    a: "Jobber and QuickBooks Online ship at launch. Housecall Pro is supported on the MAX plan (the only HCP tier that exposes API access). ServiceTitan is Studio-only via partner program. If you don't use a CRM yet, Maya works from what you tell her — text her a job address + customer last name and she'll catch up.",
  },
  {
    q: "What does Maya actually do after a job is completed?",
    a: "Three things, immediately: (1) drafts a review request in your brand voice, ready to send the customer 24h later, (2) curates the job photos you texted her into a GBP-ready post draft, (3) flags any follow-up service Maya thinks the customer might want. You approve each one in your messages.",
  },
  {
    q: "Will Maya sound like a robot pretending to be me?",
    a: "She isn't trying to be you. She's trying to manage your marketing. Maya reads your last 50 reviews and your existing GBP replies to learn your brand voice — direct, grounded, local. You set the tone (friendly neighborhood pro / professional & efficient / authoritative expert) at onboarding and can re-tune any time.",
  },
  {
    q: "What if my customer leaves a 1-star review?",
    a: "Maya drafts a calm, accountability-first reply, flags the risk in your morning brief, and never auto-posts. Negative-review reply drafts always sit in your queue until you approve. She'll also cross-reference the reviewer name against your CRM to spot whether the job context is real.",
  },
];

export default function BusinessHome() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <MarketingNav />
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
              Beta — for plumbers, HVAC, roofers, electricians, cleaners
            </div>
            <h1 className="mt-6 font-display text-[clamp(2.5rem,6.5vw,5.25rem)] leading-[1.02] tracking-[-0.02em] text-paper">
              Your AI marketing manager before you can afford a human one{" "}
              <span className="italic text-paper-dim">— for the trades.</span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-paper-dim">
              Maya turns every completed job into local marketing. Text her a
              photo and a few words about the job — she drafts the review
              request, the GBP post, and the reply when the review lands. You
              approve. She sends.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={primaryCtaHref("/onboarding/business")}
                className="btn btn-primary group"
              >
                {primaryCtaLabel("Start 14-day Pro trial")}
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
              <div className="absolute -top-3 right-6 z-10 rounded-sm bg-lime px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-ink">
                Brief · 07:02
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-paper-faint">
                  <Sparkles className="h-3.5 w-3.5 text-lime" />
                  Maya · this morning
                </div>
                <p className="mt-5 font-display text-2xl italic leading-snug text-paper">
                  &ldquo;Yesterday: 3 jobs closed. Drafted review requests for
                  the Johnson kitchen sink and the Patel furnace tune-up.
                  Holding the third — Mrs. Alvarez wrote a long thank-you text
                  already, want me to ask her on Google instead?&rdquo;
                </p>
                <div className="mt-6 flex items-center justify-between border-t border-[var(--hairline)] pt-5 text-xs font-mono text-paper-faint">
                  <span>cited · 3 jobs · CRM #4821 / #4822 / #4823</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                    grounded
                  </span>
                </div>
              </div>
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
    "Plumbing",
    "HVAC",
    "Electrical",
    "Roofing",
    "Cleaning",
    "Landscaping",
    "Pest control",
    "Restoration",
    "Painting",
    "Mobile detailing",
    "Garage doors",
    "Pool service",
  ];
  const loop = [...items, ...items];

  return (
    <section
      aria-label="Supported trades"
      className="mt-24 border-y border-[var(--hairline)] bg-ink-2/40 py-5 sm:mt-32"
    >
      <div className="flex items-center gap-8">
        <span className="ml-6 hidden shrink-0 font-mono text-[11px] uppercase tracking-widest text-paper-faint sm:inline">
          Built for · 12 trades
        </span>
        <div className="relative flex-1 overflow-hidden">
          <div className="marquee-track flex w-max gap-12">
            {loop.map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="font-display text-2xl tracking-tight text-paper-dim"
              >
                {item} <span className="text-paper-faint">·</span>
              </span>
            ))}
          </div>
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
    icon: Camera,
    title: "Job → post",
    body: "Text Maya a photo and one line about the job: \"just finished the Johnson kitchen sink at 432 Oak.\" She curates the photo, drafts a GBP post in your voice, and queues it for your one-tap approval.",
    tag: "You text, Maya drafts",
  },
  {
    no: "02",
    icon: Star,
    title: "Review pipeline",
    body: "Every completed job becomes a review request 24h later — drafted in your brand voice, sent via SMS or email, followed up day 3 and day 7 if no response. When the review lands, Maya drafts the reply and pings you to approve.",
    tag: "Drafts, you approve",
  },
  {
    no: "03",
    icon: MessageCircle,
    title: "Lead alarm",
    body: "Missed call from a GBP message? FB DM sitting cold for 2 hours? Maya nudges you on your phone with the lead's name, zip, and a draft reply. Capped at 4 alerts a day so she's a manager, not a pager.",
    tag: "Honest, not spammy",
  },
] as const;

function Features() {
  return (
    <section id="how" className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              §01 · What she does
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              Every completed job becomes{" "}
              <span className="italic text-paper-dim">local marketing.</span>
            </h2>
            <p className="mt-6 text-paper-dim">
              The local-business marketing playbook is well-known: ask for the
              review, post the photo, reply to the comment, follow up on the
              missed lead. Doing it consistently is the hard part. Maya does it
              consistently.
            </p>
          </div>
          <div className="lg:col-span-8">
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-[var(--hairline)]">
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
              You finish the job.{" "}
              <span className="italic text-paper-dim">She does the rest.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-paper-dim">
              The flow is simple. Text Maya a photo + voice note when you wrap
              up. She makes the post, asks the customer for the review, and
              drafts the GBP reply when it lands — every step grounded in the
              job you actually did.
            </p>
            <ul className="mt-8 space-y-4 text-paper-dim">
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">Push, don&rsquo;t pull.</strong>{" "}
                  No dashboard to check at 9pm. She tells you what needs you.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">Grounded or silent.</strong>{" "}
                  Every draft cites the job, the photo, the customer.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">You approve.</strong> Nothing
                  hits Google or your customer without your one-tap yes.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                <span>
                  <strong className="text-paper">Hard-capped.</strong> Max 4
                  unsolicited messages a day. She&rsquo;s a manager, not a
                  pager.
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
      <div className="absolute -left-6 top-10 hidden -rotate-90 origin-left font-mono text-[10px] uppercase tracking-[0.3em] text-paper-faint lg:block">
        Tue · 4:48 pm · iMessage
      </div>

      <div
        className="relative rounded-[42px] border border-[var(--hairline-strong)] bg-black p-2 shadow-[0_50px_120px_-30px_rgba(0,0,0,0.8),inset_0_0_0_1px_rgba(255,255,255,0.04)]"
        style={{ aspectRatio: "9 / 19" }}
      >
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 h-7 w-28 -translate-x-1/2 rounded-full bg-black" />

        <div className="relative h-full w-full overflow-hidden rounded-[34px] bg-[#000]">
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

          <div className="flex flex-col gap-2.5 overflow-hidden px-3 py-4">
            <TimeStamp>Today · 4:48 PM</TimeStamp>

            <Bubble side="right" delay={0}>
              just wrapped the johnson kitchen sink at 432 oak. customer was
              great
            </Bubble>

            <div className="reveal-up flex justify-end" style={{ animationDelay: "120ms" }}>
              <div className="rounded-2xl bg-[#3a3a3c] px-3 py-2 text-[11px] text-white/70">
                <Camera className="mr-1.5 inline h-3 w-3" />
                IMG_4821.jpg
              </div>
            </div>

            <Bubble side="left" delay={260}>
              Got it. Photo&rsquo;s clean — bright, level, no people in frame.
            </Bubble>

            <Bubble side="left" delay={380}>
              <span className="block">Drafted your GBP post:</span>
              <span className="mt-2 block rounded-2xl bg-black/40 px-3 py-2 text-[12px] leading-relaxed text-white/90">
                Another happy kitchen in Westside. Quick swap on a leaky drop-in
                — same-day, no mess. We do these every week. Need yours looked
                at? Tap call.
              </span>
            </Bubble>

            <Bubble side="left" delay={520}>
              Review request scheduled for tomorrow 10am. Want to send it now
              instead?
            </Bubble>

            <div
              className="reveal-up"
              style={{ animationDelay: "680ms" }}
            >
              <div className="ml-auto mt-1 flex max-w-[78%] justify-end">
                <div className="rounded-[20px] rounded-br-[6px] bg-[var(--imessage-blue)] px-3.5 py-2 text-[14px] leading-snug text-white shadow-[0_1px_0_rgba(0,0,0,0.2)]">
                  post it. send the review now.
                </div>
              </div>
            </div>

            <div
              className="reveal-up flex items-center gap-1 px-2"
              style={{ animationDelay: "860ms" }}
            >
              <Dot />
              <Dot delay={150} />
              <Dot delay={300} />
              <span className="ml-1 text-[10px] text-white/40">Maya</span>
            </div>
          </div>

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

          <div className="absolute bottom-1 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-white/40" />
        </div>
      </div>

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
          Plan changes prorate. Cancel anytime. Studio voice overage billed at
          $0.15/min above the included 100 minutes.
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
          −16%
        </span>
      </button>
    </div>
  );
}

function PricingCard({ tier, billing }: { tier: Tier; billing: Billing }) {
  const monthlyDisplay =
    billing === "monthly" ? tier.monthly : tier.annual / 12;
  const formattedPrice =
    billing === "monthly"
      ? `$${tier.monthly.toFixed(0)}`
      : `$${monthlyDisplay.toFixed(2)}`;

  // Voice icon decoration for Studio (signals voice-tier-only)
  const isStudio = tier.name === "Studio";

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
          {isStudio && (
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
              <Mic className="h-3 w-3" />
              voice
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
          ? `billed $${tier.annual.toLocaleString()} / year · no card for trial`
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
        href={primaryCtaHref(
          `/onboarding/business?plan=${tier.name.toLowerCase()}${
            tier.recommended ? "&trial=true" : ""
          }`,
        )}
        className={`btn mt-auto w-full ${
          tier.recommended ? "btn-primary" : "btn-ghost"
        }`}
      >
        {primaryCtaLabel(
          tier.recommended ? "Start with Pro free" : `Choose ${tier.name}`,
        )}
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
              We don&rsquo;t auto-post to Google. We don&rsquo;t spam your
              customers. We don&rsquo;t pretend to be you. If something here
              doesn&rsquo;t match what you see in the product, that&rsquo;s a
              bug — tell us.
            </p>
          </div>
          <div className="lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-[var(--hairline-strong)]">
              {FAQ.map((item, i) => (
                <details
                  key={item.q}
                  className={`group bg-ink-2 ${
                    i !== FAQ.length - 1
                      ? "border-b border-[var(--hairline)]"
                      : ""
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

/**
 * Creator-product feature flag (mirrors `middleware.ts`). When disabled
 * (default), creator-product cross-links in the footer are hidden so the
 * trades surface looks like a single-product site. `NEXT_PUBLIC_*` vars are
 * inlined at build time on the client, so this is a static check.
 */
const CREATOR_PRODUCT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT === "true";

function Footer() {
  return (
    <footer className="relative z-10 mt-32 border-t border-[var(--hairline)] px-6 pb-10 pt-16 sm:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="overflow-hidden">
          <h3 className="font-display text-[clamp(4rem,18vw,18rem)] leading-[0.9] tracking-[-0.04em] text-paper">
            Hey<span className="italic text-paper-dim">Maya</span>.
          </h3>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-10 border-t border-[var(--hairline)] pt-10 text-sm sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-paper-dim">
              Your AI marketing manager before you can afford a human one — for
              the trades.
            </p>
            <p className="mt-2 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-paper-faint">
              <ClipboardCheck className="h-3.5 w-3.5 text-lime" />
              Drafts, you approve · always
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
              {CREATOR_PRODUCT_ENABLED && (
                <li>
                  <Link className="hover:text-paper" href="/creators">
                    For creators
                  </Link>
                </li>
              )}
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
                <a className="hover:text-paper" href="mailto:hi@heymaya.app">
                  hi@heymaya.app
                </a>
              </li>
            </ul>
          </div>
          {CREATOR_PRODUCT_ENABLED && (
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                Switch track
              </h4>
              <ul className="mt-3 space-y-2 text-paper-dim">
                <li>
                  <Link
                    className="inline-flex items-center gap-1 hover:text-paper"
                    href="/"
                  >
                    Account-type picker <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </li>
                <li>
                  <Link
                    className="inline-flex items-center gap-1 hover:text-paper"
                    href="/creators"
                  >
                    Creator product <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
