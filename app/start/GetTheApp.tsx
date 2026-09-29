"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { appLink } from "@/lib/appLink";

// Read here, by name, so the build inlines them (a client bundle has no process.env to pass whole).
const APP = appLink({ NEXT_PUBLIC_APP_STORE_URL: process.env.NEXT_PUBLIC_APP_STORE_URL, NEXT_PUBLIC_APP_STORE_ID: process.env.NEXT_PUBLIC_APP_STORE_ID, NEXT_PUBLIC_TESTFLIGHT_URL: process.env.NEXT_PUBLIC_TESTFLIGHT_URL });

type Device = "iphone" | "android" | "desktop";

/** The last step's handoff: one tap on an iPhone, a QR to scan from a computer, nothing to install on Android. */
export function GetTheApp() {
  const [device, setDevice] = useState<Device | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const join = typeof window === "undefined" ? "/join?where=onboarding" : `${window.location.origin}/join?where=onboarding`;
  useEffect(() => {
    const ua = navigator.userAgent;
    const next: Device = /iPhone|iPad|iPod/.test(ua) ? "iphone" : /Android/.test(ua) ? "android" : "desktop";
    queueMicrotask(() => setDevice(next));
    if (next === "desktop") QRCode.toString(join, { type: "svg", margin: 0, color: { dark: "#29233f", light: "#00000000" } }).then(setQr).catch(() => setQr(null));
  }, [join]);
  if (APP.kind === "none" || device === null) return null;
  if (device === "android") return <p className="muted small">The Maya app is iPhone-only for now. Everything she does works over text.</p>;
  return (
    <div className="app-handoff">
      <h2>Now get the app.</h2>
      <p className="muted small">It’s where her ideas, your numbers and your week live. Sign in with the same account you just used.</p>
      {device === "iphone" ? (
        <a className="btn" href={join}>{APP.kind === "store" ? "Get Maya on the App Store" : "Get the Maya app"}</a>
      ) : (
        <div className="app-qr">
          {qr ? <div className="app-qr-code" role="img" aria-label="QR code to get the Maya app" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
          <p className="small">Scan with your iPhone camera.</p>
        </div>
      )}
    </div>
  );
}

