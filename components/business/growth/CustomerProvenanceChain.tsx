/**
 * "How we got this customer" chain — Customer detail panel.
 *
 * Three nodes max:  Maya action  →  Lead  →  Job (when converted).
 *
 * Empty state is intentionally subtle: when no lead chain matches the
 * customer (direct contact, walk-in, no Maya action attributed), the
 * component returns null rather than rendering a placeholder. Customer
 * detail already shows job + review history; this is purely additive
 * provenance.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ArrowDown,
  CalendarCheck,
  MessageSquareText,
  Sparkles,
  TrendingUp,
} from "lucide-react";

interface CustomerProvenanceChainProps {
  customerId: Id<"serviceCustomers">;
}

export function CustomerProvenanceChain({
  customerId,
}: CustomerProvenanceChainProps) {
  const provenance = useQuery(
    api.queries.business.growth.getCustomerProvenance,
    { customerId }
  );

  if (provenance === undefined) {
    return (
      <div
        data-testid="biz-customer-provenance-skeleton"
        className="h-24 animate-pulse rounded-xl bg-ink-3/40"
      />
    );
  }

  if (provenance === null) return null;

  return (
    <section
      data-testid="biz-customer-provenance"
      className="rounded-xl border border-[var(--hairline)] bg-ink-3/30 p-4"
    >
      <div className="inline-flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          How Maya got this customer
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {provenance.action ? (
          <ChainNode
            icon={<Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden />}
            label={actionLabel(provenance.action.kind)}
            detail={provenance.action.summary}
            atMs={provenance.action.atMs}
          />
        ) : (
          <ChainNode
            icon={<MessageSquareText className="h-3.5 w-3.5 text-paper-faint" aria-hidden />}
            label="Direct contact"
            detail="No Maya action attributed."
            atMs={null}
          />
        )}

        <ArrowDown
          className="h-3 w-3 text-paper-faint mx-1.5"
          aria-hidden
        />

        <ChainNode
          icon={<MessageSquareText className="h-3.5 w-3.5 text-amber-200" aria-hidden />}
          label={`Lead via ${humanSource(provenance.lead.source)}`}
          detail={provenance.lead.contactName ?? "Anonymous lead"}
          atMs={provenance.lead.capturedAt}
        />

        {provenance.convertedJob && (
          <>
            <ArrowDown
              className="h-3 w-3 text-paper-faint mx-1.5"
              aria-hidden
            />
            <ChainNode
              icon={<CalendarCheck className="h-3.5 w-3.5 text-lime" aria-hidden />}
              label={`Booked: ${provenance.convertedJob.serviceType ?? "service call"}`}
              detail={`Status: ${provenance.convertedJob.status}`}
              atMs={provenance.convertedJob.completedAt ?? null}
            />
          </>
        )}

        {!provenance.convertedJob && provenance.action && (
          <>
            <ArrowDown
              className="h-3 w-3 text-paper-faint mx-1.5"
              aria-hidden
            />
            <ChainNode
              icon={<TrendingUp className="h-3.5 w-3.5 text-paper-faint" aria-hidden />}
              label="Not yet booked"
              detail="Lead in flight."
              atMs={null}
            />
          </>
        )}
      </div>
    </section>
  );
}

function ChainNode({
  icon,
  label,
  detail,
  atMs,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  atMs: number | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-ink-2/40 px-3 py-2 text-sm">
      <div className="inline-flex items-start gap-2 min-w-0">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0">
          <div className="text-paper">{label}</div>
          <div className="line-clamp-2 text-xs text-paper-faint">{detail}</div>
        </div>
      </div>
      {atMs && (
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
          {new Date(atMs).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function actionLabel(
  kind: "gbp-post" | "lead-nudge" | "review-request" | "review-reply" | "none"
): string {
  switch (kind) {
    case "gbp-post":
      return "GBP post Maya drafted";
    case "lead-nudge":
      return "Lead nudge from Maya";
    case "review-request":
      return "Review request Maya sent";
    case "review-reply":
      return "Review reply Maya drafted";
    case "none":
      return "Direct contact";
  }
}

function humanSource(
  source: "gbp-msg" | "fb-dm" | "twilio-missed-call" | "twilio-sms"
): string {
  switch (source) {
    case "gbp-msg":
      return "GBP message";
    case "fb-dm":
      return "Facebook DM";
    case "twilio-missed-call":
      return "missed call";
    case "twilio-sms":
      return "text";
  }
}
