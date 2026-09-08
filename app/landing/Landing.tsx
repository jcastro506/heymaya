"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CtaLink } from "../cta";
import PerformancePreview from "./PerformancePreview";
import PhoneConversation from "./PhoneConversation";
import { useLandingMotion } from "./useLandingMotion";
import "./landing.css";

const moments = [
  {
    time: "06:00",
    label: "She does the scrolling",
    title: "Your niche. Already caught up.",
    text: "Maya follows the accounts you admire and spots the posts doing better than usual. You get the interesting part, without the rabbit hole.",
    message:
      "morning! that ‘do i regret it?’ format is picking up in your lane. i have a version that would work with your london footage 👀",
    tag: "A little research. A very good idea.",
  },
  {
    time: "14:00",
    label: "An idea worth making",
    title: "A starting point that sounds like you.",
    text: "A specific idea, why it could work, and how to make it your own. Built around your voice and the footage you actually have.",
    message:
      "your version: ‘six months of walking everywhere in london. do i regret it?’ open on the rain, then the view. 20 seconds. very you.",
    tag: "Your voice, with a head start.",
  },
  {
    time: "16:45",
    label: "A well-timed nudge",
    title: "Good ideas meet real life.",
    text: "Maya puts your plan on Google Calendar and checks in before you film. Life gets busy? Just text her to move it.",
    message:
      "your film block is in 15. same handheld setup, river walk, one honest take. still good for 5?",
    tag: "On your calendar. Off your mind.",
  },
  {
    time: "Sunday",
    label: "The honest debrief",
    title: "Less guessing. More getting better.",
    text: "Your posts, compared with your own baseline. Connected insights add reach and available Reels watch time on your paid plan, so next week’s ideas start with what you learned.",
    message:
      "the short reel reached 2.5× your usual audience. the longer vlog sat below your normal reach. next week, let’s test another quick walking clip before changing everything.",
    tag: "The truth, with a next step.",
  },
];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function Flower({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M40 9C49-9 62 4 58 20C77 13 88 29 70 40C88 49 77 66 59 59C65 77 49 89 40 71C30 89 14 77 21 59C2 66-9 49 9 40C-9 30 3 14 21 21C14 3 30-9 40 9Z"
        fill="currentColor"
      />
      <circle cx="31" cy="36" r="3" fill="#29233F" />
      <circle cx="49" cy="36" r="3" fill="#29233F" />
      <path
        d="M31 47Q40 56 49 47"
        stroke="#29233F"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Brand() {
  return (
    <Link href="/" className="maya-brand" aria-label="Maya home">
      <Flower />
      maya
    </Link>
  );
}
function Trial({
  where,
  text = "Meet your content person",
}: {
  where: string;
  text?: string;
}) {
  return (
    <CtaLink href="/sign-up" where={where} className="maya-button">
      {text}
      <Arrow />
    </CtaLink>
  );
}

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  useLandingMotion(rootRef);
  const [active, setActive] = useState(0);
  const moment = moments[active];
  return (
    <div className="maya-site" ref={rootRef}>
      <div className="reading-progress" aria-hidden="true" />
      <a href="#main" className="maya-skip">
        Skip to content
      </a>
      <header className="maya-nav container">
        <Brand />
        <nav aria-label="Main navigation" className="maya-nav-center">
          <a href="#how-it-works">How she helps</a>
          <a href="#your-day">A day with Maya</a>
          <a href="#your-numbers">Your numbers</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="maya-nav-actions">
          <Link href="/sign-in">Sign in</Link>
          <Trial where="nav" text="Try Maya free" />
        </div>
      </header>
      <main id="main">
        <section className="maya-hero container" aria-labelledby="hero-title">
          <div className="hero-orbit orbit-one" aria-hidden="true" />
          <div className="hero-orbit orbit-two" aria-hidden="true" />
          <div className="maya-hero-copy">
            <div className="maya-eyebrow">
              <span className="status-dot" /> YOUR CONTENT PERSON, IN YOUR
              TEXTS
            </div>
            <h1 id="hero-title">
              You do{" "}
              <span className="hero-you">
                you.
                <svg viewBox="0 0 210 20" aria-hidden="true">
                  <path d="M3 13 Q90 0 204 8 M15 19 Q104 8 181 14" />
                </svg>
              </span>
              <br />
              <span className="hero-middle">Maya does</span> <br />
              the <span className="hero-rest">rest.</span>
            </h1>
            <p>
              Maya is your content person, in your texts. Every day she scrolls
              your niche, brings you ideas with proof, keeps your week on your
              calendar, and tells you honestly what worked.
            </p>
            <div className="hero-actions">
              <Trial where="hero" />
              <a className="maya-text-link" href="#your-day">
                <span className="play-icon" aria-hidden="true">
                  ▶
                </span>{" "}
                See her in action
              </a>
            </div>
            <p className="trial-note">
              7 days free. Then $19/month. Cancel anytime.
            </p>
          </div>
          <div
            className="maya-studio"
            aria-label="Illustrative preview of Maya’s content planning and messages"
          >
            <div className="studio-grid" aria-hidden="true" />
            <div className="idea-sheet">
              <div className="idea-art">
                <span className="art-sun" />
                <span className="art-hill hill-back" />
                <span className="art-hill hill-front" />
                <span className="art-caption">
                  take the
                  <br />
                  <em>scenic route.</em>
                </span>
                <span className="art-play">▶</span>
              </div>
              <div className="idea-footer">
                <span>Less scrolling, more living.</span>
                <span>↗</span>
              </div>
            </div>
            <div className="insight-sticker">
              <span>↗</span>
              <div>
                A format worth trying<small>Spotted in your niche</small>
              </div>
              <i>✦</i>
            </div>
            <div className="chat-preview">
              <div className="chat-header">
                <span className="maya-avatar">
                  <Flower />
                </span>
                <div>
                  <b>Maya</b>
                  <span>Your content person</span>
                </div>
                <span className="chat-dots">···</span>
              </div>
              <div className="chat-body">
                <span className="chat-time">TODAY 2:06 PM</span>
                <p className="message maya-message">
                  that idea you saved? i found your angle. your london footage +
                  a “do i regret it?” hook. very you 👀
                </p>
                <p className="message user-message">wait, i love that</p>
                <p className="message maya-message">
                  knew you would. thursday at 5? i&apos;ll bring the shot list.
                </p>
                <span className="message-read">
                  A plan. Just like that. <span>✓✓</span>
                </span>
              </div>
              <div className="chat-input">
                <span>Text her like a friend...</span>
                <span>↑</span>
              </div>
            </div>
            <div className="calendar-sticker">
              <span className="calendar-icon">
                THU<b>12</b>
              </span>
              <div>
                Make a little magic<small>Film block · 5:00–5:45 pm</small>
              </div>
              <span className="calendar-check">✓</span>
            </div>
            <Flower className="studio-flower" />
            <span className="studio-spark" aria-hidden="true">
              ✧
            </span>
          </div>
        </section>
        <section
          className="platform-strip container"
          aria-label="Supported platforms"
        >
          <p>
            Made for your world.
            <br />
            <b>Fits right into it.</b>
          </p>
          <div>
            <span className="platform-symbol">♪</span>TikTok
          </div>
          <div>
            <span className="instagram-symbol" aria-hidden="true" />
            Instagram
          </div>
          <div>
            <span className="telegram-symbol" aria-hidden="true">
              ➤
            </span>
            Telegram
          </div>
          <div>
            <span className="google-calendar-symbol" aria-hidden="true">
              31
            </span>
            Google Calendar
          </div>
        </section>

        <section
          id="in-your-pocket"
          className="maya-messages container"
          aria-labelledby="messages-title"
        >
          <div className="messages-copy">
            <span className="maya-eyebrow">IN TELEGRAM</span>
            <h2 id="messages-title">
              Big ideas.
              <br />
              <span>Little chat bubbles.</span>
            </h2>
            <p>
              An idea on your walk. A hook that needs a second opinion. A week
              that needs rearranging. Send Maya a message in Telegram—she knows
              your content and helps you keep it moving.
            </p>
            <p className="messages-promise">
              No dashboard to keep checking. Just a conversation to come back
              to.
            </p>
          </div>
          <div
            className="messages-phone-stage"
            aria-label="Illustrative Telegram conversation with Maya"
          >
            <PhoneConversation />
          </div>
        </section>

        <section id="how-it-works" className="maya-features container">
          <span className="chapter-divider" aria-hidden="true" />
          <div className="section-intro">
            <span className="maya-eyebrow">WHAT SHE DOES</span>
            <h2>
              Less second-guessing.
              <br />
              <span>More “let’s try this.”</span>
            </h2>
            <p>
              Ideas that sound like you. A plan for the week ahead.
              <br />
              Maya helps you decide what to make next—and learn as you go.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature-card niche-card">
              <div className="feature-art niche-art">
                <span className="mini-label">ON MAYA’S RADAR</span>
                <div className="radar-row">
                  <i>↗</i>
                  <div>
                    @brettconti · 4.6× his normal
                    <small>the “do i regret it?” cut, 9 hours in</small>
                  </div>
                  <span>watching</span>
                </div>
                <div className="radar-row">
                  <i>✳</i>
                  <div>
                    the tier list format
                    <small>moving in your lane this week</small>
                  </div>
                  <span>saved</span>
                </div>
              </div>
              <span className="feature-category">THE RESEARCH</span>
              <h3>
                She scrolls.
                <br />
                You get the good stuff.
              </h3>
              <p>
                The accounts, the formats, the little things taking off. Maya
                finds what matters in your corner of the internet.
              </p>
            </article>
            <article className="feature-card voice-card">
              <div className="feature-art voice-art">
                <span className="voice-paper">
                  <small>YOUR CREATIVE DNA</small>
                  <b>
                    Dry humour.
                    <br />A little chaotic.
                    <br />
                    <em>Entirely you.</em>
                  </b>
                  <span>✓ voice understood</span>
                </span>
                <span className="voice-star" aria-hidden="true">
                  ✳
                </span>
              </div>
              <span className="feature-category">THE IDEAS</span>
              <h3>
                Your voice.
                <br />
                On a really good day.
              </h3>
              <p>
                She gets to know your posts, your taste, and your quirks. So her
                ideas feel like yours, with a head start.
              </p>
            </article>
            <article className="feature-card plan-card">
              <div className="feature-art plan-art">
                <div className="mini-week">
                  <span>
                    YOUR WEEK, SORTED <b>↗</b>
                  </span>
                  <div className="week-days">
                    <span>M</span>
                    <span>T</span>
                    <span>W</span>
                    <span>T</span>
                    <span>F</span>
                  </div>
                  <div className="week-grid">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <span className="week-film">↗ Film that idea</span>
                    <span className="week-post">✓ Post & go live life</span>
                  </div>
                </div>
                <span className="calendar-bubble">
                  “moved it to 6. you’re good.”
                </span>
              </div>
              <span className="feature-category">THE FOLLOW-THROUGH</span>
              <h3>
                Off your mind.
                <br />
                On your calendar.
              </h3>
              <p>
                A plan that fits your actual life. Prep notes, gentle nudges,
                and room to move things when life happens.
              </p>
            </article>
          </div>
        </section>

        <section id="your-day" className="maya-day">
          <span className="chapter-divider" aria-hidden="true" />
          <div className="container day-layout">
            <div className="day-copy">
              <span className="maya-eyebrow">A DAY WITH MAYA</span>
              <h2>
                A good day to <br />
                have <span>Maya.</span>
              </h2>
              <p>
                She’s working in the background.
                <br />
                You hear from her when it matters.
              </p>
              <div
                className="day-tabs"
                role="tablist"
                aria-label="A day with Maya"
                aria-orientation="vertical"
              >
                {moments.map((item, index) => (
                  <button
                    type="button"
                    role="tab"
                    id={`moment-tab-${index}`}
                    aria-controls="moment-panel"
                    aria-selected={active === index}
                    tabIndex={active === index ? 0 : -1}
                    onKeyDown={(event) => {
                      let next = index;
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowRight"
                      )
                        next = (index + 1) % moments.length;
                      else if (
                        event.key === "ArrowUp" ||
                        event.key === "ArrowLeft"
                      )
                        next = (index + moments.length - 1) % moments.length;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = moments.length - 1;
                      else return;
                      event.preventDefault();
                      setActive(next);
                      document.getElementById(`moment-tab-${next}`)?.focus();
                    }}
                    key={item.time}
                    onClick={() => setActive(index)}
                  >
                    <span>{item.time}</span>
                    <b>{item.label}</b>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              id="moment-panel"
              role="tabpanel"
              tabIndex={0}
              aria-labelledby={`moment-tab-${active}`}
              className="day-panel"
            >
              <div className="day-message" key={active}>
                <span className="maya-avatar">
                  <Flower />
                </span>
                <div>
                  <b>
                    Maya <small>{moment.time}</small>
                  </b>
                  <p>{moment.message}</p>
                </div>
              </div>
              <span className="day-caption">{moment.tag}</span>
              <div className="day-explainer">
                <h3>{moment.title}</h3>
                <p>{moment.text}</p>
              </div>
            </div>
          </div>
        </section>

        <PerformancePreview />

        <section className="maya-manifesto container">
          <span className="chapter-divider" aria-hidden="true" />
          <h2>
            You didn’t start creating
            <br />
            to spend your life <span>planning content.</span>
          </h2>
          <p>
            Go take the walk. Make the weird little video. Try the idea.
            <br />
            Maya will help you figure out what comes next.
          </p>
          <Flower />
        </section>

        <section id="start" className="maya-start container" aria-labelledby="start-title">
          <span className="chapter-divider" aria-hidden="true" />
          <div className="section-intro">
            <span className="maya-eyebrow">HOW IT STARTS</span>
            <h2 id="start-title">Thirty seconds of typing. Then she’s yours.</h2>
          </div>
          <ol className="start-steps">
            <li><span><b>Your handles.</b> TikTok, Instagram, or both.</span></li>
            <li><span><b>Three accounts you admire.</b> She watches them for you.</span></li>
            <li><span><b>One tap into Telegram.</b> That’s the whole pairing.</span></li>
            <li><span><b>Ten minutes later, her first read.</b> Two of your posts she liked, and one question.</span></li>
          </ol>
        </section>
        <section id="pricing" className="maya-pricing container">
          <span className="chapter-divider" aria-hidden="true" />
          <div className="pricing-copy">
            <span className="maya-eyebrow">THE PRICE</span>
            <h2>
              Small price.
              <br />
              Big “I’ve got you.”
            </h2>
            <p>
              One content assistant who gets to know you.
              <br />
              Research, ideas, planning, and honest feedback.
              <br />
              All in the conversation.
            </p>
            <div className="pricing-scribble">
              less in your head. more out in the world. ↗
            </div>
          </div>
          <div className="price-card">
            <span className="price-badge">THE FOUNDING CREATOR PLAN</span>
            <div className="price-amount">
              $19<span>/ month</span>
              <Flower />
            </div>
            <p>Founding pricing while seats last.</p>
            <ul>
              <li>Your niche, researched daily</li>
              <li>Ideas built around your voice</li>
              <li>Google Calendar planning & reminders</li>
              <li>Post insights and a weekly review</li>
              <li>Connected account insights on your paid plan</li>
              <li>Your content person, right in Telegram</li>
            </ul>
            <Trial where="pricing" text="Start my 7 days free" />
            <small>
              Card required. $19/month after your trial.
              <br />
              Cancel anytime. Delete everything in Settings by typing DELETE.
            </small>
          </div>
        </section>
        <section className="maya-faq container">
          <span className="chapter-divider" aria-hidden="true" />
          <div>
            <span className="maya-eyebrow">
              A FEW THINGS YOU MIGHT BE WONDERING
            </span>
            <h2>Good questions.</h2>
          </div>
          <div className="faq-list">
            {[
              [
                "So, what does Maya actually do?",
                "She gets to know your TikTok and Instagram content, researches your niche, suggests ideas in your voice, plans your week, and helps you understand your results. You make the content. She helps you keep going.",
              ],
              [
                "Where do I talk to her?",
                "In Telegram. Send her ideas, links, voice notes, screenshots, or a change of plan. She brings her ideas and check-ins to the same conversation. Maya is not currently available in Apple Messages or SMS.",
              ],
              [
                "Do I have to use the dashboard?",
                "Not for your everyday content work. Ask Maya for ideas, feedback, your plan, or your results right in Telegram. The dashboard is there when you want a bigger view. Setup, connecting accounts, and billing still use secure web pages.",
              ],
              [
                "What can she see when I connect my accounts?",
                "On your paid plan, connect TikTok or an Instagram Creator or Business account. Maya reads your available post metrics and compares them with your usual performance. Instagram can add reach, saves, follows, and Reels watch time where available. TikTok provides views, likes, comments, and shares. Those platforms share different information, and Maya keeps that distinction clear.",
              ],
              [
                "Can she see my TikTok watch time?",
                "Not through a connected account. Send a screenshot from TikTok Studio in Telegram and Maya can read the visible numbers with you. She won’t fill in metrics the platform hasn’t shared.",
              ],
              [
                "Will she create or post videos for me?",
                "You stay the creator. Maya helps with research, ideas, preparation, and planning. She doesn’t film, edit, or automatically publish your videos.",
              ],
              [
                "How does the free trial work?",
                "Try Maya for seven days with a card on file. The trial includes research, ideas, planning, and feedback using public post information and what you share with her. Social account connections open on your paid plan, after the trial. Then it’s $19 per month at the founding rate while founding seats last. You can cancel anytime.",
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="maya-footer container">
        <div>
          <Brand />
          <p>A little backup for your big ideas.</p>
        </div>
        <div>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© {new Date().getFullYear()} Maya</span>
        </div>
      </footer>
    </div>
  );
}
