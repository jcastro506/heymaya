"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Store,
  Target,
} from "lucide-react";

const TZ =
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "America/New_York";

const businessTypes = [
  "creator-led business",
  "local service business",
  "commerce brand",
  "agency or studio",
  "software or digital product",
  "other",
];

const channels = [
  "TikTok",
  "Instagram",
  "Google Business Profile",
  "Email",
  "LinkedIn",
  "YouTube",
];

export function BusinessMayaV0Onboarding() {
  const { user } = useUser();
  const startOnboarding = useAction(
    api.onboarding.business.pipeline.startServiceOnboarding
  );
  const recordStep = useAction(
    api.onboarding.business.pipeline.recordOnboardingStep
  );
  const saveIntake = useAction(
    api.onboarding.business.pipeline.saveBusinessMayaV0Intake
  );

  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState(businessTypes[0]);
  const [offer, setOffer] = useState("");
  const [customer, setCustomer] = useState("");
  const [market, setMarket] = useState("");
  const [goal, setGoal] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([
    "Instagram",
  ]);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signedIn = Boolean(user);
  const ready = businessName.trim() && offer.trim() && customer.trim() && goal.trim();
  const selectedChannelCopy = useMemo(
    () =>
      selectedChannels.length > 0
        ? selectedChannels.join(", ")
        : "No channels selected yet",
    [selectedChannels]
  );

  async function saveSetup() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await startOnboarding({ timezone: TZ });
      await recordStep({
        step: "name",
        payload: { name: businessName.trim() },
      });
      await recordStep({
        step: "service-types",
        payload: { serviceTypes: [businessType] },
      });
      await saveIntake({
        businessType,
        offer: offer.trim(),
        targetCustomer: customer.trim(),
        market: market.trim(),
        topMarketingGoal: goal.trim(),
        channels: selectedChannels,
        phoneNumber: phone.trim() || undefined,
        timezone: TZ,
      });
      setNotice(
        "Business profile saved. Next beta step: connect calendar, message channel, and the marketing surfaces Maya should watch."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggleChannel(channel: string) {
    setSelectedChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel]
    );
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:px-10">
        <section className="space-y-7">
          <header className="border-b border-[var(--hairline)] pb-6">
            <Link href="/" className="inline-flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-lime font-display text-lg text-ink">
                m
              </span>
              <span className="font-display text-xl text-paper">HeyMaya</span>
            </Link>
            <p className="mt-7 font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
              Business Maya · Powered by OpenClaw
            </p>
            <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-paper sm:text-5xl">
              Give your business a marketing manager before you hire one.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-paper-dim sm:text-base">
              Maya learns what you sell, who you sell to, what is on your
              calendar, and which channels matter. The website sets the business
              profile. The operating product is the message thread.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {!signedIn ? (
                <>
                  <Link
                    href="/sign-up?redirect_url=/business-maya-v0"
                    className="inline-flex min-h-11 items-center gap-2 rounded-md bg-paper px-4 text-sm font-medium text-black transition hover:bg-white"
                  >
                    Create account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/sign-in?redirect_url=/business-maya-v0"
                    className="inline-flex min-h-11 items-center rounded-md border border-[var(--hairline-strong)] px-4 text-sm text-paper-dim transition hover:text-paper"
                  >
                    Sign in
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy || !ready}
                  onClick={saveSetup}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-paper px-4 text-sm font-medium text-black transition hover:bg-white disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save business setup
                </button>
              )}
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2">
            <StatusTile icon={<Store className="h-4 w-4" />} label="Business" value={businessName || "needed"} />
            <StatusTile icon={<Target className="h-4 w-4" />} label="Goal" value={goal || "needed"} />
            <StatusTile icon={<CalendarClock className="h-4 w-4" />} label="Calendar" value="next step" />
            <StatusTile icon={<MessageSquareText className="h-4 w-4" />} label="Phone" value={phone || "needed"} />
          </section>

          <section className="space-y-4 rounded-lg border border-[var(--hairline)] bg-ink-2 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Business name" value={businessName} onChange={setBusinessName} />
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  Business type
                </span>
                <select
                  value={businessType}
                  onChange={(event) => setBusinessType(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[var(--hairline)] bg-ink px-3 py-2 text-sm text-paper outline-none focus:border-paper-dim"
                >
                  {businessTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <TextInput label="What do you sell?" value={offer} onChange={setOffer} />
              <TextInput label="Target customer" value={customer} onChange={setCustomer} />
              <TextInput label="Market or service area" value={market} onChange={setMarket} />
              <TextInput label="Phone for Maya" value={phone} onChange={setPhone} />
            </div>

            <TextInput
              label="Top marketing goal"
              value={goal}
              onChange={setGoal}
              placeholder="Example: turn more job photos into posts, get more inbound leads, launch a new offer"
            />

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                Channels Maya should know about
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {channels.map((channel) => {
                  const active = selectedChannels.includes(channel);
                  return (
                    <button
                      key={channel}
                      type="button"
                      onClick={() => toggleChannel(channel)}
                      className={`rounded-md border px-3 py-2 text-sm transition ${
                        active
                          ? "border-lime/40 bg-lime/15 text-lime"
                          : "border-[var(--hairline)] bg-ink text-paper-dim hover:text-paper"
                      }`}
                    >
                      {channel}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {(notice || error) && (
            <div
              className={`rounded-lg border p-4 text-sm ${
                error
                  ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                  : "border-lime/25 bg-lime/10 text-lime-soft"
              }`}
            >
              {error ?? notice}
            </div>
          )}
        </section>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-lg border border-[var(--hairline)] bg-ink-2">
            <div className="border-b border-[var(--hairline)] p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint">
                What Maya will do
              </p>
              <h2 className="mt-2 font-display text-3xl leading-tight text-paper">
                Watch the work, plan the marketing, keep you moving.
              </h2>
            </div>
            <div className="space-y-4 p-5">
              <PreviewLine icon={<BriefcaseBusiness className="h-4 w-4" />} title="Business picture">
                {businessName || "Your business"} sells {offer || "a clear offer"} to{" "}
                {customer || "a specific customer"}.
              </PreviewLine>
              <PreviewLine icon={<Target className="h-4 w-4" />} title="Marketing goal">
                {goal || "Maya needs one concrete business outcome to optimize for."}
              </PreviewLine>
              <PreviewLine icon={<CalendarClock className="h-4 w-4" />} title="Calendar-aware planning">
                Maya uses launches, appointments, jobs, trips, and open blocks
                to propose useful marketing moments.
              </PreviewLine>
              <PreviewLine icon={<MessageSquareText className="h-4 w-4" />} title="Message-first runtime">
                After setup, Maya lives in your phone and keeps the plan moving
                without asking you to manage another dashboard.
              </PreviewLine>
            </div>
            <div className="border-t border-[var(--hairline)] p-5 text-sm text-paper-faint">
              Selected channels: {selectedChannelCopy}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-md border border-[var(--hairline)] bg-ink px-3 py-2 text-sm text-paper outline-none placeholder:text-paper-faint focus:border-paper-dim"
      />
    </label>
  );
}

function StatusTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--hairline)] bg-ink-2 p-4">
      <span className="text-paper-faint">{icon}</span>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </p>
      <p className="mt-2 truncate text-sm text-paper">{value}</p>
    </div>
  );
}

function PreviewLine({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-ink-3 text-lime">
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-medium text-paper">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-paper-dim">{children}</p>
      </div>
    </div>
  );
}
