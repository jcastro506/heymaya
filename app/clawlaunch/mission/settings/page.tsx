"use client";

/**
 * Settings (the gear) — channel connections, product profile, how much rope
 * Maya gets ("Trust Maya"), plan & billing, session, and the danger zone.
 * Everything else in the app is Maya's; this page is the founder's.
 */

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import {
  Card,
  Loading,
  NeedsOnboarding,
  Pill,
  Rise,
  Section,
  Shell,
} from "../_components";
import { ConnectedAccounts } from "../account/_ConnectedAccounts";
import { ProductBrain } from "../account/_ProductBrain";
import { PostingControl } from "../account/_PostingControl";
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

export default function SettingsPage() {
  const account = useQuery(api.gtmMaya.missionControl.getMyAccount);
  /**
   * ⚠️ v2 sources. `getMyAccount` still carries plan and billing, which have
   * not migrated — but Product and Trust now read the rows v2 actually writes.
   */
  const product = useQuery(api.maya.dashboard.myMemory, {});
  const productUrl = product?.ok ? product.believes.url : "";
  const cancelSubscription = useAction(
    api.gtmMaya.accountLifecycle.cancelMyGtmSubscription
  );
  const resumeSubscription = useAction(
    api.gtmMaya.accountLifecycle.resumeMyGtmSubscription
  );
  const startCheckout = useAction(api.billing.gtmBilling.createGtmCheckoutSession);
  /**
   * ⭐ §18 Sprint 10 lists "account deletion + data export" under the
   * operational essentials — "without these it is not handable".
   *
   * ⚠️ Deletion had a page and export had NOTHING. `requestMyDataExport` was
   * built, tested, and had no caller anywhere in `app/`, so a founder could
   * delete everything and never get a copy of it first. That ordering is the
   * wrong way round: the irreversible action shipped and the reversible one
   * didn't.
   */
  const requestExport = useAction(api.maya.dataExport.requestMyDataExport);
  const { signOut } = useClerk();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<GtmTier | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportTruncated, setExportTruncated] = useState<string[]>([]);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportUrl(null);
    try {
      const out = await requestExport({});
      if (!out.ok || !out.url) {
        setExportError("Couldn't build the file. Try again in a minute.");
        return;
      }
      setExportUrl(out.url);
      /**
       * ⚠️ Surfaced, never swallowed. An export that silently dropped the tail
       * of a table is a file the founder would reasonably believe is complete —
       * §14.45's rule that a partial figure is never presented as the whole
       * applies to their data as much as to their results.
       */
      setExportTruncated(out.truncated ?? []);
    } catch {
      setExportError("Couldn't build the file. Try again in a minute.");
    } finally {
      setExporting(false);
    }
  }

  async function handleSignOut() {
    // Plain log out — ends the Clerk session and returns to the public landing.
    // A full reload clears all client + Convex state (distinct from deleting).
    await signOut();
    window.location.href = "/";
  }

  async function handleDeleteAccount() {
    if (confirmText.trim().toUpperCase() !== DELETE_PHRASE) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Route through /api/account/delete so the delete is COMPLETE: it purges
      // Convex (Stripe customer + ALL gtm* rows), destroys the Fly app, AND
      // deletes the Clerk identity — no ghost login left behind.
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE MAYA" }),
      });
      const result = (await res.json()) as { deleted?: boolean; error?: string };
      if (!res.ok || !result.deleted) {
        throw new Error(result.error ?? "Could not delete your account.");
      }
      try {
        await signOut();
      } catch {
        /* session already invalidated by the user delete — ignore */
      }
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
      setCancelError(err instanceof Error ? err.message : "Could not cancel.");
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
      setCancelError(err instanceof Error ? err.message : "Could not resume.");
    } finally {
      setCancelBusy(false);
    }
  }

  async function handleSubscribe(tier: GtmTier) {
    setCheckingOut(tier);
    setCheckoutError(null);
    try {
      const { url } = await startCheckout({
        interval: "monthly",
        tier,
        returnBaseUrl: window.location.origin,
      });
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
    : "Set at kickoff";

  return (
    <Shell
      title="Settings"
      subtitle="Your channels, your product, and how much rope Maya gets. Everything still runs through your Telegram."
    >
      {/* ── Channels first — the thing founders come here for ─────────── */}
      <Section title="Connected channels">
        <Rise>
          <Card>
            <Row label="Telegram" value={<Pill tone="lime">primary channel</Pill>} />
            <div className="mt-3 border-t border-paper-faint/15 pt-3">
              <ConnectedAccounts />
            </div>
          </Card>
        </Rise>
      </Section>

      {/**
        * ⭐ TRUST, PER CHANNEL — the single most consequential setting here.
        *
        * ⚠️ This read `account.postingMode` from `gtmAgents.autonomousPosting`,
        * a v1 row v2 NEVER WRITES. It rendered null for every founder, and
        * toggling it would have written to a table nothing reads. A control
        * that looks like it works and changes nothing is worse than a missing
        * one.
        *
        * ⚠️ And the v1 SHAPE was wrong, not just unwired: one account-level
        * flag cannot express what v2 stores. TikTok on `just_go` while
        * Instagram still asks first is a normal state for a founder who trusts
        * one surface more than another.
        */}
      <Section title="How much rope she gets">
        <TrustPerChannel />
      </Section>

      {/**
        * ⚠️ This read `gtmApps` via `agent.appId` — a table v2 never writes, so
        * every row rendered "—". What she believes about the product lives in
        * `customers.productTruthJson`, and Brain already shows the full read.
        */}
      <Section title="Product">
        <Card>
          <Row label="Product" value={product?.believes.name || "—"} />
          <Row
            label="Site"
            value={
              productUrl ? (
                <a
                  href={productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-paper underline decoration-paper/30 underline-offset-2"
                >
                  {productUrl}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Row
            label="What it is"
            value={product?.believes.whatItIs || "—"}
          />
          {/* The correction path is the chat, not a form here (§2.1). */}
          <p className="mt-3 text-xs leading-relaxed text-paper-dim">
            Got something wrong? Tell her in Telegram — what you say outranks
            anything she read on your site.
          </p>
        </Card>
      </Section>

      <Section title="What Maya understands about your product">
        <ProductBrain app={app} />
      </Section>

      <Section title="Plan">
        <Card>
          <Row
            label="Plan"
            value={
              account.gtmPlanTier
                ? ({
                    starter: "Starter · $99/mo",
                    growth: "Growth · $149/mo",
                    studio: "Studio · $199/mo",
                  }[account.gtmPlanTier as "starter" | "growth" | "studio"] ??
                  account.gtmPlanTier)
                : "—"
            }
          />
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
                      {new Date(account.canceledPeriodEndMs).toISOString().slice(0, 10)}
                    </span>
                    , then paused. Your data is kept for 30 days so you can resume.
                  </>
                ) : (
                  <>Your data is kept for 30 days so you can resume.</>
                )}
              </p>
              <button
                onClick={handleResume}
                disabled={cancelBusy}
                className="self-start rounded-full border border-lime/40 bg-lime/5 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-lime transition-colors hover:bg-lime/10 disabled:opacity-50"
              >
                {cancelBusy ? "Working…" : "Resume subscription"}
              </button>
              {cancelError ? <p className="text-xs text-rose">{cancelError}</p> : null}
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 border-t border-paper-faint/15 pt-4">
              <p className="text-sm text-paper-dim">
                Your first week is free — pick a plan any time to keep Maya running.
              </p>
              <TierSelector
                interval="monthly"
                showIntervalToggle={false}
                busyTier={checkingOut}
                currentTier={(account.gtmPlanTier as GtmTier | null) ?? null}
                onSelect={(tier) => handleSubscribe(tier)}
              />
              {checkoutError ? (
                <p className="text-xs text-rose">{checkoutError}</p>
              ) : null}
              {(account.gtmPlanStatus === "active" ||
                account.gtmPlanStatus === "trialing" ||
                account.gtmPlanStatus === "past_due") && (
                <div className="border-t border-paper-faint/15 pt-3">
                  <button
                    onClick={handleCancel}
                    disabled={cancelBusy}
                    className="font-mono text-xs uppercase tracking-wide text-paper-faint underline decoration-paper-faint/30 underline-offset-2 transition-colors hover:text-paper-dim disabled:opacity-50"
                  >
                    {cancelBusy ? "Working…" : "Cancel subscription"}
                  </button>
                  {cancelError ? (
                    <p className="mt-2 text-xs text-rose">{cancelError}</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Session">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-paper-dim">
              Log out of HeyMaya on this device. Maya keeps running — you can sign
              back in any time.
            </p>
            <button
              onClick={handleSignOut}
              className="rounded-full border border-paper/40 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-paper transition-colors hover:bg-paper/10"
            >
              Log out
            </button>
          </div>
        </Card>
      </Section>

      <Section title="Your data">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-paper-dim">
              Download everything Maya holds for you — your posts, drafts, ideas,
              messages and results — as one file.
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="shrink-0 rounded-full border border-paper/40 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-paper transition-colors hover:bg-paper/10 disabled:opacity-50"
            >
              {exporting ? "Building…" : "Export"}
            </button>
          </div>
          {exportUrl ? (
            <p className="mt-3 text-sm text-paper">
              <a
                href={exportUrl}
                className="underline underline-offset-4"
                download
              >
                Download your data
              </a>
              {exportTruncated.length > 0 ? (
                <span className="text-paper-dim">
                  {" "}
                  — the longest histories are capped, so {exportTruncated.join(", ")}{" "}
                  {exportTruncated.length === 1 ? "is" : "are"} the most recent
                  rather than everything.
                </span>
              ) : null}
            </p>
          ) : null}
          {exportError ? (
            <p className="mt-3 text-sm text-paper-dim">{exportError}</p>
          ) : null}
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
                className="rounded-full border border-rose/40 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-rose transition-colors hover:bg-rose/10"
              >
                Delete account
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-paper">
                This permanently deletes your account and all of Maya&apos;s
                research, cancels billing, and shuts down your manager. This cannot
                be undone. Type{" "}
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
                    deleting || confirmText.trim().toUpperCase() !== DELETE_PHRASE
                  }
                  className="rounded-full bg-rose px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-ink disabled:opacity-50"
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
                  className="rounded-full border border-paper-faint/30 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wide text-paper-dim disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              {deleteError ? <p className="text-xs text-rose">{deleteError}</p> : null}
            </div>
          )}
        </Card>
      </Section>
    </Shell>
  );
}

/**
 * ⭐ How much rope she gets, per channel.
 *
 * ⚠️ Only connected channels are offered. A control for a channel with no
 * grant would record a preference for a connection that does not exist, and
 * the publish gate would then be deciding about a surface she cannot reach.
 */
function TrustPerChannel() {
  const data = useQuery(api.maya.channels.myChannels);
  const setMode = useMutation(api.maya.channels.setMyPostingMode);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return null;
  if (!data.ok || !data.channels) {
    return <p className="text-sm text-paper-faint">Sign in to change this.</p>;
  }

  const connected = data.channels.filter(
    (c): c is typeof c & { channel: "tiktok" | "instagram" | "youtube" } =>
      c.channel !== "x" && c.state !== "not_connected"
  );

  if (connected.length === 0) {
    return (
      <Card>
        <p className="text-sm text-paper-faint">
          Connect a channel and you can decide, for each one, whether she posts
          straight away or shows you first.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      {connected.map((c) => {
        const justGo = c.postingMode === "just_go";
        return (
          <div key={c.channel} className="mc-trust-row">
            <div>
              <div className="mc-trust-ch">{c.channel}</div>
              <div className="mc-trust-sub">
                {justGo
                  ? "she posts without asking"
                  : "she shows you every post first"}
              </div>
            </div>
            <button
              type="button"
              disabled={busy === c.channel}
              className="mc-btn"
              onClick={async () => {
                setBusy(c.channel);
                try {
                  await setMode({
                    channel: c.channel,
                    postingMode: justGo ? "show_me_first" : "just_go",
                  });
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === c.channel
                ? "…"
                : justGo
                  ? "Ask me first"
                  : "Let her post"}
            </button>
          </div>
        );
      })}
    </Card>
  );
}
