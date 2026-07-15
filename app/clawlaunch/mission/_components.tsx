"use client";

/**
 * Shared UI primitives for Mission Control — the dark editorial system.
 * Ink surfaces, warm paper type (serif display + tracked micro-caps), one
 * sky-blue accent reserved for "look here". Every tab composes these; motion
 * comes from the mc-* classes in mission.css (staggered rise-ins, shimmer
 * skeletons, hover lift), all reduced-motion safe.
 */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

/** Staggered rise-in wrapper. `i` is the stagger index (55ms steps). */
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

/** Page shell: serif title + optional status line, then content. */
export function Shell({
  title,
  subtitle,
  status,
  children,
}: {
  title: string;
  subtitle?: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-32 pt-8 sm:px-8 sm:pt-12 lg:pb-16">
      <header className="mc-rise mb-9">
        <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">
          {title}
        </h1>
        {status ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-paper-dim">
            {status}
          </div>
        ) : null}
        {subtitle ? (
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-paper-dim">
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  );
}

/** A titled section with a hairline rule and optional count. */
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
    <section className={`mb-11 ${className}`}>
      <div className="mb-4 flex items-baseline gap-3 border-b border-paper-faint/15 pb-2.5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-paper">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="font-mono text-[11px] tabular-nums text-paper-faint">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A content card — the one card language everything uses. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mc-card rounded-2xl border border-paper-faint/15 bg-ink-2 p-4 ${className}`}
    >
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

/** Loading skeleton — mirrors the page rhythm (title, stat band, cards). */
export function Loading() {
  return (
    <div
      className="mx-auto max-w-3xl px-5 pb-32 pt-8 sm:px-8 sm:pt-12"
      aria-busy="true"
    >
      <div className="mc-skeleton mb-9 h-10 w-56" />
      <div className="mc-skeleton mb-8 h-24 w-full" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mc-skeleton h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

/** Empty state — manager voice, proud not apologetic. */
export function Empty({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <Card className="px-6 py-9 text-center">
      <p className="font-display text-2xl leading-tight">{title}</p>
      <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-paper-dim">
        {body}
      </p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-5 inline-block rounded-full bg-lime px-4.5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink transition-opacity hover:opacity-85"
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
      className="inline-flex items-center gap-1 rounded-full border border-paper-faint/20 bg-paper/[0.04] px-2.5 py-0.5 font-mono text-[10px] text-paper-dim transition-colors hover:border-lime/40 hover:text-lime-soft"
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

/** One big editorial number with a tracked label under it. */
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
        className={`font-display text-3xl leading-none tabular-nums sm:text-4xl ${
          accent ? "text-lime" : "text-paper"
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-paper-faint">
        {label}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-paper-dim">{hint}</p> : null}
    </div>
  );
}

/** Primary / quiet / danger action buttons — decisions should feel light. */
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

/** Maya speaking in first person — serif italic, a line from a letter. */
export function MayaLine({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-[17px] italic leading-snug text-paper sm:text-lg">
      {children}
    </p>
  );
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
    <details className="mc-fold mb-11 border-t border-paper-faint/15 pt-5">
      <summary className="flex select-none items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-paper-faint transition-colors hover:text-paper">
        <span className="mc-caret">▸</span>
        {label}
        {count !== undefined ? (
          <span className="tabular-nums">· {count}</span>
        ) : null}
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}
