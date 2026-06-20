"use client";

/**
 * TierSelector — the single source of truth for HeyMaya GTM plan tiers.
 *
 * Used by BOTH the onboarding "go live" step and the Account page so the
 * tiers, prices, channel counts, and video differences live in one place.
 * It is presentation-only: the caller owns the checkout action
 * (`createGtmCheckoutSession`) and passes a `onSelect(tier, interval)` so
 * this component never imports Convex. That keeps it reusable from any
 * surface and trivially testable.
 *
 * Backend reference: `convex/billing/gtmBilling.ts` accepts
 * `{ interval: "monthly" | "annual", tier: "starter" | "growth" | "studio" }`
 * and returns a Stripe checkout URL. The checkout starts the 7-day trial;
 * the webhook grants the trialing plan on return.
 */

export type GtmTier = "starter" | "growth" | "studio";
export type GtmInterval = "monthly" | "annual";

interface TierSpec {
  tier: GtmTier;
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  channels: string;
  video: string;
  highlight?: boolean;
}

// Single source of truth for the tier matrix. Prices/channels/video mirror
// the locked GTM pricing: Starter $99 / Growth $149 / Studio $199. Annual is
// billed at 10× monthly (two months free), matching gtmBilling's annual price
// envs. If those envs ever diverge, change them here in lockstep.
export const GTM_TIERS: ReadonlyArray<TierSpec> = [
  {
    tier: "starter",
    name: "Starter",
    monthlyPrice: "$99",
    annualPrice: "$990",
    channels: "Up to 3 channels",
    video: "Text + image posts",
  },
  {
    tier: "growth",
    name: "Growth",
    monthlyPrice: "$149",
    annualPrice: "$1,490",
    channels: "Up to 6 channels",
    video: "Text + image posts",
    highlight: true,
  },
  {
    tier: "studio",
    name: "Studio",
    monthlyPrice: "$199",
    annualPrice: "$1,990",
    channels: "Up to 6 channels",
    video: "+ Maya makes your videos",
  },
];

function priceFor(spec: TierSpec, interval: GtmInterval): string {
  return interval === "annual" ? spec.annualPrice : spec.monthlyPrice;
}

export function TierSelector({
  interval,
  onIntervalChange,
  onSelect,
  busyTier,
  disabled,
  showIntervalToggle = true,
}: {
  interval: GtmInterval;
  onIntervalChange?: (interval: GtmInterval) => void;
  /** Called when the founder picks a tier. Caller runs the checkout action. */
  onSelect: (tier: GtmTier, interval: GtmInterval) => void;
  /** The tier currently mid-checkout, so its card shows a pending state. */
  busyTier?: GtmTier | null;
  /** Disable all cards (e.g. while any checkout is in flight). */
  disabled?: boolean;
  showIntervalToggle?: boolean;
}) {
  const checkingOut = busyTier ?? null;
  const showToggle = showIntervalToggle && onIntervalChange !== undefined;

  return (
    <div className="space-y-4">
      {showToggle && (
        <div className="inline-flex items-center gap-1 rounded-full border border-paper-faint/30 bg-ink-2 p-1 text-xs">
          {(["monthly", "annual"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onIntervalChange?.(value)}
              className={
                value === interval
                  ? "rounded-full bg-paper px-3 py-1 font-medium text-ink"
                  : "rounded-full px-3 py-1 text-paper-dim hover:text-paper"
              }
            >
              {value === "monthly" ? "Monthly" : "Annual"}
              {value === "annual" ? (
                <span className="ml-1 text-lime">2 mo free</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {GTM_TIERS.map((spec) => {
          const isBusy = checkingOut === spec.tier;
          return (
            <button
              key={spec.tier}
              type="button"
              onClick={() => onSelect(spec.tier, interval)}
              disabled={disabled || checkingOut !== null}
              data-tier={spec.tier}
              className={[
                "flex flex-col gap-2 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                spec.highlight
                  ? "border-lime/60 bg-lime/10 hover:bg-lime/15"
                  : "border-paper-faint/30 bg-ink-2 hover:border-paper/50 hover:bg-ink-3",
              ].join(" ")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg text-paper">
                  {spec.name}
                </span>
                {spec.highlight ? (
                  <span className="rounded-full bg-lime/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-lime">
                    Popular
                  </span>
                ) : null}
              </div>
              <div>
                <span className="font-display text-2xl text-paper">
                  {priceFor(spec, interval)}
                </span>
                <span className="ml-1 text-xs text-paper-dim">
                  /{interval === "annual" ? "yr" : "mo"}
                </span>
              </div>
              <ul className="mt-1 space-y-1 text-sm text-paper-dim">
                <li>{spec.channels}</li>
                <li>{spec.video}</li>
              </ul>
              <span className="mt-2 font-mono text-[10px] uppercase tracking-wide text-lime">
                {isBusy ? "Starting…" : "Start 7-day trial"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
