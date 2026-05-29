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
        body="Finish setting up ClawLaunch and your manager will start working — everything she finds shows up here."
        cta={{ href: "/onboarding/gtm", label: "Set up ClawLaunch" }}
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
