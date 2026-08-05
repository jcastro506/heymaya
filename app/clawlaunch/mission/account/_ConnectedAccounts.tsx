"use client";

/**
 * Connected Accounts panel — the web self-serve connect flow.
 *
 * The backend (getZernioConnectUrl / getMyConnectedAccounts / disconnect /
 * health) already existed; it just had no UI caller, so a founder hitting
 * "connect" got an empty {}. This wires it: per-channel status + a Connect
 * button that opens Zernio's hosted OAuth, whose callback reconciles the
 * account list server-side.
 */

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * The four channels the product ships (spec §2, line 24).
 *
 * Reddit and LinkedIn were deliberately dropped and must not be offered here:
 *
 *   - **Reddit** — out on **ban risk and volatility**, NOT capability.
 *     Replying there does work (live-proven 2026-07-25), and that's precisely
 *     the trap: it works right up until an account is gone. Reddit has been
 *     tightening on API and AI-assisted posting, and a banned account is
 *     unrecoverable damage done under the founder's own name.
 *   - **LinkedIn** — wrong modality. It was the only non-vertical-video
 *     channel, and dropping it turns one 9:16 asset into three placements
 *     (TikTok + Reels + Shorts) instead of two plus a bespoke one.
 *
 * A channel offered here is a channel a founder can connect, and a connected
 * channel is one Maya will eventually post to. So this list is a product
 * boundary, not a menu — `connectedChannelsMatchSpec.test.ts` pins it.
 */
const OFFERED: ReadonlyArray<{ key: string; label: string; auto: boolean }> = [
  { key: "x", label: "X", auto: true },
  { key: "instagram", label: "Instagram", auto: true },
  { key: "youtube", label: "YouTube", auto: true },
  // TikTok's rendered-preview confirmation is a PLATFORM consent requirement,
  // not our caution — hence one-tap rather than auto (§9.1).
  { key: "tiktok", label: "TikTok", auto: false },
];

type ConnectedAccount = {
  accountId: string;
  platform: string;
  username?: string;
  displayName?: string;
  isActive: boolean;
  needsReconnect: boolean;
};

export function ConnectedAccounts() {
  const accounts = useQuery(api.gtmMaya.zernioConnect.getMyConnectedAccounts) as
    | ConnectedAccount[]
    | undefined;
  const capInfo = useQuery(api.gtmMaya.zernioConnect.getMyConnectCap);
  const getConnectUrl = useAction(
    api.gtmMaya.zernioConnect.getZernioConnectUrl
  );
  const disconnect = useAction(api.gtmMaya.zernioConnect.disconnectZernioAccount);
  const refreshHealth = useAction(api.gtmMaya.zernioConnect.refreshMyZernioHealth);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byPlatform = new Map<string, ConnectedAccount>();
  for (const a of accounts ?? []) byPlatform.set(a.platform, a);

  // Tier connect-cap: once the founder has linked their plan's allotment, the
  // Connect buttons for NOT-yet-connected channels grey out (the server in
  // getZernioConnectUrl is the real fail-closed guard; this is the UX so they
  // never click into a raw error). Reconnecting an already-linked channel never
  // consumes a slot, so it's never blocked.
  const atCap = capInfo?.atCap ?? false;

  async function handleConnect(platform: string) {
    setBusy(platform);
    setError(null);
    try {
      const { authUrl } = await getConnectUrl({ platform });
      if (!authUrl) throw new Error("No connect URL returned — try again.");
      window.open(authUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Could not start ${platform} connect.`
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(accountId: string, platform: string) {
    setBusy(platform);
    setError(null);
    try {
      await disconnect({ accountId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("__refresh__");
    setError(null);
    try {
      await refreshHealth({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {OFFERED.map(({ key, label, auto }) => {
        const acct = byPlatform.get(key);
        const isBusy = busy === key;
        // A not-yet-connected channel is blocked once the founder is at their
        // tier cap. Connected / needs-reconnect channels are never blocked.
        const capBlocked = atCap && !acct;
        return (
          <div
            key={key}
            className="flex items-center justify-between gap-4 border-b border-paper-faint/10 py-2 last:border-0"
          >
            <div className="flex flex-col">
              <span className="text-sm text-paper">{label}</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-paper-faint">
                {acct
                  ? acct.needsReconnect
                    ? "needs reconnect"
                    : `connected${acct.username ? ` · @${acct.username}` : ""}`
                  : capBlocked
                    ? "plan limit reached"
                    : auto
                      ? "auto-post once connected"
                      : "one-tap confirm"}
              </span>
            </div>
            {acct && !acct.needsReconnect ? (
              <button
                onClick={() => handleDisconnect(acct.accountId, key)}
                disabled={isBusy}
                className="shrink-0 rounded-lg border border-paper-faint/30 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-paper-dim disabled:opacity-50"
              >
                {isBusy ? "…" : "Disconnect"}
              </button>
            ) : (
              <button
                onClick={() => handleConnect(key)}
                disabled={isBusy || capBlocked}
                title={
                  capBlocked
                    ? `Your plan connects up to ${capInfo?.cap} channels — disconnect one or upgrade to add more.`
                    : undefined
                }
                className="shrink-0 rounded-lg bg-lime px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink disabled:opacity-50"
              >
                {isBusy ? "…" : acct?.needsReconnect ? "Reconnect" : "Connect"}
              </button>
            )}
          </div>
        );
      })}

      {atCap ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-paper-faint">
          {capInfo?.connectedCount}/{capInfo?.cap} channels connected — your plan&apos;s
          limit. Disconnect one or upgrade to add more.
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-[#b3261e]">{error}</p>
      ) : null}

      <button
        onClick={handleRefresh}
        disabled={busy === "__refresh__"}
        className="mt-3 self-start font-mono text-[10px] uppercase tracking-wide text-paper-faint underline decoration-paper/20 disabled:opacity-50"
      >
        {busy === "__refresh__" ? "Refreshing…" : "Refresh status"}
      </button>
    </div>
  );
}
