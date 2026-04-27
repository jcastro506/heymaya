/**
 * Billing tab for the Profile screen.
 *
 * Per Service Sprint Plan § 12.6: current plan, MTD usage incl. voice
 * minutes, upgrade/downgrade. Trial-end date when applicable.
 *
 * Wave D Stripe agent — wired upgrade/downgrade buttons, customer-portal
 * CTA, raise-cap flow, annual-toggle, subscription status badge.
 *
 * Flow:
 *   - Stripe customer present + active sub → "Open billing portal" + plan
 *     change/cancel/payment-method/invoice-history all live in portal
 *   - No Stripe customer (mid-onboarding) → tier-pick CTAs that route to
 *     `createServiceCheckoutSession`
 *   - past_due / canceled status → red banner + reactivate CTA
 *   - Voice usage at hard cap → "Raise cap" button surfaces (operator goes
 *     into the portal to upgrade or contact support)
 */

"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CreditCard, Mic, AlertTriangle, ArrowUpCircle } from "lucide-react";

export interface BillingPanelProps {
  plan: "starter" | "pro" | "studio";
  voice: {
    enabled: boolean;
    minutesUsed: number;
    minutesIncluded: number;
    overageRate: number | null;
    hardCap: number | null;
    cappedAt?: number | null;
  };
  chat: {
    cap: number | "unlimited";
  };
  trialEndsAt: number | null;
  /** Wave D additions — passed by the Profile page from getBilling. */
  subscriptionStatus?: string | null;
  hasStripeCustomer?: boolean;
  billingInterval?: "monthly" | "annual" | null;
  /** Test-only override to bypass live action calls. */
  onOpenPortal?: () => void;
  onCheckout?: (
    tier: "starter" | "pro" | "studio",
    interval: "monthly" | "annual"
  ) => void;
  testId?: string;
}

const PLAN_PRICE_MONTHLY: Record<BillingPanelProps["plan"], string> = {
  starter: "$99/mo",
  pro: "$149/mo",
  studio: "$199/mo",
};
const PLAN_PRICE_ANNUAL: Record<BillingPanelProps["plan"], string> = {
  starter: "$999/yr",
  pro: "$1,499/yr",
  studio: "$1,999/yr",
};

const PLAN_DESCRIPTION: Record<BillingPanelProps["plan"], string> = {
  starter: "Text-only, 1 GBP, 200 chat turns/mo, manual review-reply approval.",
  pro: "All channels, 1000 chat turns/mo, CRM, 30 voice min/mo + $0.20/min overage.",
  studio:
    "Multi-location (5 GBPs), unlimited chat, 100 voice min/mo + $0.15/min overage, hard cap 500/mo.",
};

const PLAN_LADDER: ReadonlyArray<BillingPanelProps["plan"]> = [
  "starter",
  "pro",
  "studio",
];

export function BillingPanel({
  plan,
  voice,
  chat,
  trialEndsAt,
  subscriptionStatus,
  hasStripeCustomer,
  billingInterval,
  onOpenPortal,
  onCheckout,
  testId,
}: BillingPanelProps) {
  const [interval, setInterval] = useState<"monthly" | "annual">(
    billingInterval ?? "monthly"
  );
  const [busy, setBusy] = useState<string | null>(null);

  const liveOpenPortal = useAction(
    api.integrations.stripe.customerPortal.openServiceCustomerPortal
  );
  const liveCheckout = useAction(
    api.integrations.stripe.checkout.createServiceCheckoutSession
  );

  const voicePct =
    voice.minutesIncluded > 0
      ? Math.min(100, (voice.minutesUsed / voice.minutesIncluded) * 100)
      : 0;
  const isCapped = voice.cappedAt != null;
  const isPastDue = subscriptionStatus === "past_due";
  const isCanceled = subscriptionStatus === "canceled";
  const isTrialing = subscriptionStatus === "trialing";

  async function handleOpenPortal() {
    if (onOpenPortal) {
      onOpenPortal();
      return;
    }
    setBusy("portal");
    try {
      const res = await liveOpenPortal({});
      if (typeof window !== "undefined") {
        window.location.href = res.url;
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCheckout(
    tier: BillingPanelProps["plan"],
    chosenInterval: "monthly" | "annual"
  ) {
    if (onCheckout) {
      onCheckout(tier, chosenInterval);
      return;
    }
    setBusy(`checkout-${tier}-${chosenInterval}`);
    try {
      const res = await liveCheckout({ tier, interval: chosenInterval });
      if (typeof window !== "undefined") {
        window.location.href = res.url;
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      data-testid={testId ?? "biz-billing-panel"}
      data-plan={plan}
      data-status={subscriptionStatus ?? "unknown"}
      className="space-y-4 rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-5"
    >
      <header className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-lime" aria-hidden />
        <h3 className="font-display text-lg text-paper">Billing</h3>
      </header>

      {/* Status banners */}
      {(isPastDue || isCanceled) && (
        <div
          data-testid="biz-billing-status-banner"
          className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <div className="font-display">
              {isPastDue
                ? "Payment past due"
                : "Subscription canceled"}
            </div>
            <p className="text-xs text-red-200/80">
              {isPastDue
                ? "Your last payment failed. Maya keeps running until dunning exhausts — please update your card."
                : "Your subscription is canceled. Reactivate to keep using Maya."}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Current plan
          </div>
          <div className="text-2xl font-display text-paper">
            {plan[0].toUpperCase() + plan.slice(1)}{" "}
            <span className="text-paper-dim">
              {(billingInterval ?? "monthly") === "annual"
                ? PLAN_PRICE_ANNUAL[plan]
                : PLAN_PRICE_MONTHLY[plan]}
            </span>
          </div>
          <p className="mt-1 text-xs text-paper-faint">
            {PLAN_DESCRIPTION[plan]}
          </p>
        </div>
        {trialEndsAt && trialEndsAt > Date.now() && (
          <div
            data-testid="biz-billing-trial-badge"
            className="rounded-full border border-lime/40 bg-lime/5 px-3 py-1 text-xs text-lime"
          >
            {isTrialing ? "Trial ends " : "Renews "}
            {new Date(trialEndsAt).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Voice usage */}
      <div className="space-y-2 rounded-xl bg-ink-3/40 p-4">
        <div className="flex items-center gap-2 text-sm text-paper">
          <Mic className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
          <span>Voice minutes</span>
          <span className="ml-auto font-mono text-xs text-paper-faint">
            {voice.minutesUsed} / {voice.minutesIncluded || "—"} this period
          </span>
        </div>
        {voice.minutesIncluded > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-2">
            <div
              data-testid="biz-billing-voice-progress"
              className="h-full bg-lime"
              style={{ width: `${voicePct}%` }}
            />
          </div>
        )}
        {voice.overageRate !== null && (
          <p className="text-[11px] text-paper-faint">
            ${voice.overageRate.toFixed(2)}/min over inclusion
            {voice.hardCap !== null
              ? ` · hard cap ${voice.hardCap}/period`
              : ""}
          </p>
        )}
        {!voice.enabled && (
          <p className="text-[11px] text-paper-faint">
            Voice not included on this plan.
          </p>
        )}
        {isCapped && (
          <div
            data-testid="biz-billing-capped-banner"
            className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            <span>Hard cap reached. Outbound voice is disabled.</span>
            <button
              type="button"
              onClick={handleOpenPortal}
              disabled={busy !== null || !hasStripeCustomer}
              data-testid="biz-billing-raise-cap-btn"
              className="rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-[11px] font-mono text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
            >
              Raise cap
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-ink-3/40 p-4 text-sm">
        <span className="text-paper-dim">Chat-turn cap</span>
        <span className="font-mono text-xs text-paper">
          {chat.cap === "unlimited" ? "Unlimited" : chat.cap}
        </span>
      </div>

      {/* Upgrade / change-plan CTAs */}
      {hasStripeCustomer ? (
        <button
          type="button"
          onClick={handleOpenPortal}
          disabled={busy !== null}
          data-testid="biz-billing-portal-btn"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-3 px-4 py-2 text-xs text-paper transition-colors hover:bg-ink-3/80 disabled:opacity-50"
        >
          {busy === "portal" ? "Opening…" : "Open billing portal"}
        </button>
      ) : (
        <div
          data-testid="biz-billing-checkout-grid"
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="font-display text-sm text-paper">
              Pick a plan
            </h4>
            <div
              data-testid="biz-billing-interval-toggle"
              className="flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-ink-3/40 p-0.5"
            >
              {(["monthly", "annual"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  data-testid={`biz-billing-interval-${opt}`}
                  data-active={interval === opt ? "true" : "false"}
                  onClick={() => setInterval(opt)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    interval === opt
                      ? "bg-lime text-ink"
                      : "text-paper-dim"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {PLAN_LADDER.map((tier) => {
              const isCurrent = tier === plan;
              const price =
                interval === "annual"
                  ? PLAN_PRICE_ANNUAL[tier]
                  : PLAN_PRICE_MONTHLY[tier];
              return (
                <button
                  key={tier}
                  type="button"
                  data-testid={`biz-billing-checkout-${tier}`}
                  data-active={isCurrent ? "true" : "false"}
                  onClick={() => handleCheckout(tier, interval)}
                  disabled={busy !== null}
                  className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-50 ${
                    isCurrent
                      ? "border-lime/60 bg-lime/10"
                      : "border-[var(--hairline)] bg-ink-3 hover:bg-ink-3/80"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {tier === "pro" && (
                      <ArrowUpCircle
                        className="h-3.5 w-3.5 text-lime"
                        aria-hidden
                      />
                    )}
                    <span className="font-display text-sm capitalize text-paper">
                      {tier}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-paper-dim">
                    {price}
                  </span>
                  <span className="text-[10px] text-paper-faint">
                    {tier === "pro" && !isCurrent ? "14-day trial" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
