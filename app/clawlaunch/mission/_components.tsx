"use client";

/**
 * Shared UI primitives for the ClawLaunch Mission Control surface.
 * Dark theme (bg-ink / text-paper / lime accent), mirrors the mission-board +
 * creator-HQ design language. Every tab composes these.
 */

import type { ReactNode } from "react";

/** Page shell: title + optional subtitle, then content. */
export function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl leading-none sm:text-5xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-paper-dim">
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  );
}

/** A titled section with a hairline rule. */
export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline gap-3 border-b border-paper-faint/15 pb-2">
        <h2 className="font-mono text-xs uppercase tracking-[0.22em] text-paper">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="font-mono text-xs text-paper-faint">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A content card. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-paper-faint/15 bg-ink-2 p-4 ${className}`}
    >
      {children}
    </div>
  );
}

const PILL_TONE: Record<string, string> = {
  lime: "bg-lime/30 text-[#0a0a0a]",
  paper: "bg-paper/10 text-paper-dim",
  rose: "bg-rose/20 text-[#b3261e]",
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${PILL_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** Loading skeleton — three shimmer bars. */
export function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8" aria-busy="true">
      <div className="mb-8 h-10 w-64 animate-pulse rounded bg-paper-faint/10" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl bg-paper-faint/10"
          />
        ))}
      </div>
    </div>
  );
}

/** Empty state with a manager-voice line + optional CTA. */
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
    <Card className="text-center">
      <p className="font-display text-xl">{title}</p>
      <p className="mt-2 text-sm text-paper-dim">{body}</p>
      {cta ? (
        <a
          href={cta.href}
          className="mt-4 inline-block rounded-lg bg-lime px-4 py-2 font-mono text-xs uppercase tracking-wide text-[#0a0a0a]"
        >
          {cta.label}
        </a>
      ) : null}
    </Card>
  );
}

/** "Not onboarded yet" — shown when the operator has no GTM agent. */
export function NeedsOnboarding() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
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

/** A wrapped product link should always render as the redirect; raw external
 *  links open in a new tab. */
export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-paper underline decoration-paper/30 underline-offset-2 hover:decoration-paper"
    >
      {children}
    </a>
  );
}

/* ───────────────────────── Mission Control v2 primitives ─────────────────
 * The cockpit language: big serif numbers, tracked micro-labels, one accent.
 * Everything below composes the same ink/paper/accent variables as the rest
 * of the surface — no new colors, no boxes-for-the-sake-of-boxes. */

/** A breathing dot — "Maya is live". Pure CSS, respects reduced motion. */
export function LiveDot({ className = "" }: { className?: string }) {
  return (
    <span className={`relative inline-flex size-2 ${className}`} aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-lime" />
    </span>
  );
}

/** One big editorial number with a tracked label under it. The stat strip is
 *  typography, not boxes — numbers do the talking. */
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

/** Primary / quiet action buttons for the decision surfaces (Queue, quick-add).
 *  Kept deliberately small — decisions should feel light, not ceremonial. */
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
        ? "border border-rose/40 text-[#b3261e] hover:bg-rose/10"
        : "border border-paper-faint/25 text-paper-dim hover:border-paper-faint/50 hover:text-paper";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {busy ? (
        <span className="inline-block size-3 animate-spin rounded-full border border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}

/** Maya speaking in first person — serif italic, like a line from a letter.
 *  This is the voice treatment for the narrative stream. */
export function MayaLine({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-[17px] italic leading-snug text-paper sm:text-lg">
      {children}
    </p>
  );
}

/** Session grouping for activity rollups: consecutive activity rows within
 *  GAP_MS of each other collapse into one working session. */
export interface ActivityRowLike {
  _id: string;
  kind: string;
  summary: string;
  detail?: string;
  linkedRef?: string;
  createdAt: number;
}

export interface ActivitySession<T extends ActivityRowLike> {
  startMs: number;
  endMs: number;
  rows: T[]; // newest first
  counts: Record<string, number>;
}

const SESSION_GAP_MS = 20 * 60 * 1000;

export function groupIntoSessions<T extends ActivityRowLike>(
  rows: T[] // newest first
): ActivitySession<T>[] {
  const sessions: ActivitySession<T>[] = [];
  for (const row of rows) {
    const current = sessions[sessions.length - 1];
    if (current && current.startMs - row.createdAt <= SESSION_GAP_MS) {
      current.rows.push(row);
      current.startMs = row.createdAt;
      current.counts[row.kind] = (current.counts[row.kind] ?? 0) + 1;
    } else {
      sessions.push({
        startMs: row.createdAt,
        endMs: row.createdAt,
        rows: [row],
        counts: { [row.kind]: 1 },
      });
    }
  }
  return sessions;
}

/** "read 12 · drafted 3 · posted 1" — the session receipt line. */
export function sessionSummary(counts: Record<string, number>): string {
  const LABELS: Record<string, [string, string]> = {
    researching: ["swept", "sweeps"],
    found: ["find", "finds"],
    drafted: ["draft", "drafts"],
    posted: ["posted", "posted"],
    plan_changed: ["plan change", "plan changes"],
    thinking: ["note", "notes"],
    status: ["update", "updates"],
  };
  return Object.entries(counts)
    .map(([kind, n]) => {
      const [one, many] = LABELS[kind] ?? [kind, kind];
      return kind === "posted" ? `posted ${n}` : `${n} ${n === 1 ? one : many}`;
    })
    .join(" · ");
}
