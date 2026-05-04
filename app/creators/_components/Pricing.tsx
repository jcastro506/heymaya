"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export type Billing = "monthly" | "annual";

type Tier = {
  id: "coach" | "manager";
  name: string;
  monthly: number;
  annual: number;
  headline: string;
  bullets: string[];
  recommended?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "coach",
    name: "Coach",
    monthly: 19.99,
    annual: 199,
    headline:
      "Maya advises. You decide. Daily briefs, weekly plans, honest reads — every send waits on your tap.",
    bullets: [
      "Morning brief, evening recap, weekly plan",
      "Performance reads grounded in your real numbers",
      "Trend watcher tuned to what already works for you",
      "Idea sparring + hook drafting in your voice",
      "200 chat turns / mo",
      "She drafts, you send. Nothing goes out without your tap.",
    ],
  },
  {
    id: "manager",
    name: "Manager",
    monthly: 49.99,
    annual: 499,
    headline:
      "Maya acts. She drafts, sends, and follows up — within rules you set. Brand DMs, contracts, outreach, all handled.",
    bullets: [
      "Everything in Coach",
      "Reads brand emails and replies for you",
      "Reaches out to brands you'd be a fit for",
      "Reads any contract you send her, flags what to push back on",
      "A polished packet a real manager could read in 5 minutes",
      "Unlimited chat",
      "Sends the replies you trust her with, asks you on the rest",
    ],
    recommended: true,
  },
];

export function Pricing({
  billing,
  setBilling,
}: {
  billing: Billing;
  setBilling: (b: Billing) => void;
}) {
  return (
    <section id="pricing" className="px-6 pt-28 sm:px-10 sm:pt-36 lg:pt-44">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <span className="font-mono text-xs uppercase tracking-[0.22em] text-paper-faint">
              Pricing
            </span>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
              Pick how much rope.{" "}
              <span className="italic text-paper-dim">
                Same Maya, either way.
              </span>
            </h2>
            <p className="mt-5 max-w-xl text-paper-dim">
              One social media manager. Two pricing tiers, set by how much
              autonomy you want her to have. Both ship with 7 days free.
            </p>
          </div>
          <BillingToggle billing={billing} setBilling={setBilling} />
        </div>

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-[var(--hairline)] md:grid-cols-2">
          {TIERS.map((t) => (
            <PricingCard key={t.id} tier={t} billing={billing} />
          ))}
        </div>

        <p className="mt-6 flex items-center gap-2 text-sm text-paper-faint">
          <ShieldCheck className="h-4 w-4 text-lime" />
          7 days free on both tiers. Plan changes prorate. Cancel anytime. Your
          data exports in one click.
        </p>
      </div>
    </section>
  );
}

function BillingToggle({
  billing,
  setBilling,
}: {
  billing: Billing;
  setBilling: (b: Billing) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-strong)] bg-ink-2 p-1 text-sm"
    >
      <button
        role="tab"
        aria-selected={billing === "monthly"}
        onClick={() => setBilling("monthly")}
        className={`rounded-full px-4 py-1.5 transition-colors ${
          billing === "monthly"
            ? "bg-paper text-ink"
            : "text-paper-dim hover:text-paper"
        }`}
      >
        Monthly
      </button>
      <button
        role="tab"
        aria-selected={billing === "annual"}
        onClick={() => setBilling("annual")}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 transition-colors ${
          billing === "annual"
            ? "bg-paper text-ink"
            : "text-paper-dim hover:text-paper"
        }`}
      >
        Annual
        <span
          className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            billing === "annual"
              ? "bg-ink text-lime"
              : "bg-[var(--hairline-strong)] text-lime"
          }`}
        >
          −17%
        </span>
      </button>
    </div>
  );
}

function PricingCard({ tier, billing }: { tier: Tier; billing: Billing }) {
  const monthlyEquivalent =
    billing === "monthly" ? tier.monthly : tier.annual / 12;
  const formattedPrice = `$${monthlyEquivalent.toFixed(2)}`;
  const annualLabel = `billed $${tier.annual} / year · 7 days free`;
  const monthlyLabel = "billed monthly · 7 days free";

  return (
    <div
      className={`relative flex flex-col gap-6 p-7 sm:p-9 ${
        tier.recommended ? "bg-ink-3" : "bg-ink-2"
      }`}
    >
      {tier.recommended && (
        <div className="absolute right-7 top-7 rounded-full bg-lime px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-ink">
          7 days free
        </div>
      )}
      <div>
        <div className="flex items-center gap-3">
          <h3 className="font-display text-3xl text-paper">{tier.name}</h3>
          {tier.recommended && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
              Most chosen
            </span>
          )}
        </div>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-paper-dim">
          {tier.headline}
        </p>
      </div>

      <div className="flex items-end gap-2">
        <span className="font-display text-5xl leading-none tracking-tight text-paper">
          {formattedPrice}
        </span>
        <span className="pb-1 text-sm text-paper-dim">/ mo</span>
      </div>
      <div className="-mt-3 text-xs text-paper-faint">
        {billing === "annual" ? annualLabel : monthlyLabel}
      </div>

      <ul className="mt-2 space-y-2.5 text-sm text-paper-dim">
        {tier.bullets.map((b) => (
          <li key={b} className="flex items-start gap-3">
            <span className="mt-2 h-1 w-3 shrink-0 bg-lime" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/checkout?tier=${tier.id}&interval=${billing}`}
        className={`btn mt-auto w-full ${
          tier.recommended ? "btn-primary" : "btn-ghost"
        }`}
      >
        Start 7 days free
      </Link>
    </div>
  );
}
