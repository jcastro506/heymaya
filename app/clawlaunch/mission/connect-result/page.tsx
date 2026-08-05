"use client";

import Link from "next/link";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

const LABELS: Record<string, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  reddit: "Reddit",
  tiktok: "TikTok",
};

export default function ConnectResultPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-paper px-6 py-16 text-ink">
          <div className="mx-auto max-w-md rounded-lg border border-ink/15 bg-white/50 p-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink/55">
              HeyMaya
            </p>
            <h1 className="mt-4 font-display text-3xl tracking-tight">
              Finishing connect…
            </h1>
          </div>
        </main>
      }
    >
      <ConnectResultBody />
    </Suspense>
  );
}

function ConnectResultBody() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") ?? undefined;
  const error = searchParams.get("connect_error") ?? undefined;
  const connected = searchParams.get("connected") ?? undefined;
  const label = provider ? (LABELS[provider] ?? provider) : "Account";
  const success = Boolean(connected) && !error;

  useEffect(() => {
    const payload = {
      type: "heymaya:zernio-connect",
      provider,
      status: success ? "success" : "error",
      error,
      ts: Date.now(),
    };
    window.opener?.postMessage(payload, window.location.origin);
    window.localStorage.setItem(
      "heymaya:zernio-connect-result",
      JSON.stringify(payload)
    );
    if (success) {
      window.setTimeout(() => window.close(), 900);
    }
  }, [error, provider, success]);

  return (
    <main className="min-h-screen bg-paper px-6 py-16 text-ink">
      <div className="mx-auto flex max-w-md flex-col gap-5 rounded-lg border border-ink/15 bg-white/50 p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink/55">
          HeyMaya
        </p>
        <h1 className="font-display text-3xl tracking-tight">
          {success ? `${label} connected` : `${label} was not connected`}
        </h1>
        <p className="text-sm leading-relaxed text-ink/70">
          {success
            ? "You can close this tab. Mission Control is refreshing the account status."
            : "The connect flow did not finish. Return to Mission Control and try again when you are ready."}
        </p>
        {error ? (
          <p className="rounded border border-ink/10 bg-paper px-3 py-2 font-mono text-xs text-ink/60">
            {error}
          </p>
        ) : null}
        <Link
          href="/clawlaunch/mission/account"
          className="self-start rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper"
        >
          Back to account
        </Link>
      </div>
    </main>
  );
}
