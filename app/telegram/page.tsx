"use client";

/**
 * Screen 6 and 7 (plan §7 S2): meet Maya on Telegram. Assume they don't have it.
 * One big button fires the app link; if the app doesn't take over in ~1.5 s the
 * store button appears. The page flips to Connected from the pairing row.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import QRCode from "qrcode";
import { api } from "@/convex/_generated/api";
import { OnboardShell } from "../onboarding/Shell";

/** On a phone the button opens the app; on a computer the QR is the button (2026-09-07). */
function isPhone(): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

function storeUrl(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "https://apps.apple.com/app/telegram-messenger/id686449807";
  if (/Android/i.test(ua)) return "https://play.google.com/store/apps/details?id=org.telegram.messenger";
  return "https://telegram.org/apps";
}

export default function TelegramPage() {
  const createLink = useMutation(api.core.pairing.createPairingLink);
  const progress = useQuery(api.onboarding.start.progress);
  const [link, setLink] = useState<{ deepLink: string; appLink: string; kind: "telegram" | "imessage"; lineNumber?: string; token?: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [stuck, setStuck] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  async function mint() {
    const r = await createLink({});
    if (!r.ok || !r.deepLink) return setError(r.error ?? "couldn't make your link");
    if (r.kind === "imessage") {
      // §23: the link opens Messages with START prefilled; the QR carries the same link for a phone scanning a laptop.
      setLink({ deepLink: r.deepLink, appLink: r.deepLink, kind: "imessage", lineNumber: r.lineNumber, token: r.token });
      try { setQr(await QRCode.toDataURL(r.deepLink, { margin: 1, width: 220, color: { dark: "#ffffffff", light: "#00000000" } })); } catch { setQr(null); }
      return;
    }
    const m = r.deepLink.match(/t\.me\/([^?]+)\?start=(.+)$/);
    const appLink = m ? `tg://resolve?domain=${m[1]}&start=${m[2]}` : r.deepLink;
    setLink({ deepLink: r.deepLink, appLink, kind: "telegram" });
    // The QR carries the same one-shot link; scanning it on a phone opens Telegram at Maya with Start ready.
    try { setQr(await QRCode.toDataURL(r.deepLink, { margin: 1, width: 220, color: { dark: "#ffffffff", light: "#00000000" } })); } catch { setQr(null); }
  }

  useEffect(() => {
    // Minted on the next tick so the state write is not synchronous inside the effect.
    // Both on the next tick: no synchronous state write inside the effect, and no hydration
    // mismatch (the server has no navigator, so "phone" starts true and corrects itself).
    const t = setTimeout(() => { setPhone(isPhone()); void mint(); }, 0);
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
    <OnboardShell where="last step">

      {paired ? (
        <section>
          <h2>Connected.</h2>
          <p className="small">
            {progress?.dossier ? `She's read your posts. Her first message is on its way${progress?.channelKind === "imessage" ? " to your phone" : " to Telegram"}.` : `She's reading your posts now (${progress?.posts ?? 0} so far). Her first message lands ${progress?.channelKind === "imessage" ? "as a text" : "in Telegram"} in a few minutes.`}
          </p>
        </section>
      ) : link?.kind === "imessage" ? (
        <section>
          <h2>Text Maya</h2>
          {phone ? (
            <>
              <p className="muted small">One text pairs you. Tap the button, send the message it opens, and she&apos;s yours.</p>
              <a className="btn" href={link.deepLink} onClick={() => setTapped(true)}>Text Maya</a>
            </>
          ) : (
            <>
              <p className="muted small">She texts your phone. Scan this with your phone&apos;s camera and send the message it opens.</p>
              {qr ? <img src={qr} alt="Scan to text Maya" className="qr self-start" /> : <p className="tiny muted">Making your code…</p>}
            </>
          )}
          <p className="tiny muted">Or text <b>START {link.token}</b> to <b>{link.lineNumber}</b> from {progress?.phone ?? "your number"}.</p>
          {tapped && !paired && <p className="tiny muted">Waiting for your text…</p>}
        </section>
      ) : (
        <section>
          <h2>Meet Maya on Telegram</h2>
          {phone ? (
            <>
              <p className="muted small">She texts you there. Tap the button, then tap <b>Start</b> in Telegram. That&apos;s the whole pairing.</p>
              <button className="btn" disabled={!link} onClick={open}>Open Maya in Telegram</button>
            </>
          ) : (
            <>
              <p className="muted small">She texts you on your phone. Scan this with your phone&apos;s camera, then tap <b>Start</b> in Telegram. That&apos;s the whole pairing.</p>
              {qr ? <img src={qr} alt="Scan to open Maya in Telegram" className="qr self-start" /> : <p className="tiny muted">Making your code…</p>}
              <button className="btn-secondary" disabled={!link} onClick={open}>Or open Telegram on this computer</button>
            </>
          )}
          {showStore && (
            <div className="panel">
              <p className="small">Looks like Telegram isn&apos;t installed yet. It&apos;s free. Install it, come back here, and tap the button again.</p>
              <a className="btn-secondary" href={storeUrl()} target="_blank" rel="noreferrer">Get Telegram, it&apos;s free</a>
            </div>
          )}
          {tapped && !showStore && !paired && <p className="tiny muted">Waiting for you to tap Start in Telegram…</p>}
          {stuck && !paired && (
            <p className="small">Didn&apos;t work? Tap the button again. If Telegram opened but nothing happened, tap <b>Start</b> at the bottom of the chat, she can&apos;t message first.</p>
          )}
          {link && phone && (
            <details className="tiny muted">
              <summary>On a computer too?</summary>
              <p className="mt-2">This link works anywhere you have Telegram: <a className="link" href={link.deepLink}>{link.deepLink}</a></p>
            </details>
          )}
          {progress && progress.posts > 0 && <p className="tiny muted">Meanwhile she has read {progress.posts} of your posts.</p>}
        </section>
      )}
      {error && <p className="err">{error}</p>}
    </OnboardShell>
  );
}
