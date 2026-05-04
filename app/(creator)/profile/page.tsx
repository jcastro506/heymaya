/**
 * Profile screen — Sprint 6A.
 *
 * Mobile-first single column → 2-col on lg. Sections render via the shared
 * `<Section>` wrapper; design vocabulary mirrors the other 5 Creator HQ
 * pages (font-mono eyebrows, hairline rules, lime accents, dark theme).
 *
 * Top-level sections:
 *   1. Picture editor   — 5 USER.md fields + tone slider
 *   2. Handles          — verified-handle list + add/remove
 *   3. Connections      — Composio providers (Gmail / Calendar / Apollo /
 *                          Hunter / Stripe), connect via OAuth + disconnect
 *   4. Channel          — primary outbound channel preference
 *   5. Auto-send        — Pro+ per-provider USD threshold
 *   6. Memory reset     — destructive intent log
 *   7. Billing          — current plan + tier comparison + portal stub
 *   8. Data export      — JSON download
 *
 * Plan-tier gating is duplicated client-side for UX cues; the Convex
 * mutations + actions in `convex/profile.ts` are the authoritative gate.
 *
 * OAuth callback: when the URL carries `?oauth=callback&provider=...&code=...`,
 * we call `completeOAuth` once and then strip the query so reloads don't
 * re-fire the exchange.
 */

"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { type FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  Check,
  CreditCard,
  Download,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Send,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Section } from "@/components/creator/Section";
import { ChannelPairingCard } from "@/components/creator/ChannelPairingCard";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

type Plan = "coach" | "manager";
type Channel = "imessage" | "whatsapp" | "sms" | "web";
type Provider = "gmail" | "stripe" | "calendar" | "apollo" | "hunter";
type Tone = "supportive" | "strategic" | "tough-love";
type CareerStage =
  | "just-starting"
  | "building"
  | "monetizing"
  | "scaling";
type RevenueStream =
  | "brand-deals"
  | "affiliate"
  | "merch"
  | "courses"
  | "subs"
  | "ad-rev"
  | "email-list"
  | "live-events"
  | "consulting"
  | "other";
type Platform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "x";

const REVENUE_STREAMS: ReadonlyArray<{ id: RevenueStream; label: string }> = [
  { id: "brand-deals", label: "Brand deals" },
  { id: "affiliate", label: "Affiliate" },
  { id: "merch", label: "Merch" },
  { id: "courses", label: "Courses" },
  { id: "subs", label: "Subscriptions" },
  { id: "ad-rev", label: "Ad revenue" },
  { id: "email-list", label: "Email list" },
  { id: "live-events", label: "Live events" },
  { id: "consulting", label: "Consulting" },
  { id: "other", label: "Other" },
];

const CAREER_STAGES: ReadonlyArray<{ id: CareerStage; label: string; hint: string }> = [
  { id: "just-starting", label: "Just starting", hint: "<10K" },
  { id: "building", label: "Building", hint: "10K–100K" },
  { id: "monetizing", label: "Monetizing", hint: "100K–500K" },
  { id: "scaling", label: "Scaling", hint: "500K+" },
];

const TONES: ReadonlyArray<{ id: Tone; label: string; blurb: string }> = [
  { id: "supportive", label: "Supportive", blurb: "Encouraging, gentle. Maya cushions tough feedback." },
  { id: "strategic", label: "Strategic", blurb: "Even, analytical. Default Maya — direct without edge." },
  { id: "tough-love", label: "Tough love", blurb: "Sharp, no hedging. Maya calls out misses fast." },
];

const PLATFORMS: ReadonlyArray<{ id: Platform; label: string }> = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X / Twitter" },
];

const PROVIDER_META: Record<
  Provider,
  { label: string; icon: typeof Mail; pitch: string; tier: Plan }
> = {
  // Gmail / Calendar / Stripe are available on every tier — Composio Gmail is
  // a small per-call cost and the brand-triage value is the headline reason
  // creators sign up. Apollo/Hunter are Studio-only because they're real
  // per-query paid lookups for outbound brand-contact discovery.
  gmail: {
    label: "Gmail",
    icon: Mail,
    pitch: "Brand-email triage + 4-variant reply drafts.",
    tier: "coach",
  },
  calendar: {
    label: "Calendar",
    icon: CalendarIcon,
    pitch: "Maya plans content arcs around weddings, trips, launches.",
    tier: "coach",
  },
  stripe: {
    label: "Stripe",
    icon: CreditCard,
    pitch: "Read-only revenue snapshot (Mon 9am).",
    tier: "coach",
  },
  apollo: {
    label: "Apollo",
    icon: Search,
    pitch: "Brand contact discovery for outbound pitches (paid lookups).",
    tier: "manager",
  },
  hunter: {
    label: "Hunter",
    icon: Search,
    pitch: "Email lookup for cold pitches (paid lookups).",
    tier: "manager",
  },
};

const CHANNEL_META: Record<
  Channel,
  { label: string; icon: typeof MessageSquare; sub: string }
> = {
  imessage: {
    label: "iMessage",
    icon: MessageSquare,
    sub: "Best on iPhone. Rich media supported.",
  },
  whatsapp: {
    label: "WhatsApp",
    icon: MessageSquare,
    sub: "Best on Android. Rich media supported.",
  },
  sms: {
    label: "SMS",
    icon: Smartphone,
    sub: "Universal fallback. No images / videos.",
  },
  web: {
    label: "Web chat",
    icon: Phone,
    sub: "Always available inside the dashboard.",
  },
};

/**
 * Convex action references. All three modules are already in the codegen'd
 * api map (see `convex/_generated/api.d.ts`). The aliases below make the
 * useAction call sites read cleanly and centralize the wire location.
 */
const startOAuthRef = api.integrations.composio.oauth.startOAuth;
const completeOAuthRef = api.integrations.composio.oauth.completeOAuth;
const verifyHandleRef = api.integrations.scrapeCreators.verifyHandle.verifyHandle;

/* -------------------------------------------------------------------------- */
/* Top-level page                                                              */
/* -------------------------------------------------------------------------- */

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileBody />
    </Suspense>
  );
}

function ProfileBody() {
  const summary = useQuery(api.profile.getProfileSummary);
  const router = useRouter();
  const searchParams = useSearchParams();
  const completeOAuth = useAction(completeOAuthRef);
  const oauthHandled = useRef(false);

  // Handle the OAuth callback exactly once.
  useEffect(() => {
    if (oauthHandled.current) return;
    if (searchParams.get("oauth") !== "callback") return;
    const provider = searchParams.get("provider") as Provider | null;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!provider || !code || !state) return;
    oauthHandled.current = true;
    void completeOAuth({ provider, code, state })
      .catch(() => {
        // OAuth completion failed. Toast surface lands in Sprint 6B alongside
        // the billing flow's error UX; for now we swallow silently and let the
        // creator see the un-changed Connections section so they can retry.
      })
      .finally(() => {
        // Strip the query so a reload doesn't re-fire the exchange.
        router.replace("/profile");
      });
  }, [searchParams, completeOAuth, router]);

  if (summary === undefined) return <ProfileSkeleton />;
  if (summary === null) {
    return (
      <div className="pt-2 sm:pt-6">
        <Section
          eyebrow="§ Profile"
          title="Sign in to manage your Maya."
          variant="tight"
        >
          <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/40 p-8">
            <p className="text-sm text-paper-dim">
              You need an authenticated session to access this page.
            </p>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="pt-2 sm:pt-6">
      <Section
        eyebrow="§ Profile"
        title="Your Maya"
        caption="Voice, tone, channel, billing, connected accounts. Every change here flows into Maya's next deploy."
        rightSlot={
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            {summary.creator.plan} plan
          </span>
        }
        variant="tight"
      >
        <p className="text-xs text-paper-faint">
          Signed in as <span className="text-paper-dim">{summary.creator.email}</span>
        </p>
      </Section>

      <PictureEditorSection summary={summary} />
      <HandlesSection summary={summary} />
      <ConnectionsSection summary={summary} />
      <ChannelSection summary={summary} />
      <AutoSendSection summary={summary} />
      <MemoryResetSection />
      <BillingSection summary={summary} />
      <DataExportSection />
      <DeleteAccountSection />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Picture editor                                                     */
/* -------------------------------------------------------------------------- */

type ProfileSummary = NonNullable<
  FunctionReturnType<typeof api.profile.getProfileSummary>
>;

function PictureEditorSection({ summary }: { summary: ProfileSummary }) {
  const update = useMutation(api.profile.updateCreatorPicture);
  const [careerStage, setCareerStage] = useState<CareerStage | null>(
    summary.picture?.careerStage ?? null
  );
  const [city, setCity] = useState(summary.picture?.locationSoul?.city ?? "");
  const [stateField, setStateField] = useState(
    summary.picture?.locationSoul?.state ?? ""
  );
  const [country, setCountry] = useState(
    summary.picture?.locationSoul?.country ?? ""
  );
  const [timezone, setTimezone] = useState(
    summary.picture?.locationSoul?.timezone ?? summary.creator.timezone
  );
  const [monthlyRev, setMonthlyRev] = useState<string>(
    summary.picture?.monthlyRevenueUsd != null
      ? String(summary.picture.monthlyRevenueUsd)
      : ""
  );
  const [streams, setStreams] = useState<ReadonlyArray<RevenueStream>>(
    (summary.picture?.currentRevenueStreams ?? []) as RevenueStream[]
  );
  const [oneYear, setOneYear] = useState(
    summary.picture?.longTermGoals?.oneYear ?? ""
  );
  const [fiveYear, setFiveYear] = useState(
    summary.picture?.longTermGoals?.fiveYear ?? ""
  );
  const [tone, setTone] = useState<Tone | null>(summary.creator.tonePreference);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const toggleStream = (s: RevenueStream) => {
    setStreams((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const onSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const monthlyRevenueUsd =
        monthlyRev.trim().length === 0
          ? undefined
          : Number(monthlyRev);
      if (
        monthlyRevenueUsd !== undefined &&
        (!Number.isFinite(monthlyRevenueUsd) || monthlyRevenueUsd < 0)
      ) {
        throw new Error("Monthly revenue must be a non-negative number.");
      }
      await update({
        careerStage: careerStage ?? undefined,
        locationSoul: {
          city: city.trim() || undefined,
          state: stateField.trim() || undefined,
          country: country.trim() || undefined,
          timezone: timezone.trim() || undefined,
        },
        monthlyRevenueUsd,
        currentRevenueStreams: streams.length > 0 ? [...streams] : undefined,
        longTermGoals: {
          oneYear: oneYear.trim() || undefined,
          fiveYear: fiveYear.trim() || undefined,
        },
        tonePreference: tone ?? undefined,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      eyebrow="§01 · Creator picture"
      title="Who you are"
      caption="Edit the 5 USER.md fields Maya consults for every coaching read. Tone slider sets her default voice."
    >
      <div className="space-y-6 rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:p-8">
        {/* Career stage */}
        <div>
          <FieldLabel>Career stage</FieldLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {CAREER_STAGES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setCareerStage(s.id)}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                  careerStage === s.id
                    ? "border-lime bg-lime text-ink"
                    : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
                }`}
              >
                {s.label}{" "}
                <span className="ml-1 font-mono text-[10px] opacity-70">
                  {s.hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextInput label="City" value={city} onChange={setCity} placeholder="Austin" />
          <TextInput label="State / Region" value={stateField} onChange={setStateField} placeholder="TX" />
          <TextInput label="Country" value={country} onChange={setCountry} placeholder="US" />
          <TextInput label="Timezone" value={timezone} onChange={setTimezone} placeholder="America/Los_Angeles" />
        </div>

        {/* Revenue */}
        <div>
          <FieldLabel>Monthly creator revenue (USD)</FieldLabel>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            value={monthlyRev}
            onChange={(e) => setMonthlyRev(e.target.value)}
            placeholder="0"
            className="mt-2 h-12 w-full rounded-xl border border-[var(--hairline-strong)] bg-ink-3 px-4 text-base text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none sm:max-w-xs"
          />
          <p className="mt-1 text-xs text-paper-faint">
            Optional. Maya uses this for monetization-diversifier reads only —
            never shown publicly.
          </p>
        </div>

        {/* Revenue streams */}
        <div>
          <FieldLabel>Current revenue streams</FieldLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {REVENUE_STREAMS.map((s) => {
              const active = streams.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStream(s.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-lime bg-lime text-ink"
                      : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Long-term goals */}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextArea
            label="1-year goal"
            value={oneYear}
            onChange={setOneYear}
            placeholder="ship a course in Q3, hit 100K on IG…"
          />
          <TextArea
            label="5-year goal"
            value={fiveYear}
            onChange={setFiveYear}
            placeholder="build a small media company around the niche…"
          />
        </div>

        {/* Tone */}
        <div>
          <FieldLabel>Maya&rsquo;s tone</FieldLabel>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {TONES.map((t) => {
              const active = tone === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTone(t.id)}
                  className={`flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors ${
                    active
                      ? "border-lime bg-lime/10"
                      : "border-[var(--hairline-strong)] bg-ink-3 hover:border-[var(--hairline-strong)]"
                  }`}
                >
                  <span
                    className={`font-display text-base ${active ? "text-lime" : "text-paper"}`}
                  >
                    {t.label}
                  </span>
                  <span className="text-xs text-paper-dim">{t.blurb}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4 border-t border-[var(--hairline)] pt-5">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="btn btn-primary h-11 px-5 text-sm disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>Save picture</>
            )}
          </button>
          {savedAt && (
            <span className="font-mono text-[11px] uppercase tracking-widest text-lime">
              <Check className="mr-1 inline h-3.5 w-3.5" />
              Saved {timeAgo(savedAt)}
            </span>
          )}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Connected handles                                                  */
/* -------------------------------------------------------------------------- */

function HandlesSection({ summary }: { summary: ProfileSummary }) {
  const verify = useAction(verifyHandleRef);
  const addHandle = useMutation(api.profile.addCreatorHandle);
  const removeHandle = useMutation(api.profile.removeCreatorHandle);
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cap = summary.features.maxHandles;
  const atCap = summary.handles.length >= cap;

  const onAdd = async () => {
    const trimmed = handle.trim();
    if (trimmed.length === 0 || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const verified = await verify({ platform, handle: trimmed });
      await addHandle({
        platform,
        handle: verified.handle,
        followerCount: verified.followerCount,
      });
      setHandle("");
    } catch (e) {
      setErr(e instanceof Error ? stripStack(e.message) : "Could not add handle.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      eyebrow="§02 · Handles"
      title="Where Maya watches"
      caption={`Your ${summary.creator.plan} plan caps you at ${cap} handle${cap === 1 ? "" : "s"}.`}
      rightSlot={
        <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
          {summary.handles.length} / {cap}
        </span>
      }
    >
      {summary.handles.length > 0 ? (
        <ul className="mb-5 divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2">
          {summary.handles.map((h) => (
            <li
              key={h._id}
              className="flex items-center gap-4 p-4 sm:p-5"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime text-ink">
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
                    {h.platform}
                  </span>
                  <span className="truncate font-display text-lg text-paper">
                    @{h.handle}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-paper-dim">
                  {h.followerCount != null && (
                    <span>
                      {formatFollowers(h.followerCount)} followers
                    </span>
                  )}
                  {h.scrapedAt && (
                    <span className="font-mono">last pull · {timeAgo(h.scrapedAt)}</span>
                  )}
                  {h.verified && <span className="text-lime">verified</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void removeHandle({ handleId: h._id })}
                aria-label={`Remove ${h.platform} handle`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--hairline)] text-paper-faint transition-colors hover:border-rose hover:text-rose"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!atCap ? (
        <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/50 p-5 sm:p-6">
          <FieldLabel>Add a handle</FieldLabel>
          <div className="mt-3 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const used = summary.handles.some((h) => h.platform === p.id);
              const active = platform === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={used}
                  onClick={() => setPlatform(p.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-lime bg-lime text-ink"
                      : used
                        ? "cursor-not-allowed border-[var(--hairline)] text-paper-faint line-through"
                        : "border-[var(--hairline-strong)] text-paper-dim hover:text-paper"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-1 items-center rounded-2xl border border-[var(--hairline-strong)] bg-ink-3 px-4">
              <span className="font-mono text-sm text-paper-faint">@</span>
              <input
                value={handle.replace(/^@+/, "")}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onAdd();
                  }
                }}
                placeholder="yourhandle"
                disabled={busy}
                className="h-12 w-full bg-transparent pl-2 text-base text-paper outline-none placeholder:text-paper-faint disabled:opacity-50"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Your ${platform} handle`}
              />
            </div>
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={handle.trim().length === 0 || busy}
              className="btn btn-primary h-12 px-5 text-sm disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Add handle
                </>
              )}
            </button>
          </div>
          {err && <p className="mt-2 text-sm text-rose">{err}</p>}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ink-2/50 p-5 text-sm text-paper-dim">
          You&rsquo;ve hit your plan&rsquo;s handle cap. Upgrade to add more.
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Connected accounts (Composio)                                      */
/* -------------------------------------------------------------------------- */

function ConnectionsSection({ summary }: { summary: ProfileSummary }) {
  const startOAuth = useAction(startOAuthRef);
  const disconnect = useMutation(api.profile.disconnectProvider);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const allowed = useMemo(
    () => new Set(summary.features.allowedProviders),
    [summary.features.allowedProviders]
  );
  // We render every provider, including the ones the plan doesn't allow, so
  // the upgrade nudge is visible. Order: gmail, calendar, stripe, apollo,
  // hunter — write-providers first, then discovery.
  const providerOrder: ReadonlyArray<Provider> = [
    "gmail",
    "calendar",
    "stripe",
    "apollo",
    "hunter",
  ];

  const onConnect = async (provider: Provider) => {
    setErr(null);
    setBusyProvider(provider);
    try {
      const redirectUri = `${window.location.origin}/profile?oauth=callback&provider=${provider}`;
      const { redirectUrl } = await startOAuth({
        provider,
        redirectUri,
      });
      window.location.assign(redirectUrl);
    } catch (e) {
      setErr(
        e instanceof Error
          ? stripStack(e.message)
          : "OAuth could not be started."
      );
      setBusyProvider(null);
    }
  };

  const onDisconnect = async (provider: Provider) => {
    setErr(null);
    setBusyProvider(provider);
    try {
      await disconnect({ provider });
    } catch (e) {
      setErr(
        e instanceof Error ? stripStack(e.message) : "Could not disconnect."
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const accountByProvider = new Map(
    summary.accounts.map((a) => [a.provider, a])
  );

  return (
    <Section
      eyebrow="§03 · Connections"
      title="Composio providers"
      caption="Maya never logs in as you — every write is OAuth-scoped through Composio. Disconnect anytime; we keep the audit trail."
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {providerOrder.map((p) => {
          const meta = PROVIDER_META[p];
          const Icon = meta.icon;
          const acc = accountByProvider.get(p);
          const isAllowed = allowed.has(p);
          const isActive = acc && acc.scopeStatus === "active";
          const isBusy = busyProvider === p;
          return (
            <li
              key={p}
              className={`rounded-2xl border bg-ink-2 p-5 ${
                isAllowed
                  ? "border-[var(--hairline-strong)]"
                  : "border-[var(--hairline)] opacity-70"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--hairline-strong)] text-lime">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-lg text-paper">
                      {meta.label}
                    </span>
                    {!isAllowed && (
                      <span className="rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-paper-faint">
                        Studio plan
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-paper-dim">{meta.pitch}</p>

                  <div className="mt-3">
                    {!isAllowed ? (
                      <span className="text-xs text-paper-faint">
                        Upgrade to Studio to enable.
                      </span>
                    ) : isActive ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-lime bg-lime/10 px-2.5 py-1 text-xs text-lime">
                          <Check className="h-3.5 w-3.5" />
                          Connected · {timeAgo(acc!.connectedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void onDisconnect(p)}
                          disabled={isBusy}
                          className="text-xs text-paper-faint underline-offset-2 hover:text-rose hover:underline disabled:opacity-50"
                        >
                          {isBusy ? "Disconnecting…" : "Disconnect"}
                        </button>
                      </div>
                    ) : acc?.scopeStatus === "revoked" ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs text-paper-faint">
                          Disconnected — reconnect any time.
                        </span>
                        <button
                          type="button"
                          onClick={() => void onConnect(p)}
                          disabled={isBusy}
                          className="btn btn-ghost h-8 px-3 text-xs disabled:opacity-50"
                        >
                          {isBusy ? "Opening…" : "Reconnect"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onConnect(p)}
                        disabled={isBusy}
                        className="btn btn-primary h-9 px-4 text-xs disabled:opacity-50"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Opening…
                          </>
                        ) : (
                          <>Connect {meta.label}</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {err && <p className="mt-3 text-sm text-rose">{err}</p>}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Channel preference                                                 */
/* -------------------------------------------------------------------------- */

function ChannelSection({ summary }: { summary: ProfileSummary }) {
  const update = useMutation(api.profile.updateChannelPreference);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allowed = useMemo(
    () => new Set(summary.features.allowedChannels),
    [summary.features.allowedChannels]
  );
  const order: ReadonlyArray<Channel> = ["imessage", "whatsapp", "sms", "web"];

  const onPick = async (channel: Channel) => {
    if (!allowed.has(channel)) return;
    setErr(null);
    setBusy(true);
    try {
      await update({ channel });
    } catch (e) {
      setErr(e instanceof Error ? stripStack(e.message) : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const needsPairing =
    summary.creator.channelPreference === "imessage" ||
    summary.creator.channelPreference === "whatsapp" ||
    summary.creator.channelPreference === "sms";

  return (
    <Section
      eyebrow="§04 · Channel"
      title="Where Maya pings you"
      caption="Routing changes apply to the next outbound message. Pair iMessage, WhatsApp, or SMS below — Maya talks to you on whichever channel you've paired."
    >
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {order.map((c) => {
          const meta = CHANNEL_META[c];
          const Icon = meta.icon;
          const active = summary.creator.channelPreference === c;
          const isAllowed = allowed.has(c);
          return (
            <li key={c}>
              <button
                type="button"
                onClick={() => void onPick(c)}
                disabled={!isAllowed || busy}
                className={`flex w-full flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors ${
                  active
                    ? "border-lime bg-lime/10"
                    : isAllowed
                      ? "border-[var(--hairline-strong)] bg-ink-2 hover:border-[var(--hairline-strong)]"
                      : "border-[var(--hairline)] bg-ink-2/40 opacity-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={`h-4 w-4 ${active ? "text-lime" : "text-paper-faint"}`}
                  />
                  <span
                    className={`font-display text-base ${active ? "text-lime" : "text-paper"}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <span className="text-xs text-paper-dim">{meta.sub}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {needsPairing && (
        <div className="mt-5">
          <ChannelPairingCard />
        </div>
      )}
      {err && <p className="mt-2 text-sm text-rose">{err}</p>}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Auto-send threshold                                                */
/* -------------------------------------------------------------------------- */

function AutoSendSection({ summary }: { summary: ProfileSummary }) {
  const setThreshold = useMutation(api.profile.setAutoSendThreshold);
  const gmail = summary.accounts.find((a) => a.provider === "gmail");
  const [value, setValue] = useState<number>(
    gmail?.autoSendThreshold ?? 0
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Hide entirely for Starter — server still rejects fail-closed.
  if (!summary.features.gmailDealDeskEnabled) return null;

  const onSave = async () => {
    if (!gmail) return;
    setErr(null);
    setBusy(true);
    try {
      await setThreshold({ provider: "gmail", thresholdUsd: value });
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? stripStack(e.message) : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      eyebrow="§05 · Auto-send"
      title="Per-provider threshold"
      caption="When Maya drafts a firm-decline reply for a brand offer below this dollar amount, she sends it automatically. Anti-footgun: only firm declines auto-send, never enthusiastic acceptances."
    >
      <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5 sm:p-6">
        {!gmail ? (
          <p className="text-sm text-paper-dim">
            Connect Gmail above to enable auto-send for the deal-desk.
          </p>
        ) : (
          <div className="space-y-4">
            <FieldLabel>Auto-send under (USD)</FieldLabel>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={500}
                step={10}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                aria-label="Auto-send threshold in USD"
                className="flex-1 accent-lime"
              />
              <input
                type="number"
                min={0}
                max={500}
                value={value}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0 && n <= 500) setValue(n);
                }}
                className="h-10 w-24 rounded-xl border border-[var(--hairline-strong)] bg-ink-3 px-3 text-sm text-paper"
              />
              <span className="font-mono text-xs uppercase tracking-widest text-paper-faint">USD</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={busy}
                className="btn btn-primary h-10 px-4 text-sm disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>Save threshold</>
                )}
              </button>
              {savedAt && (
                <span className="font-mono text-[11px] uppercase tracking-widest text-lime">
                  <Check className="mr-1 inline h-3.5 w-3.5" />
                  Saved {timeAgo(savedAt)}
                </span>
              )}
              {err && <span className="text-sm text-rose">{err}</span>}
            </div>
            {value === 0 && (
              <p className="text-xs text-paper-faint">
                Set to 0 = Maya always asks before sending.
              </p>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Memory reset                                                       */
/* -------------------------------------------------------------------------- */

function MemoryResetSection() {
  const reset = useAction(api.profile.resetMayaMemory);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onReset = async () => {
    setErr(null);
    setBusy(true);
    try {
      await reset({ confirm: "RESET" });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? stripStack(e.message) : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      eyebrow="§06 · Memory"
      title="Reset Maya's memory"
      caption="Clears Maya's running notes, dream sweep deltas, and conversational memory. Your handles, deals, and connections stay. The wipe queues server-side; the actual OpenClaw memory clear runs in the next deploy cycle."
    >
      <div className="rounded-2xl border border-rose/40 bg-rose/5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose" />
          <div className="flex-1">
            <p className="text-sm text-paper">
              This is a destructive operation. Maya will lose her running
              context (recent learnings, in-flight commitments, conversation
              history per the retention policy).
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="btn btn-ghost mt-4 h-10 border-rose/40 px-4 text-sm text-rose hover:bg-rose/10"
            >
              Reset Maya&rsquo;s memory
            </button>
            {done && (
              <p className="mt-3 text-xs text-lime">
                Reset queued. Maya&rsquo;s next boot will pick up the clean state.
              </p>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div
          role="alertdialog"
          aria-labelledby="reset-title"
          className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-6 sm:p-7"
          >
            <h3 id="reset-title" className="font-display text-2xl text-paper">
              Reset Maya&rsquo;s memory?
            </h3>
            <p className="mt-3 text-paper-dim">
              She&rsquo;ll forget recent learnings + in-flight commitments. Your
              data, handles, and connections aren&rsquo;t touched. This action
              is logged for audit.
            </p>
            {err && (
              <p className="mt-3 rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-sm text-rose">
                {err}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn btn-ghost h-11 px-5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onReset()}
                disabled={busy}
                className="btn btn-primary h-11 border-rose bg-rose px-5 text-sm text-ink hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Resetting…
                  </>
                ) : (
                  <>Yes, reset</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Billing                                                            */
/* -------------------------------------------------------------------------- */

const PLAN_TABLE: ReadonlyArray<{
  id: Plan;
  price: string;
  annual: string;
  headline: string;
  features: ReadonlyArray<string>;
}> = [
  {
    id: "coach",
    price: "$29/mo",
    annual: "$249/yr",
    headline: "Advisory only — Maya advises, you decide.",
    features: [
      "All read/advisory cron behaviors (morning brief, evening recap, weekly plan, niche scan, performance check, hook library, comment triage, calendar lookahead)",
      "Pre-post review + rate suggestions + contract red-flag scan",
      "Brand email triage — Maya drafts, you approve and send",
      "Manager-readiness packet (quarterly)",
      "Up to 5 platforms · all 5 channels · 5-peer competitor watch",
      "NO auto-send · NO cold pitching · NO Apollo/Hunter discovery",
    ],
  },
  {
    id: "manager",
    price: "$99/mo",
    annual: "$899/yr",
    headline: "Coach + autonomous brand-deal back-and-forth.",
    features: [
      "Everything in Coach",
      "Brand email auto-send under your threshold",
      "Brand outreach via Apollo + Hunter (paid contact discovery)",
      "Brand pitching — Maya drafts and sends cold pitches",
      "Brand-deal negotiation back-and-forth",
      "Faster post-publish reactions (<5 min) · 10-peer competitor watch",
      "On-demand manager-readiness packet",
      "14-day free trial; auto-downgrades to Coach if you don't continue",
    ],
  },
];

function BillingSection({ summary }: { summary: ProfileSummary }) {
  const openPortal = useAction(api.billing.portal.openCustomerPortal);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPortal = async () => {
    setErr(null);
    setBusy(true);
    try {
      const { url } = await openPortal({});
      window.location.assign(url);
    } catch (e) {
      // The portal action throws "subscribe first" when no stripeCustomerId
      // exists yet. That's the most common path during pre-trial onboarding —
      // surface a friendly note rather than the raw error string.
      const msg = e instanceof Error ? stripStack(e.message) : "Could not open portal.";
      setErr(
        /subscribe first/i.test(msg)
          ? "Subscribe to a plan first — the portal opens once your Stripe customer record exists."
          : msg
      );
      setBusy(false);
    }
  };

  return (
    <Section
      eyebrow="§07 · Billing"
      title="Plan + subscription"
      caption="14-day Pro trial, no card required. Upgrade or downgrade anytime; effective immediately at the next billing boundary."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_TABLE.map((p) => {
          const active = summary.creator.plan === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border p-5 ${
                active
                  ? "border-lime bg-lime/5"
                  : "border-[var(--hairline-strong)] bg-ink-2"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={`font-display text-xl capitalize ${active ? "text-lime" : "text-paper"}`}
                >
                  {p.id}
                </span>
                {active && (
                  <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-ink">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-paper-faint">
                {p.price} · {p.annual}
              </p>
              <p className="mt-2 text-sm text-paper-dim">{p.headline}</p>
              <ul className="mt-4 space-y-1.5 text-xs text-paper-dim">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-lime">·</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => void onPortal()}
          disabled={busy}
          className="btn btn-primary h-11 px-5 text-sm disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening portal…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Manage subscription
            </>
          )}
        </button>
        {summary.creator.trialEndsAt != null && (
          <span className="font-mono text-[11px] uppercase tracking-widest text-paper-faint">
            Trial ends {humanizeDate(summary.creator.trialEndsAt)}
          </span>
        )}
        {err && <span className="text-sm text-rose">{err}</span>}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section: Data export                                                        */
/* -------------------------------------------------------------------------- */

function DataExportSection() {
  const exportData = useAction(api.profile.exportCreatorData);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onExport = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await exportData({});
      setUrl(res.url);
    } catch (e) {
      setErr(e instanceof Error ? stripStack(e.message) : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      eyebrow="§08 · Data export"
      title="Download your data"
      caption="Maya runs on your data. Take it with you anytime — JSON blob with creator picture, handles, connected accounts, posts, briefs, and weekly reviews. Encrypted credentials are scrubbed."
    >
      <div className="rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={busy}
            className="btn btn-primary h-11 px-5 text-sm disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Bundling…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download (JSON)
              </>
            )}
          </button>
          {url && (
            <a
              href={url}
              download
              target="_blank"
              rel="noreferrer"
              className="text-sm text-lime underline-offset-2 hover:underline"
            >
              Open download
            </a>
          )}
          {err && <span className="text-sm text-rose">{err}</span>}
        </div>
      </div>
    </Section>
  );
}

function DeleteAccountSection() {
  return (
    <Section
      eyebrow="§09 · Account deletion"
      title="Delete your account"
      caption="This removes your Maya data, connected tokens, channel pairing, and Clerk identity. The same flow is available from iMessage after Maya confirms the exact phrase."
    >
      <div className="rounded-2xl border border-rose/40 bg-ink-2 p-5 sm:p-6">
        <Link
          href="/account/delete"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-rose px-4 text-sm font-medium text-white transition hover:brightness-95"
        >
          <Trash2 className="h-4 w-4" />
          Delete account
        </Link>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
      {children}
    </span>
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
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full rounded-xl border border-[var(--hairline-strong)] bg-ink-3 px-4 text-base text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none"
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-2 w-full resize-y rounded-xl border border-[var(--hairline-strong)] bg-ink-3 px-4 py-3 text-base text-paper placeholder:text-paper-faint focus:border-lime focus:outline-none"
      />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="px-5 pt-10 sm:px-8 sm:pt-14">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-3 w-32 rounded-full bg-ink-2" />
        <div className="h-12 w-3/4 rounded-2xl bg-ink-2" />
        <div className="h-40 w-full rounded-2xl bg-ink-2" />
        <div className="h-32 w-full rounded-2xl bg-ink-2" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(ts: number): string {
  const diffMin = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function humanizeDate(ts: number): string {
  const d = new Date(ts);
  const diffDay = Math.round((ts - Date.now()) / (24 * 3600_000));
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffDay === 0) return `today (${dateStr})`;
  if (diffDay === 1) return `tomorrow (${dateStr})`;
  if (diffDay > 0 && diffDay <= 14) return `in ${diffDay} days (${dateStr})`;
  return dateStr;
}

function stripStack(msg: string): string {
  const cleaned = msg.replace(/\[CONVEX[^\]]*\]\s*/g, "").trim();
  return cleaned.replace(/^Server Error:?\s*/i, "");
}
