"use client";

/**
 * Account — product profile, North Star, connected surfaces (Telegram + your
 * social channels), plan, and a reversible delete-account. The go-live shell home.
 */

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
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
import { TierSelector, type GtmTier } from "@/components/billing/TierSelector";

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

const DELETE_PHRASE = "DELETE";

export default function AccountPage() {
  const account = useQuery(api.gtmMaya.missionControl.getMyAccount);
  const hardDeleteAccount = useAction(
    api.gtmMaya.accountLifecycle.hardDeleteMyGtmAccount
  );
  const cancelSubscription = useAction(
    api.gtmMaya.accountLifecycle.cancelMyGtmSubscription
  );
  const resumeSubscription = useAction(
    api.gtmMaya.accountLifecycle.resumeMyGtmSubscription
  );
  const startCheckout = useAction(
    api.billing.gtmBilling.createGtmCheckoutSession
  );
  const { signOut } = useClerk();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<GtmTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleDeleteAccount() {
    if (confirmText.trim().toUpperCase() !== DELETE_PHRASE) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Hard, irreversible delete: cancels + deletes the Stripe customer, purges
      // ALL gtm* rows (cross-tenant learnings exempt), and destroys the Fly app.
      // The DB purge is authoritative; Stripe/Fly teardown is best-effort.
      const result = await hardDeleteAccount({});
      if (!result.deleted) {
        throw new Error(result.reason ?? "Could not delete your account.");
      }
      // Now end the Clerk session and hard-redirect to the public landing — a
      // full reload wipes all client + Convex state so there's no stale authed
      // dashboard left behind.
      await signOut();
      window.location.href = "/";
    } catch (err) {
      setDeleting(false);
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete your account."
      );
    }
  }

  async function handleCancel() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const result = await cancelSubscription({});
      if (!result.ok) {
        setCancelError(
          result.reason === "no-active-subscription"
            ? "No active subscription to cancel."
            : (result.reason ?? "Could not cancel.")
        );
      }
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : "Could not cancel."
      );
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleResume() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const result = await resumeSubscription({});
      if (!result.ok) {
        if (result.reason === "subscription-ended-resubscribe") {
          setCancelError(
            "Your subscription already ended — pick a plan below to resume."
          );
        } else {
          setCancelError(result.reason ?? "Could not resume.");
        }
      }
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : "Could not resume."
      );
    } finally {
      setCancelBusy(false);
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
          {account.canceledAt ? (
            <div className="mt-4 flex flex-col gap-3 border-t border-paper-faint/15 pt-4">
              <p className="text-sm text-paper">
                Subscription canceled.{" "}
                {account.canceledPeriodEndMs ? (
                  <>
                    Active until{" "}
                    <span className="font-mono text-paper">
                      {new Date(account.canceledPeriodEndMs)
                        .toISOString()
                        .slice(0, 10)}
                    </span>
                    , then paused. Your data is kept for 30 days so you can
                    resume.
                  </>
                ) : (
                  <>Your data is kept for 30 days so you can resume.</>
                )}
              </p>
              <button
                onClick={handleResume}
                disabled={cancelBusy}
                className="self-start rounded-lg border border-lime/40 bg-lime/5 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-lime hover:bg-lime/10 disabled:opacity-50"
              >
                {cancelBusy ? "Working…" : "Resume subscription"}
              </button>
              {cancelError ? (
                <p className="text-xs text-[#b3261e]">{cancelError}</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 border-t border-paper-faint/15 pt-4">
              <p className="text-sm text-paper-dim">
                Your first week is free — pick a plan any time to keep Maya
                running.
              </p>
              <TierSelector
                interval="monthly"
                showIntervalToggle={false}
                busyTier={checkingOut}
                onSelect={(tier) => handleSubscribe(tier)}
              />
              {checkoutError ? (
                <p className="text-xs text-[#b3261e]">{checkoutError}</p>
              ) : null}
              {(account.gtmPlanStatus === "active" ||
                account.gtmPlanStatus === "trialing" ||
                account.gtmPlanStatus === "past_due") && (
                <div className="border-t border-paper-faint/15 pt-3">
                  <button
                    onClick={handleCancel}
                    disabled={cancelBusy}
                    className="font-mono text-xs uppercase tracking-wide text-paper-faint underline decoration-paper-faint/30 underline-offset-2 hover:text-paper-dim disabled:opacity-50"
                  >
                    {cancelBusy ? "Working…" : "Cancel subscription"}
                  </button>
                  {cancelError ? (
                    <p className="mt-2 text-xs text-[#b3261e]">{cancelError}</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
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
                This permanently deletes your account and all of Maya&apos;s
                research, cancels billing, and shuts down your manager. This
                cannot be undone. Type{" "}
                <span className="font-mono text-paper">{DELETE_PHRASE}</span> to
                confirm.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={DELETE_PHRASE}
                autoComplete="off"
                disabled={deleting}
                className="w-40 rounded-lg border border-rose/40 bg-transparent px-3 py-1.5 font-mono text-sm text-paper outline-none placeholder:text-paper-faint/50 focus:border-rose disabled:opacity-50"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleDeleteAccount}
                  disabled={
                    deleting ||
                    confirmText.trim().toUpperCase() !== DELETE_PHRASE
                  }
                  className="rounded-lg bg-rose px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-ink disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Permanently delete"}
                </button>
                <button
                  onClick={() => {
                    setConfirming(false);
                    setConfirmText("");
                    setDeleteError(null);
                  }}
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
