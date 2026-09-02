"use client";

/**
 * Screen 6 and 7 (plan §7 S2): meet Maya on Telegram. Assume they don't have it.
 * One big button fires the app link; if the app doesn't take over in ~1.5 s the
 * store button appears. The page flips to Connected from the pairing row.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function storeUrl(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "https://apps.apple.com/app/telegram-messenger/id686449807";
  if (/Android/i.test(ua)) return "https://play.google.com/store/apps/details?id=org.telegram.messenger";
  return "https://telegram.org/apps";
}

export default function TelegramPage() {
  const createLink = useMutation(api.core.pairing.createPairingLink);
  const progress = useQuery(api.onboarding.start.progress);
  const [link, setLink] = useState<{ deepLink: string; appLink: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [stuck, setStuck] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  async function mint() {
    const r = await createLink({});
    if (!r.ok || !r.deepLink) return setError(r.error ?? "couldn't make your link");
    const m = r.deepLink.match(/t\.me\/([^?]+)\?start=(.+)$/);
    const appLink = m ? `tg://resolve?domain=${m[1]}&start=${m[2]}` : r.deepLink;
    setLink({ deepLink: r.deepLink, appLink });
  }

  useEffect(() => {
    // Minted on the next tick so the state write is not synchronous inside the effect.
    const t = setTimeout(() => void mint(), 0);
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open() {
    if (!link) return;
    setTapped(true);
    setShowStore(false);
    const before = hiddenAt.current;
    window.location.href = link.appLink;
    // If the app didn't take over, the page never hid: offer the store.
    setTimeout(() => {
      if (!document.hidden && hiddenAt.current === before) setShowStore(true);
    }, 1500);
    // If it opened but no Start arrived, say so rather than spinning.
    setTimeout(() => {
      if (!progress?.paired) setStuck(true);
    }, 120_000);
  }

  const paired = progress?.paired ?? false;

  return (
    <main className="min-h-dvh max-w-md mx-auto p-6 flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Maya</h1>
        <span className="text-xs opacity-60">last step</span>
      </header>

      {paired ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg">Connected.</h2>
          <p className="text-sm opacity-80">
            {progress?.dossier ? "She's read your posts. Her first message is on its way to Telegram." : `She's reading your posts now (${progress?.posts ?? 0} so far). Her first message lands in Telegram in a few minutes.`}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg">Meet Maya on Telegram</h2>
          <p className="text-sm opacity-70">She texts you there. Tap the button, then tap <b>Start</b> in Telegram. That&apos;s the whole pairing.</p>
          <button className="btn" disabled={!link} onClick={open}>Open Maya in Telegram</button>
          {showStore && (
            <div className="flex flex-col gap-2">
              <p className="text-sm opacity-80">Looks like Telegram isn&apos;t installed yet. It&apos;s free. Install it, come back here, and tap the button again.</p>
              <a className="btn-secondary" href={storeUrl()} target="_blank" rel="noreferrer">Get Telegram, it&apos;s free</a>
            </div>
          )}
          {tapped && !showStore && !paired && <p className="text-xs opacity-60">Waiting for you to tap Start in Telegram…</p>}
          {stuck && !paired && (
            <p className="text-sm opacity-80">Didn&apos;t work? Tap the button again. If Telegram opened but nothing happened, tap <b>Start</b> at the bottom of the chat, she can&apos;t message first.</p>
          )}
          {link && (
            <details className="text-xs opacity-60">
              <summary>On a computer?</summary>
              <p className="mt-2">Open this on your phone: <a className="underline" href={link.deepLink}>{link.deepLink}</a></p>
            </details>
          )}
          {progress && progress.posts > 0 && <p className="text-xs opacity-60">Meanwhile she has read {progress.posts} of your posts.</p>}
        </section>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </main>
  );
}
