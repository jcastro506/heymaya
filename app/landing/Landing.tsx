/**
 * The landing for an app (W1, docs/CREATOR_MASTER_PLAN.md). The promise is the whole team: she
 * researches, plans, writes, reads the numbers and finds brand deals, all over text. Messages is
 * where she lives; the app is where her work is kept. Every CTA is "Get the app" through `/join`
 * (attribution → App Store / TestFlight). Prices come from billing/tiers only.
 * Server-rendered; the only client code is the CTA's click tracking and the page analytics.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { TIERS, TIER_NAMES, price } from "@/convex/billing/tiers";
import { appLink, ctaLabel, type AppLink } from "@/lib/appLink";
import { CtaLink } from "../cta";
import { DealsScreen, Flower, IdeasScreen, MessagesScreen, NumbersScreen, Phone, ReviewScreen, TodayScreen, type Line } from "./Screens";
import "./landing.css";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://hey-maya.ai").replace(/\/$/, "");
const PARTNER = TIERS.partner;

/** One thread, three of her jobs: the researcher, the copywriter, the analyst. */
const HERO_THREAD: Line[] = [
  { from: "maya", time: "Today 7:12 AM", text: "a runner you follow posted a “i can't do this” → “i love running” hill video last night. it's at 8.5× her normal. you'd nail this on your river loop." },
  { from: "me", text: "ok filmed it!! caption?" },
  { from: "maya", text: "1. the hill always wins (it's 7am)\n2. my legs said no, my brain said content\n3. pov: you signed up for this" },
  { from: "maya", time: "2:40 PM", text: "the hill one is at 31K. that's 3.1× your normal 🙌" },
];

/** Things people actually text her. Every one maps to something she can do by text today. */
const ASKS = [
  "save the hill one",
  "move thursday's shoot to 6",
  "write me a caption for this",
  "how'd my last post do?",
  "what's working in my niche this week?",
  "show me what that would look like",
  "find me brands",
  "send them my media kit",
  "never pitch me dance trends",
  "don't text me before 9",
  "be more blunt",
  "pause",
];

const TEAM: Array<{ role: string; line: string; proof: string; plan?: string }> = [
  { role: "Trend researcher", line: "Watches the creators you admire and your whole niche on TikTok and Instagram. When a post is beating that creator's usual, you hear about it.", proof: "“a runner you follow is at 8.5× her normal”" },
  { role: "Strategist", line: "Turns what's working into ideas for you, with the post that inspired each one and why it fits. Send her a photo of where you are and she'll give you angles and a shot list.", proof: "“your version: the river loop, 15 seconds”" },
  { role: "Producer", line: "Books filming time around your real calendar, sends the shot list that morning, checks in after, and moves it when life happens. She plans around races, trips and launches weeks out.", proof: "“filming today at 5. start at the bottom of the hill”" },
  { role: "Copywriter", line: "Send her the video you already filmed. She watches it, then writes three captions in your voice and finds a sound to put under it. She learns how you like to edit them.", proof: "“1. the hill always wins (it's 7am)”" },
  { role: "Analyst", line: "Measures every post against your own normal, tells you why it did or didn't work, and texts you while one is taking off. Send a screenshot of your analytics and she'll read it with you.", proof: "“31K, that's 3.1× your normal”" },
  { role: "Brand deals manager", line: "Finds brands already paying creators like you, builds your media kit, and writes the outreach for you to approve. Then she tracks the replies.", proof: "“pacefern paid two runners you watch this month”", plan: "Partnerships plan" },
];

const SCHEDULE: Array<{ when: string; what: string[] }> = [
  { when: "Every few hours", what: ["Checks the creators you admire for posts beating their usual", "Checks your own posts. If one takes off, you hear about it while it's still climbing"] },
  { when: "Every day", what: ["Searches your niche on TikTok and Instagram", "Spots formats and sounds catching on with creators like you", "Finds new accounts worth watching", "A morning text, only when something's worth saying"] },
  { when: "Around your shoots", what: ["The shot list that morning", "“how'd it go?” that evening", "Missed one? She offers to put it back the next day. No guilt"] },
  { when: "Every Sunday", what: ["An honest read of your week: what worked, what didn't, one thing to try", "Next week's plan, built around your calendar"] },
  { when: "Every week, on the partnerships plan", what: ["New brands paying creators in your niche", "Follow-ups on pitches that haven't heard back, twice at most"] },
  { when: "All the time", what: ["Learns from what you save, pass on and post", "Learns how you write captions", "Keeps up with your calendar"] },
];

const DEAL_STEPS: Array<[string, string]> = [
  ["She spots them", "Brands already paying creators in your niche, from the sponsored posts she's watching anyway. Once a week she tells you who's new."],
  ["She finds the right person", "A real contact from the brand's own site or profile. Never a guessed email."],
  ["She builds your media kit", "Your followers, typical views and best posts, with a link you can share. Never your rates."],
  ["She writes the outreach", "The email, the DM, or the answers to a brand's creator application, in your voice."],
  ["You approve, it sends", "Nothing goes out without your OK. Emails go from your own inbox."],
  ["She keeps it moving", "Tracks replies, tells you what they said, and follows up twice at most. Every brand lives in Deals in the app."],
];

const VOICE = [
  "wait, your first marathon?!",
  "ok THAT one. the dog at the tv 😭",
  "i can't see watch time from here, tiktok keeps that in the app. i can see it did 3× your normal though.",
  "i get it. putting in the hours just to watch views crawl is exhausting.",
  "tuesday 5 works? i'll put it in and nudge you before.",
  "that's the third time an object open beat your normal. it's a thing now.",
  "YES. you posted the scary one.",
];

const FAQ: Array<[string, string]> = [
  ["What does Maya actually do?", "The work of a content team. She watches your niche and the creators you admire, turns what's working into ideas for you, plans your shoots around your calendar, writes your captions, reads your numbers against your own normal, and on the partnerships plan, finds brand deals and writes the outreach. You stay the creator: she doesn't film, edit or post for you."],
  ["Where do I talk to her?", "In your texts, over iMessage or SMS. Send her a link, a video, a screenshot, a voice note or half an idea. Anything the app can do, you can ask her for by text. There's no chat inside the app on purpose."],
  ["Then what's the app for?", "Seeing her work. Every idea she's sent with the post that inspired it, your numbers, your week, your brand deals, and widgets for your home screen. Nothing in it you have to check."],
  ["Will she text me too much?", "She texts first only when something's worth it, never during your quiet hours, and there's a daily limit on how often. Text her \"pause\" any time, and \"resume\" when you want her back."],
  ["How do brand deals work?", `On the ${PARTNER.label.toLowerCase()} plan, she finds brands already paying creators in your niche, finds a real contact, builds your media kit, and writes the email, DM or application for you. Nothing is sent until you approve it, emails go from your own inbox, and she follows up twice at most. The deal is yours to make.`],
  ["What can she see?", "Your public posts from the start. Connect your accounts in the app and she can read more, like followers over time, and on Instagram reach, saves and Reels watch time. TikTok doesn't share watch time, so she says so instead of guessing. She never makes up a number."],
  ["Is it on Android?", "iPhone first. Android is planned."],
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
  const link = appLink();
  const qr = await qrSvg();
  return (
    <div className="mx">
      <a href="#main" className="mx-skip">Skip to content</a>
      <header className="mx-nav wrap">
        <Link href="/" className="mx-brand" aria-label="Maya home"><Flower />maya</Link>
        <nav aria-label="Main navigation">
          <a href="#texts">How it works</a>
          <a href="#team">What she does</a>
          <a href="#deals">Brand deals</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <CtaLink href="/join?where=nav" where="nav" className="mx-nav-cta">Get the app</CtaLink>
      </header>

      <main id="main">
        {/* ——— 1. Hero ——— */}
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow"><i className="dot" />For TikTok and Instagram creators</span>
            <h1 id="hero-title">Your whole content team. <em>In one text thread.</em></h1>
            <p className="lede">
              Maya is a TikTok and Instagram expert who watches your niche, turns what&apos;s working into ideas, plans your shoots, writes your captions, reads your numbers, and finds you brand deals. All over text.
            </p>
            <div className="hero-cta">
              <GetApp link={link} where="hero" />
              <a className="ghost" href="#texts">See how it works</a>
            </div>
            <p className="fine">{availability(link)}</p>
          </div>
          <div className="hero-stage">
            <Phone className="ph-back" label="The Maya app's Today screen: her latest idea, your numbers against your normal, and what's coming up">
              <TodayScreen />
            </Phone>
            <Phone className="ph-front" label="A text thread with Maya: a trend from a creator you follow, three captions for the video you filmed, then your post taking off">
              <MessagesScreen lines={HERO_THREAD} />
            </Phone>
            <span className="float float-a"><b>3 captions</b> in your voice<small>for the video you already filmed</small></span>
            <span className="float float-b"><i className="cal">THU<b>8</b></i>Film at 5:00<small>booked from a text</small></span>
          </div>
        </section>

        {/* ——— 2. She lives in your texts ——— */}
        <section id="texts" className="texts wrap" aria-labelledby="texts-title">
          <div className="texts-copy">
            <span className="eyebrow">How it works</span>
            <h2 id="texts-title">She lives in <span>your texts.</span></h2>
            <p>
              Maya texts you over iMessage or SMS, like anyone else in your phone. No new chat to open, nothing to check. Send her a link, a video, a screenshot, a voice note or half an idea, and she takes it from there.
            </p>
            <p className="texts-strong">Everything she does, you can ask for by text.</p>
          </div>
          <div className="asks" aria-label="Things you can text Maya">
            {ASKS.map((a, i) => (
              <p key={a} className="bub bub-out" style={{ "--i": i } as CSSProperties}>{a}</p>
            ))}
          </div>
        </section>

        {/* ——— 3. The app is the visual ——— */}
        <section id="app" className="appsec" aria-labelledby="app-title">
          <div className="wrap appsec-grid">
            <div className="appsec-copy">
              <span className="eyebrow">The app</span>
              <h2 id="app-title">The app is where <span>her work lives.</span></h2>
              <p>Texts are for talking. The app is for seeing everything she&apos;s made for you in one place. Nothing in it you have to check.</p>
              <ul className="ticks">
                <li>Every idea she&apos;s sent, with the post that inspired it. Swipe to save or pass</li>
                <li>Your TikTok and Instagram numbers, against your own normal</li>
                <li>Your week, your shoots, her Sunday review</li>
                <li>Your brand deals and media kit</li>
                <li>Home-screen widgets, and “Send to Maya” from any app&apos;s share button</li>
              </ul>
            </div>
            <div className="appsec-stage">
              <Phone className="ph-small" label="The Ideas screen: a swipeable card with a hook, the post that inspired it and why it fits">
                <IdeasScreen />
              </Phone>
              <Phone className="ph-small ph-offset" label="Your numbers: TikTok and Instagram followers and every post against your normal">
                <NumbersScreen />
              </Phone>
            </div>
          </div>
        </section>

        {/* ——— 4. Her team ——— */}
        <section id="team" className="team wrap" aria-labelledby="team-title">
          <div className="intro">
            <span className="eyebrow">What she does</span>
            <h2 id="team-title">Meet your team. <span>It&apos;s all Maya.</span></h2>
          </div>
          <div className="team-grid">
            {TEAM.map((t, i) => (
              <article key={t.role} className={`role role-${i + 1}`}>
                <span className="role-head">
                  <b>{t.role}</b>
                  {t.plan ? <span className="role-plan">{t.plan}</span> : null}
                </span>
                <p>{t.line}</p>
                <p className="bub bub-in role-proof">{t.proof}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ——— 5. Her schedule ——— */}
        <section id="schedule" className="sched" aria-labelledby="sched-title">
          <div className="wrap sched-grid">
            <div className="sched-copy">
              <span className="eyebrow">On her own</span>
              <h2 id="sched-title">She works <span>while you don&apos;t.</span></h2>
              <p>You don&apos;t have to ask. Maya runs her own routine for you, all day, every day, and texts you only when there&apos;s something worth your time.</p>
              <p className="sched-rules">Quiet hours you set. A daily limit on texts. Silence when there&apos;s nothing to say.</p>
              <Phone className="ph-small sched-phone" label="Her Sunday review: a short read of the week and what to try next">
                <ReviewScreen />
              </Phone>
            </div>
            <ol className="sched-list">
              {SCHEDULE.map((s) => (
                <li key={s.when}>
                  <b>{s.when}</b>
                  <ul>{s.what.map((w) => <li key={w}>{w}</li>)}</ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ——— 6. Brand deals ——— */}
        <section id="deals" className="deals wrap" aria-labelledby="deals-title">
          <div className="deals-copy">
            <span className="eyebrow">Brand deals · {PARTNER.label} plan</span>
            <h2 id="deals-title">She goes looking <span>for brand deals.</span></h2>
            <p>Maya doesn&apos;t wait for brands to find you. She finds the ones already paying creators in your niche, does the homework, and writes the outreach. You just say yes.</p>
            <ol className="deal-steps">
              {DEAL_STEPS.map(([h, d]) => (
                <li key={h}><b>{h}</b><span>{d}</span></li>
              ))}
            </ol>
            <p className="fine">On the {PARTNER.label.toLowerCase()} plan, {price(PARTNER.priceUsd)}/month.</p>
          </div>
          <div className="deals-stage">
            <Phone label="The Deals screen: your media kit, brands ready for you, and a brand that replied">
              <DealsScreen />
            </Phone>
            <span className="float float-deal">
              <Flower />
              <span>pacefern paid two runners you watch this month. want me to find the right person there and draft a pitch?</span>
            </span>
          </div>
        </section>

        {/* ——— 7. Her voice ——— */}
        <section className="voice" aria-labelledby="voice-title">
          <div className="wrap intro">
            <span className="eyebrow">What she sounds like</span>
            <h2 id="voice-title">An expert who <span>texts like a friend.</span></h2>
            <p className="sub">Warm, quick, a little funny, and honest. Never a report, never a hype machine.</p>
          </div>
          <div className="voice-track" aria-label="Examples of how Maya texts">
            <div className="voice-row">
              {[...VOICE, ...VOICE].map((v, i) => (
                <p key={i} className="bub bub-in" aria-hidden={i >= VOICE.length ? true : undefined}>{v}</p>
              ))}
            </div>
          </div>
        </section>

        {/* ——— 8. Trust ——— */}
        <section className="trust wrap" aria-label="What she promises">
          <div>
            <b>She never invents a number.</b>
            <p>Every figure is one she read. If she can&apos;t see it, she tells you.</p>
          </div>
          <div>
            <b>Nothing goes out without you.</b>
            <p>Pitches, emails and applications wait for your OK.</p>
          </div>
          <div>
            <b>Yours to delete.</b>
            <p>Type DELETE in Settings and everything is gone.</p>
          </div>
        </section>

        {/* ——— 9. Setup ——— */}
        <section className="setup wrap" aria-labelledby="setup-title">
          <div className="intro">
            <span className="eyebrow">Getting started</span>
            <h2 id="setup-title">Three steps. <span>Then she gets to work.</span></h2>
          </div>
          <ol className="steps">
            <li><b>Get the app</b><span>Download it and sign in. It takes a tap.</span></li>
            <li><b>Tell her where you post</b><span>Your TikTok, your Instagram, or both, and a few creators you love.</span></li>
            <li><b>Text her START</b><span>She reads your posts and your niche, then sends her first text within minutes.</span></li>
          </ol>
        </section>

        {/* ——— 10. Pricing ——— */}
        <section id="pricing" className="pricing wrap" aria-labelledby="pricing-title">
          <div className="intro">
            <span className="eyebrow">Pricing</span>
            <h2 id="pricing-title">Seven days free. <span>Then one small monthly.</span></h2>
          </div>
          <div className="prices">
            {TIER_NAMES.map((tier) => (
              <div className={`price${tier === "duo" ? " price-feat" : ""}`} key={tier}>
                {tier === "duo" ? <span className="price-tag">Most creators</span> : null}
                <span className="price-name">{TIERS[tier].label}</span>
                <div className="price-amt">{price(TIERS[tier].priceUsd)}<small>/month</small></div>
                <p>{TIERS[tier].blurb}</p>
                <ul>
                  <li>{tier === "solo" ? "One TikTok or Instagram account" : "Your TikTok and your Instagram"}</li>
                  <li>Trends, ideas and captions, texted to you</li>
                  <li>Your numbers against your normal</li>
                  <li>Shoots planned, reminders, a Sunday review</li>
                  {tier === "partner" ? <li>Brand deals: found, pitched with your OK, replies tracked</li> : null}
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

        {/* ——— 11. FAQ ——— */}
        <section id="faq" className="faq wrap" aria-labelledby="faq-title">
          <div className="intro">
            <span className="eyebrow">Questions</span>
            <h2 id="faq-title">Good questions.</h2>
          </div>
          <div className="faq-list">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}<span aria-hidden="true">+</span></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ——— 12. Get the app ——— */}
        <section id="get" className="get wrap" aria-labelledby="get-title">
          <div className="get-card">
            <div className="get-copy">
              <Flower className="get-flower" />
              <h2 id="get-title">Go make the thing. <span>She&apos;ll handle the rest.</span></h2>
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
