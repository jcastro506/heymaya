/**
 * Builder marketing landing — `/growth`.
 *
 * Founder distribution pitch. Single CTA -> Clerk sign-up -> onboarding.
 * Aesthetic: dark, minimal, founder-focused.
 */

import Link from "next/link";

export const metadata = {
  title: "HeyMaya For Builders — X + LinkedIn distribution",
  description:
    "Maya drafts your LinkedIn and X posts, finds your audience, and builds distribution while you ship the product.",
};

export default function GrowthLandingPage() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-4xl px-6 py-24 sm:py-32">
        <header className="mb-16 flex items-center justify-between">
          <Link href="/" className="text-sm text-paper-faint hover:text-paper">
            ← heymaya
          </Link>
          <Link
            href="/sign-in"
            className="text-sm text-paper-faint hover:text-paper"
          >
            sign in
          </Link>
        </header>

        <section className="mb-20">
          <p className="mb-6 font-mono text-xs uppercase tracking-widest text-paper-faint">
            For Builders · X + LinkedIn distribution
          </p>
          <h1 className="mb-8 font-serif text-5xl leading-tight sm:text-6xl">
            Your AI marketing manager, drafting on LinkedIn and X{" "}
            <span className="text-paper-dim">while you ship.</span>
          </h1>
          <p className="mb-10 max-w-2xl text-lg text-paper-dim">
            Maya is a single agent who lives in your messages. She drafts
            posts in your voice, finds the people who care about what
            you&rsquo;re building, and writes outreach you would have
            written&mdash;if you had the time. You approve every send.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/sign-up?redirect_url=/onboarding/growth"
              className="rounded-full bg-paper px-7 py-3 text-sm font-medium text-ink hover:bg-white"
            >
              Get Maya running
            </Link>
            <Link
              href="#how"
              className="rounded-full border border-paper-faint/40 px-7 py-3 text-sm text-paper-dim hover:border-paper hover:text-paper"
            >
              How it works
            </Link>
          </div>
        </section>

        <section id="how" className="mb-20 grid gap-10 sm:grid-cols-3">
          <Step
            n="1"
            title="Connect"
            body="LinkedIn and X via Composio dashboard. Two clicks, no developer apps to register."
          />
          <Step
            n="2"
            title="Calibrate"
            body="Paste 5 posts that sound like you. Tell Maya what you're building. She fits her voice to yours."
          />
          <Step
            n="3"
            title="Deploy"
            body="Maya spins up on her own machine. She drafts each morning, watches engagement each evening, asks before she sends anything."
          />
        </section>

        <section className="mb-20 rounded-2xl border border-paper-faint/15 bg-ink-2 p-8">
          <h2 className="mb-4 font-serif text-2xl">
            What Maya actually does, day one
          </h2>
          <ul className="space-y-3 text-paper-dim">
            <li>· Drafts 1 LinkedIn post + 2&ndash;3 X drafts each morning, with research citations.</li>
            <li>· Watches your home feed for relevant conversations and drafts replies.</li>
            <li>· Pulls engagement on what got published yesterday and tells you what worked.</li>
            <li>· Flags people who liked, commented, or signed up&mdash;so you can follow up by name.</li>
            <li>· Sleeps at 3am, dreams about your last week, adjusts her own schedule.</li>
          </ul>
        </section>

        <section className="mb-20">
          <h2 className="mb-4 font-serif text-2xl">What Maya doesn&rsquo;t do</h2>
          <ul className="space-y-2 text-paper-faint">
            <li>· Auto-publish anything in week 1. You copy/paste while she calibrates.</li>
            <li>· Send DMs without your text approval. Ever.</li>
            <li>· Pretend to know what you think. She asks if she can&rsquo;t cite a source.</li>
            <li>· Send connection requests. LinkedIn flags those; not worth the risk.</li>
          </ul>
        </section>

        <footer className="border-t border-paper-faint/15 pt-8 text-xs text-paper-faint">
          For Builders is a HeyMaya product. Currently in single-user beta.
        </footer>
      </div>
    </main>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <p className="mb-3 font-mono text-xs text-paper-faint">step {n}</p>
      <h3 className="mb-2 font-serif text-xl">{title}</h3>
      <p className="text-sm text-paper-dim">{body}</p>
    </div>
  );
}
