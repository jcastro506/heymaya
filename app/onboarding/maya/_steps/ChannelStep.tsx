"use client";

/**
 * Step 4: Channel.
 *
 * Phone number capture + channel routing recommendation. Device-detect via
 * `navigator.userAgent` and recommend (but never silently force) the channel
 * that matches:
 *   - iPhone → iMessage
 *   - Android → WhatsApp (rich media)
 *   - Anything else → web (no phone needed)
 *
 * SMS is always available as a fallback but carries an explicit
 * degraded-experience warning ("you won't be able to send me images/videos
 * via SMS"). Web chat is always offered as the zero-friction option.
 *
 * Plan-tier note: Starter creators don't get iMessage/WhatsApp at all — those
 * options are visually disabled with a "Pro" badge here. Server-side gating
 * lives in `convex/lib/planFeatures.ts` and the deploy pipeline; the UI cap
 * is just to avoid asking for a phone number we can't route to.
 */

import { useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Globe,
  MessageCircle,
  MessageSquare,
  Phone,
  Smartphone,
} from "lucide-react";
import {
  PLAN_ALLOWED_CHANNELS,
  recommendChannel,
  type Channel,
  type ChannelState,
  type OnboardingState,
} from "../_state";
import { StepShell, StepFooter } from "./HandlesStep";

interface ChannelStepProps {
  state: OnboardingState;
  setChannel: (next: ChannelState) => void;
  onAdvance: () => void;
}

interface ChannelCard {
  id: Channel;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Channel-specific warning copy shown when the user picks it. */
  warning?: string;
}

const CHANNEL_CARDS: ReadonlyArray<ChannelCard> = [
  {
    id: "imessage",
    label: "iMessage",
    blurb: "Best on iPhone. Rich media, read receipts, fast.",
    icon: Smartphone,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    blurb: "Best on Android. Rich media, voice notes, global.",
    icon: MessageCircle,
  },
  {
    id: "sms",
    label: "SMS",
    blurb: "Universal fallback. Text only.",
    icon: MessageSquare,
    warning:
      "Heads up — over SMS, Maya can't send you images, videos, or thread previews. She'll still text you the words but the rich stuff lives in web chat.",
  },
  {
    id: "web",
    label: "Web chat only",
    blurb: "No phone number needed. Open the dashboard to talk.",
    icon: Globe,
  },
];

export function ChannelStep({ state, setChannel, onAdvance }: ChannelStepProps) {
  const allowedChannels = PLAN_ALLOWED_CHANNELS[state.plan];

  // On mount, detect the user agent and seed the recommendation.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (state.channel.recommended !== "web" || state.channel.selected !== "web") return;
    const recommended = recommendChannel(navigator.userAgent);
    // If the recommendation isn't allowed by plan, fall back to web.
    const finalRec = allowedChannels.has(recommended) ? recommended : "web";
    setChannel({
      ...state.channel,
      recommended: finalRec,
      selected: finalRec,
    });
    // We intentionally only run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init: re-running on dep change would clobber the user's selection
  }, []);

  const selectedCard = CHANNEL_CARDS.find((c) => c.id === state.channel.selected);
  const phoneRequired = state.channel.selected !== "web";
  const phoneValid = !phoneRequired || /^[+]?[\d\s\-()]{7,}$/.test(state.channel.phoneNumber.trim());

  return (
    <StepShell
      eyebrow="§04 · Channel"
      title="Where should Maya text you?"
      caption="The whole point is she lives in your messages. Pick where that is — you can change it later from Profile."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CHANNEL_CARDS.map((card) => {
          const allowed = allowedChannels.has(card.id);
          const selected = state.channel.selected === card.id;
          const recommended = state.channel.recommended === card.id;
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              disabled={!allowed}
              onClick={() => setChannel({ ...state.channel, selected: card.id })}
              className={`relative flex items-start gap-4 rounded-2xl border p-5 text-left transition-colors ${
                selected
                  ? "border-lime bg-ink-3"
                  : allowed
                    ? "border-[var(--hairline-strong)] bg-ink-2 hover:border-paper-dim"
                    : "cursor-not-allowed border-[var(--hairline)] bg-ink-2/40 opacity-50"
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${
                  selected ? "border-lime text-lime" : "border-[var(--hairline-strong)] text-paper-dim"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-xl text-paper">{card.label}</span>
                  {recommended && allowed && (
                    <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-ink">
                      Picked for you
                    </span>
                  )}
                  {!allowed && (
                    <span className="rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-paper-faint">
                      Pro
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-paper-dim">{card.blurb}</p>
              </div>
            </button>
          );
        })}
      </div>

      {!allowedChannels.has("imessage") && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[var(--hairline-strong)] bg-ink-3 p-4 text-sm text-paper-dim">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            Starter
          </span>
          <p className="flex-1">
            iMessage and WhatsApp are Manager features.{" "}
            <Link
              href="/checkout?tier=manager&interval=monthly"
              className="text-lime underline-offset-2 hover:underline"
            >
              Start a 7-day Manager trial
            </Link>
            {" "}— no card required.
          </p>
        </div>
      )}

      {/* Phone number input — hidden when web-only. */}
      {phoneRequired && (
        <div className="mt-6">
          <label className="mb-2 block font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            Phone number
          </label>
          <div className="flex items-center rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 px-4">
            <Phone className="h-4 w-4 text-paper-faint" />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={state.channel.phoneNumber}
              onChange={(e) =>
                setChannel({ ...state.channel, phoneNumber: e.target.value })
              }
              placeholder="+1 415 555 0101"
              className="h-14 w-full bg-transparent pl-3 text-base text-paper outline-none placeholder:text-paper-faint"
              aria-label="Your phone number"
            />
          </div>
          <p className="mt-2 text-xs text-paper-faint">
            We use this only to route Maya&rsquo;s messages. Never sold, never
            spammed, never used for marketing.
          </p>
        </div>
      )}

      {selectedCard?.warning && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose/40 bg-ink-2 p-4 text-sm text-paper-dim">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose" />
          <p>{selectedCard.warning}</p>
        </div>
      )}

      <StepFooter
        leftMeta={state.channel.selected === "web" ? "Web chat · no phone needed" : undefined}
        canAdvance={phoneValid}
        onAdvance={onAdvance}
        advanceLabel="Connect your tools"
      />
    </StepShell>
  );
}
