"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AudienceToggle } from "./_components/AudienceToggle";
import { Faq } from "./_components/Faq";
import { FeatureSection } from "./_components/FeatureSection";
import { Hero } from "./_components/Hero";
import { IMessageCard } from "./_components/IMessageCard";
import { MobileStickyCta } from "./_components/MobileStickyCta";
import { Pricing, type Billing } from "./_components/Pricing";

/**
 * /creators — the consumer creator product landing page.
 *
 * Conversion framework (lovable.dev): hero with single primary CTA → value
 * proposition → per-feature pain-led sections → pricing → FAQ → final CTA.
 *
 * Constraint: zero "AI" mentions in rendered copy. Maya is "your social media
 * manager" / "your content coach." Coach and Manager are autonomy-level
 * pricing tiers of one product, never two products.
 */
export default function CreatorLanding() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="relative isolate flex min-h-screen flex-col pb-24 md:pb-0">
      <Nav />
      <main className="relative z-10 flex-1">
        <Hero />
        <ValueProp />
        <FeatureRail />
        <Pricing billing={billing} setBilling={setBilling} />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <MobileStickyCta />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                  NAV                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="relative z-20 px-6 pt-6 sm:px-10 sm:pt-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
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
        <div className="hidden md:block">
          <AudienceToggle />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden text-sm text-paper-dim transition-colors hover:text-paper sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/checkout?tier=manager&interval=monthly"
            className="btn btn-primary h-10 px-4 text-sm !bg-paper !text-ink hover:!bg-white"
          >
            Start 7 days free
          </Link>
        </div>
      </div>
      <div className="mx-auto mt-4 flex max-w-7xl justify-center md:hidden">
        <AudienceToggle />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 place-items-center rounded-full bg-lime text-ink"
      style={{
        boxShadow:
          "0 0 0 1px rgba(214,255,61,0.3), 0 6px 24px -6px rgba(214,255,61,0.5)",
      }}
    >
      <span className="font-display text-lg leading-none">m</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                              VALUE PROPOSITION                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function ValueProp() {
  return (
    <section className="px-6 pt-24 sm:px-10 sm:pt-32">
      <div className="mx-auto max-w-5xl text-center">
        <p className="font-display text-3xl leading-[1.1] tracking-tight text-paper sm:text-5xl">
          Maya is your social media manager.{" "}
          <span className="italic text-paper-dim">
            Lives in your iMessages. Replaces eight tools and a manager you
            can&rsquo;t afford yet.
          </span>
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                               FEATURE RAIL                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * 12 feature sections, each anchored to a creator pain point. Order is
 * deliberate — algorithm anxiety up top (most universal), tier-restricted
 * outreach mid-way (Manager value), anti-sycophancy as the closer (the
 * personality differentiator).
 */
function FeatureRail() {
  return (
    <div id="features" className="pt-12">
      {/* 01 — Trends */}
      <FeatureSection
        headline={
          <>
            The algorithm changes every week.{" "}
            <span className="italic text-paper-dim">You can&rsquo;t catch up.</span>
          </>
        }
        subhead={
          <>
            Maya watches your niche every day and only brings up trends that
            match what already works for you. No generic &ldquo;TikTok trends
            today&rdquo; list. The three openings she thinks fit your last 30
            posts, with why.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Tue · 9:14 AM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Caught a new POV format moving in beauty TikTok this week.
                    34 of your peers used it, the top 3 averaged{" "}
                    <strong>5.7×</strong> baseline.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    It fits your &ldquo;tried it for a week&rdquo; voice. Drafted
                    one for the candle launch — want to see?
                  </>
                ),
              },
            ]}
            caption="seen across 34 of your peers"
          />
        }
      />

      {/* 02 — Idea sparring */}
      <FeatureSection
        reverse
        headline={
          <>
            You&rsquo;re working alone.{" "}
            <span className="italic text-paper-dim">
              Half-baked ideas die in your notes app.
            </span>
          </>
        }
        subhead={
          <>
            Send a half-thought via iMessage. Maya sharpens it into a hook, a
            shot list, a caption — in your voice, with three variants to pick
            from. The notes-app graveyard becomes a working draft folder.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Wed · 11:42 PM"
            bubbles={[
              {
                side: "right",
                body: <>quick thought: skincare routine for a flight??</>,
              },
              {
                side: "left",
                body: (
                  <>
                    Yeah — pre-flight prep is a saved-post category for your
                    audience (12% of saves last month).
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    3 hooks: <em>&ldquo;The 4 things I do before a 9-hour
                    flight&rdquo;</em>, <em>&ldquo;Skincare won&rsquo;t save you
                    on this flight&rdquo;</em>, <em>&ldquo;Airport bathroom
                    routine, ranked&rdquo;</em>. Want scripts?
                  </>
                ),
              },
            ]}
            caption="from the last 30 days of your saves"
          />
        }
      />

      {/* 03 — Weekly plan */}
      <FeatureSection
        headline={
          <>
            Sunday hits and the week is{" "}
            <span className="italic text-paper-dim">a blank wall.</span>
          </>
        }
        subhead={
          <>
            Sunday at 4pm, Maya drops next week&rsquo;s content arc — three
            TikToks, hook variants for each, posting times that fit your real
            calendar. You start Monday already aimed at something.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Sun · 4:14 PM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Plan for week of Mar 18. You&rsquo;ve got the dentist Tue
                    morning and a wedding Sat — built around it.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    <strong>Mon 7pm</strong> · POV opener (Reel + TT)
                    <br />
                    <strong>Wed 6pm</strong> · process video, batch w/ Mon
                    leftovers
                    <br />
                    <strong>Fri 11am</strong> · wedding-prep get-ready (build-up
                    arc into Sat)
                  </>
                ),
              },
            ]}
            caption="matched against your calendar"
          />
        }
      />

      {/* 04 — Performance reading */}
      <FeatureSection
        reverse
        headline={
          <>
            A post hits. Another flops.{" "}
            <span className="italic text-paper-dim">You don&rsquo;t know why.</span>
          </>
        }
        subhead={
          <>
            Every two hours during waking hours, Maya reads what just published
            against your last 30. She tells you why Tuesday&rsquo;s Reel hit
            2.3× and Thursday&rsquo;s stalled — opener, length, audio, posting
            window. Then what to do next.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Thu · 5:08 PM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Tue&rsquo;s POV is at <strong>2.3×</strong> your 30-post
                    median. Thu is at <strong>0.4×</strong>.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Same length, same niche. Tue opened on a question, Thu
                    opened on a wide shot. Saves on the Tue post say POV-
                    question is the lever — keep it for Sun.
                  </>
                ),
              },
            ]}
            caption="against your last 30 posts, every two hours"
          />
        }
      />

      {/* 05 — Lives in your iMessages */}
      <FeatureSection
        headline={
          <>
            Eight tools. Seven dashboards.{" "}
            <span className="italic text-paper-dim">
              Your phone is a graveyard of $9.99 subscriptions.
            </span>
          </>
        }
        subhead={
          <>
            Morning brief at 7am. Evening recap at 7pm. Sunday plan. Weekly
            review. All on iMessage, where you already are. No app to open,
            no dashboard to remember the password for.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Mon · 7:02 AM"
            bubbles={[
              {
                side: "left",
                body: <>Morning. Quick read on the weekend before today gets weird.</>,
              },
              {
                side: "left",
                body: (
                  <>
                    Saturday&rsquo;s Reel is at <strong>180K</strong>, saves
                    9.4%. Algorithm fuel for the next 72h. Lean into POV format
                    Wed.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Glossier replied Sat night. $4K, below your floor. Drafted a
                    counter — want to see?
                  </>
                ),
              },
            ]}
            caption="iMessage"
          />
        }
      />

      {/* 06 — Accountability */}
      <FeatureSection
        reverse
        headline={
          <>
            You said three TikToks.{" "}
            <span className="italic text-paper-dim">You posted one.</span>
          </>
        }
        subhead={
          <>
            Friday at 10am, if you&rsquo;re behind on what you committed to,
            Maya tells you — specifically, with the exact unblock. Not nagging.
            Not flattery. The thing a real manager would say at the standup.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Fri · 10:00 AM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    You committed to 3 TikToks this week. You&rsquo;re at 1.
                  </>
                ),
              },
              {
                side: "left",
                reaction: "question",
                body: (
                  <>
                    The two unfilmed are the POV ones we drafted Tue. Both are
                    under 90 sec. You have 6:30-7:00pm tonight clear. That&rsquo;s
                    enough for one — want me to bump the third to next Tue?
                  </>
                ),
              },
            ]}
            caption="matched against what you said you'd do"
          />
        }
      />

      {/* 07 — Brand DM triage */}
      <FeatureSection
        headline={
          <>
            Brand emails sit unanswered. You undercharge.{" "}
            <span className="italic text-paper-dim">
              You get ghosted on a rate that was probably too low.
            </span>
          </>
        }
        subhead={
          <>
            Maya reads every brand email in Gmail, drafts the reply in your
            voice, and anchors on your minimum rate. If the deal is at or above
            the rate you&rsquo;ve trusted her with, she sends and tells you what
            she said. If she&rsquo;s not sure, you get the draft.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Mon · 2:38 PM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Glossier — Q2 launch, 1 Reel + 3 stories, $4,000.
                    That&rsquo;s 33% under your floor for that scope.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Drafted counter at $6,500 with 30-day exclusivity carved
                    out, citing your last Glossier post (412K, 11% saves).
                    Sending unless you say otherwise in 2h.
                  </>
                ),
              },
            ]}
            caption="anchored on your $6K minimum"
          />
        }
      />

      {/* 08 — Brand outreach (Manager only) */}
      <FeatureSection
        reverse
        badge="Manager tier"
        headline={
          <>
            The brands you&rsquo;d be perfect for{" "}
            <span className="italic text-paper-dim">don&rsquo;t know you exist.</span>
          </>
        }
        subhead={
          <>
            Maya spots brands you&rsquo;d be a fit for, tracks down the right
            person at each, and drafts the cold pitch in your voice. You see it
            before she hits send. The pipeline you&rsquo;d build if you had
            time, running while you film.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Wed · 11:02 AM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Spotted 3 brand fits this week: Topicals (skincare, your
                    audience overlap is 41%), Caraway (cookware, you keep
                    mentioning yours), Lemme (vitamins, low CPC, easy yes).
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Drafted pitches to all three, addressed to the right brand
                    lead at each. Want to read before I send?
                  </>
                ),
              },
            ]}
            caption="matched on audience overlap"
          />
        }
      />

      {/* 09 — Contracts */}
      <FeatureSection
        headline={
          <>
            A 14-page contract. You skim. You sign.{" "}
            <span className="italic text-paper-dim">
              Three months later, you find out you signed away exclusivity.
            </span>
          </>
        }
        subhead={
          <>
            Drop the PDF in chat. Maya flags the things that get creators in
            trouble — exclusivity, who owns the content, when you actually get
            paid, kill fees, the disclosure rules. In plain language. The
            clauses you should push back on, and the words to push back with.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Thu · 6:11 PM"
            bubbles={[
              {
                side: "right",
                body: <>just got the contract — 14 pages</>,
              },
              {
                side: "left",
                body: (
                  <>
                    Read it. Three flags:
                    <br />
                    1. <strong>90-day exclusivity</strong> across the entire
                    skincare category (industry standard for this rate is 30d
                    same-brand).
                    <br />
                    2. <strong>IP grant is perpetual</strong> — they keep your
                    footage forever.
                    <br />
                    3. <strong>Net-60 payment</strong>. Push to net-30.
                  </>
                ),
              },
            ]}
            caption="three clauses to push back on"
          />
        }
      />

      {/* 10 — Manager packet */}
      <FeatureSection
        reverse
        headline={
          <>
            A real manager is sniffing around. They want a deck.{" "}
            <span className="italic text-paper-dim">
              Your follower count alone won&rsquo;t sell you.
            </span>
          </>
        }
        subhead={
          <>
            Quarterly, or on-demand, Maya generates a polished PDF a real
            manager could read in five minutes. Audience, performance, brand
            history, rate card, what&rsquo;s next. The packet you&rsquo;d hire
            someone to build.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Q2 · on demand"
            bubbles={[
              {
                side: "right",
                body: <>UTA wants a deck. can you?</>,
              },
              {
                side: "left",
                body: (
                  <>
                    Yes. Pulled Q1 data — 14% follower growth, 3 brand deals
                    closed, $34K revenue, top-saved post is the candle launch
                    series. Generating now.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Packet ready: <strong>14 pages</strong>, brand-history
                    timeline, rate card with rationale. Sent to your inbox.
                  </>
                ),
              },
            ]}
            caption="generated · 6 min ago"
          />
        }
      />

      {/* 11 — Memory + voice mirror */}
      <FeatureSection
        headline={
          <>
            VAs and agencies dilute your voice.{" "}
            <span className="italic text-paper-dim">
              You felt the magic drain before your audience did.
            </span>
          </>
        }
        subhead={
          <>
            Maya is built from your last 30 posts and 500 comments before she
            sends a single message. She remembers your goals, your tone, your
            minimum rate, your brand history, the hooks that hit and the ones
            that didn&rsquo;t. The longer you have her, the more she sounds
            like she knows you.
          </>
        }
        visual={
          <IMessageCard
            timestamp="6 weeks in"
            bubbles={[
              {
                side: "left",
                reaction: "love",
                body: (
                  <>
                    Caraway is back. They asked about a holiday push. You said
                    in March you&rsquo;d only do them again at $8K and with
                    creative approval — they came in at $9K and said yes to
                    approval up front.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Drafted a yes, with the disclosure language you used last
                    time. Send?
                  </>
                ),
              },
            ]}
            caption="from your March email and your minimum"
          />
        }
      />

      {/* 12 — Tells the truth */}
      <FeatureSection
        reverse
        headline={
          <>
            Cheerleading is{" "}
            <span className="italic text-paper-dim">a betrayal of the job.</span>
          </>
        }
        subhead={
          <>
            Maya never says &ldquo;amazing post.&rdquo; If a piece underperforms,
            she tells you plainly — with the data and what comes next. The
            tone is tunable (supportive, strategic, tough-love). The honesty
            isn&rsquo;t.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Sat · 8:47 PM"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Friday&rsquo;s post underperformed. <strong>0.3×</strong>{" "}
                    your median, lowest watch-time of the last 30.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Opener was a 2.4-sec wide pan. Your top 5 all open on a
                    face or a question by 0.8 sec. Don&rsquo;t boost this one —
                    save the spend for Sunday&rsquo;s.
                  </>
                ),
              },
            ]}
            caption="grounded · told you the truth"
          />
        }
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*                                FINAL CTA                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="px-6 pt-32 sm:px-10 sm:pt-40">
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-3xl border border-[var(--hairline-strong)] bg-ink-2 px-8 py-16 text-center sm:px-16 sm:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              background:
                "radial-gradient(60% 80% at 50% 0%, rgba(214,255,61,0.18), transparent 70%)",
            }}
          />
          <h2 className="relative font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-6xl">
            Try Maya for 7 days.{" "}
            <span className="italic text-paper-dim">
              See if she earns the desk.
            </span>
          </h2>
          <p className="relative mx-auto mt-6 max-w-xl text-paper-dim">
            No card. Cancel anytime. If she isn&rsquo;t the manager you&rsquo;d
            hire, walk away on day 6 with your data exported.
          </p>
          <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/checkout?tier=manager&interval=monthly"
              className="btn btn-primary group !bg-paper !text-ink hover:!bg-white"
            >
              Start 7 days free
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-[1px] group-hover:translate-x-[1px]" />
            </Link>
            <a href="#pricing" className="btn btn-ghost">
              See pricing
            </a>
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
              Your social media manager before you can afford a human one.
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
                <a className="hover:text-paper" href="#features">
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
                <a className="hover:text-paper" href="mailto:hi@heymaya.app">
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
