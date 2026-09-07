"use client";

/**
 * The front door (2026-09-07). White ground, black type, one colour that is hers. Every
 * section is the thing she does, shown as a working piece of UI rather than described,
 * revealed on scroll. No animation library: an IntersectionObserver adds `in`, CSS does
 * the rest, and reduced-motion turns all of it off.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CtaLink } from "../cta";
import "./landing.css";

/** Adds `in` to every .rv the first time it enters the viewport. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".ld .rv"));
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.15 });
    // The first viewport shows at rest, never parked at opacity 0 waiting on an observer.
    const vh = window.innerHeight || 800;
    els.forEach((e) => { if (e.getBoundingClientRect().top < vh * 0.95) e.classList.add("in"); else io.observe(e); });
    return () => io.disconnect();
  }, []);
}

/** A conversation that arrives one bubble at a time, once it is on screen. */
function Conversation({ lines, delay = 650 }: { lines: Array<{ who: "maya" | "you" | "ts" | "chips"; text?: string; chips?: string[] }>; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { const t = window.setTimeout(() => setShown(lines.length), 0); return () => clearTimeout(t); }
    let timers: number[] = [];
    const start = () => {
      let i = 0;
      const step = () => {
        if (i >= lines.length) { setTyping(false); return; }
        const next = lines[i];
        if (next.who === "maya") {
          setTyping(true);
          timers.push(window.setTimeout(() => { setTyping(false); setShown(i + 1); i++; timers.push(window.setTimeout(step, delay)); }, 900));
        } else { setShown(i + 1); i++; timers.push(window.setTimeout(step, delay)); }
      };
      step();
    };
    const io = new IntersectionObserver((en) => { if (en[0]?.isIntersecting) { start(); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); timers = []; };
  }, [lines, delay]);
  return (
    <div ref={ref} className="screen" aria-live="polite">
      <div className="top"><span>Maya</span><span>today</span></div>
      {lines.slice(0, shown).map((l, i) =>
        l.who === "ts" ? <div key={i} className="ts">{l.text}</div>
        : l.who === "chips" ? <div key={i} className="chips in">{l.chips?.map((c) => <span key={c} className="chip">{c}</span>)}</div>
        : <div key={i} className={`bubble in ${l.who}`}>{l.text}</div>,
      )}
      {typing && <div className="typing" aria-label="Maya is typing"><i /><i /><i /></div>}
    </div>
  );
}

/** A number that counts up to its value once revealed. */
function CountUp({ to, suffix = "", decimals = 1 }: { to: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { const t = window.setTimeout(() => setV(to), 0); return () => clearTimeout(t); }
    const io = new IntersectionObserver((en) => {
      if (!en[0]?.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now(); const dur = 1400;
      const tick = (t: number) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); setV(to * e); if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref} className="num">{v.toFixed(decimals)}{suffix}</span>;
}

const HERO = [
  { who: "ts" as const, text: "8:41 am" },
  { who: "maya" as const, text: "morning! you've got the london night walk at 5 today. prep: same handheld, let the street talk, caption lands late. 45 minutes tops." },
  { who: "you" as const, text: "wait which one was that" },
  { who: "maya" as const, text: "the piccadilly one that did 9× your normal. the sequel, basically 😭" },
  { who: "you" as const, text: "ok yeah. moving it to 6 though" },
  { who: "maya" as const, text: "6 it is. i'll nudge you at 5:45." },
  { who: "chips" as const, chips: ["shot list", "push it"] },
];

const OPINION = [
  { who: "you" as const, text: "thinking of a day-in-the-life vlog, thoughts? https://tiktok.com/…" },
  { who: "maya" as const, text: "the walking bit with the earbud mic is the part that works, keep that. it'll sit around your normal, not blow up: your quick running clips are what pull strangers in. do it, but anchor it on something specific and unglamorous. solid, not strong." },
  { who: "chips" as const, chips: ["put it on the calendar", "not this week"] },
];

export default function Landing() {
  useReveal();
  return (
    <div className="ld">
      <div className="wrap">
        <nav>
          <Link className="brand" href="/">Maya</Link>
          <div className="links"><Link href="/sign-in">Sign in</Link><CtaLink className="btn" href="/sign-up" where="nav">Start the trial</CtaLink></div>
        </nav>
      </div>

      <section className="hero">
        <div className="wrap grid g2 wide">
          <div className="stack">
            <span className="eyebrow rv">A content person for TikTok and Instagram creators</span>
            <h1 className="rv d1">She scrolls so you don&apos;t have to.</h1>
            <p className="lede rv d2">Every day Maya scrolls your lane and the accounts you wish you were, texts you when something&apos;s actually worth stealing, keeps your week on the calendar, and gives you a straight opinion on anything you send her. She gets sharper the longer she knows you.</p>
            <div className="rv d3" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <CtaLink className="btn" href="/sign-up" where="hero">Start the 7-day trial</CtaLink>
              <span className="fine">$19 a month while founding seats last. Card on file, first charge on day seven, cancel in one tap.</span>
            </div>
          </div>
          <div className="phone rv d2"><Conversation lines={HERO} /></div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack">
            <span className="eyebrow rv">Every day, before you&apos;re up</span>
            <h2 className="rv d1">She scrolls your lane and the accounts you admire, and texts you only when something&apos;s worth stealing.</h2>
            <p className="lede rv d2">Not &quot;trending.&quot; A specific post, from an account you named, doing a multiple of its own normal, and the version of it that&apos;s yours to make. If nothing clears that bar, you hear nothing.</p>
          </div>
          <div className="card rv d2 stack">
            <div className="eyebrow">@brettconti · 9 hours ago</div>
            <div className="big"><CountUp to={4.6} suffix="×" /><small>his normal</small></div>
            <div className="bar"><i style={{ "--w": "78%" } as React.CSSProperties} /></div>
            <p>&quot;halfway through the year and asking do i regret it. everyone sticks around to see if the big leap was a mistake.&quot;</p>
            <div className="soft" style={{ padding: 14 }}>
              <p style={{ fontSize: ".95rem" }}><b>your version:</b> the same shape over your london footage. &quot;months into walking central london. do i regret it yet?&quot; 20 seconds, original audio, today at 5 because this one goes stale.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2 flip">
          <div className="stack">
            <span className="eyebrow rv">She actually watched your posts</span>
            <h2 className="rv d1">Not the caption. The video.</h2>
            <p className="lede rv d2">Before she says a word she watches your posts the way a person does: how you shoot, how you talk, what kind of funny you are, your room, your dog. Then every new one you post. That&apos;s why her ideas sound like you and not like a template.</p>
          </div>
          <div className="card rv d2 stack">
            <div className="frame"><div className="cap">&quot;why is piccadilly circle so naturally cool?&quot; · 9× your normal</div></div>
            <dl className="kv">
              <dt>look</dt><dd>behind the camera, handheld, a phone over bedding when you&apos;re at home</dd>
              <dt>voice</dt><dd>no speech yet: the caption does the talking</dd>
              <dt>humour</dt><dd>dry, at your own expense, post-workout exhaustion</dd>
              <dt>world</dt><dd>london at night, the thames, a fluffy dog on the sofa</dd>
              <dt>a friend would notice</dt><dd>you film the dog before you film yourself</dd>
            </dl>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack">
            <span className="eyebrow rv">Send her anything</span>
            <h2 className="rv d1">A draft, a link, a half-thought. A straight opinion back.</h2>
            <p className="lede rv d2">She reads it against your own best posts and says what will work, what won&apos;t, and how sure she is. Her calls go on the record, and she keeps score on herself.</p>
          </div>
          <div className="phone rv d2"><Conversation lines={OPINION} delay={900} /></div>
        </div>
      </section>

      <section>
        <div className="wrap stack" style={{ gap: 28 }}>
          <div className="stack">
            <span className="eyebrow rv">Your week, on the calendar</span>
            <h2 className="rv d1">Anything you agree to make gets a time. Nothing slips.</h2>
            <p className="lede rv d2">She lays out the week from your own numbers, books it in one tap, and then shows up: a prep note in the morning, a check-in fifteen minutes before, a nudge to post once you&apos;ve filmed. Move anything by telling her.</p>
          </div>
          <div className="card rv d2 stack" style={{ gap: 22 }}>
            <div className="week">
              {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d, i) => (
                <div className="day" key={d}><b>{d}</b>
                  {i === 1 && <><span className="block film b1">5:00 film · the tier list</span><span className="block edit b2">6:00 edit</span><span className="block post b3">8:00 post</span></>}
                  {i === 3 && <><span className="block film b4">6:00 film · do i regret it</span></>}
                  {i === 6 && <span className="block edit b4">the week, honestly</span>}
                </div>
              ))}
            </div>
            <div className="timeline">
              <div className="tl"><time>8:40</time><div>prep: the hook, the shot list, the one thing to grab before you wrap.</div></div>
              <div className="tl"><time>4:45</time><div>fifteen minutes out: yes, push it, or skip.</div></div>
              <div className="tl"><time>7:50</time><div>you filmed, so: post now, caption in your words.</div></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2 flip">
          <div className="stack">
            <span className="eyebrow rv">She remembers</span>
            <h2 className="rv d1">Ask about the dog video from February. She knows the one.</h2>
            <p className="lede rv d2">Every post you&apos;ve made, every idea she sent, everything you told her, by meaning rather than by caption. She brings things up the way a friend does: the idea you saved and never filmed, the win from three weeks ago, the thing you said about October.</p>
          </div>
          <div className="card rv d2 stack">
            <div className="search"><span>the dog barking at the tv</span><span className="caret" /></div>
            <div className="hit">
              <div className="thumb" />
              <div>
                <div style={{ fontWeight: 600 }}>&quot;I have no words&quot; · Feb</div>
                <div className="fine">uncut handheld clip of the dog reacting to the TV · 8.99× your normal · a friend would notice: you film the dog before you film yourself</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack">
            <span className="eyebrow rv">Sunday, honestly</span>
            <h2 className="rv d1">What you liked versus what actually worked.</h2>
            <p className="lede rv d2">Once a week she tells you the truth about the week in a text, not a chart: the one thing that explains it, which of her ideas you took, which of your posts performed, and whether they agree. Then next week, laid out.</p>
          </div>
          <div className="card rv d2 vs">
            <div className="col"><h3>you liked</h3><div className="row"><span>the tier list</span><span className="num">saved</span></div><div className="row"><span>day in the life</span><span className="num">hearted</span></div><div className="row"><span>do i regret it</span><span className="num">passed</span></div></div>
            <div className="col"><h3>what worked</h3><div className="row"><span>the tier list</span><span className="num good">3.1×</span></div><div className="row"><span>night walk, thames</span><span className="num good">2.4×</span></div><div className="row"><span>day in the life</span><span className="num">0.9×</span></div></div>
          </div>
        </div>
      </section>

      <section className="quiet">
        <div className="wrap stack" style={{ alignItems: "center" }}>
          <span className="eyebrow rv">Most days</span>
          <h2 className="rv d1">Nothing.</h2>
          <p className="lede rv d2" style={{ textAlign: "center" }}>She only texts when it&apos;s worth your time. Three a day at most, never in your quiet hours, never two questions at once. A quiet day means your lane was quiet, not that she was.</p>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack price">
            <span className="eyebrow rv">The price</span>
            <h2 className="rv d1">$19 a month while founding seats last.</h2>
            <p className="lede rv d2">Seven days free with a card on file, charged on day seven, cancel in one tap in Settings. Delete everything, ever, by typing DELETE. She reads your public posts and the accounts you connect, nothing else.</p>
            <CtaLink className="btn rv d3" href="/sign-up" where="pricing">Start the 7-day trial</CtaLink>
          </div>
          <div className="phone rv d2">
            <div className="screen">
              <div className="top"><span>Maya</span><span>just now</span></div>
              <div className="bubble maya in">hey! i&apos;m maya, your content person now. every day i&apos;ll scroll for you: what&apos;s actually working in your lane, what&apos;s blowing up in general, who&apos;s doing something worth stealing.</div>
              <div className="bubble maya in">i&apos;m going through your posts and the accounts you picked right now. give me about ten minutes and i&apos;ll tell you what i see. what should i call you, by the way?</div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap"><footer><span>Maya</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><span>TikTok · Instagram · Telegram</span></footer></div>
    </div>
  );
}
