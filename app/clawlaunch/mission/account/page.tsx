"use client";

/**
 * Account — product profile, North Star, connected surfaces (Telegram + Google
 * Calendar), plan, and a reversible delete-account. The go-live shell home.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Shell,
  Section,
  Card,
  Pill,
  Loading,
  NeedsOnboarding,
} from "../_components";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="font-mono text-xs uppercase tracking-wide text-paper-faint">
        {label}
      </span>
      <span className="text-right text-sm text-paper">{value}</span>
    </div>
  );
}

export default function AccountPage() {
  const account = useQuery(api.gtmMaya.missionControl.getMyAccount);
  const calendar = useQuery(api.gtmMaya.calendarOAuth.getMyCalendarConnection);
  const deleteAccount = useMutation(
    api.gtmMaya.missionControl.deleteMyGtmAccount
  );
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);

  if (account === undefined) return <Loading />;
  if (account === null) return <NeedsOnboarding />;

  const app = account.app;
  const northStar = app?.northStarMetric
    ? `${app.northStarMetric}${app.northStarTarget ? ` — target ${app.northStarTarget}` : ""}${
        app.northStarDeadlineMs
          ? ` by ${new Date(app.northStarDeadlineMs).toISOString().slice(0, 10)}`
          : ""
      }`
    : "Set at synthesis";

  return (
    <Shell
      title="Account"
      subtitle="Your product, your goal, and what's connected. Everything still runs through your Telegram."
    >
      <Section title="Product">
        <Card>
          <Row label="App" value={app?.name ?? "—"} />
          <Row
            label="Site"
            value={
              app?.url ? (
                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lime underline decoration-lime/40 underline-offset-2"
                >
                  {app.url}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Row label="Stage" value={app?.stage ?? "—"} />
          <Row
            label="Mode"
            value={
              app?.entryMode ? (
                <Pill tone="lime">{app.entryMode}</Pill>
              ) : (
                "unresolved"
              )
            }
          />
          {app?.archetype ? (
            <Row label="Archetype" value={app.archetype} />
          ) : null}
          <Row label="North Star" value={northStar} />
        </Card>
      </Section>

      <Section title="Connected">
        <Card>
          <Row
            label="Telegram"
            value={<Pill tone="lime">primary channel</Pill>}
          />
          <Row
            label="Google Calendar"
            value={
              calendar ? (
                <Pill tone="lime">connected</Pill>
              ) : (
                <a
                  href="/lc_maya/start_google_calendar_oauth"
                  className="text-lime underline decoration-lime/40 underline-offset-2"
                >
                  connect
                </a>
              )
            }
          />
        </Card>
      </Section>

      <Section title="Plan">
        <Card>
          <Row label="Plan" value={account.plan} />
          <Row label="Status" value={<Pill>{account.status}</Pill>} />
          {account.deployedAt ? (
            <Row
              label="Live since"
              value={new Date(account.deployedAt).toISOString().slice(0, 10)}
            />
          ) : null}
        </Card>
      </Section>

      <Section title="Danger zone">
        <Card>
          {deleted ? (
            <p className="text-sm text-paper-dim">
              Your account is marked deleted. ClawLaunch has stopped. Reach out
              if you want it back.
            </p>
          ) : !confirming ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-paper-dim">
                Stop ClawLaunch and remove your account.
              </p>
              <button
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-rose/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-rose hover:bg-rose/10"
              >
                Delete account
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-paper">
                This stops your manager and hides your account. Are you sure?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    await deleteAccount({});
                    setDeleted(true);
                  }}
                  className="rounded-lg bg-rose px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-paper-faint/30 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-paper-dim"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
      </Section>
    </Shell>
  );
}
