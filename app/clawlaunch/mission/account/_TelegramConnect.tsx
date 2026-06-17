"use client";

/**
 * Add Maya to your phone — QR-first Telegram pairing.
 *
 * The founder scans this QR with their phone camera (or Telegram's in-app
 * scanner); it opens the shared @Maya bot with a one-time pairing token, which
 * binds THIS chat to their agent (claimPairingToken). No bot creation, no token
 * pasting. The QR is rendered client-side so the pairing token never leaves the
 * browser. getMyPairingStatus is a live Convex subscription, so the panel flips
 * to "Connected" the instant the bind lands — no polling.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/convex/_generated/api";

export function TelegramConnect() {
  const status = useQuery(api.gtmMaya.telegramPairing.getMyPairingStatus);
  const createToken = useMutation(
    api.gtmMaya.telegramPairing.createPairingToken
  );
  const [link, setLink] = useState<{
    deepLink: string;
    botUsername: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paired = status?.paired === true;

  // Mint a pairing link once we know they aren't paired yet. Guarded so a
  // re-render doesn't churn tokens (createPairingToken also reuses a live one).
  useEffect(() => {
    if (status === undefined || paired || link) return;
    let cancelled = false;
    void createToken({})
      .then((r) => {
        if (!cancelled)
          setLink({ deepLink: r.deepLink, botUsername: r.botUsername });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "could not create link");
      });
    return () => {
      cancelled = true;
    };
  }, [status, paired, link, createToken]);

  if (paired) {
    return (
      <div className="rounded-lg border border-lime/40 bg-lime/[0.06] p-5">
        <div className="flex items-center gap-2">
          <span className="text-lime">✓</span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-lime">
            Telegram connected
          </span>
        </div>
        <p className="mt-2 text-sm text-paper-dim">
          Maya texts you at{" "}
          <span className="text-paper">
            {status?.username ? `@${status.username}` : "your linked chat"}
          </span>
          . Message her any time — she routes straight to your agent.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-paper-faint/15 bg-ink-2/40 p-5">
      <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-paper">
        Add Maya to your phone
      </h3>
      <p className="mt-2 max-w-md text-sm text-paper-dim">
        Scan this with your phone&apos;s camera to open Maya in Telegram and
        connect. Maya then lives in your Telegram — text her like a person.
      </p>

      {error ? (
        <p className="mt-3 text-sm text-red-400">{error}</p>
      ) : !link ? (
        <p className="mt-4 font-mono text-xs text-paper-faint">
          Generating your link…
        </p>
      ) : (
        <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {/* QR — white quiet-zone so phone cameras lock on reliably. */}
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={link.deepLink} size={168} marginSize={0} />
          </div>
          <div className="space-y-3">
            <p className="text-sm text-paper-dim">
              On your phone already?
            </p>
            <a
              href={link.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-paper px-5 py-2.5 text-sm font-medium text-ink"
            >
              Open Maya in Telegram →
            </a>
            <p className="font-mono text-[11px] text-paper-faint">
              opens @{link.botUsername}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
