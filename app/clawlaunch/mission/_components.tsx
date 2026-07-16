"use client";

/**
 * Shared UI primitives for Mission Control — the v3.1 board system.
 * Locked-dark surface, mono micro-caps, one sky accent, channel dot chips,
 * tabular numerals on every figure. Numbers and shapes lead; captions are
 * one line. All motion is reduced-motion safe (mission.css).
 */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

/** Staggered rise-in wrapper. `i` is the stagger index (50ms steps). */
export function Rise({
  i = 0,
  children,
  className = "",
}: {
  i?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mc-rise ${className}`} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

/** Page shell: board apphead — crumb, title, right-hand `when` slot. */
export function Shell({
  title,
  subtitle,
  status,
  when,
  children,
}: {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  when?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-32 pt-6 sm:px-6 lg:pb-10">
      <header className="mc-rise mc-apphead">
        <div>
          <div className="mc-crumb">Mission Control</div>
          <h1>{title}</h1>
          {status ? (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-paper-dim">
              {status}
            </div>
          ) : null}
          {subtitle ? (
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-paper-dim">
              {subtitle}
            </p>
          ) : null}
        </div>
        {when ? <div className="mc-when">{when}</div> : null}
      </header>
      {children}
    </div>
  );
}

/** A titled section with a hairline rule and optional count (settings). */
export function Section({
  title,
  count,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      <div className="mb-3 flex items-baseline gap-3 border-b border-[var(--mc-line-soft)] pb-2">
        <h2 className="mc-h3 !mb-0">{title}</h2>
        {count !== undefined ? (
          <span className="mc-mono mc-num text-[11px] text-paper-faint">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A content card — the board card language. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mc-card ${className}`}>{children}</div>;
}

/** Board panel: card with the mono micro-caps title, optional live badge,
 *  optional raised gradient. Everything on the four tabs composes this. */
export function Panel({
  title,
  live = false,
  raised = false,
  className = "",
  children,
}: {
  title: string;
  live?: boolean;
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`mc-panel ${raised ? "mc-raised" : ""} ${className}`}>
      <h3 className="mc-h3">
        {title}
        {live ? <span className="mc-live">live</span> : null}
      </h3>
      {children}
    </div>
  );
}

const PILL_TONE: Record<string, string> = {
  lime: "bg-lime/12 text-lime-soft ring-1 ring-inset ring-lime/25",
  paper: "bg-paper/8 text-paper-dim ring-1 ring-inset ring-paper/10",
  rose: "bg-rose/10 text-rose ring-1 ring-inset ring-rose/25",
};

/** A small status/label pill. */
export function Pill({
  children,
  tone = "paper",
}: {
  children: ReactNode;
  tone?: "lime" | "paper" | "rose";
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${PILL_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/* ── Channels ──────────────────────────────────────────────────────────── */

/** Board channel colors (CVD-validated) — exact. */
const CHANNEL_COLOR: Record<string, string> = {
  reddit: "var(--mc-reddit)",
  x: "var(--mc-xchan)",
  linkedin: "var(--mc-chan3)",
};

export function channelColor(platform: string | null | undefined): string {
  return (platform && CHANNEL_COLOR[platform]) || "var(--mc-accent)";
}

export function channelLabel(p: string): string {
  return p === "x"
    ? "X"
    : p === "hn"
      ? "Hacker News"
      : p.charAt(0).toUpperCase() + p.slice(1);
}

/** Channel chip — colored dot + label. */
export function Chip({
  platform,
  children,
  className = "",
}: {
  platform?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`mc-chip ${className}`}>
      <span className="mc-dot" style={{ background: channelColor(platform) }} />
      {children}
    </span>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

/** Board button. */
export function Btn({
  children,
  onClick,
  tone = "default",
  disabled = false,
  busy = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "ghost" | "default";
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const cls =
    tone === "primary" ? "mc-btn-primary" : tone === "ghost" ? "mc-btn-ghost" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`mc-btn ${cls} ${className}`}
    >
      {busy ? (
        <span className="mr-1.5 inline-block size-3 animate-spin rounded-full border border-current border-t-transparent align-[-1px] motion-reduce:animate-none" />
      ) : null}
      {children}
    </button>
  );
}

/** Legacy action button (settings still uses it). */
export function ActionButton({
  children,
  onClick,
  tone = "primary",
  disabled = false,
  busy = false,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "primary" | "quiet" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const cls =
    tone === "primary"
      ? "bg-paper text-ink hover:opacity-85"
      : tone === "danger"
        ? "border border-rose/40 text-rose hover:bg-rose/10"
        : "border border-paper-faint/25 text-paper-dim hover:border-paper-faint/50 hover:text-paper";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {busy ? (
        <span className="inline-block size-3 animate-spin rounded-full border border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}

/* ── Data marks ────────────────────────────────────────────────────────── */

/** Tiny trend polyline. Renders nothing without ≥2 points. */
export function Sparkline({
  points,
  width = 120,
  height = 30,
  stroke = "#2E5F80",
  endDot = false,
  label,
}: {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
  endDot?: boolean;
  label?: string;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const pad = 4;
  const step = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const coords = points.map((v, i) => [pad + i * step, y(v)] as const);
  const pts = coords.map(([px, py]) => `${px},${Math.round(py * 10) / 10}`).join(" ");
  const last = coords[coords.length - 1];
  return (
    <svg
      className="mc-spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {endDot ? <circle cx={last[0]} cy={last[1]} r="3.5" fill={stroke} /> : null}
    </svg>
  );
}

/** One big editorial number with a tracked label (settings/legacy). */
export function BigStat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`text-3xl font-extrabold leading-none tracking-tight tabular-nums ${
          accent ? "text-lime" : "text-paper"
        }`}
      >
        {value}
      </p>
      <p className="mc-mono mt-1.5 text-[10px] uppercase tracking-[0.22em] text-paper-faint">
        {label}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-paper-dim">{hint}</p> : null}
    </div>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

/** Loading skeleton — mirrors the page rhythm. */
export function Loading() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-32 pt-6 sm:px-6" aria-busy="true">
      <div className="mc-skeleton mb-6 h-10 w-56" />
      <div className="mc-skeleton mb-4 h-40 w-full" />
      <div className="grid gap-3.5 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="mc-skeleton h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Empty state — terse and honest. */
export function Empty({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
  cta?: { href: string; label: string };
}) {
  return (
    <Card className="px-6 py-8 text-center">
      <p className="text-lg font-bold tracking-tight">{title}</p>
      {body ? (
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-paper-dim">
          {body}
        </p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="mc-btn mc-btn-primary mt-4 inline-block no-underline"
        >
          {cta.label}
        </Link>
      ) : null}
    </Card>
  );
}

/** "Not onboarded yet" — shown when the operator has no agent. */
export function NeedsOnboarding() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8">
      <Empty
        title="No agent yet"
        body="Finish setting up HeyMaya and your manager will start working — everything she finds shows up here."
        cta={{ href: "/onboarding/gtm", label: "Set up HeyMaya" }}
      />
    </div>
  );
}

/* ── Text helpers ──────────────────────────────────────────────────────── */

/** Relative-time helper for feed/timestamps. */
export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Wall-clock time, short. */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Short mono date — "JUL 15". */
export function monoDate(ms: number): string {
  return new Date(ms)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

/** External link — always opens in a new tab. */
export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-paper underline decoration-paper/30 underline-offset-2 transition-colors hover:decoration-lime hover:text-lime-soft"
    >
      {children}
    </a>
  );
}

/** Board source link — small mono accent link. */
export function SrcLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//.test(href)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mc-src-link">
      {children}
    </a>
  );
}

/** Source chip — the tappable receipt behind a claim. */
export function SourceChip({ url, label }: { url: string; label?: string }) {
  if (!/^https?:\/\//.test(url)) return null;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--mc-line)] bg-paper/[0.04] px-2.5 py-0.5 font-mono text-[10px] text-paper-dim transition-colors hover:border-lime/40 hover:text-lime-soft"
    >
      <span className="text-lime">↗</span> {label ?? host}
    </a>
  );
}

/** A breathing dot — "Maya is live". Pure CSS, respects reduced motion. */
export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex size-2 ${className}`} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-lime" />
    </span>
  );
}

/** Maya speaking in first person (legacy). */
export function MayaLine({ children }: { children: ReactNode }) {
  return <p className="text-[15px] italic leading-snug text-paper">{children}</p>;
}

/** Collapsed archive fold — quiet by default, smooth caret. */
export function Fold({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <details className="mc-fold mb-8 border-t border-[var(--mc-line-soft)] pt-4">
      <summary className="flex select-none items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-paper-faint transition-colors hover:text-paper">
        <span className="mc-caret">▸</span>
        {label}
        {count !== undefined ? <span className="tabular-nums">· {count}</span> : null}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
