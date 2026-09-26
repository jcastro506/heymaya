/**
 * The iPhone app's screens, drawn in HTML from the SwiftUI source (apps/ios/Maya: Palette,
 * MayaFont, HeroCard, PostTile, IdeaCard, StatTile, MayaBubble, the tab bar), so the landing
 * shows the app itself rather than an illustration of it. The creator is a sample: a runner
 * who posts on TikTok and Instagram. Every number on a screen is one the app would show for
 * that creator; nothing claims to be a real person's account.
 *
 * Static and server-rendered. The motion (messages arriving, the card swiping, bars growing)
 * is CSS, and stops under prefers-reduced-motion.
 */
import type { CSSProperties, ReactNode } from "react";

export function Flower({ className = "", size }: { className?: string; size?: number }) {
  return (
    <svg className={`flower ${className}`} viewBox="0 0 80 80" width={size} height={size} aria-hidden="true">
      <path d="M40 9C49-9 62 4 58 20C77 13 88 29 70 40C88 49 77 66 59 59C65 77 49 89 40 71C30 89 14 77 21 59C2 66-9 49 9 40C-9 30 3 14 21 21C14 3 30-9 40 9Z" fill="currentColor" />
      <circle cx="31" cy="36" r="3" fill="#29233F" />
      <circle cx="49" cy="36" r="3" fill="#29233F" />
      <path d="M31 47Q40 56 49 47" stroke="#29233F" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** An iPhone, flat and light: the frame, the island, the status bar. */
export function Phone({ children, className = "", label, dark = false }: { children: ReactNode; className?: string; label: string; dark?: boolean }) {
  return (
    <figure className={`ph ${className}`} role="img" aria-label={label}>
      <div className={`ph-screen${dark ? " ph-dark" : ""}`}>
        <div className="ph-status" aria-hidden="true">
          <span>9:41</span>
          <span className="ph-island" />
          <span className="ph-icons">
            <i className="ph-signal" />
            <i className="ph-wifi" />
            <i className="ph-battery" />
          </span>
        </div>
        {children}
      </div>
    </figure>
  );
}

/* ——— Covers: a post's first frame, in shapes (no stock photos, no real creator's work) ——— */

type CoverKind = "hill" | "dawn" | "kitchen" | "track" | "river" | "shoes";

export function Cover({ kind, overlay, className = "", style }: { kind: CoverKind; overlay?: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`cover cover-${kind} ${className}`} style={style} aria-hidden="true">
      <span className="cv-a" />
      <span className="cv-b" />
      <span className="cv-c" />
      {overlay ? <span className="cv-text">{overlay}</span> : null}
    </div>
  );
}

function Platform({ p }: { p: "tiktok" | "instagram" }) {
  return p === "tiktok" ? (
    <span className="plat plat-tt" aria-label="TikTok">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.3 7.3 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6Z" fill="currentColor" /></svg>
    </span>
  ) : (
    <span className="plat plat-ig" aria-label="Instagram">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" /></svg>
    </span>
  );
}

/* ——— The tab bar: Today · Ideas · Deals · You (app spec D2) ——— */

const TAB_ICONS: Record<string, ReactNode> = {
  Today: <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
  Ideas: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />,
  Deals: <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7Z" />,
  You: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" />,
};

function TabBar({ active }: { active: "Today" | "Ideas" | "Deals" | "You" }) {
  return (
    <div className="s-tabs" aria-hidden="true">
      {Object.keys(TAB_ICONS).map((t) => (
        <span key={t} className={t === active ? "on" : ""}>
          <svg viewBox="0 0 24 24">{TAB_ICONS[t]}</svg>
          {t}
        </span>
      ))}
    </div>
  );
}

/* ——— Messages: where she talks ——— */

export type Line = { from: "maya" | "me"; text: string; time?: string };

export function MessagesScreen({ lines, footer = "Delivered", animate = true }: { lines: Line[]; footer?: string; animate?: boolean }) {
  return (
    <div className={`msg${animate ? " msg-live" : ""}`}>
      <div className="msg-head">
        <span className="msg-back" aria-hidden="true">‹</span>
        <span className="msg-who">
          <span className="msg-avatar"><Flower /></span>
          <b>Maya ›</b>
        </span>
      </div>
      <div className="msg-thread">
        {lines.map((l, i) => (
          <div key={i} className="msg-row" style={{ "--i": i } as CSSProperties}>
            {l.time ? <span className="msg-time">{l.time}</span> : null}
            <p className={`bub ${l.from === "maya" ? "bub-in" : "bub-out"}`}>{l.text}</p>
          </div>
        ))}
        <span className="msg-read" style={{ "--i": lines.length } as CSSProperties}>{footer}</span>
      </div>
      <div className="msg-input" aria-hidden="true">
        <span className="msg-plus">+</span>
        <span className="msg-field">Text Message</span>
      </div>
    </div>
  );
}

/* ——— Today: the briefing (TodayView) ——— */

const WEEK = [
  { kind: "hill" as const, p: "tiktok" as const, views: "31.2K", multiple: "3.1×", day: "Tue", up: true },
  { kind: "track" as const, p: "instagram" as const, views: "12.4K", multiple: "1.6×", day: "Mon", up: true },
  { kind: "kitchen" as const, p: "tiktok" as const, views: "6.8K", multiple: "0.7×", day: "Sat", up: false },
  { kind: "river" as const, p: "instagram" as const, views: "9.1K", multiple: "1.1×", day: "Thu", up: false },
];

/** Views of the last posts against their normal (≈10K): the bars above it are filled. */
const BARS = [0.62, 0.9, 1.05, 0.7, 1.12, 0.68, 1.6, 3.1];

export function PostsBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="s-sec">
      <div className="s-sec-head">
        <span className="s-kicker">Your numbers</span>
        <span className="s-link">See all ›</span>
      </div>
      <div className="s-chart">
        {BARS.map((b, i) => (
          <i key={i} className={b >= 1 ? "up" : ""} style={{ "--h": Math.min(1, b / 3.1), "--i": i } as CSSProperties} />
        ))}
        <span className="s-normal" style={{ "--n": 1 / 3.1 } as CSSProperties} />
      </div>
      <div className="s-legend">
        <span><i className="up" />above your normal</span>
        <span><i />below</span>
        <span className="s-num">normal ≈ 10K</span>
      </div>
      <div className={`s-posts${compact ? " s-posts-compact" : ""}`}>
        {WEEK.map((w) => (
          <div key={w.day} className="s-post">
            <Cover kind={w.kind} />
            <Platform p={w.p} />
            <span className="s-post-meta">
              <em className={w.up ? "good" : ""}>{w.multiple}</em>
              <b>{w.views}</b>
              <small>{w.day}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TodayScreen() {
  return (
    <div className="app">
      <div className="app-scroll">
        <h3 className="app-title">Today</h3>
        <span className="s-kicker">Wednesday, October 7</span>
        <span className="s-pill"><Flower size={16} />She texted you an idea this morning</span>
        <div className="s-hero">
          <span className="s-kicker purple">Her latest idea</span>
          <div className="s-hero-row">
            <Cover kind="hill" className="s-hero-cover" />
            <div>
              <b className="s-hero-hook">“i can&apos;t do this” to “i love running” in one hill</b>
              <p>Says what every runner thinks. Your river loop has the hill.</p>
              <span className="s-link">Open the idea →</span>
            </div>
          </div>
        </div>
        <PostsBlock compact />
        <div className="s-sec">
          <span className="s-kicker">Coming up</span>
          <div className="s-up">
            <span className="s-date"><small>THU</small>8</span>
            <span className="s-up-text"><b>Film: the hill monologue</b><small>5:00 PM</small></span>
            <span className="chip ok">booked</span>
          </div>
          <div className="s-up">
            <span className="s-date"><small>SAT</small>10</span>
            <span className="s-up-text"><b>Long run, film the 5 a.m. alarm</b><small>6:30 AM</small></span>
            <span className="chip warn">waiting for you</span>
          </div>
        </div>
      </div>
      <TabBar active="Today" />
    </div>
  );
}

/* ——— Ideas: the swipe file (IdeasView / IdeaCard) ——— */

export function IdeasScreen() {
  return (
    <div className="app">
      <div className="app-scroll">
        <h3 className="app-title">Ideas</h3>
        <div className="s-seg" aria-hidden="true"><span className="on">New</span><span>Saved</span><span>Posted</span><span>Passed</span></div>
        <div className="s-stack">
          <div className="s-card s-card-3"><Cover kind="shoes" /></div>
          <div className="s-card s-card-2"><Cover kind="dawn" /></div>
          <div className="s-card s-card-1">
            <Cover kind="hill" overlay="running in queensland heat (it's 7am)" />
            <span className="s-chips"><span className="cchip new">new</span><span className="cchip coral">not your usual</span></span>
            <div className="s-card-body">
              <small>Inspired by a runner in your lane · 8.5× her normal</small>
              <b>“i can&apos;t do this” to “i love running” in one hill</b>
              <p>The monologue says what every runner actually thinks. 15 seconds, your own audio.</p>
            </div>
          </div>
        </div>
        <div className="s-actions" aria-hidden="true">
          <span className="ra ra-no">✕</span>
          <span className="ra ra-open">↗</span>
          <span className="ra ra-save">
            <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4Z" fill="currentColor" /></svg>
          </span>
        </div>
        <span className="s-togo">3 to go</span>
      </div>
      <TabBar active="Ideas" />
    </div>
  );
}

/* ——— Your numbers: TikTok and Instagram side by side (AnalyticsView) ——— */

export function NumbersScreen() {
  return (
    <div className="app">
      <div className="app-scroll">
        <h3 className="app-title">Your numbers</h3>
        <div className="s-accts">
          <div className="s-acct">
            <Platform p="tiktok" />
            <b>2,140</b>
            <small>followers</small>
            <em className="good">+96 in 30 days</em>
          </div>
          <div className="s-acct">
            <Platform p="instagram" />
            <b>8,050</b>
            <small>followers</small>
            <em className="good">+214 in 30 days</em>
          </div>
        </div>
        <PostsBlock compact />
        <div className="s-note">
          <Flower size={20} />
          <p>the hill one did 3.1× your normal. that’s the thing to do again.</p>
        </div>
      </div>
      <TabBar active="Today" />
    </div>
  );
}

/* ——— Her Sunday review (ReviewSheet) ——— */

export function ReviewScreen() {
  return (
    <div className="app app-sheet">
      <div className="sheet-grab" aria-hidden="true" />
      <div className="sheet-head"><span /><b>Her review</b><span className="s-link">Done</span></div>
      <div className="app-scroll">
        <span className="s-kicker">Sunday, October 11</span>
        <div className="mb">
          <Flower size={24} />
          <p>good week. you posted 3 of the 4 you planned, and the hill one did 3.1× your normal.</p>
        </div>
        <div className="mb">
          <Flower size={24} />
          <p>the recipe sat under your normal. not a verdict on cooking, people just came for the running.</p>
        </div>
        <div className="s-stats">
          <span><b>3 of 4</b><small>posted</small></span>
          <span><b>1.4×</b><small>vs your normal</small></span>
          <span><b>9.8K</b><small>lane median</small></span>
        </div>
        <span className="s-kicker">What she wants you to try</span>
        <ul className="s-try">
          <li><i className="held">✓</i>open on your face, not the view</li>
          <li><i>◌</i>one more hill, a different hill</li>
          <li><i>◌</i>post before 7 a.m., when yours are up</li>
        </ul>
      </div>
    </div>
  );
}

/* ——— Deals: the partnerships plan (OpportunitiesView / PipelineView). Sample brands, made up. ——— */

const DEALS = [
  { group: "Ready for you", brand: "Pacefern Hydration", type: "Sponsorship", fit: "Paid two runners you watch this month. Your hill posts are their exact audience.", note: "Pitch drafted · waiting for your OK" },
  { group: "Ready for you", brand: "Solebird Socks", type: "Gifting", fit: "Their creator program takes accounts your size. Application answers are ready.", note: "Application: answers ready to copy" },
  { group: "In progress", brand: "Loopline Running Club", type: "Ambassador", fit: "Replied yesterday: they'd like your rates and dates.", note: "They replied · 1 day ago" },
];

export function DealsScreen() {
  return (
    <div className="app">
      <div className="app-scroll">
        <h3 className="app-title">Deals</h3>
        <div className="s-kit">
          <b>Your media kit</b>
          <p>Followers, typical views and best posts, ready to paste into a pitch. Never your rates.</p>
          <span className="s-kit-row"><span className="s-kit-btn">Share</span><span className="s-link">hey-maya.ai/k/sam</span></span>
        </div>
        {["Ready for you", "In progress"].map((g) => (
          <div key={g} className="s-sec">
            <span className="s-kicker">{g}</span>
            {DEALS.filter((d) => d.group === g).map((d) => (
              <div key={d.brand} className="s-deal">
                <span className="s-deal-head"><b>{d.brand}</b><span className="chip purple">{d.type}</span></span>
                <p>{d.fit}</p>
                <small>{d.note}</small>
              </div>
            ))}
          </div>
        ))}
      </div>
      <TabBar active="Deals" />
    </div>
  );
}
