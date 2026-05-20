"use client";

import { useState } from "react";
import Link from "next/link";

import { MarketingNav } from "../_components/MarketingNav";
import { primaryCtaHref, primaryCtaLabel } from "../_components/landingMode";
import { Faq } from "./_components/Faq";
import { FeatureSection } from "./_components/FeatureSection";
import { Hero } from "./_components/Hero";
import { IMessageCard } from "./_components/IMessageCard";
import { MobileStickyCta } from "./_components/MobileStickyCta";
import { Pricing, type Billing } from "./_components/Pricing";

/**
 * /creators — the consumer creator product landing page.
 *
 * Conversion framework: hero → value prop → 11 pain-led feature sections →
 * pricing → FAQ → final CTA → footer.
 *
 * Constraint: zero "AI" mentions. Maya is "your social media manager."
 * Language is creator-voice — no median/baseline/multiplier/CPC/exclusivity-
 * jargon. Numbers stay; the words around them get human.
 *
 * Front-of-rail order is deliberately weighted toward the four daily jobs:
 *   01 weekly plan · 02 daily reminders · 03 trends · 04 consistency.
 * Bigger-deal behaviors (brand triage, contracts, packet) sit mid-rail.
 * Memory + anti-sycophancy close.
 */
export default function CreatorLanding() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="relative isolate flex min-h-screen flex-col pb-24 md:pb-0">
      <MarketingNav />
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
/*                              VALUE PROPOSITION                             */
/* ─────────────────────────────────────────────────────────────────────────── */

function ValueProp() {
  return (
    <section className="px-6 pt-32 sm:px-10 sm:pt-44">
      <div className="mx-auto max-w-4xl text-center">
        <p className="font-display text-3xl leading-[1.1] tracking-[-0.02em] text-paper sm:text-5xl">
          The week&rsquo;s plan. Today&rsquo;s shot list. What&rsquo;s
          trending now.{" "}
          <span className="italic text-paper-dim">
            Maya owns the four things you forget the second you start
            shooting.
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
 * 11 pain-led feature sections.
 *
 * Order is deliberate. The first four are the daily-job core — what Maya
 * does for you, every day, that keeps you posting:
 *   01 plans your week · 02 tells you what to do today ·
 *   03 watches what's trending · 04 keeps you accountable.
 * Then bigger-deal behaviors (brand triage, brand outreach, contracts,
 * manager packet). Memory + the anti-sycophancy closer at the end.
 */
function FeatureRail() {
  return (
    <div id="features" className="pt-12">
      {/* 01 — Weekly plan */}
      <FeatureSection
        headline={
          <>
            Sunday hits and the week is{" "}
            <span className="italic text-paper-dim">a blank wall.</span>
          </>
        }
        subhead={
          <>
            Sunday at 4pm, Maya texts you next week&rsquo;s plan. Three
            TikToks, hook ideas for each, posting times that fit your
            actual calendar. You start Monday already aimed at something.
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
                    Plan for the week of Mar 18. You&rsquo;ve got the
                    dentist Tue morning and a wedding Sat &mdash; built
                    around it.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    <strong>Mon 7pm</strong> · POV opener (Reel + TT)
                    <br />
                    <strong>Wed 6pm</strong> · process video, batch with
                    Mon leftovers
                    <br />
                    <strong>Fri 11am</strong> · wedding-prep get-ready
                    (build-up into Sat)
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 02 — Daily companion (morning brief + reminders + evening recap) */}
      <FeatureSection
        reverse
        headline={
          <>
            Maya tells you what to do today,{" "}
            <span className="italic text-paper-dim">
              before you even check your phone.
            </span>
          </>
        }
        subhead={
          <>
            7am text: what&rsquo;s worth filming, what to reply to,
            what&rsquo;s bubbling in your niche. Mid-day if you&rsquo;re
            falling behind on what you said you&rsquo;d do. Evening, only
            if something real popped. No app. No dashboard. Just messages.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Mon · all day"
            bubbles={[
              {
                side: "left",
                body: (
                  <>
                    Morning. Today: the POV we wrote Tuesday
                    (you&rsquo;re free 6:30-7pm tonight), candle launch
                    caption to schedule. Glossier comment worth reading
                    before lunch.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    3:14pm &mdash; heads up, POV is still unfilmed. Push
                    it to tomorrow, or are you good for tonight?
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    7:28pm &mdash; Tuesday&rsquo;s post is at 84K and
                    climbing. Filming tomorrow&rsquo;s POV can wait if
                    you&rsquo;re tired.
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 03 — Trends */}
      <FeatureSection
        headline={
          <>
            The algorithm changes every week.{" "}
            <span className="italic text-paper-dim">You can&rsquo;t keep up.</span>
          </>
        }
        subhead={
          <>
            Maya watches your niche every day and only flags trends that
            fit what already works for you. No generic &ldquo;TikTok this
            week&rdquo; list &mdash; just the three openings she thinks
            you should try, with why.
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
                    Caught a new POV format moving in beauty TikTok this
                    week. 34 of your peers tried it &mdash; the best ones
                    are doing <strong>way more</strong> than their usual.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    It fits your &ldquo;tried it for a week&rdquo; voice.
                    Wrote one for the candle launch &mdash; wanna see?
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 04 — Consistency / accountability */}
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
            Friday at 10am, if you&rsquo;re behind on what you said
            you&rsquo;d do, Maya tells you &mdash; with the exact unstuck.
            Not nagging. Not flattery. The thing a real manager would say
            at the Friday check-in.
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
                    You said 3 TikToks this week. You&rsquo;re at 1.
                  </>
                ),
              },
              {
                side: "left",
                reaction: "question",
                body: (
                  <>
                    The two unfilmed are the POV ones we wrote Tuesday.
                    Both under 90 sec. You&rsquo;re free 6:30-7pm tonight
                    &mdash; that&rsquo;s enough for one. Want me to push
                    the third to next Tue?
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 05 — Idea sparring */}
      <FeatureSection
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
            Text Maya a half-thought. She turns it into a hook, a shot
            list, and a caption in your voice &mdash; three versions to
            pick from. The notes-app graveyard becomes a working draft
            folder.
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
                    Yeah &mdash; pre-flight prep is something your audience
                    saves a lot. About 1 in 8 of your saves last month
                    were that lane.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    3 hooks: <em>&ldquo;The 4 things I do before a 9-hour
                    flight&rdquo;</em>, <em>&ldquo;Skincare won&rsquo;t
                    save you on this flight&rdquo;</em>, <em>&ldquo;Airport
                    bathroom routine, ranked&rdquo;</em>. Want scripts?
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 06 — Editing */}
      <FeatureSection
        reverse
        headline={
          <>
            You filmed it.{" "}
            <span className="italic text-paper-dim">
              It&rsquo;s rotting in your camera roll because editing is the
              wall.
            </span>
          </>
        }
        subhead={
          <>
            Send Maya the raw clips. She cuts them down, puts them in
            order, picks the opening that hooks, and sends back something
            you can post today. The part you dread turns into a thing you
            just approve.
          </>
        }
        visual={
          <IMessageCard
            timestamp="Wed · 8:21 PM"
            bubbles={[
              {
                side: "right",
                body: (
                  <>
                    shot like 6 clips at the studio, no clue what to do
                    with them
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Sent you a <strong>22-second cut</strong> — opens on
                    the mirror clip, then the voiceover carries the rest.
                    Swap anything or post it?
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 07 — Performance reading */}
      <FeatureSection
        headline={
          <>
            A post hits. Another flops.{" "}
            <span className="italic text-paper-dim">You don&rsquo;t know why.</span>
          </>
        }
        subhead={
          <>
            Every couple hours, Maya checks how your new posts are doing
            compared to your usual stuff. She tells you why Tuesday&rsquo;s
            Reel popped and Thursday&rsquo;s stalled &mdash; opener,
            length, sound, time of day. Then what to do next.
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
                    Tue&rsquo;s POV is doing <strong>about 2x</strong> what
                    your stuff usually hits. Thu is way under.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Same length, same niche. Tue opened on a question, Thu
                    opened on a wide shot. People are saving the Tuesday
                    one &mdash; keep the question opener for Sunday.
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 07 — Brand DM triage */}
      <FeatureSection
        headline={
          <>
            Brand emails sit unanswered. You undercharge.{" "}
            <span className="italic text-paper-dim">
              Or you get ghosted on a rate that was probably too low.
            </span>
          </>
        }
        subhead={
          <>
            Maya reads every brand email in your Gmail and writes the
            reply in your voice, with your minimum in mind. If the offer
            is at or above what you&rsquo;ve told her you&rsquo;ll take,
            she sends and tells you what she said. If she&rsquo;s not
            sure, you see the draft.
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
                    Glossier wants 1 Reel + 3 stories for $4,000 for the
                    spring launch. That&rsquo;s way under what you usually
                    get for that.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Wrote back at $6,500, with the 30-day exclusivity
                    carved out. Used your last Glossier post (412K, lots
                    of saves) as the reason. Sending in 2 hours unless you
                    say no.
                  </>
                ),
              },
            ]}
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
            Maya spots brands that match you, tracks down the right person
            at each, and writes the cold pitch in your voice. You see it
            before she hits send. The pipeline you&rsquo;d build if you
            had time, running while you film.
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
                    Spotted 3 brands worth pitching this week. Topicals
                    &mdash; lots of their fans already follow you. Caraway
                    &mdash; you keep mentioning yours in posts. Lemme
                    &mdash; small ask, easy yes.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Wrote pitches to all three, addressed to the right
                    person at each. Want to read before I send?
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 09 — Contracts */}
      <FeatureSection
        headline={
          <>
            A 14-page contract. You skim. You sign.{" "}
            <span className="italic text-paper-dim">
              Three months later you realize what you gave up.
            </span>
          </>
        }
        subhead={
          <>
            Drop the PDF in chat. Maya flags the stuff that gets creators
            burned &mdash; who can post when, who keeps the footage, when
            you actually get paid, kill fees, the disclosure rules. In
            plain English. The things to push back on, and the words to
            push back with.
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
                    Read it. Three things to push back on:
                    <br />
                    1. They want you to skip every skincare brand for{" "}
                    <strong>90 days</strong>. Normal at this rate is 30,
                    and only against them.
                    <br />
                    2. They <strong>keep your footage forever</strong>.
                    Push for 1 year, then it reverts to you.
                    <br />
                    3. They wanna pay you in <strong>60 days</strong>.
                    Push for 30.
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 10 — Memory + voice mirror */}
      <FeatureSection
        reverse
        headline={
          <>
            VAs and agencies water down your voice.{" "}
            <span className="italic text-paper-dim">
              You felt the magic drain before your audience did.
            </span>
          </>
        }
        subhead={
          <>
            Maya reads your last 30 posts and 500 comments before she
            sends a single message. She remembers your goals, your tone,
            your minimum rate, every brand you&rsquo;ve worked with, what
            hits and what doesn&rsquo;t. The longer she&rsquo;s with you,
            the more she sounds like she knows you.
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
                    Caraway is back. They asked about a holiday push. In
                    March you said you&rsquo;d only do them again at $8K
                    and with creative approval &mdash; they came in at
                    $9K and said yes to approval.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Wrote a yes with the disclosure language you used last
                    time. Send?
                  </>
                ),
              },
            ]}
          />
        }
      />

      {/* 11 — Tells the truth */}
      <FeatureSection
        headline={
          <>
            Cheerleading is{" "}
            <span className="italic text-paper-dim">a betrayal of the job.</span>
          </>
        }
        subhead={
          <>
            Maya never says &ldquo;amazing post.&rdquo; If something
            flops, she tells you plainly &mdash; with what you saw and
            what to do next. The tone is yours to set (supportive,
            strategic, tough-love). The honesty isn&rsquo;t.
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
                    Friday&rsquo;s post flopped. About <strong>a third</strong>{" "}
                    of your usual, and the lowest watch time you&rsquo;ve
                    had in a month.
                  </>
                ),
              },
              {
                side: "left",
                body: (
                  <>
                    Opener was a 2.4-sec wide pan. Your top 5 all open on a
                    face or a question by 0.8 sec. Don&rsquo;t boost this
                    one &mdash; save the spend for Sunday&rsquo;s.
                  </>
                ),
              },
            ]}
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
    <section className="border-t border-[var(--hairline)] px-6 pt-32 sm:px-10 sm:pt-44">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="font-display text-4xl leading-[1.04] tracking-[-0.025em] text-paper sm:text-6xl">
          Try Maya for 7 days.{" "}
          <span className="italic text-paper-dim">
            See if she earns the desk.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-paper-dim">
          No card. Cancel anytime. If she isn&rsquo;t the manager
          you&rsquo;d hire, walk away on day 6 with your data.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
          <Link
            href={primaryCtaHref("/checkout?tier=manager&interval=monthly")}
            className="inline-flex h-11 items-center rounded-md bg-paper px-5 text-sm font-medium text-ink transition hover:bg-white"
          >
            {primaryCtaLabel("Start 7 days free")}
          </Link>
          <a
            href="#pricing"
            className="text-sm text-paper-dim transition-colors hover:text-paper"
          >
            See pricing &rarr;
          </a>
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
                  X / Twitter &rarr;
                </a>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-1 hover:text-paper"
                  href="https://tiktok.com/@heymaya"
                  target="_blank"
                  rel="noreferrer"
                >
                  TikTok &rarr;
                </a>
              </li>
              <li>
                <a
                  className="inline-flex items-center gap-1 hover:text-paper"
                  href="https://instagram.com/heymaya"
                  target="_blank"
                  rel="noreferrer"
                >
                  Instagram &rarr;
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
