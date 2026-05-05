import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  CalendarClock,
  Handshake,
  MessageSquareText,
  Radar,
  Sparkles,
  UserRound,
  Video,
} from "lucide-react";

export const metadata: Metadata = {
  title: "HeyMaya — your AI manager in messages",
  description:
    "Maya helps creators and businesses plan content, understand what is working, schedule around real life, and follow up from messages.",
};

const features = [
  {
    icon: <UserRound className="h-5 w-5" />,
    title: "Knows you",
    body: "Maya learns your niche, goals, voice, constraints, and what you are trying to build.",
  },
  {
    icon: <Radar className="h-5 w-5" />,
    title: "Watches what matters",
    body: "She tracks your account, samples content intelligently, and notices patterns worth acting on.",
  },
  {
    icon: <CalendarClock className="h-5 w-5" />,
    title: "Plans around your calendar",
    body: "Maya finds useful windows for filming, publishing, launches, events, and follow-up.",
  },
  {
    icon: <MessageSquareText className="h-5 w-5" />,
    title: "Texts the next move",
    body: "The daily loop happens in your messages, where you can approve, change, or ask for more.",
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: "Filters trends",
    body: "Instead of generic trend chasing, Maya looks for ideas that fit your audience and timing.",
  },
  {
    icon: <Handshake className="h-5 w-5" />,
    title: "Finds opportunities",
    body: "For higher tiers, Maya can research brand fits and prepare outreach for your approval.",
  },
  {
    icon: <Video className="h-5 w-5" />,
    title: "Helps shape posts",
    body: "Maya can turn a content window into hooks, shot lists, drafts, and edit direction.",
  },
  {
    icon: <ArrowRight className="h-5 w-5" />,
    title: "Keeps momentum",
    body: "She remembers what slipped, what worked, and what should happen next.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <Link href="/" className="font-display text-xl text-paper">
          HeyMaya
        </Link>
        <nav className="flex items-center gap-4 text-sm text-paper-dim">
          <Link href="/sign-in" className="hover:text-paper">
            Sign in
          </Link>
          <Link
            href="/sign-up?redirect_url=/creator-maya-v0"
            className="inline-flex min-h-10 items-center rounded-md bg-paper px-4 font-medium text-black transition hover:bg-white"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-12 pt-20 sm:px-8 sm:pt-28 lg:px-10">
        <div className="max-w-4xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            Powered by OpenClaw
          </p>
          <h1 className="mt-5 font-display text-6xl leading-[0.9] text-paper sm:text-8xl lg:text-9xl">
            Your manager before you have one.
          </h1>
          <p className="mt-7 max-w-2xl text-xl leading-relaxed text-paper-dim">
            Maya helps creators and businesses decide what to post, when to make
            it, what deserves follow-up, and what the next move should be.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/sign-up?redirect_url=/creator-maya-v0"
              className="inline-flex min-h-12 items-center gap-2 rounded-md bg-paper px-5 text-sm font-medium text-black transition hover:bg-white"
            >
              Sign up
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex min-h-12 items-center rounded-md border border-[var(--hairline-strong)] px-5 text-sm text-paper-dim transition hover:text-paper"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 lg:px-10">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-5"
            >
              <div className="text-paper-dim">{feature.icon}</div>
              <h2 className="mt-5 text-base font-semibold text-paper">
                {feature.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
