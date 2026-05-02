import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  MessageSquareText,
  Radar,
  Sparkles,
  UserRound,
} from "lucide-react";

export const metadata: Metadata = {
  title: "HeyMaya — an AI manager in your messages",
  description:
    "HeyMaya gives creators and small businesses an AI manager that learns their context, plans around their calendar, and texts the next move.",
};

const pillars = [
  {
    title: "Learns the creator first",
    body: "Goals, stage, niche, voice, blockers, weekly time, and content boundaries become Maya's operating brief.",
  },
  {
    title: "Plans around real life",
    body: "Calendar lookahead gives Maya useful windows for filming, launches, travel, meetings, and recovery days.",
  },
  {
    title: "Samples posts intelligently",
    body: "ScrapeCreators pulls broad metadata; Gemini only reviews the small subset worth watching deeply.",
  },
  {
    title: "Moves to iMessage",
    body: "The web app activates Maya. The daily product is your phone: briefs, replies, holds, and follow-through.",
  },
];

const dailyLoop = [
  "Morning plan based on your calendar, niche, and current TikTok context",
  "Content ideas and filming holds when your schedule creates an opening",
  "Trend scans filtered for your actual audience instead of generic virality",
  "Evening recap with what shipped, what slipped, and what Maya should adjust",
];

const tracks = [
  {
    label: "For creators",
    title: "A manager before human managers care.",
    body: "If you are not big enough for a real manager yet, Maya helps you act like you have one: content planning, TikTok context, calendar holds, accountability, and brand-readiness.",
    href: "/sign-up?redirect_url=/creator-maya-v0",
    cta: "Sign up as creator",
  },
  {
    label: "For businesses",
    title: "A marketing manager before you hire one.",
    body: "For founder-led and local businesses that need consistent marketing but do not have an operator watching reviews, posts, customer moments, and follow-up every day.",
    href: "/sign-up?redirect_url=/business-maya-v0",
    cta: "Sign up as business",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-ink text-paper">
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="HeyMaya home">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-lime font-display text-lg text-ink">
            m
          </span>
          <span className="font-display text-xl text-paper">HeyMaya</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-paper-dim">
          <Link href="#tracks" className="hover:text-paper">
            For creators
          </Link>
          <Link href="#tracks" className="hover:text-paper">
            For businesses
          </Link>
          <Link href="/sign-in" className="hover:text-paper">
            Sign in
          </Link>
          <Link
            href="/sign-up?redirect_url=/creator-maya-v0"
            className="inline-flex min-h-10 items-center rounded-md bg-lime px-3 font-medium text-black transition hover:brightness-95"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <section className="relative mx-auto grid min-h-[78vh] max-w-6xl content-center gap-10 px-5 pb-14 pt-8 sm:px-8 lg:grid-cols-[1fr_0.86fr] lg:px-10">
        <div className="relative z-10 max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            Powered by OpenClaw · message-first manager
          </p>
          <h1 className="mt-4 font-display text-[clamp(4rem,13vw,9rem)] leading-[0.86] text-paper">
            HeyMaya
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-relaxed text-paper-dim">
            For creators, Maya is the manager you get before human managers are
            interested. For businesses, she is the marketing manager you get
            before you can justify another hire.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-up?redirect_url=/creator-maya-v0"
              className="inline-flex min-h-12 items-center gap-2 rounded-md bg-lime px-5 text-sm font-medium text-black transition hover:brightness-95"
            >
              Sign up
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#tracks"
              className="inline-flex min-h-12 items-center rounded-md border border-[var(--hairline-strong)] px-5 text-sm text-paper-dim transition hover:text-paper"
            >
              Compare paths
            </Link>
          </div>
        </div>

        <div className="relative z-10 lg:pt-12">
          <div className="mx-auto max-w-sm overflow-hidden rounded-[2rem] border border-[var(--hairline-strong)] bg-black shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-paper">Maya</p>
                <p className="text-xs text-paper-faint">iMessage</p>
              </div>
              <span className="rounded-full bg-lime/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-lime">
                Daily
              </span>
            </div>
            <div className="space-y-3 p-5">
              <Bubble>
                You have a clean window tomorrow at 2:30. Want a 45-minute
                filming hold?
              </Bubble>
              <Bubble own>Yes. Make it useful for founders.</Bubble>
              <Bubble>
                Done. Hook: &quot;Your calendar tells you what to post next.&quot;
              </Bubble>
              <Bubble>
                Trend fit is medium, audience fit is high. I would ship it.
              </Bubble>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--hairline)]" />
      </section>

      <section className="border-y border-[var(--hairline)] bg-ink-2">
        <div className="mx-auto grid max-w-6xl gap-px px-5 sm:px-8 md:grid-cols-4 lg:px-10">
          {pillars.map((pillar) => (
            <article key={pillar.title} className="py-8 md:px-5">
              <h2 className="text-sm font-semibold text-paper">{pillar.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                {pillar.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="tracks" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:px-10">
        <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              Choose your Maya
            </p>
            <h2 className="mt-3 font-display text-4xl leading-tight text-paper sm:text-5xl">
              Same manager shape. Different job to be done.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-paper-dim">
            Creators and businesses both need a manager who knows context,
            notices opportunities, and follows up in the channel they actually
            answer.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {tracks.map((track, index) => (
            <Link
              key={track.label}
              href={track.href}
              className={`group rounded-lg border p-5 transition ${
                index === 0
                  ? "border-lime/30 bg-lime/10"
                  : "border-[var(--hairline)] bg-ink-2"
              }`}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint">
                {track.label}
              </p>
              <h3 className="mt-3 font-display text-3xl leading-tight text-paper">
                {track.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                {track.body}
              </p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-lime">
                {track.cta}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.85fr_1fr] lg:px-10">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            Creator-first operating system
          </p>
          <h2 className="mt-3 font-display text-4xl leading-tight text-paper sm:text-5xl">
            The website is setup. The product is Maya texting you.
          </h2>
        </div>
        <div className="grid gap-3">
          {dailyLoop.map((item, index) => (
            <div
              key={item}
              className="flex gap-4 rounded-lg border border-[var(--hairline)] bg-ink-2 p-4"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink-3 font-mono text-xs text-lime">
                {index + 1}
              </span>
              <p className="text-sm leading-relaxed text-paper-dim">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 lg:px-10">
        <div className="grid gap-3 md:grid-cols-4">
          <Signal icon={<UserRound className="h-4 w-4" />} label="Creator picture" />
          <Signal icon={<Radar className="h-4 w-4" />} label="TikTok context" />
          <Signal icon={<CalendarClock className="h-4 w-4" />} label="Calendar planning" />
          <Signal icon={<MessageSquareText className="h-4 w-4" />} label="iMessage runtime" />
        </div>
        <div className="mt-10 flex flex-col gap-4 rounded-lg border border-lime/20 bg-lime/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-sm font-medium text-lime-soft">
              <Sparkles className="h-4 w-4" />
              Beta focus
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-paper-dim">
              First tier includes calendar-aware planning. Brand outreach comes
              later as an approval-gated Studio workflow, not an autonomous
              spam machine.
            </p>
          </div>
          <Link
            href="/creator-maya-v0"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-paper px-4 text-sm font-medium text-ink"
          >
            Open setup
            <CheckCircle2 className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--hairline)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-6 text-sm text-paper-faint sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p>HeyMaya, powered by OpenClaw.</p>
          <nav className="flex gap-4">
            <Link href="/privacy" className="hover:text-paper">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-paper">
              Terms
            </Link>
            <a href="mailto:support@hey-maya.ai" className="hover:text-paper">
              Support
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}

function Bubble({ children, own = false }: { children: string; own?: boolean }) {
  return (
    <div className={`flex ${own ? "justify-end" : "justify-start"}`}>
      <p
        className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          own
            ? "rounded-br-md bg-[var(--imessage-blue)] text-white"
            : "rounded-bl-md bg-[var(--imessage-gray)] text-paper"
        }`}
      >
        {children}
      </p>
    </div>
  );
}

function Signal({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-lg border border-[var(--hairline)] bg-ink-2 px-4">
      <span className="grid h-8 w-8 place-items-center rounded-md bg-ink-3 text-lime">
        {icon}
      </span>
      <span className="text-sm font-medium text-paper">{label}</span>
    </div>
  );
}
