/**
 * Profile screen — `/biz/profile`.
 *
 * Per Service Sprint Plan § 12.6:
 *   - Editable business profile
 *   - Connections panel
 *   - Channel preference / auto-send threshold / tone slider / memory reset
 *   - Billing tab
 *   - GDPR data export
 *   - "Trust Maya" approval rules
 *
 * Edits go through Wave C/D mutations (not in this agent's scope) — this
 * page surfaces the data and the read-side gating UX.
 */

"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Section } from "@/components/business/Section";
import { EmptyState } from "@/components/business/EmptyState";
import { ConnectionsPanel } from "@/components/business/ConnectionsPanel";
import { ApprovalRulesPanel } from "@/components/business/ApprovalRulesPanel";
import { BillingPanel } from "@/components/business/BillingPanel";
import { VoiceSetupPanel } from "@/components/business/VoiceSetupPanel";

type Tab = "overview" | "connections" | "trust" | "billing";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "connections", label: "Connections" },
  { key: "trust", label: "Trust Maya" },
  { key: "billing", label: "Billing" },
];

export default function ProfilePage() {
  const [tab, setTab] = useState<Tab>("overview");

  const profile = useQuery(api.queries.business.profile.getProfile);
  const connections = useQuery(api.queries.business.profile.getConnections);
  const approval = useQuery(api.queries.business.profile.getApprovalRules);
  const billing = useQuery(api.queries.business.profile.getBilling);

  if (profile === undefined) return <Skeleton />;
  if (profile === null) {
    return (
      <div className="px-5 py-10 sm:px-8">
        <EmptyState
          stage="fresh"
          title="Finish onboarding"
          body="Your profile shows up after the conversational onboarding deploys your Maya."
          cta={{ label: "Onboarding", href: "/onboarding/business" }}
        />
      </div>
    );
  }

  return (
    <div className="pb-12 pt-4 sm:pt-6">
      <Section
        eyebrow="Profile"
        title={profile.business.name}
        caption={
          profile.business.serviceTypes.length > 0
            ? profile.business.serviceTypes.join(" · ")
            : undefined
        }
        rightSlot={
          <div className="flex flex-wrap items-center gap-1 rounded-full border border-[var(--hairline)] bg-ink-3/40 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                data-testid={`biz-profile-tab-${t.key}`}
                data-active={tab === t.key ? "true" : "false"}
                onClick={() => setTab(t.key)}
                className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  tab === t.key ? "bg-lime text-ink" : "text-paper-dim"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mx-auto mt-6 max-w-5xl space-y-5 px-5 sm:px-8">
        {tab === "overview" && (
          <OverviewTab
            business={profile.business}
            account={profile.account}
            plan={profile.features.plan}
          />
        )}

        {tab === "connections" &&
          (connections === undefined ? (
            <div className="h-64 animate-pulse rounded-2xl bg-ink-3/60" />
          ) : connections ? (
            <div className="space-y-3">
              <ConnectionsPanel
                gbpLocations={connections.gbpLocations}
                crmConnections={connections.crmConnections}
                voiceChannel={connections.voiceChannel}
                zernioConnection={connections.zernioConnection}
                canConnectVoice={connections.canConnectVoice}
                canConnectCrm={connections.canConnectCrm}
                maxGbpLocations={connections.maxGbpLocations}
              />
              <VoiceSetupPanel
                voiceChannel={connections.voiceChannel}
                studioVoice={
                  connections.canConnectVoice &&
                  profile.features.plan === "studio"
                }
                proInclusion={profile.features.plan === "pro"}
              />
            </div>
          ) : (
            <EmptyState
              stage="ready"
              title="No connections yet"
              body="Connect GBP first — that anchors every Maya behavior."
            />
          ))}

        {tab === "trust" &&
          (approval === undefined ? (
            <div className="h-64 animate-pulse rounded-2xl bg-ink-3/60" />
          ) : approval ? (
            <ApprovalRulesPanel
              rules={approval.rules}
              enableable={approval.enableable}
              forbiddenAtAllTiers={approval.forbiddenAtAllTiers}
              plan={approval.plan}
            />
          ) : null)}

        {tab === "billing" &&
          (billing === undefined ? (
            <div className="h-64 animate-pulse rounded-2xl bg-ink-3/60" />
          ) : billing ? (
            <BillingPanel
              plan={billing.plan}
              voice={billing.voice}
              chat={billing.chat}
              trialEndsAt={billing.trialEndsAt}
              subscriptionStatus={billing.subscriptionStatus}
              hasStripeCustomer={Boolean(billing.stripeCustomerId)}
              billingInterval={billing.billingInterval}
            />
          ) : null)}
      </div>
    </div>
  );
}

function OverviewTab({
  business,
  account,
  plan,
}: {
  business: { name: string; serviceTypes: string[]; tonePreference?: string; responseSpeed?: string };
  account: { email: string; timezone: string; channelPreference: string };
  plan: string;
}) {
  return (
    <div className="space-y-3">
      <Field label="Business name" value={business.name} />
      <Field label="Service types" value={business.serviceTypes.join(", ") || "—"} />
      <Field label="Owner email" value={account.email} />
      <Field label="Timezone" value={account.timezone} />
      <Field label="Channel preference" value={account.channelPreference} />
      <Field label="Tone preference" value={business.tonePreference ?? "—"} />
      <Field label="Response speed" value={business.responseSpeed ?? "—"} />
      <Field label="Plan tier" value={plan} />
      <p className="text-xs text-paper-faint">
        Editing lands in Wave D. For now, message Maya with what you want
        changed and she'll route it.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div
      data-testid={`biz-profile-field-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
      className="flex justify-between gap-3 rounded-xl border border-[var(--hairline)] bg-ink-2/40 px-4 py-3 text-sm"
    >
      <span className="text-paper-faint">{label}</span>
      <span className="text-paper">{value}</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-5 py-10 sm:px-8" data-testid="biz-profile-skeleton">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="h-9 w-1/3 animate-pulse rounded bg-ink-3" />
        <div className="h-32 animate-pulse rounded-2xl bg-ink-3" />
      </div>
    </div>
  );
}
