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

const OFFERED: ReadonlyArray<{ key: string; label: string; auto: boolean }> = [
  { key: "x", label: "X", auto: true },
  { key: "linkedin", label: "LinkedIn", auto: true },
  { key: "instagram", label: "Instagram", auto: true },
  { key: "youtube", label: "YouTube", auto: true },
  { key: "reddit", label: "Reddit", auto: false },
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
  const getConnectUrl = useAction(
    api.gtmMaya.zernioConnect.getZernioConnectUrl
  );
  const disconnect = useAction(api.gtmMaya.zernioConnect.disconnectZernioAccount);
  const refreshHealth = useAction(api.gtmMaya.zernioConnect.refreshMyZernioHealth);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byPlatform = new Map<string, ConnectedAccount>();
  for (const a of accounts ?? []) byPlatform.set(a.platform, a);

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
                disabled={isBusy}
                className="shrink-0 rounded-lg bg-lime px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-ink disabled:opacity-50"
              >
                {isBusy ? "…" : acct?.needsReconnect ? "Reconnect" : "Connect"}
              </button>
            )}
          </div>
        );
      })}

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
