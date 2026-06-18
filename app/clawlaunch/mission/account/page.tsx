"use client";

/**
 * Account — product profile, North Star, connected surfaces (Telegram + your
 * social channels), plan, and a reversible delete-account. The go-live shell home.
 */

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import {
  Shell,
  Section,
  Card,
  Pill,
  Loading,
  NeedsOnboarding,
} from "../_components";
import { ConnectedAccounts } from "./_ConnectedAccounts";
import { ProductBrain } from "./_ProductBrain";
import { PostingControl } from "./_PostingControl";

type GtmTier = "starter" | "growth" | "studio";

const GTM_TIERS: ReadonlyArray<{
  tier: GtmTier;
  name: string;
  price: string;
  blurb: string;
}> = [
  { tier: "starter", name: "Starter", price: "$99/mo", blurb: "Up to 3 channels" },
  { tier: "growth", name: "Growth", price: "$149/mo", blurb: "Up to 6 channels" },
  { tier: "studio", name: "Studio", price: "$199/mo", blurb: "6 channels + video" },
];

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
  const deleteAccount = useMutation(
    api.gtmMaya.missionControl.deleteMyGtmAccount
  );
  const startCheckout = useAction(
    api.billing.gtmBilling.createGtmCheckoutSession
  );
  const { signOut } = useClerk();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<GtmTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount({});
      // Account soft-deleted (status="deleted"). Now end the Clerk session and
      // hard-redirect to the public landing — a full reload wipes all client +
      // Convex state so there's no stale authed dashboard left behind.
      await signOut();
      window.location.href = "/";
    } catch (err) {
      setDeleting(false);
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete your account."
      );
    }
  }

  async function handleSubscribe(tier: GtmTier) {
    setCheckingOut(tier);
    setCheckoutError(null);
    try {
      const { url } = await startCheckout({ interval: "monthly", tier });
      window.location.href = url;
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Could not start checkout."
      );
      setCheckingOut(null);
    }
  }

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
                  className="text-paper underline decoration-paper/30 underline-offset-2"
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

      <Section title="What Maya understands about your product">
        <ProductBrain app={app} />
      </Section>

      <Section title="Posting">
        <PostingControl
          mode={account.postingMode}
          graduated={account.postingGraduated}
        />
      </Section>

      <Section title="Connected">
        <Card>
          <Row
            label="Telegram"
            value={<Pill tone="lime">primary channel</Pill>}
          />
          <div className="mt-3 border-t border-paper-faint/15 pt-3">
            <p className="mb-2 font-mono text-xs uppercase tracking-wide text-paper-faint">
              Channels
            </p>
            <ConnectedAccounts />
          </div>
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
          <div className="mt-4 flex flex-col gap-3 border-t border-paper-faint/15 pt-4">
            <p className="text-sm text-paper-dim">
              Your first week is free — pick a plan any time to keep Maya
              running.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {GTM_TIERS.map((t) => (
                <button
                  key={t.tier}
                  onClick={() => handleSubscribe(t.tier)}
                  disabled={checkingOut !== null}
                  className="flex flex-col gap-0.5 rounded-lg border border-lime/40 bg-lime/5 px-3 py-2 text-left hover:bg-lime/10 disabled:opacity-50"
                >
                  <span className="font-mono text-xs uppercase tracking-wide text-paper">
                    {t.name} — {t.price}
                  </span>
                  <span className="text-xs text-paper-dim">{t.blurb}</span>
                  <span className="mt-1 font-mono text-[10px] uppercase tracking-wide text-lime">
                    {checkingOut === t.tier ? "Starting…" : "Subscribe"}
                  </span>
                </button>
              ))}
            </div>
            {checkoutError ? (
              <p className="text-xs text-[#b3261e]">{checkoutError}</p>
            ) : null}
          </div>
        </Card>
      </Section>

      <Section title="Danger zone">
        <Card>
          {!confirming ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-paper-dim">
                Stop HeyMaya and remove your account.
              </p>
              <button
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-rose/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[#b3261e] hover:bg-rose/10"
              >
                Delete account
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-paper">
                This stops your manager, deletes your account, and signs you
                out. Are you sure?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="rounded-lg bg-rose px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="rounded-lg border border-paper-faint/30 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-paper-dim disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {deleteError ? (
                <p className="text-xs text-[#b3261e]">{deleteError}</p>
              ) : null}
            </div>
          )}
        </Card>
      </Section>
    </Shell>
  );
}
