/**
 * The landing for an app (W1, docs/CREATOR_MASTER_PLAN.md). The promise is one person: a TikTok
 * creator's assistant who texts. She helps decide what to make, plans when to film it, and keeps
 * them posting every week (2026-11-11: the page used to sell "a whole content team" in twelve wordy
 * sections; it now says one thing per section and lets the phones show the rest). Messages is where
 * she lives; the app is where her work is kept. Every CTA is "Get the app" through `/join`
 * (attribution → App Store / TestFlight). Prices come from billing/tiers only.
 * Server-rendered; the only client code is the CTA's click tracking, the page analytics, and the
 * wrapper that starts a phone's motion when it scrolls into view (InView).
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { TIERS, offeredTiers, price, tierCopy } from "@/convex/billing/tiers";
import { appLink, ctaLabel, type AppLink } from "@/lib/appLink";
import { CtaLink } from "../cta";
import { InView } from "./InView";
import { platformCopy } from "./platformCopy";
import { DealsScreen, Flower, IdeasScreen, MessagesScreen, NumbersScreen, Phone, ReviewScreen, TodayScreen, type Line } from "./Screens";
import "./landing.css";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://hey-maya.ai").replace(/\/$/, "");
const PARTNER = TIERS.partner;
type Copy = ReturnType<typeof platformCopy>;

/* The sample creator on every screen is one runner (Screens.tsx), so the threads tell her week too. */

/** A week with her, in four texts: the shoot, the caption, the Sunday read. */
const HERO_THREAD: Line[] = [
  { from: "maya", time: "Thu 7:12 AM", text: "filming today at 5: the hill monologue. start at the bottom, phone low. shot list is in the app" },
  { from: "me", text: "ok filmed it!! caption?" },
  { from: "maya", text: "“the hill always wins (it's 7am)”" },
  { from: "maya", time: "Sun 6:00 PM", text: "3 of 4 posted this week, and the hill one did 3.1× your normal 🙌" },
];

/** Her first text: she read their posts before she said hello. */
const FIRST_THREAD: Line[] = [
  { from: "me", text: "START" },
  { from: "maya", text: "hey Sam! it's Maya 👋 save this number, i'll text you when i find something worth making" },
  { from: "maya", text: "your 5am alarm video got 24K, against a usual 10K. the comments are all about your deadpan face" },
  { from: "maya", text: "want to do that again this week? i've got one for your river loop" },
];

/** Being told no, and what changes after. */
const NO_THREAD: Line[] = [
  { from: "me", text: "i don't want to do recipe videos anymore" },
  { from: "maya", text: "got it. give me a minute to rethink your plan around that." },
  { from: "maya", time: "2 minutes later", text: "took the recipes out. this week is two runs and a gear check. thursday at 5 still good?" },
];

/** Things people text her to stay in charge. Each one works today. */
const ASKS = ["text me less", "don't text me before 9", "move thursday's shoot to 6", "never pitch me dance trends", "be more blunt", "pause"];

const TRACK: Array<[string, string]> = [
  ["A plan every week.", "Shoots on your calendar, sized to what you can really do."],
  ["A nudge before you film.", "Miss one and she moves it. No guilt."],
  ["Help finishing the video.", "Send her what you filmed. She writes the caption and finds a sound."],
  ["A Sunday check-in.", "What you posted, what worked, and one thing to try next."],
];

const DEAL_STEPS: Array<[string, string]> = [
  ["She finds the brands", "The ones already paying creators like you."],
  ["She builds your media kit", "Your followers, typical views and best posts, on one link."],
  ["She writes the pitch", "In your voice. Nothing goes out without your OK."],
];

const faq = (c: Copy): Array<[string, string]> => [
  ["Where do I talk to her?", "In your texts, over iMessage or SMS. There's no chat inside the app on purpose."],
  ["Then what's the app for?", "Keeping her work: every idea she's sent, your numbers, your week and your brand deals."],
  ["Will she text me too much?", "She texts first only when something's worth it, and never during your quiet hours. Text her \"less\" or \"pause\" any time."],
  ["Does she post for me?", "No. You film, edit and post. She never posts, comments or messages anyone as you."],
  ["What can she see?", c.whatSheSees],
  ["How does the free trial work?", "Seven days free with a card on file, then the plan you picked. Cancel in one tap in Settings. Delete everything by typing DELETE."],
];

function AppleGlyph() {
  return (
    <svg viewBox="0 0 17 20" aria-hidden="true" className="apple">
      <path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.9 3.4-.9s2 .9 3.4.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-3-4.2ZM11.5 3c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5Z" />
    </svg>
  );
}

function GetApp({ link, where, variant = "dark" }: { link: AppLink; where: string; variant?: "dark" | "light" }) {
  const label = ctaLabel(link);
  return (
    <CtaLink href={`/join?where=${where}`} where={where} className={`get-app get-app-${variant}`} label={label}>
      {link.kind === "none" ? (
        <span className="get-app-one">{label} →</span>
      ) : (
        <>
          <AppleGlyph />
          <span className="get-app-two">
            <small>{link.kind === "store" ? "Download on the" : "Join the beta on"}</small>
            <b>{link.kind === "store" ? "App Store" : "TestFlight"}</b>
          </span>
        </>
      )}
    </CtaLink>
  );
}

function availability(link: AppLink): string {
  if (link.kind === "store") return `Free for 7 days, then from ${price(TIERS.solo.priceUsd)}/month. iPhone.`;
  if (link.kind === "beta") return "In beta on iPhone. 7 days free when she launches.";
  return "Coming soon to the App Store. iPhone first.";
}

async function qrSvg(): Promise<string> {
  return QRCode.toString(`${SITE}/join?where=qr&utm_medium=qr&utm_source=landing`, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#29233F", light: "#0000" },
  });
}

export default async function Landing() {
  const c = platformCopy();
  const link = appLink();
  const qr = await qrSvg();
  return (
    <div className="mx">
      <noscript><style>{".iv .msg-live *, .iv .s-chart i { animation-play-state: running !important; }"}</style></noscript>
      <a href="#main" className="mx-skip">Skip to content</a>
      <header className="mx-nav wrap">
        <Link href="/" className="mx-brand" aria-label="Maya home"><Flower />maya</Link>
        <nav aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#deals">Brand deals</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <CtaLink href="/join?where=nav" where="nav" className="mx-nav-cta">Get the app</CtaLink>
      </header>

      <main id="main">
        {/* ——— 1. Hero: who she is ——— */}
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow"><i className="dot" />{c.eyebrow}</span>
            <h1 id="hero-title">{c.headline} <em>in your texts.</em></h1>
            <p className="lede">{c.lede}</p>
            <div className="hero-cta">
              <GetApp link={link} where="hero" />
              <a className="ghost" href="#how">See how it works</a>
            </div>
            <p className="fine">{availability(link)}</p>
          </div>
          <div className="hero-stage">
            <Phone className="ph-back" label="The Maya app's Today screen: her latest idea, your numbers against your normal, and what's coming up">
              <TodayScreen />
            </Phone>
            <Phone className="ph-front" label="A text thread with Maya: a reminder to film today, a caption for the video, then her Sunday read of the week">
              <MessagesScreen lines={HERO_THREAD} />
            </Phone>
            <span className="float float-a"><b>3 of 4</b> posted this week<small>she keeps count, kindly</small></span>
            <span className="float float-b"><i className="cal">THU<b>8</b></i>Film at 5:00<small>booked from a text</small></span>
          </div>
        </section>

        <section id="how" className="rows wrap" aria-label="How it works">
          {/* ——— 2. She keeps you on track ——— */}
          <div className="row">
            <div className="row-copy">
              <span className="eyebrow">Staying consistent</span>
              <h2>She keeps you <span>on track.</span></h2>
              <p>A plan for the week that fits your life, and someone who notices when you follow through.</p>
              <ul className="points">
                {TRACK.map(([h, d]) => (
                  <li key={h}><b>{h}</b><span>{d}</span></li>
                ))}
              </ul>
            </div>
            <div className="row-stage">
              <Phone label="Her Sunday review: what you posted, what worked, and what to try next">
                <ReviewScreen />
              </Phone>
            </div>
          </div>

          {/* ——— 3. Her first text ——— */}
          <div className="row row-flip row-band">
            <div className="row-copy">
              <span className="eyebrow">Her first text</span>
              <h2>She&apos;s already <span>watched your videos.</span></h2>
              <p>Minutes after you sign up, she tells you which post worked and what to film next.</p>
            </div>
            <div className="row-stage">
              <InView>
                <Phone label="Maya's first text: she names your best post, with its numbers, and offers the next idea">
                  <MessagesScreen lines={FIRST_THREAD} />
                </Phone>
              </InView>
            </div>
          </div>

          {/* ——— 4. Your numbers ——— */}
          <div className="row">
            <div className="row-copy">
              <span className="eyebrow">Your numbers</span>
              <h2>She finds what&apos;s <span>working for you.</span></h2>
              <p>Every post against your own normal, so one lucky video doesn&apos;t steer you wrong.</p>
            </div>
            <div className="row-stage">
              <InView>
                <Phone label={`Your numbers: ${c.platforms} followers and every post against your normal`}>
                  <NumbersScreen />
                </Phone>
              </InView>
            </div>
          </div>

          {/* ——— 5. Your call ——— */}
          <div className="row row-flip row-band">
            <div className="row-copy">
              <span className="eyebrow">Your call</span>
              <h2>Tell her no. <span>She listens.</span></h2>
              <p>Say what you don&apos;t want and she rebuilds your plan around it.</p>
              <div className="row-asks" aria-label="Things you can text Maya">
                {ASKS.map((a) => (
                  <p key={a} className="bub bub-out">{a}</p>
                ))}
              </div>
            </div>
            <div className="row-stage">
              <InView>
                <Phone label="You tell Maya you don't want recipe videos; two minutes later she sends a new plan without them">
                  <MessagesScreen lines={NO_THREAD} />
                </Phone>
              </InView>
            </div>
          </div>

          {/* ——— 6. The app ——— */}
          <div className="row">
            <div className="row-copy">
              <span className="eyebrow">The app</span>
              <h2>Everything she sends, <span>kept in one place.</span></h2>
              <p>Text her to talk. Open the app to see your ideas, your week and your numbers.</p>
            </div>
            <div className="row-stage">
              <Phone label="The Ideas screen: a swipeable card with a hook, the post that inspired it and why it fits">
                <IdeasScreen />
              </Phone>
            </div>
          </div>
        </section>

        {/* ——— 7. Brand deals ——— */}
        <section id="deals" className="deals wrap" aria-labelledby="deals-title">
          <div className="deals-copy">
            <span className="eyebrow">Brand deals · {c.partnerLabel} plan</span>
            <h2 id="deals-title">She goes looking <span>for brand deals.</span></h2>
            <p>She does the homework and writes the pitch. You say yes.</p>
            <ol className="deal-steps deals-short">
              {DEAL_STEPS.map(([h, d]) => (
                <li key={h}><b>{h}</b><span>{d}</span></li>
              ))}
            </ol>
            <p className="fine">On the {c.partnerPlan} plan, {price(PARTNER.priceUsd)}/month.</p>
          </div>
          <div className="deals-stage">
            <Phone label="The Deals screen: your media kit, brands ready for you, and one in progress">
              <DealsScreen />
            </Phone>
            <span className="float float-deal">
              <Flower />
              <span>pacefern paid two runners you watch this month. want me to draft a pitch?</span>
            </span>
          </div>
        </section>

        {/* ——— 8. Pricing ——— */}
        <section id="pricing" className="pricing wrap" aria-labelledby="pricing-title">
          <div className="intro">
            <span className="eyebrow">Pricing</span>
            <h2 id="pricing-title">Seven days <span>free.</span></h2>
          </div>
          <div className={`prices prices-${offeredTiers().length}`} style={{ "--n": offeredTiers().length } as CSSProperties}>
            {offeredTiers().map((tier) => (
              <div className={`price${tier === c.featured.tier ? " price-feat" : ""}`} key={tier}>
                {tier === c.featured.tier ? <span className="price-tag">{c.featured.tag}</span> : null}
                <span className="price-name">{tierCopy(tier).label}</span>
                <div className="price-amt">{price(TIERS[tier].priceUsd)}<small>/month</small></div>
                <p>{tierCopy(tier).blurb}</p>
                <ul>
                  <li>{c.accountLine(tier)}</li>
                  <li>Ideas, a weekly plan and captions, by text</li>
                  <li>Your numbers against your normal</li>
                  {tier === "partner" ? <li>Brand deals: found and pitched, with your OK</li> : null}
                </ul>
                <small className="price-fine">or {price(TIERS[tier].annualUsd)}/year. Cancel in one tap.</small>
              </div>
            ))}
          </div>
          <div className="pricing-cta">
            <GetApp link={link} where="pricing" />
            <span className="fine">Pick your plan in the app. Card on file, first charge on day seven.</span>
          </div>
        </section>

        {/* ——— 9. Setup, and what she promises ——— */}
        <section className="setup wrap" aria-labelledby="setup-title">
          <div className="intro">
            <span className="eyebrow">Getting started</span>
            <h2 id="setup-title">Three <span>steps.</span></h2>
          </div>
          <ol className="steps">
            <li><b>Get the app</b><span>Sign in with a tap.</span></li>
            <li><b>Tell her where you post</b><span>{c.whereYouPost}</span></li>
            <li><b>Text her START</b><span>Her first text arrives within minutes.</span></li>
          </ol>
        </section>
        <section className="trust wrap" aria-label="What she promises">
          <div>
            <b>She never invents a number.</b>
            <p>If she can&apos;t see it, she says so.</p>
          </div>
          <div>
            <b>She never posts for you.</b>
            <p>Your account stays yours.</p>
          </div>
          <div>
            <b>Yours to delete.</b>
            <p>Type DELETE in Settings and everything is gone.</p>
          </div>
        </section>

        {/* ——— 10. FAQ ——— */}
        <section id="faq" className="faq wrap" aria-labelledby="faq-title">
          <div className="intro">
            <span className="eyebrow">Questions</span>
            <h2 id="faq-title">Questions.</h2>
          </div>
          <div className="faq-list">
            {faq(c).map(([q, a]) => (
              <details key={q}>
                <summary>{q}<span aria-hidden="true">+</span></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ——— 11. Get the app ——— */}
        <section id="get" className="get wrap" aria-labelledby="get-title">
          <div className="get-card">
            <div className="get-copy">
              <Flower className="get-flower" />
              <h2 id="get-title">Go make the thing. <span>She&apos;ll keep you going.</span></h2>
              <p>{availability(link)}</p>
              <GetApp link={link} where="footer" variant="light" />
            </div>
            <div className="get-qr">
              <div className="qr" role="img" aria-label="QR code to get the Maya app on your iPhone" dangerouslySetInnerHTML={{ __html: qr }} />
              <p>On your computer? Point your iPhone camera here.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-foot wrap">
        <Link href="/" className="mx-brand" aria-label="Maya home"><Flower />maya</Link>
        <nav aria-label="Footer">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© {new Date().getFullYear()} Maya</span>
        </nav>
      </footer>
    </div>
  );
}
