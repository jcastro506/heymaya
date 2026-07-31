"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { MarketingNav } from "../_components/MarketingNav";
import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";
import { FeatureSection } from "../_components/FeatureSection";

/**
 * /vibecoders — landing for the "you built it, now you need an audience"
 * vertical. SCAFFOLD for evaluation on staging (operator: "make a PR to
 * staging, check into main if we like it").
 *
 * One product, two doors. This is the SAME Maya/engine as /creators,
 * reframed for indie/vibe-coder builders: she runs your launch content on
 * TikTok / X / LinkedIn so builders who can't market get distribution.
 *
 * NOT wired to a new Maya backend — the VibeCoder-specific Maya (different
 * skills/onboarding/attribution) is a separate planning track. This page
 * exists to validate the positioning + collect waitlist intent.
 *
 * Constraint (shared with /creators): zero "AI" in rendered copy. Maya is
 * "your marketing manager."
 */
export default function VibeCodersLanding() {
  return (
    <div className="relative isolate flex min-h-screen flex-col pb-24 md:pb-0">
      <MarketingNav />
      <main className="relative z-10 flex-1">
        <Hero />
        <ValueProp />
        <FeatureRail />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                   HERO                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative px-6 pt-16 sm:px-10 sm:pt-24 lg:pt-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] px-3 py-1 text-xs uppercase tracking-[0.18em] text-paper-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              For people who ship — and need an audience
            </div>
            <h1 className="mt-6 font-display text-[clamp(2.5rem,6.5vw,5.25rem)] leading-[1.02] tracking-[-0.02em] text-paper">
              You built it.{" "}
              <span className="italic text-paper-dim">
                Nobody&rsquo;s coming yet.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-paper-dim">
              The hard part wasn&rsquo;t the code. It&rsquo;s that you have no
              idea how to get anyone to use it. Maya is your marketing manager
              — she runs your launch content on TikTok, X, and LinkedIn, ties
              every post back to real signups, and tells you what to do next.
              You stay in the editor.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={primaryCtaHref("/sign-up?redirect_url=/creator-maya-v0")}
                className="btn btn-primary group"
              >
                {primaryCtaLabel("Get on the list")}
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" />
              </Link>
              <a href="#how" className="btn btn-ghost">
                How she works
              </a>
            </div>
          </div>

          <aside className="lg:col-span-5">
            <MessageCard
              lines={[
                "your launch tweet did 3.1k views — 11 of them signed up. that thread format is working.",
                "want me to draft 2 more in that shape for this week + a TikTok cut of the demo?",
              ]}
            />
          </aside>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                              VALUE PROPOSITION                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function ValueProp() {
  return (
    <section id="how" className="px-6 pt-24 sm:px-10 sm:pt-32">
      <div className="mx-auto max-w-5xl text-center">
        <p className="font-display text-3xl leading-[1.1] tracking-tight text-paper sm:text-5xl">
          Maya is your marketing manager.{" "}
          <span className="italic text-paper-dim">
            Lives in your messages. Turns the thing you built into something
            people actually find.
          </span>
        </p>
        <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-paper-dim sm:text-[17px]">
          Most indie products die in silence — not because they&rsquo;re bad,
          but because the person who built them never learned distribution.
          Maya is the distribution. Same operator you&rsquo;d hire, working the
          channels where your users actually are.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                FEATURE RAIL                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

function FeatureRail() {
  return (
    <>
      <FeatureSection
        headline={
          <>
            You can ship. You can&rsquo;t{" "}
            <span className="text-paper-dim">market.</span>
          </>
        }
        subhead={
          <>
            That&rsquo;s the whole problem and it&rsquo;s fine. Maya runs the
            content engine — launch posts, build-in-public threads, demo cuts,
            the boring consistent cadence — across TikTok, X, and LinkedIn.
            You approve, you keep coding.
          </>
        }
        visual={
          <MessageCard
            lines={[
              "3 posts queued for this week. all in your voice, all from the changelog you shipped Tuesday.",
              "want to see them or just let them run?",
            ]}
          />
        }
      />
      <FeatureSection
        reverse
        badge="The difference"
        headline={
          <>
            Grounded in real signups —{" "}
            <span className="text-paper-dim">not vanity likes.</span>
          </>
        }
        subhead={
          <>
            A creator&rsquo;s scoreboard is followers. Yours is users. Maya
            connects to your signup metric, so every recommendation is tied to
            what actually moved installs — &ldquo;this post drove 11, do more
            of that shape&rdquo; — never &ldquo;this got likes.&rdquo; If she
            can&rsquo;t prove a post worked, she says so.
          </>
        }
        visual={
          <MessageCard
            lines={[
              "honest read: the meme posts get views but ~0 signups. the 'here's exactly how I built X' posts convert.",
              "shifting the week toward the second kind. ok?",
            ]}
          />
        }
      />
      <FeatureSection
        headline={
          <>
            Lives in your{" "}
            <span className="text-paper-dim">messages.</span>
          </>
        }
        subhead={
          <>
            No dashboard to check, no tool to learn. Maya texts you: what to
            post, when, what&rsquo;s working, what to kill. You reply like
            you&rsquo;d text a teammate. The product is the thread.
          </>
        }
        visual={
          <MessageCard
            lines={[
              "Show HN is live. I drafted the launch thread + 4 reply-guy responses for the obvious questions.",
              "first comment in 6 min — want the reply now?",
            ]}
          />
        }
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                   FAQ                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does Maya post for me automatically?",
    a: "No. She prepares everything — the post, the thread, the cut, the timing — for you to send in one tap. Your accounts, your voice, your call. The publishing moment stays with you.",
  },
  {
    q: "How does she know if a post actually worked?",
    a: "You connect your signup metric (a webhook or a read-only key from wherever your signups land). Maya ties content to real signups, not likes — so her recommendations are about what moved users, not what got engagement. If she can't ground it, she won't claim it.",
  },
  {
    q: "Which platforms?",
    a: "TikTok, X, and LinkedIn — the places indie products actually get discovered. If your audience is somewhere else, get on the list and tell us; it shapes what ships next.",
  },
  {
    q: "Is this different from the creator product?",
    a: "Same Maya, reframed for builders. A creator grows a persona; you grow a product. The work — content, cadence, knowing what's working — is the same engine, pointed at signups instead of followers.",
  },
];

function Faq() {
  return (
    <section className="px-6 pt-24 sm:px-10 sm:pt-32">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-3xl tracking-tight text-paper sm:text-4xl">
          Questions
        </h2>
        <dl className="mt-10 divide-y divide-[var(--hairline)]">
          {FAQ.map((item) => (
            <div key={item.q} className="py-6">
              <dt className="font-display text-lg text-paper">{item.q}</dt>
              <dd className="mt-3 text-base leading-relaxed text-paper-dim">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                FINAL CTA                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="px-6 pt-24 sm:px-10 sm:pt-32">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
          Stop shipping into the void.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-paper-dim">
          Get on the list. We&rsquo;re onboarding builders who have something
          real and zero distribution.
        </p>
        <div className="mt-9 flex justify-center">
          <Link
            href={primaryCtaHref("/sign-up?redirect_url=/creator-maya-v0")}
            className="btn btn-primary group"
          >
            {primaryCtaLabel("Get on the list")}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                 FOOTER                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="mt-32 border-t border-[var(--hairline)] px-6 py-10 sm:px-10">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <span className="font-display text-lg tracking-tight text-paper">
          HeyMaya
        </span>
        <nav className="flex gap-6 text-sm text-paper-dim">
          <Link href="/creators" className="hover:text-paper">
            For Creators
          </Link>
          <Link href="/privacy" className="hover:text-paper">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-paper">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                              SHARED VISUAL                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

function MessageCard({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5 shadow-2xl">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-lime text-xs font-semibold text-ink">
          M
        </span>
        <span className="text-sm text-paper-dim">Maya</span>
      </div>
      <div className="space-y-3">
        {lines.map((line, i) => (
          <p
            key={i}
            className="rounded-2xl bg-ink px-4 py-3 text-[15px] leading-relaxed text-paper"
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
