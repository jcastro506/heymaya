/**
 * Billing tab for the Profile screen.
 *
 * Per Service Sprint Plan § 12.6: current plan, MTD usage incl. voice
 * minutes, upgrade/downgrade. Trial-end date when applicable.
 *
 * v0 surfaces the data — Stripe portal CTA is wired via parent (Wave D
 * lands the metered billing flow).
 */

import { CreditCard, Mic } from "lucide-react";

export interface BillingPanelProps {
  plan: "starter" | "pro" | "studio";
  voice: {
    enabled: boolean;
    minutesUsed: number;
    minutesIncluded: number;
    overageRate: number | null;
    hardCap: number | null;
  };
  chat: {
    cap: number | "unlimited";
  };
  trialEndsAt: number | null;
  onOpenPortal?: () => void;
  testId?: string;
}

const PLAN_PRICE: Record<BillingPanelProps["plan"], string> = {
  starter: "$99/mo",
  pro: "$149/mo",
  studio: "$199/mo",
};

export function BillingPanel({
  plan,
  voice,
  chat,
  trialEndsAt,
  onOpenPortal,
  testId,
}: BillingPanelProps) {
  const voicePct =
    voice.minutesIncluded > 0
      ? Math.min(100, (voice.minutesUsed / voice.minutesIncluded) * 100)
      : 0;
  return (
    <section
      data-testid={testId ?? "biz-billing-panel"}
      data-plan={plan}
      className="space-y-4 rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-5"
    >
      <header className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-lime" aria-hidden />
        <h3 className="font-display text-lg text-paper">Billing</h3>
      </header>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Current plan
          </div>
          <div className="text-2xl font-display text-paper">
            {plan[0].toUpperCase() + plan.slice(1)}{" "}
            <span className="text-paper-dim">{PLAN_PRICE[plan]}</span>
          </div>
        </div>
        {trialEndsAt && trialEndsAt > Date.now() && (
          <div className="rounded-full border border-lime/40 bg-lime/5 px-3 py-1 text-xs text-lime">
            Trial ends {new Date(trialEndsAt).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-xl bg-ink-3/40 p-4">
        <div className="flex items-center gap-2 text-sm text-paper">
          <Mic className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
          <span>Voice minutes</span>
          <span className="ml-auto font-mono text-xs text-paper-faint">
            {voice.minutesUsed} / {voice.minutesIncluded || "—"} this month
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
              ? ` · hard cap ${voice.hardCap}/mo`
              : ""}
          </p>
        )}
        {!voice.enabled && (
          <p className="text-[11px] text-paper-faint">
            Voice not included on this plan.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-ink-3/40 p-4 text-sm">
        <span className="text-paper-dim">Chat-turn cap</span>
        <span className="font-mono text-xs text-paper">
          {chat.cap === "unlimited" ? "Unlimited" : chat.cap}
        </span>
      </div>

      {onOpenPortal && (
        <button
          type="button"
          onClick={onOpenPortal}
          data-testid="biz-billing-portal-btn"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-ink-3 px-4 py-2 text-xs text-paper transition-colors hover:bg-ink-3/80"
        >
          Open billing portal
        </button>
      )}
    </section>
  );
}
