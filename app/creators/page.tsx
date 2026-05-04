"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Brain,
  Calendar,
  ClipboardCheck,
  FileText,
  Handshake,
  LineChart,
  Megaphone,
  MessageSquareText,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";

type Billing = "monthly" | "annual";

const FEATURES: Array<{
  icon: typeof Sparkles;
  title: string;
  body: string;
}> = [
  {
    icon: Search,
    title: "She finds what's trending — for you",
    body: "Maya watches your niche daily. Hashtags, sounds, formats, competitors. She surfaces only the trends that fit what's already working for your audience — not the algorithm-of-the-week.",
  },
  {
    icon: Sparkles,
    title: "She thinks through ideas with you",
    body: "Send her a half-baked thought and she sharpens it into a hook, a script, a caption — anchored in your top-performing patterns and your voice.",
  },
  {
    icon: Calendar,
    title: "She plans your week",
    body: "Sunday at 4pm: next week's content arc, per-platform variants, posting times built around your real calendar. Filming windows held against your schedule so it actually fits your life.",
  },
  {
    icon: LineChart,
    title: "She reads your performance",
    body: "Every two hours during the day, every post you publish, every metric shift. She tells you why the Tuesday Reel hit 2.3× and the Thursday one stalled — and what to do about both.",
  },
  {
    icon: MessageSquareText,
    title: "She lives in your messages",
    body: "Morning brief at 7am. Performance pings during the day. Evening recap at 7pm. Sunday plan. Weekly review. All on iMessage, no app to open, no inbox to check.",
  },
  {
    icon: Trophy,
    title: "She holds you accountable",
    body: "You said three TikToks this week. You posted one. Friday at 10am she texts. No nag — a specific, grounded nudge with the exact unblock to move you forward.",
  },
  {
    icon: Handshake,
    title: "She responds to brand DMs for you",
    body: "Reads every brand message that lands in your inbox, drafts the reply in your voice, surfaces the deal value, anchors on your floor rate. Sends under your auto-send threshold or hands it back for approval.",
  },
  {
    icon: Megaphone,
    title: "She reaches out to brands for you",
    body: "Spots a brand fit you'd be perfect for, finds the right person, drafts the cold pitch in your voice, sends it. You see the outbound thread before she replies again — every time.",
  },
  {
    icon: FileText,
    title: "She reads contracts for you",
    body: "Drop a brand-deal PDF in chat. She flags red-flags in plain language: exclusivity, IP grants, payment terms, kill fees, FTC compliance. Tells you what to push back on. Never tells you a clause is fine — only 'no flag detected here.'",
  },
  {
    icon: ClipboardCheck,
    title: "She drafts your manager packet",
    body: "Quarterly, or on-demand: a polished PDF a real manager could read in 5 minutes. Audience demographics, top hooks, brand history, growth trajectory. For when a real manager is calling.",
  },
  {
    icon: ShieldCheck,
    title: "She remembers everything",
    body: "Your goals, your tone, your floor rate, the brands you've worked with, the hooks that hit, the ones that didn't. The longer you have her, the more she sounds like she knows you — because she does.",
  },
  {
    icon: Brain,
    title: "She tells you the truth",
    body: "Anti-sycophancy is non-negotiable. She never says 'amazing post.' If a post underperforms, she says so plainly — with the data — and proposes what's next. The grounded read you can't get anywhere else.",
  },
];

const SHOWCASE: Array<{
  label: string;
  bubbles: string[];
}> = [
  {
    label: "Monday · 7:00 AM · Morning brief",
    bubbles: [
      "Yesterday's 4am Reel is at 47k — 5.2× your trailing 30. Three of your top five all-time use the constraint hook. Pattern's earning its keep.",
      "Today: ride it. Sequel — same hook shape, different exercise. Earlier is better; your audience's engagement window on this account is 4am–8am.",
    ],
  },
  {
    label: "Friday · 10:14 AM · Accountability",
    bubbles: [
      "You said three TikToks this week. Posted one. Today is Friday.",
      "Your 'dumbbell move for back pain' hook is in your top set, and you haven't reused it in six weeks. Could film it in 20 min.",
    ],
  },
  {
    label: "Tuesday · 2:33 PM · Brand DM",
    bubbles: [
      "Glossier reached out four days ago via your IG inbox. You missed it.",
      "$1.2K, dad-fitness recovery launch, real account, real person.",
      "Want me to draft a reply? I'd anchor on your morning routine angle since your audience over-indexes there.",
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What does Maya actually text me?",
    a: "Specific, grounded things. 'Your 4am Reel is at 47k — 5.2× your trailing.' 'You said three posts this week, you've posted one — what's blocking the second?' 'Glossier reached out four days ago, want me to draft a reply?' Never platitudes, never 'great post,' never generic.",
  },
  {
    q: "Does Maya post for me?",
    a: "No. Maya prepares everything — hook, caption, cut, time, per-platform variant — and hands it back to you to publish in one tap. The moment of publishing stays your call. Your account, your voice.",
  },
  {
    q: "Can Maya email a brand without asking me?",
    a: "Only if you turn on auto-send and set a threshold. Below your threshold, Maya drafts, voice-checks, cite-checks, and sends through your Gmail. Above your threshold, or on cold outreach to a new brand, she always asks first. You can leave auto-send off and Maya stays draft-only — same Maya, just slower outbound.",
  },
  {
    q: "How does the 7-day trial work?",
    a: "No card required up front. You get the full Manager — outreach, brand replies, contracts, planning, the works — for 7 days. On day 5, Maya nudges you. On day 7 you choose your level (Coach or Manager) or cancel; if you cancel after the trial we drop you to Coach so you keep daily direction at the lowest paid floor. You keep your data and your Maya either way.",
  },
  {
    q: "Which channels does she watch?",
    a: "TikTok, Instagram, YouTube, LinkedIn, X. She's platform-aware — what works on TikTok rarely works on LinkedIn, and Maya treats them differently. Connect by handle at onboarding. She never logs in as you.",
  },
  {
    q: "What data does she actually read?",
    a: "Public post data, public audience demographics, your own comments and DMs, plus whatever you explicitly connect — Gmail, Stripe, Google Calendar. She reads through ScrapeCreators (a public-data layer) and writes only through OAuth scopes you grant per provider.",
  },
  {
    q: "What if I don't like her advice?",
    a: "Reply 'no' or 'ignore' and she remembers. Maya isn't a generic recommender — she learns your account over weeks. The longer you have her, the more she sounds like she knows you, because she actually does.",
  },
];

export default function CreatorsLanding() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <Nav />
      <main className="relative z-10 flex-1 pb-24 sm:pb-0">
        <Hero />
        <Features />
        <Showcase />
        <Pricing billing={billing} setBilling={setBilling} />
        <Faq />
      </main>
      <Footer />
      <MobileStickyCta />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                              NAV  +  TOGGLE                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="relative z-20 px-5 pt-[max(env(safe-area-inset-top),1rem)] sm:px-10 sm:pt-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 flex-none"
          aria-label="HeyMaya home"
        >
          <Logo />
          <span className="font-display text-xl tracking-tight text-paper">
            HeyMaya
          </span>
        </Link>

        <AudienceToggle current="creators" />

        <div className="flex items-center gap-3 flex-none">
          <Link
            href="/sign-in"
            className="hidden text-sm text-paper-dim transition-colors hover:text-paper sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/checkout?tier=manager&interval=monthly"
            className="btn btn-primary !min-h-11 !px-4 !text-sm"
          >
            Start trial
          </Link>
        </div>
      </div>

      <nav className="mx-auto mt-6 hidden max-w-7xl items-center justify-center gap-8 text-sm text-paper-dim md:flex">
        <a href="#features" className="transition-colors hover:text-paper">
          What she does
        </a>
        <a href="#showcase" className="transition-colors hover:text-paper">
          How she shows up
        </a>
        <a href="#pricing" className="transition-colors hover:text-paper">
          Pricing
        </a>
        <a href="#faq" className="transition-colors hover:text-paper">
          FAQ
        </a>
      </nav>
    </header>
  );
}

function AudienceToggle({ current }: { current: "creators" | "business" }) {
  return (
    <div
      role="tablist"
      aria-label="Audience"
      className="flex items-center rounded-full border border-[var(--hairline)] bg-ink-2 p-1"
    >
      <Link
        href="/creators"
        role="tab"
        aria-selected={current === "creators"}
        className={`rounded-full px-4 text-sm transition-colors min-h-10 inline-flex items-center ${
          current === "creators"
            ? "bg-paper text-ink"
            : "text-paper-dim hover:text-paper"
        }`}
      >
        For creators
      </Link>
      <Link
        href="/business"
        role="tab"
        aria-selected={current === "business"}
        className={`rounded-full px-4 text-sm transition-colors min-h-10 inline-flex items-center ${
          current === "business"
            ? "bg-paper text-ink"
            : "text-paper-dim hover:text-paper"
        }`}
      >
        For businesses
      </Link>
    </div>
  );
}

function Logo() {
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
    >
      <span className="font-display text-base">M</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  HERO                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="px-5 pt-16 sm:px-10 sm:pt-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <div>
          <h1 className="font-display text-5xl leading-[1.02] tracking-tight text-paper sm:text-6xl lg:text-7xl">
            Maya. Your social
            <br />
            media manager.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-paper-dim sm:text-xl">
            She watches every post you make, plans your week, holds you
            accountable, drafts your brand replies, and lives in your messages.
            She runs the parts of your career you don't have time for.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/checkout?tier=manager&interval=monthly"
              className="btn btn-primary"
            >
              Start your 7-day trial
            </Link>
            <a href="#features" className="btn btn-ghost">
              See what she does
            </a>
          </div>
          <p className="mt-4 text-sm italic text-paper-faint">
            No card required · cancel anytime
          </p>
        </div>
        <HeroIMessage />
      </div>
    </section>
  );
}

function HeroIMessage() {
  return (
    <div className="relative">
      <div className="rounded-3xl border border-[var(--hairline)] bg-ink-2 p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center gap-2 text-xs text-paper-faint">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-ink font-display text-xs">
            M
          </span>
          <span className="font-medium text-paper">Maya</span>
          <span>· Tuesday, 4:02 AM</span>
        </div>
        <div className="space-y-2.5">
          <Bubble side="them">
            Your 4am POV reel hit 47k overnight — 5.2× your trailing.
          </Bubble>
          <Bubble side="them">
            Same hook shape as the dumbbell-back post that did 38k last
            Tuesday. You've got a 4am pattern.
          </Bubble>
          <Bubble side="them">
            Locking it as your morning slot. Want me to plan three more
            constraint hooks for this week?
          </Bubble>
          <Bubble side="me">yeah do it</Bubble>
          <Bubble side="them">on it. drafts in the plan tab by 10am.</Bubble>
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-6 -right-6 hidden h-32 w-32 rounded-full bg-lime/10 blur-3xl sm:block" />
    </div>
  );
}

function Bubble({
  children,
  side,
}: {
  children: React.ReactNode;
  side: "me" | "them";
}) {
  const isMe = side === "me";
  return (
    <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-snug ${
          isMe
            ? "rounded-br-md bg-[var(--imessage-blue)] text-white"
            : "rounded-bl-md bg-[var(--imessage-gray)] text-white"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  FEATURES                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function Features() {
  return (
    <section id="features" className="px-5 pt-28 sm:px-10 sm:pt-36">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper-faint">
            What she does
          </p>
          <h2 className="mt-4 font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
            All the parts of being a creator that aren't filming.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-paper-dim sm:text-lg">
            Maya is one social media manager. She does all of this. Pick the
            level of help you want at the bottom — autonomy is the only
            difference.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Sparkles;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-3xl border border-[var(--hairline)] bg-ink-2 p-6 sm:p-7">
      <div className="grid h-10 w-10 place-items-center rounded-2xl bg-lime/10 text-lime">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-display text-xl tracking-tight text-paper">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-paper-dim">{body}</p>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  SHOWCASE                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function Showcase() {
  return (
    <section id="showcase" className="px-5 pt-28 sm:px-10 sm:pt-36">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper-faint">
            How she shows up
          </p>
          <h2 className="mt-4 font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
            She lives in your messages. Not in another app you'll forget to
            open.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {SHOWCASE.map((item) => (
            <article
              key={item.label}
              className="rounded-3xl border border-[var(--hairline)] bg-ink-2 p-6"
            >
              <span className="font-mono text-xs uppercase tracking-widest text-paper-faint">
                {item.label}
              </span>
              <div className="mt-4 space-y-2.5">
                {item.bubbles.map((b, i) => (
                  <Bubble key={i} side="them">
                    {b}
                  </Bubble>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  PRICING                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

const TIER_DATA = [
  {
    key: "coach" as const,
    name: "Coach",
    monthly: 19.99,
    annual: 199,
    headline: "She tells you. You do it.",
    description:
      "Daily direction, planning, performance reads, accountability, idea sharpening, draft feedback, contract scans, brand-DM drafts. Every advisory thing on the list above. Coach hands you the move; you make it.",
    excludes:
      "Coach doesn't auto-send brand replies and doesn't reach out to brands cold. If you want her to do those for you — that's Manager.",
  },
  {
    key: "manager" as const,
    name: "Manager",
    monthly: 49.99,
    annual: 499,
    headline: "She does it. You approve.",
    description:
      "Everything in Coach, plus: drafts and sends brand replies under your auto-send threshold, finds new brand opportunities, drafts and sends cold pitches, runs the brand back-and-forth. The full thing.",
    excludes: null,
    recommended: true,
  },
];

function Pricing({
  billing,
  setBilling,
}: {
  billing: Billing;
  setBilling: (b: Billing) => void;
}) {
  return (
    <section id="pricing" className="px-5 pt-28 sm:px-10 sm:pt-36">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper-faint">
              Pricing
            </p>
            <h2 className="mt-4 font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
              Pick your level of help.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-paper-dim sm:text-lg">
              Same Maya. The only difference between Coach and Manager is
              autonomy — does she just tell you the move, or does she also do
              the parts you'd rather not? Both tiers start with 7 days free on
              your first subscription.
            </p>
          </div>
          <BillingToggle billing={billing} setBilling={setBilling} />
        </div>
        <div className="mt-10 grid gap-5 sm:gap-6 lg:grid-cols-2">
          {TIER_DATA.map((tier) => (
            <PricingCard key={tier.key} tier={tier} billing={billing} />
          ))}
        </div>
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
    <div className="flex w-full items-center rounded-full border border-[var(--hairline)] bg-ink-2 p-1 sm:w-auto">
      {(["monthly", "annual"] as const).map((option) => (
        <button
          key={option}
          onClick={() => setBilling(option)}
          className={`flex-1 rounded-full px-4 text-sm transition-colors min-h-11 sm:flex-initial ${
            billing === option
              ? "bg-paper text-ink"
              : "text-paper-dim hover:text-paper"
          }`}
        >
          {option === "monthly" ? "Monthly" : "Annual · save ~25%"}
        </button>
      ))}
    </div>
  );
}

function PricingCard({
  tier,
  billing,
}: {
  tier: (typeof TIER_DATA)[number];
  billing: Billing;
}) {
  const price = billing === "monthly" ? tier.monthly : tier.annual;
  const priceLabel =
    billing === "monthly"
      ? `$${price.toFixed(2).replace(/\.00$/, "")}`
      : `$${price}`;
  const cadence = billing === "monthly" ? "/ month" : "/ year";
  const annualEquiv =
    billing === "annual"
      ? `$${(tier.annual / 12).toFixed(2).replace(/\.00$/, "")}/mo equiv`
      : null;

  // Both tiers get a 7-day free trial on first subscription. Headline copy
  // mirrors the Stripe Checkout-side trial gating in convex/billing/checkout.ts.
  const trialCopy =
    billing === "monthly"
      ? `7 days free, then ${priceLabel} / month`
      : `7 days free, then ${priceLabel} / year`;

  return (
    <article
      className={`relative flex flex-col rounded-3xl border bg-ink-2 p-7 sm:p-9 ${
        tier.recommended
          ? "border-lime/40 shadow-[0_0_0_1px_rgba(214,255,61,0.1)]"
          : "border-[var(--hairline)]"
      }`}
    >
      {tier.recommended && (
        <span className="absolute -top-3 left-7 rounded-full bg-lime px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink">
          7-day trial · default
        </span>
      )}
      <h3 className="font-display text-3xl tracking-tight text-paper">
        {tier.name}
      </h3>
      <p className="mt-2 text-base text-paper-dim">{tier.headline}</p>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="font-display text-5xl tracking-tight text-paper">
          {priceLabel}
        </span>
        <span className="text-sm text-paper-dim">{cadence}</span>
      </div>
      {annualEquiv && (
        <p className="mt-1 text-xs text-paper-faint">{annualEquiv}</p>
      )}
      <p className="mt-2 text-xs font-mono uppercase tracking-widest text-lime">
        {trialCopy}
      </p>
      <p className="mt-6 text-sm leading-relaxed text-paper-dim">
        {tier.description}
      </p>
      {tier.excludes && (
        <p className="mt-4 rounded-xl border-l-2 border-paper-faint/40 bg-ink/40 px-4 py-3 text-sm italic leading-relaxed text-paper-faint">
          {tier.excludes}
        </p>
      )}
      <Link
        href={`/checkout?tier=${tier.key}&interval=${billing}`}
        className={`mt-8 ${tier.recommended ? "btn btn-primary" : "btn btn-ghost"}`}
      >
        {tier.recommended
          ? "Start 7-day Manager trial"
          : `Start with ${tier.name}`}
      </Link>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                    FAQ                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section id="faq" className="px-5 pt-28 sm:px-10 sm:pt-36">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper-faint">
          Questions
        </p>
        <h2 className="mt-4 font-display text-4xl leading-tight tracking-tight text-paper sm:text-5xl">
          Things creators ask first.
        </h2>
        <div className="mt-10 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {FAQ.map(({ q, a }, i) => (
            <details key={i} className="group">
              <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-5 text-left">
                <span className="font-display text-lg tracking-tight text-paper">
                  {q}
                </span>
                <span className="faq-plus inline-block text-2xl font-light leading-none text-paper-dim">
                  +
                </span>
              </summary>
              <p className="pb-5 text-base leading-relaxed text-paper-dim">
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                   FOOTER                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="mt-32 border-t border-[var(--hairline)] px-5 pb-[max(env(safe-area-inset-bottom),2.5rem)] pt-14 sm:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-start justify-between gap-10 sm:flex-row">
          <div className="max-w-md">
            <Link href="/" className="inline-flex items-center gap-2">
              <Logo />
              <span className="font-display text-xl tracking-tight text-paper">
                HeyMaya
              </span>
            </Link>
            <p className="mt-5 text-sm leading-relaxed text-paper-dim">
              Your social media manager. Live in your messages, watching your
              work, telling you the truth.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm text-paper-dim sm:grid-cols-3">
            <Link href="/business" className="transition-colors hover:text-paper">
              For businesses
            </Link>
            <a href="#features" className="transition-colors hover:text-paper">
              What she does
            </a>
            <a href="#pricing" className="transition-colors hover:text-paper">
              Pricing
            </a>
            <Link href="/sign-in" className="transition-colors hover:text-paper">
              Sign in
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-paper">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-paper">
              Terms
            </Link>
          </div>
        </div>
        <p className="mt-12 font-mono text-xs uppercase tracking-widest text-paper-faint">
          © {new Date().getFullYear()} HeyMaya
        </p>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                            MOBILE STICKY CTA                                */
/* ─────────────────────────────────────────────────────────────────────────── */

function MobileStickyCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--hairline)] bg-[var(--ink)]/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--ink)]/70 sm:hidden">
      <Link
        href="/checkout?tier=manager&interval=monthly"
        className="btn btn-primary flex-1 !min-h-12"
      >
        Start your 7-day trial
      </Link>
    </div>
  );
}
