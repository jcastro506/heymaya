/**
 * TelemetryAuditList — per-nudge audit log surface for the Growth tab.
 *
 * Pro/Studio only. Server-side gating in `getTelemetrySummary` returns null
 * for Starter; this component short-circuits on null so we never flash
 * empty content.
 *
 * Counts and outcome breakdowns only — no score/rank synthesis. Mirrors the
 * judgment-not-rules invariant; the operator scans these counts to sanity-
 * check Maya's behavior over the window.
 */

"use client";

import {
  AlertCircle,
  AlertTriangle,
  BellRing,
  CircleCheck,
  Coins,
  PhoneCall,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  TelemetrySignalKind,
  TelemetrySignalSummary,
  TelemetrySummary,
} from "@/convex/queries/business/growth";

interface TelemetryAuditListProps {
  data: TelemetrySummary | null | undefined;
}

export function TelemetryAuditList({ data }: TelemetryAuditListProps) {
  // Loading
  if (data === undefined) {
    return (
      <div
        data-testid="biz-growth-telemetry-skeleton"
        className="space-y-3"
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-2xl bg-ink-3/60"
          />
        ))}
      </div>
    );
  }

  // No-tier / no-session — render nothing (Starter path).
  if (data === null) return null;

  // Window had nothing in any signal — empty message keeps the section
  // honest rather than rendering a phantom row of zeroes.
  const totalCount = data.signals.reduce((acc, s) => acc + s.count, 0);
  if (totalCount === 0) {
    return (
      <div
        data-testid="biz-growth-telemetry-empty"
        className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-6 text-sm text-paper-dim"
      >
        Nothing for Maya to log this period yet. Audit rows land as approvals,
        nudges, and replies move through her queue.
      </div>
    );
  }

  return (
    <ul data-testid="biz-growth-telemetry-list" className="space-y-3">
      {data.signals
        .filter((s) => s.count > 0)
        .map((s) => (
          <SignalRow key={s.signal} summary={s} />
        ))}
    </ul>
  );
}

function SignalRow({ summary }: { summary: TelemetrySignalSummary }) {
  const meta = SIGNAL_META[summary.signal];
  const Icon = meta.icon;
  return (
    <li
      data-testid={`biz-growth-telemetry-row-${summary.signal}`}
      className="flex items-start gap-3 rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-4"
    >
      <Icon className="mt-1 h-4 w-4 text-lime" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            {meta.label}
          </div>
          <span className="font-display text-xl tracking-tight text-paper">
            {summary.count}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {Object.entries(summary.byOutcome).map(([outcome, n]) => (
            <span
              key={outcome}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-ink-3 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-dim"
            >
              {outcome}
              <span className="text-paper">{n}</span>
            </span>
          ))}
        </div>
        {summary.numericSum !== null && (
          <div className="mt-1 text-xs text-paper-faint">
            {meta.numericLabel}: {formatNumeric(summary.signal, summary.numericSum)}
          </div>
        )}
      </div>
    </li>
  );
}

function formatNumeric(signal: TelemetrySignalKind, sum: number): string {
  if (signal === "ai-cost") {
    return `$${sum.toFixed(2)}`;
  }
  if (signal === "voice-satisfaction") {
    // Sum of ratings is rarely meaningful on its own; mostly here for parity.
    return sum.toFixed(0);
  }
  return sum.toLocaleString();
}

const SIGNAL_META: Record<
  TelemetrySignalKind,
  { label: string; icon: LucideIcon; numericLabel: string }
> = {
  "review-request-approval": {
    label: "Review-request approvals",
    icon: CircleCheck,
    numericLabel: "n/a",
  },
  "review-reply-moderation": {
    label: "Review-reply moderation",
    icon: Star,
    numericLabel: "n/a",
  },
  "lead-response-nudge-open": {
    label: "Lead-nudge engagement",
    icon: BellRing,
    numericLabel: "n/a",
  },
  "voice-satisfaction": {
    label: "Voice call ratings",
    icon: PhoneCall,
    numericLabel: "Sum of ratings",
  },
  "ai-cost": {
    label: "AI cost (mirrored)",
    icon: Coins,
    numericLabel: "Total cost",
  },
  "crm-webhook-idempotency-hit": {
    label: "CRM webhook dedupe hits",
    icon: AlertTriangle,
    numericLabel: "n/a",
  },
};

// Suppresses unused-import warnings on icons we may swap in later.
void AlertCircle;
