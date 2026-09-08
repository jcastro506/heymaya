"use client";

/**
 * The front door (2026-09-08). White ground, black type, one colour that is hers, and the
 * choreography the best product pages use: two pinned stages scrubbed by scroll (the hero
 * conversation, then her day), a phone with real depth, and every other section arriving
 * as you reach it. GSAP ScrollTrigger + Lenis, CSS 3D, no WebGL. Reduced motion renders
 * the page at rest.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CtaLink } from "../cta";
import { Phone } from "./Phone";
import { useScrollStage } from "./scroll";
import "./landing.css";

type Line = { who: "maya" | "you" | "ts" | "chips"; text?: string; chips?: string[] };

const HERO: Line[] = [
  { who: "ts", text: "8:41 am" },
  { who: "maya", text: "morning! you've got the london night walk at 5 today. prep: same handheld, let the street talk, caption lands late. 45 minutes tops." },
  { who: "you", text: "wait which one was that" },
  { who: "maya", text: "the piccadilly one that did 9× your normal. the sequel, basically 😭" },
  { who: "you", text: "ok yeah. moving it to 6 though" },
  { who: "maya", text: "6 it is. i'll nudge you at 5:45." },
  { who: "chips", chips: ["shot list", "push it"] },
];

const OPINION: Line[] = [
  { who: "you", text: "thinking of a day-in-the-life vlog, thoughts? https://tiktok.com/…" },
  { who: "maya", text: "the walking bit with the earbud mic is the part that works, keep that. it'll sit around your normal, not blow up: your quick running clips are what pull strangers in. do it, but anchor it on something specific and unglamorous. solid, not strong." },
  { who: "chips", chips: ["put it on the calendar", "not this week"] },
  { who: "you", text: "also remember that clip of the dog barking at the tv?" },
  { who: "maya", text: "february, \"I have no words\", 9× your normal. you filmed the dog before you filmed yourself, which is a whole format if you want it." },
];

const DAY: Array<{ t: string; title: string; sub: string; screen: Line[] }> = [
  { t: "6:00", title: "Your niche, checked", sub: "The accounts you admire, sampled while you sleep.", screen: [{ who: "ts", text: "overnight" }, { who: "maya", text: "@brettconti did 4.6× his normal on a \"do i regret it\" cut. holding it for the morning." }] },
  { t: "8:40", title: "Your morning", sub: "A line if there's something on today.", screen: [{ who: "ts", text: "8:40 am" }, { who: "maya", text: "you've got a film block at 5. prep: same handheld, let the street talk. 45 minutes tops." }] },
  { t: "2:06", title: "An idea, with a reason", sub: "Only when it clears the bar.", screen: [{ who: "ts", text: "2:06 pm" }, { who: "maya", text: "brett conti's halfway-through-the-year cut is at 4.6× his normal. your version: \"months into walking central london. do i regret it yet?\" today at 5 because this one goes stale." }, { who: "chips", chips: ["shot list", "not me", "save"] }] },
  { t: "4:45", title: "The check-in", sub: "Fifteen minutes before you film.", screen: [{ who: "ts", text: "4:45 pm" }, { who: "maya", text: "5 o'clock still on?" }, { who: "chips", chips: ["yes", "push it", "skip"] }] },
  { t: "Sun", title: "The week, honestly", sub: "What you liked versus what worked. Then next week.", screen: [{ who: "ts", text: "sunday 9:12 am" }, { who: "maya", text: "three posts, median 1.8× your normal. the tier list you saved did 3.1×; the vlog you loved sat at 0.9. results beat taste and you should know that. next week's below." }] },
];

function Bubbles({ lines, cls = "" }: { lines: Line[]; cls?: string }) {
  return (
    <>
      {lines.map((l, i) =>
        l.who === "ts" ? <div key={i} className={`ts ${cls}`}>{l.text}</div>
        : l.who === "chips" ? <div key={i} className={`chips in ${cls}`}>{l.chips?.map((c) => <span key={c} className="chip">{c}</span>)}</div>
        : <div key={i} className={`bubble in ${l.who} ${cls}`}>{l.text}</div>,
      )}
    </>
  );
}

/** A conversation that arrives on its own once on screen (used where the scroll is not pinned). */
function Conversation({ lines, delay = 800 }: { lines: Line[]; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { const t = window.setTimeout(() => setShown(lines.length), 0); return () => clearTimeout(t); }
    let timers: number[] = [];
    const start = () => {
      let i = 0;
      const step = () => {
        if (i >= lines.length) { setTyping(false); return; }
        if (lines[i].who === "maya") { setTyping(true); timers.push(window.setTimeout(() => { setTyping(false); setShown(i + 1); i++; timers.push(window.setTimeout(step, delay)); }, 900)); }
        else { setShown(i + 1); i++; timers.push(window.setTimeout(step, delay)); }
      };
      step();
    };
    const io = new IntersectionObserver((en) => { if (en[0]?.isIntersecting) { start(); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); timers.forEach(clearTimeout); timers = []; };
  }, [lines, delay]);
  return (
    <div ref={ref} style={{ display: "contents" }}>
      <div className="top"><span>Maya</span><span>today</span></div>
      <Bubbles lines={lines.slice(0, shown)} />
      {typing && <div className="typing" aria-label="Maya is typing"><i /><i /><i /></div>}
    </div>
  );
}

export default function Landing() {
  const build = useCallback(({ gsap, ScrollTrigger }: Parameters<Parameters<typeof useScrollStage>[0]>[0]) => {
    // Everything marked data-rv arrives as you reach it.
    gsap.set(".ld [data-rv]", { opacity: 0, y: 22 });
    ScrollTrigger.batch(".ld [data-rv]", { start: "top 88%", onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.8, stagger: 0.12, ease: "power3.out", overwrite: true }) });

    // Stage 1: the hero. Pinned. The phone starts turned toward you and large; as you scroll, the
    // bubbles arrive one by one and the phone settles into place while the headline resolves.
    const hero = gsap.timeline({ scrollTrigger: { trigger: "#hero", start: "top top", end: "+=180%", scrub: 0.6, pin: true, anticipatePin: 1 } });
    hero.fromTo("#hero .p3-body", { rotateY: -22, rotateX: 6, scale: 1.06, y: 40 }, { rotateY: 0, rotateX: 0, scale: 1, y: 0, ease: "none", duration: 1 }, 0);
    // The page shows at rest: the headline and the first two bubbles are visible at scroll zero;
    // the rest of the conversation arrives as you scroll, and the copy never hides.
    hero.from("#hero .hb:nth-child(n+4)", { opacity: 0, y: 14, stagger: 0.18, ease: "none", duration: 1 }, 0.05);

    // Stage 2: her day. Pinned. Scroll progress picks the stop; the phone's screen swaps with it.
    const stops = gsap.utils.toArray<HTMLElement>("#day .stop");
    const shots = gsap.utils.toArray<HTMLElement>("#day .shot");
    const setStop = (i: number) => { stops.forEach((s, k) => s.classList.toggle("on", k === i)); shots.forEach((s, k) => s.classList.toggle("on", k === i)); };
    setStop(0);
    ScrollTrigger.create({ trigger: "#day", start: "top top", end: `+=${stops.length * 70}%`, pin: true, scrub: true, onUpdate: (self) => setStop(Math.min(stops.length - 1, Math.floor(self.progress * stops.length))) });
    gsap.fromTo("#day .p3-body", { rotateY: 14 }, { rotateY: -6, ease: "none", scrollTrigger: { trigger: "#day", start: "top top", end: `+=${stops.length * 70}%`, scrub: true } });

    // Meters, the calendar, the person card and the roster fill as they arrive.
    gsap.utils.toArray<HTMLElement>(".ld .bar i").forEach((el) => gsap.fromTo(el, { width: 0 }, { width: el.dataset.w ?? "60%", duration: 1.3, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%" } }));
    gsap.utils.toArray<HTMLElement>(".ld .gcal .ev.mine").forEach((el, i) => gsap.fromTo(el, { opacity: 0, scaleY: 0.5, transformOrigin: "top" }, { opacity: 1, scaleY: 1, duration: 0.5, delay: i * 0.18, ease: "back.out(1.6)", scrollTrigger: { trigger: ".ld .gcal", start: "top 80%" } }));
    gsap.utils.toArray<HTMLElement>(".ld .kv dd").forEach((el, i) => gsap.fromTo(el, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.5, delay: i * 0.22, scrollTrigger: { trigger: ".ld .kv", start: "top 85%" } }));
    gsap.utils.toArray<HTMLElement>(".ld .acct").forEach((el, i) => gsap.fromTo(el, { opacity: 0, y: 14, rotateX: -30 }, { opacity: 1, y: 0, rotateX: 0, duration: 0.6, delay: i * 0.1, ease: "power3.out", scrollTrigger: { trigger: ".ld .roster", start: "top 85%" } }));
    return () => ScrollTrigger.getAll().forEach((t) => t.kill());
  }, []);
  useScrollStage(build);

  return (
    <div className="ld">
      <div className="wrap">
        <nav>
          <Link className="brand" href="/">Maya</Link>
          <div className="links"><Link href="/sign-in">Sign in</Link><CtaLink className="btn" href="/sign-up" where="nav">Start the trial</CtaLink></div>
        </nav>
      </div>

      <section className="stage hero-stage" id="hero">
        <div className="wrap grid g2 wide">
          <div className="stack hero-copy">
            <span className="eyebrow">A content person for TikTok and Instagram</span>
            <h1>She scrolls so you don&apos;t have to.</h1>
            <p className="lede">She lives in your texts. Every day she scrolls your lane, keeps your week on the calendar, and tells you the truth.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <CtaLink className="btn" href="/sign-up" where="hero">Start the 7-day trial</CtaLink>
              <span className="fine">$19 a month while founding seats last.</span>
            </div>
          </div>
          <div className="hero-phone">
            <Phone>
              <div className="top"><span>Maya</span><span>today</span></div>
              <Bubbles lines={HERO} cls="hb" />
            </Phone>
          </div>
        </div>
      </section>

      <section className="stage day-stage" id="day">
        <div className="wrap">
          <div className="stack">
            <span className="eyebrow">Every day</span>
            <h2>She works every day. She texts when it matters.</h2>
            <p className="lede">Scroll through one.</p>
            <div className="stops">
              {DAY.map((d) => <div className="stop" key={d.t}><time>{d.t}</time><div><b>{d.title}</b><span>{d.sub}</span></div></div>)}
            </div>
          </div>
          <Phone>
            <div className="screens">
              {DAY.map((d) => <div className="shot" key={d.t}><div className="top"><span>Maya</span><span>{d.t === "Sun" ? "sunday" : "today"}</span></div><Bubbles lines={d.screen} /></div>)}
            </div>
          </Phone>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack">
            <span className="eyebrow" data-rv>Your niche</span>
            <h2 data-rv>She follows your niche like it&apos;s her job.</h2>
            <p className="lede" data-rv>The accounts you admire, the ones she finds on her own, the sounds and formats moving this week. You hear about it when it matters, not every hour.</p>
          </div>
          <div className="stack" data-rv>
            <div className="roster">
              <span className="acct"><i /><b>@brettconti</b><span className="num hot">4.6×</span></span>
              <span className="acct"><i /><b>@aliabdaal</b><span className="num hot">1.9×</span></span>
              <span className="acct"><i /><b>@drewbinsky</b><span className="num">quiet</span></span>
              <span className="acct"><i /><b>@starterstory</b><span className="num">1.1×</span></span>
              <span className="acct"><i /><b>@becca_foggia</b><span className="num">new</span></span>
            </div>
            <div className="card stack">
              <div className="bubble maya in" style={{ maxWidth: "100%" }}>@becca_foggia keeps coming up in your lane: 4 posts on 4 different days, median 14k. want me to watch her?</div>
              <div className="chips in"><span className="chip" style={{ color: "var(--ink)", borderColor: "var(--line)" }}>watch her</span><span className="chip" style={{ color: "var(--ink)", borderColor: "var(--line)" }}>no thanks</span></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2 flip">
          <div className="stack">
            <span className="eyebrow" data-rv>Ideas</span>
            <h2 data-rv>Ideas with receipts.</h2>
            <p className="lede" data-rv>A specific post, a specific number, and your version in your voice, with a time to make it.</p>
          </div>
          <div className="card stack" data-rv>
            <div className="eyebrow">@brettconti · 9 hours ago</div>
            <div className="big">4.6×<small>his normal</small></div>
            <div className="bar"><i data-w="78%" /></div>
            <p>&quot;halfway through the year and asking do i regret it. everyone sticks around to see if the big leap was a mistake.&quot;</p>
            <div className="soft" style={{ padding: 14 }}><p style={{ fontSize: ".95rem" }}><b>your version:</b> the same shape over your london footage. &quot;months into walking central london. do i regret it yet?&quot; 20 seconds, original audio, today at 5 because this one goes stale.</p></div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack">
            <span className="eyebrow" data-rv>Your posts</span>
            <h2 data-rv>She watched. Not skimmed.</h2>
            <p className="lede" data-rv>Every post you&apos;ve made, the way a person would: how you shoot, how you talk, what&apos;s funny about you.</p>
          </div>
          <div className="card stack" data-rv>
            <div className="frame"><div className="cap">&quot;why is piccadilly circle so naturally cool?&quot; · 9× your normal</div></div>
            <dl className="kv">
              <dt>look</dt><dd>behind the camera, handheld, a phone over bedding at home</dd>
              <dt>voice</dt><dd>no speech yet: the caption does the talking</dd>
              <dt>humour</dt><dd>dry, at your own expense, post-workout exhaustion</dd>
              <dt>world</dt><dd>london at night, the thames, a fluffy dog on the sofa</dd>
              <dt>a friend would notice</dt><dd>you film the dog before you film yourself</dd>
            </dl>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2 flip">
          <div className="stack">
            <span className="eyebrow" data-rv>Your numbers</span>
            <h2 data-rv>Your numbers, in plain words.</h2>
            <p className="lede" data-rv>Connect your accounts and she sees reach, impressions, watch time and follows. Then she tells you why a post did what it did.</p>
          </div>
          <div className="card stack" data-rv>
            <div className="eyebrow">the tier list · tuesday</div>
            <div className="meter"><span className="lab">reached</span><div className="bar"><i data-w="34%" /></div><span className="val">1,240</span></div>
            <div className="meter"><span className="lab">your normal</span><div className="bar"><i data-w="88%" /></div><span className="val">3,600</span></div>
            <div className="meter"><span className="lab">watched</span><div className="bar"><i data-w="71%" /></div><span className="val">71%</span></div>
            <div className="meter"><span className="lab">followed</span><div className="bar"><i data-w="12%" /></div><span className="val">+9</span></div>
            <div className="verdict">the platform barely showed it, and the people it reached watched most of it. the post isn&apos;t the problem yet. the first three seconds and the posting time are the levers.</div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap stack" style={{ gap: 28 }}>
          <div className="stack">
            <span className="eyebrow" data-rv>Your week</span>
            <h2 data-rv>On your Google Calendar, or it doesn&apos;t happen.</h2>
            <p className="lede" data-rv>The week from your own numbers, booked in one tap. A prep note, a check-in, a nudge to post. Move anything by texting her.</p>
          </div>
          <div className="gcal" data-rv>
            <div className="head"><div /><div>Mon<b>8</b></div><div>Tue<b>9</b></div><div>Wed<b>10</b></div><div>Thu<b>11</b></div><div>Fri<b>12</b></div></div>
            <div className="body">
              <div className="hours"><div>3 pm</div><div>4 pm</div><div>5 pm</div><div>6 pm</div><div>7 pm</div><div>8 pm</div></div>
              <div className="col"><div className="ev theirs" style={{ top: 44, height: 40 }}>Dentist</div></div>
              <div className="col"><div className="ev film mine" style={{ top: 88, height: 40 }}>film · the tier list</div><div className="ev edit mine" style={{ top: 132, height: 40 }}>edit</div><div className="ev post mine" style={{ top: 220, height: 30 }}>post</div></div>
              <div className="col"><div className="ev theirs" style={{ top: 0, height: 84 }}>Standup</div></div>
              <div className="col"><div className="ev film mine" style={{ top: 132, height: 40 }}>film · do i regret it</div><div className="ev post mine" style={{ top: 220, height: 30 }}>post</div></div>
              <div className="col"><div className="ev theirs" style={{ top: 176, height: 60 }}>Drinks w/ Sam</div></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2 flip">
          <div className="stack">
            <span className="eyebrow" data-rv>Anything</span>
            <h2 data-rv>Ask her anything. She remembers all of it.</h2>
            <p className="lede" data-rv>Drafts, links, half-thoughts. The dog video from February.</p>
          </div>
          <div data-rv><Phone><Conversation lines={OPINION} delay={1000} /></Phone></div>
        </div>
      </section>

      <section>
        <div className="wrap grid g2">
          <div className="stack">
            <span className="eyebrow" data-rv>The price</span>
            <h2 data-rv>$19 a month while founding seats last.</h2>
            <p className="lede" data-rv>Seven days free, card on file, cancel in one tap. Delete everything, ever, by typing DELETE.</p>
            <div data-rv><CtaLink className="btn" href="/sign-up" where="pricing">Start the 7-day trial</CtaLink></div>
          </div>
          <div data-rv>
            <Phone>
              <div className="top"><span>Maya</span><span>just now</span></div>
              <div className="bubble maya in">hey! i&apos;m maya, your content person now. every day i&apos;ll scroll for you: what&apos;s actually working in your lane, what&apos;s blowing up in general, who&apos;s doing something worth stealing.</div>
              <div className="bubble maya in">i&apos;m going through your posts and the accounts you picked right now. give me about ten minutes and i&apos;ll tell you what i see. what should i call you, by the way?</div>
            </Phone>
          </div>
        </div>
      </section>

      <div className="wrap"><footer><span>Maya</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><span>TikTok · Instagram · Telegram · Google Calendar</span></footer></div>
    </div>
  );
}
