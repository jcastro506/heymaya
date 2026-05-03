/**
 * ChannelPairingCard — Sprint 6C.
 *
 * Self-contained card the Profile screen drops in. Reads its own data from
 * Convex (via `useQuery(api.creators.me)` + `useQuery(api.integrations.openclaw.channels.listPairedChannels)`)
 * and exposes pair / confirm / unpair flows for iMessage, WhatsApp, and SMS.
 *
 * Responsibilities (project_openclaw_alignment.md):
 *   - This component is the orchestration UI ONLY. OpenClaw owns all message
 *     routing, inbound handling, and outbound delivery natively. We render the
 *     plan-tier gate, collect the E.164 phone number, fire `requestPairing`,
 *     show the QR code (iMessage/WhatsApp) or SMS code-entry form (SMS), and
 *     fire `confirmPairing`. After that, OpenClaw takes over.
 *
 * Props:
 *   - variant: "default" (full pairing UI) | "compact" (status badges only).
 *     6A's profile page uses "default"; an inline summary placement could use
 *     "compact" to render a quick "iMessage paired" pill without buttons.
 */

"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export interface ChannelPairingCardProps {
  variant?: "default" | "compact";
}

const PAIRABLE: ReadonlyArray<"imessage" | "whatsapp" | "sms"> = [
  "imessage",
  "whatsapp",
  "sms",
];

const CHANNEL_LABEL: Record<"imessage" | "whatsapp" | "sms", string> = {
  imessage: "iMessage",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

export function ChannelPairingCard(
  props: ChannelPairingCardProps = {}
) {
  const variant = props.variant ?? "default";
  const me = useQuery(api.creators.me);
  const paired = useQuery(
    api.integrations.openclaw.channels.listPairedChannels
  );

  const requestPairing = useAction(
    api.integrations.openclaw.channels.requestPairing
  );
  const confirmPairing = useAction(
    api.integrations.openclaw.channels.confirmPairing
  );
  const unpairChannel = useAction(
    api.integrations.openclaw.channels.unpairChannel
  );

  // Local UI state — which channel is mid-pair, the in-flight payload, the
  // most recent error string. Intentionally not lifted: the entire flow is
  // ephemeral; refreshing the page should reset to "neutral".
  const [activePair, setActivePair] = useState<{
    channel: "imessage" | "whatsapp" | "sms";
    pairingId?: string;
    qrCodeDataUrl?: string;
    smsConfirmationCodeRequested?: boolean;
  } | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!me || paired === undefined) {
    return (
      <div
        className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-6 text-sm text-paper-faint"
        data-testid="channel-pairing-loading"
      >
        Loading channel pairing.
      </div>
    );
  }

  const allowedSet = new Set(allowedChannelsForPlan(me.plan));

  if (variant === "compact") {
    return (
      <div
        className="flex flex-wrap gap-2"
        data-testid="channel-pairing-compact"
      >
        {paired
          .filter((p) => p.status === "active")
          .map((p) => (
            <span
              key={p.externalPairingId}
              className="rounded-full border border-[var(--hairline)] bg-ink-2/40 px-3 py-1 font-mono text-[11px] text-paper-dim"
            >
              {CHANNEL_LABEL[p.channel]} paired
            </span>
          ))}
        {paired.filter((p) => p.status === "active").length === 0 && (
          <span className="font-mono text-[11px] text-paper-faint">
            No paired channels.
          </span>
        )}
      </div>
    );
  }

  const onPair = async (channel: "imessage" | "whatsapp" | "sms") => {
    setErrorMsg(null);
    if (!phoneInput.trim()) {
      setErrorMsg("Enter your phone number first (E.164, e.g. +14155551234).");
      return;
    }
    setBusy(true);
    try {
      const res = await requestPairing({
        channel,
        phoneNumber: phoneInput.trim(),
      });
      setActivePair({
        channel,
        pairingId: res.pairingId,
        qrCodeDataUrl: res.qrCodeDataUrl,
        smsConfirmationCodeRequested: channel === "sms",
      });
      setCodeInput("");
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (!activePair?.pairingId) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await confirmPairing({
        pairingId: activePair.pairingId,
        confirmationCode:
          activePair.channel === "sms" ? codeInput.trim() : undefined,
      });
      setActivePair(null);
      setPhoneInput("");
      setCodeInput("");
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onUnpair = async (channel: "imessage" | "whatsapp" | "sms") => {
    setErrorMsg(null);
    setBusy(true);
    try {
      await unpairChannel({ channel });
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-2xl border border-[var(--hairline)] bg-ink-2/40 p-6"
      data-testid="channel-pairing-card"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            Channel
          </p>
          <p className="text-base text-paper">
            Currently routing to{" "}
            <span className="font-mono text-paper">
              {me.channelPreference}
            </span>
          </p>
        </div>
        <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
          {me.plan}
        </span>
      </div>

      {/* Active pair-flow modal-ish region */}
      {activePair && (
        <div
          className="mb-5 rounded-xl border border-[var(--hairline-strong)] bg-ink-2/60 p-4"
          data-testid="channel-pairing-active"
        >
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            Confirm {CHANNEL_LABEL[activePair.channel]}
          </p>
          {activePair.qrCodeDataUrl ? (
            <div className="mb-3">
              <p className="mb-2 text-sm text-paper-dim">
                Scan this with your {CHANNEL_LABEL[activePair.channel]} app to
                finish pairing.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from OpenClaw, no need for next/image */}
              <img
                src={activePair.qrCodeDataUrl}
                alt={`Pair ${CHANNEL_LABEL[activePair.channel]} QR code`}
                className="h-40 w-40 rounded bg-paper p-2"
                data-testid="channel-pairing-qr"
              />
            </div>
          ) : null}
          {activePair.smsConfirmationCodeRequested && (
            <div className="mb-3">
              <p className="mb-2 text-sm text-paper-dim">
                We sent a code to {phoneInput}. Enter it below.
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={codeInput}
                onChange={(e) =>
                  setCodeInput(e.target.value.toUpperCase().slice(0, 12))
                }
                placeholder="ABCD12"
                className="w-full rounded border border-[var(--hairline)] bg-ink-2 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-dim"
                data-testid="channel-pairing-sms-code-input"
              />
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-full bg-paper px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink disabled:opacity-50"
              data-testid="channel-pairing-confirm-btn"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setActivePair(null);
                setCodeInput("");
              }}
              className="rounded-full border border-[var(--hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Phone number input + pair buttons */}
      {!activePair && (
        <div className="mb-5">
          <label
            htmlFor="channel-pair-phone"
            className="mb-1 block font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint"
          >
            Phone (E.164)
          </label>
          <input
            id="channel-pair-phone"
            type="tel"
            inputMode="tel"
            placeholder="+14155551234"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            className="w-full rounded border border-[var(--hairline)] bg-ink-2 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-dim"
            data-testid="channel-pairing-phone-input"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {PAIRABLE.map((channel) => {
              const allowed = allowedSet.has(channel);
              return (
                <button
                  key={channel}
                  type="button"
                  disabled={!allowed || busy}
                  onClick={() => onPair(channel)}
                  className="rounded-full border border-[var(--hairline)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim transition hover:border-paper-dim hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    allowed
                      ? `Pair ${CHANNEL_LABEL[channel]}`
                      : `${CHANNEL_LABEL[channel]} not available on this plan`
                  }
                  data-testid={`channel-pairing-pair-btn-${channel}`}
                >
                  Pair {CHANNEL_LABEL[channel]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error surface */}
      {errorMsg && (
        <p
          className="mb-3 rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 font-mono text-[11px] text-amber-200"
          data-testid="channel-pairing-error"
        >
          {errorMsg}
        </p>
      )}

      {/* Active / past pairings */}
      <div className="mt-5">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Pairings
        </p>
        {paired.length === 0 && (
          <p className="font-mono text-[11px] text-paper-faint">
            No pairings yet.
          </p>
        )}
        <ul className="space-y-2">
          {paired.map((p) => (
            <li
              key={p.externalPairingId}
              className="flex items-center justify-between rounded border border-[var(--hairline)] bg-ink-2/40 px-3 py-2"
              data-testid={`channel-pairing-row-${p.channel}-${p.status}`}
            >
              <div className="min-w-0">
                <p className="text-sm text-paper">
                  {CHANNEL_LABEL[p.channel]}{" "}
                  <span className="font-mono text-[11px] text-paper-faint">
                    · {p.status}
                  </span>
                </p>
                <p className="font-mono text-[11px] text-paper-faint">
                  {p.phoneNumber}
                </p>
              </div>
              {p.status === "active" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onUnpair(p.channel)}
                  className="rounded-full border border-[var(--hairline)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim hover:border-paper-dim hover:text-paper disabled:opacity-50"
                  data-testid={`channel-pairing-unpair-btn-${p.channel}`}
                >
                  Unpair
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mirror of `planFeatures(creator).allowedChannels` for the three pairable
 * channels. Used purely as a UX hint — the server enforces the gate
 * (channels.ts → planFeatures) on every request, so this client-side check
 * cannot grant access if the server denies it.
 *
 * Channels are OpenClaw-native — no per-tier cost. Every plan can pair every
 * channel. The `plan` parameter is retained for future-proofing in case a
 * later tier philosophy needs to gate one of these (e.g. an internal-only
 * channel).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- plan kept for forward-compat / API symmetry
function allowedChannelsForPlan(
  plan: "starter" | "pro" | "studio"
): ReadonlyArray<"imessage" | "whatsapp" | "sms"> {
  return ["imessage", "whatsapp", "sms"];
}
