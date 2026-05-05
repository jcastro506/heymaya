/**
 * Subscription section — restrained tier + interval + renewal summary plus
 * switch / cancel actions.
 *
 * Data sources:
 *   - api.profile.getProfileSummary       → plan + trialEndsAt
 *   - api.creators.me                     → currentPlanPeriodEnd + billingInterval
 *                                           + stripeSubscriptionId (used to
 *                                           decide whether the portal can open)
 *
 * Actions:
 *   - api.billing.portal.openCustomerPortal — manage / cancel via Stripe
 *
 * Switch buttons route to /checkout?tier=…&interval=… (existing checkout
 * flow). The portal handles cancel + payment-method swaps.
 *
 * No Stripe flows are invented here.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

type ProfileSummary = NonNullable<
  FunctionReturnType<typeof api.profile.getProfileSummary>
>;
type CreatorMe = NonNullable<FunctionReturnType<typeof api.creators.me>>;

type Plan = "coach" | "manager";
type Interval = "monthly" | "annual";

const PRICE: Record<Plan, Record<Interval, { price: string; per: string }>> = {
  coach: {
    monthly: { price: "$19.99", per: "/ mo" },
    annual: { price: "$199", per: "/ yr" },
  },
  manager: {
    monthly: { price: "$49.99", per: "/ mo" },
    annual: { price: "$499", per: "/ yr" },
  },
};

const TIER_BLURB: Record<Plan, string> = {
  coach: "She drafts. You send. Every reply waits for your tap.",
  manager: "She drafts and sends, within rules you set.",
};

export function SubscriptionSection({
  summary,
  me,
}: {
  summary: ProfileSummary;
  me: CreatorMe;
}) {
  const openPortal = useAction(api.billing.portal.openCustomerPortal);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const plan = summary.creator.plan as Plan;
  const otherPlan: Plan = plan === "coach" ? "manager" : "coach";
  const interval: Interval = me.billingInterval ?? "monthly";
  const otherInterval: Interval = interval === "monthly" ? "annual" : "monthly";

  const priceLabel = PRICE[plan][interval];
  const trialEndsAt = summary.creator.trialEndsAt ?? null;
  const renewsAt = me.currentPlanPeriodEnd ?? null;
  const onTrial = trialEndsAt != null && trialEndsAt > Date.now();
  const hasSubscription = me.stripeSubscriptionId != null;

  const onPortal = async () => {
    setErr(null);
    setBusy(true);
    try {
      const { url } = await openPortal({});
      window.location.assign(url);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Could not open portal.";
      const cleaned = raw.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim();
      setErr(
        /subscribe first/i.test(cleaned)
          ? "Pick a plan first — billing options open once you've subscribed."
          : cleaned
      );
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-[var(--hairline)] px-5 pt-10 sm:px-8 sm:pt-12">
      <div className="mx-auto max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Subscription
        </span>

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-3xl tracking-tight text-paper sm:text-4xl">
            <span className="capitalize">{plan}</span>
            {","}
            <span className="italic text-paper-dim"> {labelForInterval(interval)}.</span>
          </h2>
          <div className="flex items-baseline gap-1">
            <span className="font-display text-3xl text-paper">{priceLabel.price}</span>
            <span className="text-sm text-paper-dim">{priceLabel.per}</span>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-paper-dim">
          {TIER_BLURB[plan]}
        </p>

        <dl className="mt-6 grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-2 sm:gap-x-6">
          {onTrial && trialEndsAt != null && (
            <Row label="Trial ends" value={humanizeDate(trialEndsAt)} accent="lime" />
          )}
          {!onTrial && renewsAt != null && (
            <Row label="Next renewal" value={humanizeDate(renewsAt)} />
          )}
          <Row label="Billed" value={interval === "annual" ? "Yearly" : "Monthly"} />
        </dl>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href={`/checkout?tier=${otherPlan}&interval=${interval}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-2 px-5 text-sm text-paper transition-colors hover:border-paper-dim"
          >
            Switch to <span className="capitalize">{otherPlan}</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link
            href={`/checkout?tier=${plan}&interval=${otherInterval}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[var(--hairline)] px-5 text-sm text-paper-dim transition-colors hover:border-paper-dim hover:text-paper"
          >
            Switch to {otherInterval === "annual" ? "yearly" : "monthly"}
          </Link>
        </div>

        <div className="mt-8 border-t border-[var(--hairline)] pt-5">
          {hasSubscription ? (
            <button
              type="button"
              onClick={() => void onPortal()}
              disabled={busy}
              className="inline-flex min-h-11 items-center gap-2 text-sm text-paper-faint underline-offset-4 transition-colors hover:text-paper hover:underline disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Opening billing
                </>
              ) : (
                <>Manage payment or cancel</>
              )}
            </button>
          ) : (
            <p className="text-xs text-paper-faint">
              Subscribe to a plan and you can change card or cancel from here.
            </p>
          )}
          {err && <p className="mt-2 text-sm text-rose">{err}</p>}
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "lime";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-1">
      <dt className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
        {label}
      </dt>
      <dd
        className={`text-sm ${
          accent === "lime" ? "text-lime" : "text-paper"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function labelForInterval(interval: Interval): string {
  return interval === "annual" ? "billed yearly" : "billed monthly";
}

function humanizeDate(ts: number): string {
  const d = new Date(ts);
  const diffDay = Math.round((ts - Date.now()) / (24 * 3_600_000));
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffDay === 0) return `today (${dateStr})`;
  if (diffDay === 1) return `tomorrow (${dateStr})`;
  if (diffDay > 0 && diffDay <= 14) return `in ${diffDay} days · ${dateStr}`;
  if (diffDay < 0 && diffDay >= -14) return `${Math.abs(diffDay)}d ago · ${dateStr}`;
  return dateStr;
}
