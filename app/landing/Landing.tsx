/**
 * The landing for an app (W1, docs/CREATOR_MASTER_PLAN.md). One story: she texts you in
 * Messages, and everything she finds lives in the iPhone app. Every CTA is "Get the app"
 * through `/join` (attribution → App Store / TestFlight). Prices come from billing/tiers only.
 * Server-rendered; the only client code is the CTA's click tracking and the page analytics.
 */
import Link from "next/link";
import QRCode from "qrcode";
import { TIERS, TIER_NAMES, price } from "@/convex/billing/tiers";
import { appLink, ctaLabel, type AppLink } from "@/lib/appLink";
import { CtaLink } from "../cta";
import { Cover, Flower, IdeasScreen, MessagesScreen, NumbersScreen, Phone, ReviewScreen, TodayScreen, type Line } from "./Screens";
import "./landing.css";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://hey-maya.ai").replace(/\/$/, "");

const HERO_THREAD: Line[] = [
  { from: "maya", time: "Today 7:12 AM", text: "the switch from “i can't do this” to “i love running” halfway up a hill made me laugh. a runner in your lane posted it last night and it's at 8.5× her normal." },
  { from: "maya", text: "you'd nail a 15 sec version on your river loop. text on screen: running in queensland heat (it's 7am). your own audio." },
  { from: "me", text: "omg that's literally me. tomorrow 5?" },
  { from: "maya", text: "booked 🙌 i'll nudge you before 5 so you can't pretend you forgot" },
];

const PLAN_THREAD: Line[] = [
  { from: "me", time: "Wed 7:20 AM", text: "omg that's literally me. tomorrow 5?" },
  { from: "maya", text: "booked 🙌 i'll nudge you before 5" },
  { from: "maya", time: "Thu 3:45 PM", text: "filming today at 5: the hill one. start at the bottom, phone at hip height, one honest take." },
  { from: "me", text: "done!! posted it" },
  { from: "maya", text: "YES. the face at the top 😭 i'll tell you how it's doing in the morning." },
  { from: "maya", time: "Fri 8:02 AM", text: "31K and climbing. that's 3.1× your normal, your best since june." },
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
  ["What does Maya actually do?", "She watches your lane on TikTok and Instagram, reads your own numbers, and texts you the ideas worth making, each with the post that inspired it. She plans your filming around your real week, nudges you before you shoot, and tells you honestly how it went. You stay the creator: she doesn't film, edit or post for you."],
  ["Where do I talk to her?", "In Messages, like any friend. Send her a link, a screenshot, a half-formed idea or a change of plan. There's no chat inside the app on purpose: the app is where her work is kept, Messages is where you two talk."],
  ["What's in the app?", "Every idea she's sent, with its proof, to save or pass with a swipe. Your posts from TikTok and Instagram compared with your own normal. Your week and what's coming up. Her Sunday review. And Deals, where brand opportunities show up on the partnerships plan."],
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
          <a href="#how">How it works</a>
          <a href="#app">The app</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <CtaLink href="/join?where=nav" where="nav" className="mx-nav-cta">Get the app</CtaLink>
      </header>

      <main id="main">
        {/* ——— Hero ——— */}
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow"><i className="dot" />For TikTok and Instagram creators</span>
            <h1 id="hero-title">She texts you the idea <em>worth making.</em></h1>
            <p className="lede">
              Maya watches your lane, reads your own numbers, and texts you what to make next, with the proof. Everything she finds lives in the app.
            </p>
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
            <Phone className="ph-front" label="A text thread with Maya in Messages: she sends an idea with its proof, you book a time to film">
              <MessagesScreen lines={HERO_THREAD} />
            </Phone>
            <span className="float float-a"><b>8.5×</b> her normal<small>the post that inspired it</small></span>
            <span className="float float-b"><i className="cal">THU<b>8</b></i>Film at 5:00<small>booked from a text</small></span>
          </div>
        </section>

        {/* ——— Two halves ——— */}
        <section id="how" className="halves wrap" aria-labelledby="how-title">
          <div className="intro">
            <span className="eyebrow">How it works</span>
            <h2 id="how-title">One friend in the industry. <span>Two places to find her.</span></h2>
          </div>
          <div className="half-grid">
            <article className="half half-msg">
              <span className="half-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 4.9 3.6 6.5L5 21.5l3.8-2c1 .3 2.1.5 3.2.5 5.5 0 10-3.8 10-8.5S17.5 3 12 3Z" fill="currentColor" /></svg>
              </span>
              <h3>She talks in Messages</h3>
              <p>No new chat to check. She texts like a friend: an idea with its proof, a nudge before you film, the honest read on Sunday. Reply however you like, even just “tomorrow 5?”</p>
              <div className="half-bubbles" aria-hidden="true">
                <p className="bub bub-in">ok THAT one. the dog at the tv 😭</p>
                <p className="bub bub-out">he&apos;s a natural</p>
              </div>
            </article>
            <article className="half half-app">
              <span className="half-icon" aria-hidden="true"><Flower /></span>
              <h3>Her work lives in the app</h3>
              <p>Every idea she&apos;s sent, with the post that inspired it. Your TikTok and Instagram numbers against your own normal. Your week. Swipe to save, tap to open.</p>
              <div className="half-tiles" aria-hidden="true">
                <Cover kind="hill" />
                <Cover kind="track" />
                <Cover kind="dawn" />
              </div>
            </article>
          </div>
          <ol className="steps">
            <li><b>Get the app</b><span>Download it and sign in. It takes a tap.</span></li>
            <li><b>Tell her where you post</b><span>Your TikTok, your Instagram, or both, and a few creators you love.</span></li>
            <li><b>Text her START</b><span>She reads your posts and your lane, then sends her first text within minutes.</span></li>
          </ol>
        </section>

        {/* ——— The app, screen by screen ——— */}
        <section id="app" className="tour" aria-labelledby="app-title">
          <div className="wrap intro">
            <span className="eyebrow">Inside the app</span>
            <h2 id="app-title">Everything she finds, <span>in one place.</span></h2>
          </div>

          <div className="row wrap">
            <div className="row-copy">
              <span className="num">01</span>
              <h3>Ideas with proof, not vibes.</h3>
              <p>Every idea comes with the post that inspired it, how far it beat that creator&apos;s normal, and why it fits <em>you</em>. Swipe right to save it for later, left to pass. She learns from both.</p>
              <ul className="ticks">
                <li>The real post it came from, one tap away</li>
                <li>Written for your voice and the footage you actually have</li>
                <li>Say “film it thursday” and it&apos;s on your calendar</li>
              </ul>
            </div>
            <div className="row-stage">
              <Phone label="The Ideas screen: a swipeable card with a hook, the post that inspired it and why it fits">
                <IdeasScreen />
              </Phone>
            </div>
          </div>

          <div className="row row-flip wrap">
            <div className="row-copy">
              <span className="num">02</span>
              <h3>Your numbers, against your normal.</h3>
              <p>Not a wall of totals. Each post is measured against your own usual, TikTok and Instagram side by side, so 3× means something and a quiet week doesn&apos;t feel like a verdict.</p>
              <ul className="ticks">
                <li>Both platforms, every post, in one row</li>
                <li>Followers over time once you connect</li>
                <li>If a platform doesn&apos;t share a number, she says so. She never guesses one.</li>
              </ul>
            </div>
            <div className="row-stage">
              <Phone label="Your numbers: TikTok and Instagram followers and every post against your normal">
                <NumbersScreen />
              </Phone>
            </div>
          </div>

          <div className="row wrap">
            <div className="row-copy">
              <span className="num">03</span>
              <h3>A plan that survives real life.</h3>
              <p>She books a time to film around your actual week, sends the shot list that morning, and checks in after. Didn&apos;t get to it? Tell her. She moves it, no guilt trip.</p>
              <ul className="ticks">
                <li>Works with your Google Calendar, or on its own</li>
                <li>Plans around races, trips and launches weeks out</li>
                <li>Quiet hours you set, and a cap on how often she texts</li>
              </ul>
            </div>
            <div className="row-stage row-stage-pair">
              <Phone className="ph-small" label="A shoot-day thread: the morning shot list, then how the post did">
                <MessagesScreen lines={PLAN_THREAD} footer="Read" animate={false} />
              </Phone>
              <Phone className="ph-small ph-offset" label="Today screen with coming-up filming blocks">
                <TodayScreen />
              </Phone>
            </div>
          </div>

          <div className="row row-flip wrap">
            <div className="row-copy">
              <span className="num">04</span>
              <h3>The honest Sunday read.</h3>
              <p>What worked, what didn&apos;t, and one thing to try next week. Warm, specific, and never rounded up. She&apos;d rather tell you a post fell flat than let you guess.</p>
              <ul className="ticks">
                <li>Posted vs planned, and how it did vs your normal</li>
                <li>Experiments she tracks across weeks</li>
                <li>Brand deals on the partnerships plan: she finds them, drafts the pitch, you approve</li>
              </ul>
            </div>
            <div className="row-stage">
              <Phone label="Her Sunday review: a short read of the week and what to try next">
                <ReviewScreen />
              </Phone>
            </div>
          </div>
        </section>

        {/* ——— Her voice ——— */}
        <section className="voice" aria-labelledby="voice-title">
          <div className="wrap intro">
            <span className="eyebrow">What she sounds like</span>
            <h2 id="voice-title">A friend who&apos;s <span>seen everything in your lane.</span></h2>
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

        {/* ——— Trust ——— */}
        <section className="trust wrap" aria-label="What she promises">
          <div>
            <b>She never invents a number.</b>
            <p>Every figure is one she read. If she can&apos;t see it, she tells you.</p>
          </div>
          <div>
            <b>Your normal, not someone else&apos;s.</b>
            <p>Every post is measured against how you usually do.</p>
          </div>
          <div>
            <b>Yours to delete.</b>
            <p>Type DELETE in Settings and everything is gone.</p>
          </div>
        </section>

        {/* ——— Pricing ——— */}
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
                  <li>Ideas with proof, texted to you</li>
                  <li>Your numbers against your normal</li>
                  <li>Filming plan, reminders and a Sunday review</li>
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

        {/* ——— FAQ ——— */}
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

        {/* ——— Get the app ——— */}
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
