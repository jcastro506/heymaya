/**
 * Voice setup panel — Studio-only Profile screen surface.
 *
 * Wave D — service plan § 13 Sprint 6. Lives inside the Profile → Connections
 * tab and supplements the existing `ConnectionsPanel`'s Voice row by giving
 * the operator the controls needed to actually run voice:
 *   - Enable/disable voice toggle (Studio-only — UI greys + "Upgrade to
 *     Studio" otherwise)
 *   - Twilio number display (read-only)
 *   - PIN setup field (4-6 digits)
 *   - Realtime provider selector (ElevenLabs / Gemini Live)
 *   - Allowlist input (E.164 numbers Maya answers)
 *   - Test-call button (placeholder UX; outbound call surfaces in Wave D
 *     beta hardening)
 *
 * Plan-tier UX: non-Studio shows a single "Upgrade to Studio" CTA with a
 * brief value prop. Pro tier has a voice-inclusion bucket but the channel
 * config UI is Studio-only per § 5 onboarding Q8.
 */

"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Mic, ShieldCheck, Phone } from "lucide-react";

export interface VoiceSetupPanelProps {
  voiceChannel: Doc<"voiceChannels"> | null;
  /** True iff `planFeaturesService(business).voice && plan === "studio"`. */
  studioVoice: boolean;
  /** True iff Pro+ — used to surface Pro inclusion-bucket messaging. */
  proInclusion: boolean;
  testId?: string;
}

export function VoiceSetupPanel({
  voiceChannel,
  studioVoice,
  proInclusion,
  testId,
}: VoiceSetupPanelProps) {
  const setPin = useAction(api.voice.transcripts.setMyVoicePin);
  const updateSettings = useAction(
    api.voice.transcripts.updateMyVoiceSettings
  );

  const [pinDraft, setPinDraft] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);

  const [allowlistDraft, setAllowlistDraft] = useState(
    (voiceChannel?.inboundAllowlist ?? []).join("\n")
  );
  const [providerDraft, setProviderDraft] = useState<
    "elevenlabs" | "gemini-live"
  >(voiceChannel?.realtimeProvider ?? "elevenlabs");
  const [settingsSaving, setSettingsSaving] = useState(false);

  if (!studioVoice) {
    return (
      <section
        data-testid={testId ?? "biz-voice-setup-panel"}
        data-studio-voice="false"
        className="rounded-xl border border-[var(--hairline)] bg-ink-3/40 p-5"
      >
        <div className="flex items-center gap-2 text-paper">
          <Mic className="h-4 w-4 text-paper-faint" />
          <span className="text-sm font-medium">Voice (Maya answers calls)</span>
        </div>
        <p className="mt-2 text-xs text-paper-faint">
          {proInclusion
            ? "Pro includes 30 voice minutes per month for sampling. Upgrade to Studio to wire up your own number, allowlist customers, and let Maya answer the phone."
            : "Voice is included on Studio. Maya answers your phone with your brand voice, takes job notes, and PIN-gates anything that touches CRM."}
        </p>
        <div className="mt-3">
          <span className="rounded-full border border-paper-faint/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-faint">
            Studio
          </span>
        </div>
      </section>
    );
  }

  const onSavePin = async () => {
    setPinError(null);
    setPinSuccess(false);
    if (!/^[0-9]{4,6}$/.test(pinDraft)) {
      setPinError("PIN must be 4-6 digits.");
      return;
    }
    setPinSaving(true);
    try {
      await setPin({ pin: pinDraft });
      setPinSuccess(true);
      setPinDraft("");
    } catch (err) {
      setPinError((err as Error).message);
    } finally {
      setPinSaving(false);
    }
  };

  const onSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      const list = allowlistDraft
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await updateSettings({
        allowlist: list,
        realtimeProvider: providerDraft,
      });
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <section
      data-testid={testId ?? "biz-voice-setup-panel"}
      data-studio-voice="true"
      className="space-y-3 rounded-xl border border-[var(--hairline)] bg-ink-3/40 p-5"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-lime" />
          <span className="text-sm font-medium text-paper">
            Voice setup (Studio)
          </span>
        </div>
        <span className="rounded-full border border-lime/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-lime">
          {voiceChannel ? "Active" : "Pending"}
        </span>
      </header>

      <div className="rounded-lg border border-[var(--hairline)] bg-ink-2/40 p-3">
        <div className="text-xs uppercase tracking-wider text-paper-faint">
          Twilio number
        </div>
        <div
          data-testid="biz-voice-twilio-number"
          className="mt-1 font-mono text-sm text-paper"
        >
          {voiceChannel?.twilioPhoneNumber ?? "Not yet provisioned"}
        </div>
      </div>

      {/* PIN setup */}
      <div className="rounded-lg border border-[var(--hairline)] bg-ink-2/40 p-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-lime" />
          <span className="text-xs uppercase tracking-wider text-paper-faint">
            PIN for sensitive ops
          </span>
        </div>
        <p className="mt-1 text-xs text-paper-faint">
          Maya asks for this PIN before creating jobs, sending invoices, posting,
          or modifying customer records via voice.{" "}
          {voiceChannel?.pinHash ? "PIN currently set." : "Not set yet."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            data-testid="biz-voice-pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="4-6 digits"
            value={pinDraft}
            onChange={(e) => setPinDraft(e.target.value.replace(/[^0-9]/g, ""))}
            className="rounded-md border border-[var(--hairline)] bg-ink/80 px-3 py-1.5 font-mono text-sm text-paper outline-none focus:border-lime"
          />
          <button
            data-testid="biz-voice-pin-save"
            type="button"
            disabled={pinSaving || pinDraft.length < 4}
            onClick={onSavePin}
            className="rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-medium text-lime transition-colors hover:bg-lime/20 disabled:opacity-50"
          >
            {pinSaving ? "Saving…" : voiceChannel?.pinHash ? "Rotate PIN" : "Save PIN"}
          </button>
          {pinError ? (
            <span className="text-xs text-amber-300">{pinError}</span>
          ) : null}
          {pinSuccess ? (
            <span className="text-xs text-lime">Saved.</span>
          ) : null}
        </div>
      </div>

      {/* Realtime + allowlist */}
      <div className="rounded-lg border border-[var(--hairline)] bg-ink-2/40 p-3">
        <div className="flex items-center gap-2">
          <Phone className="h-3.5 w-3.5 text-lime" />
          <span className="text-xs uppercase tracking-wider text-paper-faint">
            Inbound config
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-paper-faint">
            Realtime provider
            <select
              data-testid="biz-voice-provider-select"
              value={providerDraft}
              onChange={(e) =>
                setProviderDraft(
                  e.target.value as "elevenlabs" | "gemini-live"
                )
              }
              className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-ink/80 px-2 py-1.5 text-sm text-paper"
            >
              <option value="elevenlabs">ElevenLabs (default)</option>
              <option value="gemini-live">Gemini Live</option>
            </select>
          </label>

          <label className="block text-xs text-paper-faint sm:col-span-2">
            Allowlist (one E.164 number per line, e.g. +14155551234)
            <textarea
              data-testid="biz-voice-allowlist"
              value={allowlistDraft}
              onChange={(e) => setAllowlistDraft(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-ink/80 px-2 py-1.5 font-mono text-xs text-paper"
              placeholder="+15551234567"
            />
          </label>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            data-testid="biz-voice-settings-save"
            type="button"
            disabled={settingsSaving}
            onClick={onSaveSettings}
            className="rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-medium text-lime transition-colors hover:bg-lime/20 disabled:opacity-50"
          >
            {settingsSaving ? "Saving…" : "Save voice settings"}
          </button>
        </div>
      </div>

      <p className="text-xs text-paper-faint">
        Test calls will land in beta hardening (Sprint 7). For now, dial your
        Twilio number from an allow-listed line to verify the inbound greeting.
      </p>
    </section>
  );
}
