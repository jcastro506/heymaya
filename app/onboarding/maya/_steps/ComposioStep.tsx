"use client";

/**
 * Step 5: Composio connections.
 *
 * Three optional connections, ordered deliberately:
 *   1. Calendar (calendar leads — per the recent sprint doc update, this is
 *      the highest-value Composio connection because it converts Maya from
 *      reactive to anticipatory)
 *   2. Gmail
 *   3. Stripe
 *
 * Calendar is gated by a one-time skip-nudge dialog so the creator has to
 * explicitly choose to skip it. Stripe is offered to every plan; Gmail and
 * Calendar are Pro+ only and visually present a "Pro" badge with a trial CTA
 * for Starter creators.
 *
 * Plan-tier note: server-side enforcement is in `convex/lib/planFeatures.ts`.
 * The frontend mirrors the gating in `_state.ts`'s `PLAN_ALLOWED_PROVIDERS`
 * for UX cues only.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Calendar as CalendarIcon,
  Check,
  CreditCard,
  Loader2,
  Mail,
} from "lucide-react";
import {
  PLAN_ALLOWED_PROVIDERS,
  markCalendarSkipNudgeShown,
  recordProviderConnection,
  recordProviderSkip,
  type OnboardingState,
  type Provider,
} from "../_state";
import { StepShell, StepFooter } from "./HandlesStep";

interface ComposioStepProps {
  state: OnboardingState;
  setState: (next: OnboardingState) => void;
  onAdvance: () => void;
}

interface ProviderCard {
  id: Provider;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pitch: string;
  /** Sub-pitch shown smaller below the main line. */
  detail: string;
  /** True iff this provider should be visually emphasized. */
  headline?: boolean;
}

const PROVIDER_CARDS: ReadonlyArray<ProviderCard> = [
  {
    id: "calendar",
    label: "Calendar (Google + Microsoft)",
    icon: CalendarIcon,
    pitch:
      "Got a wedding, trip, launch, or shoot coming up? Maya plans content arcs around your real life — build-up, day-of, recap.",
    detail:
      "Maya scans 1–14 days out daily. Drops content arcs into your weekly plan automatically. Skips work meetings & private events.",
    headline: true,
  },
  {
    id: "gmail",
    label: "Gmail",
    icon: Mail,
    pitch: "Maya can triage brand emails for you.",
    detail:
      "She drafts 4 reply variants tuned to your floor rate, flags red-flag contracts, and never sends without your approval.",
  },
  {
    id: "stripe",
    label: "Stripe",
    icon: CreditCard,
    pitch: "See what you actually earned this month.",
    detail:
      "Read-only revenue snapshot Monday morning. No write access, ever — Maya can't move money.",
  },
];

export function ComposioStep({ state, setState, onAdvance }: ComposioStepProps) {
  const allowedProviders = PLAN_ALLOWED_PROVIDERS[state.plan];
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [showCalendarSkipDialog, setShowCalendarSkipDialog] = useState(false);

  const onConnect = async (provider: Provider) => {
    setConnecting(provider);
    try {
      // Inline OAuth wiring lives behind the Profile screen post-deploy
      // (see app/(creator)/profile/page.tsx + convex/integrations/composio).
      // The onboarding flow keeps this an in-memory connect placeholder so
      // the sub-4-min onboarding never blocks on a popup-blocked OAuth
      // window. Real Composio OAuth wiring during onboarding is tracked
      // separately — TODO(s7): inline the OAuth round-trip via callback
      // page once the OAuth callback router lands.
      await new Promise((resolve) => setTimeout(resolve, 900));
      const composioAccountId = `pending_${provider}_${Date.now()}`;
      setState(recordProviderConnection(state, provider, composioAccountId));
    } finally {
      setConnecting(null);
    }
  };

  const onSkip = (provider: Provider) => {
    if (provider === "calendar" && !state.composio.calendarSkipNudgeShown) {
      // First skip click — show the nudge and remember we showed it.
      setState(markCalendarSkipNudgeShown(state));
      setShowCalendarSkipDialog(true);
      return;
    }
    setState(recordProviderSkip(state, provider));
    if (provider === "calendar") setShowCalendarSkipDialog(false);
  };

  return (
    <StepShell
      eyebrow="§05 · Connections"
      title="Hand Maya the keys you want her to have."
      caption="All optional. All revocable from Profile any time. Maya never logs in as you — every write is OAuth-scoped through Composio."
    >
      <ul className="space-y-4">
        {PROVIDER_CARDS.map((card) => {
          const allowed = allowedProviders.has(card.id);
          const record = state.composio.providers[card.id];
          const isConnecting = connecting === card.id;
          const Icon = card.icon;
          return (
            <li
              key={card.id}
              className={`relative overflow-hidden rounded-2xl border p-5 transition-colors sm:p-6 ${
                card.headline
                  ? "border-lime/40 bg-ink-3"
                  : "border-[var(--hairline-strong)] bg-ink-2"
              } ${allowed ? "" : "opacity-60"}`}
            >
              {card.headline && (
                <div className="absolute right-5 top-5 hidden rounded-full bg-lime px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-ink sm:block">
                  Recommended
                </div>
              )}
              <div className="flex items-start gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-lime">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-display text-xl text-paper">{card.label}</span>
                    {!allowed && (
                      <span className="rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-paper-faint">
                        Pro
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-base leading-relaxed text-paper-dim">{card.pitch}</p>
                  <p className="mt-2 text-sm text-paper-faint">{card.detail}</p>

                  {!allowed ? (
                    <div className="mt-4">
                      <Link
                        href="/sign-up?plan=pro&trial=true"
                        className="btn btn-ghost h-10 px-4 text-sm"
                      >
                        Start Pro trial
                      </Link>
                    </div>
                  ) : record?.status === "connected" ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-lime bg-lime/10 px-3 py-1 text-xs text-lime">
                      <Check className="h-3.5 w-3.5" />
                      Connected
                    </div>
                  ) : record?.status === "skipped" ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <span className="text-xs text-paper-faint">Skipped — you can connect later from Profile.</span>
                      <button
                        type="button"
                        onClick={() => void onConnect(card.id)}
                        className="text-xs text-lime underline-offset-2 hover:underline"
                      >
                        Connect now
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void onConnect(card.id)}
                        disabled={isConnecting}
                        className="btn btn-primary h-10 px-4 text-sm disabled:opacity-50"
                      >
                        {isConnecting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Opening…
                          </>
                        ) : (
                          `Connect ${card.label.split(" ")[0]}`
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSkip(card.id)}
                        className="text-sm text-paper-faint hover:text-paper-dim"
                      >
                        Skip for now
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Calendar skip-nudge — surfaces on first skip click only. */}
      {showCalendarSkipDialog && (
        <div
          role="alertdialog"
          aria-labelledby="cal-skip-title"
          className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4"
          onClick={() => setShowCalendarSkipDialog(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:p-7"
          >
            <h3
              id="cal-skip-title"
              className="font-display text-2xl leading-snug text-paper"
            >
              Sure you want to skip calendar?
            </h3>
            <p className="mt-3 text-paper-dim">
              Calendar is what turns Maya from reactive (post analysis) into
              anticipatory (life-event-driven content arcs). Without it she
              can&rsquo;t plan around your wedding, trip, launch, or shoot. You
              can connect it later but most creators wish they had from day 1.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setState(recordProviderSkip(state, "calendar"));
                  setShowCalendarSkipDialog(false);
                }}
                className="btn btn-ghost h-11 px-5 text-sm"
              >
                Skip anyway
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCalendarSkipDialog(false);
                  void onConnect("calendar");
                }}
                className="btn btn-primary h-11 px-5 text-sm"
              >
                Connect calendar
              </button>
            </div>
          </div>
        </div>
      )}

      <StepFooter
        leftMeta="All optional · revocable any time"
        canAdvance
        onAdvance={onAdvance}
        advanceLabel="Deploy Maya"
      />
    </StepShell>
  );
}
