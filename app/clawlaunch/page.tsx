import type { Metadata } from "next";
import Link from "next/link";

import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";

export const metadata: Metadata = {
  title: "ClawLaunch — your GTM agent for getting first users",
  description:
    "ClawLaunch is an OpenClaw-powered GTM teammate for indie builders. Maya researches where your users are, plans the week, drafts the work, and learns from what gets customers.",
};

export default function ClawLaunchLandingPage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between border-b border-paper-faint/15 pb-5">
          <Link href="/" className="font-mono text-sm uppercase tracking-widest">
            ClawLaunch
          </Link>
          <nav className="flex items-center gap-5 text-sm text-paper-dim">
            <Link href="#system" className="hover:text-paper">
              system
            </Link>
            <Link href="#proof" className="hover:text-paper">
              proof
            </Link>
            <Link href="/sign-in" className="hover:text-paper">
              sign in
            </Link>
          </nav>
        </header>

        <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div>
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.22em] text-lime">
              OpenClaw launches your business
            </p>
            <h1 className="max-w-4xl font-display text-5xl leading-[0.98] tracking-tight sm:text-7xl">
              You built the app. Maya gets it in front of people who might
              actually use it.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-relaxed text-paper-dim">
              ClawLaunch is a GTM teammate for indie builders and vibe coders.
              Maya researches your market, chooses the right first channels,
              writes the weekly plan into your calendar, drafts posts and
              replies, and improves based on signups, replies, demos, and
              feedback.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href={primaryCtaHref("/sign-up?redirect_url=/onboarding/gtm")}
                className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white"
              >
                {primaryCtaLabel("Start ClawLaunch")}
              </Link>
              <Link
                href="#system"
                className="rounded-full border border-paper-faint/40 px-7 py-3 text-sm text-paper-dim hover:border-paper hover:text-paper"
              >
                How it works
              </Link>
            </div>
          </div>

          <aside className="border border-paper-faint/15 bg-ink-2 p-6">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-paper-faint">
              Maya, after onboarding
            </p>
            <div className="space-y-4 text-sm leading-relaxed text-paper-dim">
              <Bubble>
                I found three live Reddit threads where builders are asking how
                to get first users. Reddit is primary this week. X is secondary.
                LinkedIn is parked until we see buyer context.
              </Bubble>
              <Bubble>
                Tuesday calendar is built: 10 reply targets, 2 founder posts,
                one screen-recorded demo script. Each event has the source,
                angle, draft, and success metric.
              </Bubble>
              <Bubble>
                I will not call ScrapeCreators from heartbeat. Research spend
                only happens inside budgeted jobs.
              </Bubble>
            </div>
          </aside>
        </section>

        <section id="system" className="grid gap-5 py-16 sm:grid-cols-3">
          <Pillar
            title="Research first"
            body="Maya inspects the app, searches live demand, studies platform formats, and stores cited evidence before choosing channels."
          />
          <Pillar
            title="Calendar as the UI"
            body="The weekly plan lands as rich Google Calendar events with scripts, source links, assets needed, approval state, and success criteria."
          />
          <Pillar
            title="Learn from customers"
            body="The score is not impressions. Maya reviews replies, signups, demos, and feedback, then changes next week's experiments."
          />
        </section>

        <section id="proof" className="border-t border-paper-faint/15 py-12">
          <p className="max-w-3xl text-2xl leading-snug text-paper">
            V1 is deliberately narrow: no cold outbound clone, no autonomous
            TikTok posting, no giant dashboard. One GTM agent, one primary
            channel, one secondary channel, real evidence, real follow-through.
          </p>
        </section>
      </div>
    </main>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-paper-faint/15 bg-ink px-4 py-3">
      {children}
    </div>
  );
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-paper-faint/15 bg-ink-2 p-6">
      <h2 className="mb-3 font-display text-2xl">{title}</h2>
      <p className="text-sm leading-relaxed text-paper-dim">{body}</p>
    </div>
  );
}
