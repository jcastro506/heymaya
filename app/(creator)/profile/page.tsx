/**
 * /profile — the creator's settings surface.
 *
 * Single column, mobile-first, dark-editorial. Matches the design language of
 * /creators (font-display + paper/ink/lime palette, hairline rules, mono
 * eyebrows). Five sections, in this order:
 *
 *   1. Header        — name (or email) + status pill (Active / Trial / Coach)
 *   2. Subscription  — tier, price, interval, renewal, switch + cancel
 *   3. Your details  — name, primary handle, phone (read-only), email
 *   4. How she talks — three-way tone picker (supportive / strategic / tough)
 *   5. Connections   — Gmail, Calendar, primary social handle
 *   6. Account       — data export + delete (restrained text links)
 *
 * What this page deliberately does NOT do anymore:
 *   - Edit the long onboarding picture (career stage, location, revenue,
 *     5-year goals). Those flow back to Maya in chat.
 *   - Add or remove handles. Handle changes invalidate Maya's voice baseline
 *     and route through support / chat.
 *   - Surface auto-send threshold UI. The Manager autonomy boundary is set
 *     conversationally with Maya, not on a slider.
 *   - Surface Maya's memory reset. Destructive runtime ops live in chat.
 *   - Surface the full pricing comparison cards. Pricing reads belong on the
 *     marketing page; the profile shows the current plan and a switch link.
 *
 * All existing Convex data sources, mutations, and actions are preserved —
 * only the UI shell has changed. Server-side gating is unchanged.
 */

"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

import { AccountSection } from "./_components/AccountSection";
import { ConnectionsSection } from "./_components/ConnectionsSection";
import { DetailsSection } from "./_components/DetailsSection";
import { SubscriptionSection } from "./_components/SubscriptionSection";
import { ToneSection } from "./_components/ToneSection";

type ComposioProvider = "gmail" | "calendar" | "stripe" | "apollo" | "hunter";

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileBody />
    </Suspense>
  );
}

function ProfileBody() {
  const summary = useQuery(api.profile.getProfileSummary);
  const me = useQuery(api.creators.me);

  const router = useRouter();
  const searchParams = useSearchParams();
  const completeOAuth = useAction(
    api.integrations.composio.oauth.completeOAuth
  );
  const oauthHandled = useRef(false);

  // Handle the OAuth callback exactly once — preserved from the prior page.
  useEffect(() => {
    if (oauthHandled.current) return;
    if (searchParams.get("oauth") !== "callback") return;
    const provider = searchParams.get("provider") as ComposioProvider | null;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!provider || !code || !state) return;
    oauthHandled.current = true;
    void completeOAuth({ provider, code, state }).finally(() => {
      // Strip the callback query so a refresh doesn't re-fire the exchange.
      router.replace("/profile");
    });
  }, [searchParams, completeOAuth, router]);

  if (summary === undefined || me === undefined) return <ProfileSkeleton />;

  if (summary === null || me === null) {
    return (
      <div className="px-5 pt-16 sm:px-8 sm:pt-24">
        <div className="mx-auto max-w-2xl">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
            Profile
          </span>
          <h1 className="mt-4 font-display text-3xl tracking-tight text-paper sm:text-4xl">
            Sign in to manage your Maya.
          </h1>
          <p className="mt-3 text-sm text-paper-dim">
            You need an authenticated session to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Header summary={summary} me={me} />
      <SubscriptionSection summary={summary} me={me} />
      <DetailsSection summary={summary} me={me} />
      <ToneSection summary={summary} />
      <ConnectionsSection summary={summary} />
      <AccountSection />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

function Header({
  summary,
  me,
}: {
  summary: NonNullable<ReturnType<typeof useQuery<typeof api.profile.getProfileSummary>>>;
  me: NonNullable<ReturnType<typeof useQuery<typeof api.creators.me>>>;
}) {
  const trialEndsAt = summary.creator.trialEndsAt ?? null;
  const onTrial = trialEndsAt != null && trialEndsAt > Date.now();
  const trialDaysLeft =
    onTrial && trialEndsAt != null
      ? Math.max(1, Math.ceil((trialEndsAt - Date.now()) / (24 * 3_600_000)))
      : null;

  const planLabel = summary.creator.plan === "manager" ? "Manager" : "Coach";
  const greetingName =
    me.displayName ??
    summary.handles[0]?.handle ??
    summary.creator.email.split("@")[0] ??
    "you";

  return (
    <header className="px-5 pb-2 pt-10 sm:px-8 sm:pt-14">
      <div className="mx-auto max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-faint">
          Your Maya
        </span>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-5xl">
            Hey,{" "}
            <span className="italic text-paper-dim">{greetingName}.</span>
          </h1>
          <StatusPill onTrial={onTrial} trialDaysLeft={trialDaysLeft} planLabel={planLabel} />
        </div>
        <p className="mt-3 text-sm text-paper-dim">
          Settings, subscription, and the accounts she watches. Everything you
          tweak here flows into her next read.
        </p>
      </div>
    </header>
  );
}

function StatusPill({
  onTrial,
  trialDaysLeft,
  planLabel,
}: {
  onTrial: boolean;
  trialDaysLeft: number | null;
  planLabel: string;
}) {
  if (onTrial && trialDaysLeft != null) {
    const dayWord = trialDaysLeft === 1 ? "day" : "days";
    return (
      <span className="inline-flex items-center rounded-full border border-lime/60 bg-lime/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-lime">
        Trial · {trialDaysLeft} {dayWord} left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--hairline-strong)] bg-ink-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
      Active · {planLabel}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

function ProfileSkeleton() {
  return (
    <div className="px-5 pt-12 sm:px-8 sm:pt-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-3">
          <div className="h-3 w-24 rounded-full bg-ink-2" />
          <div className="h-12 w-3/4 rounded-2xl bg-ink-2" />
          <div className="h-4 w-1/2 rounded-full bg-ink-2" />
        </div>
        <div className="h-40 w-full rounded-2xl bg-ink-2" />
        <div className="h-32 w-full rounded-2xl bg-ink-2" />
        <div className="h-28 w-full rounded-2xl bg-ink-2" />
      </div>
    </div>
  );
}
