"use client";
import { useEffect, useState } from "react";

const q = (s: string) => encodeURIComponent(s);

/** Gmail's app on an iPhone, Gmail on the web on a computer (Android opens Gmail from a mail link), and the default mail app. */
export function SendButtons({ to, subject, body }: { to: string; subject: string; body: string }) {
  const [device, setDevice] = useState<"ios" | "android" | "desktop">("desktop");
  useEffect(() => { const ua = navigator.userAgent; setDevice(/iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "desktop"); }, []);
  const mail = `mailto:${to}?subject=${q(subject)}&body=${q(body)}`;
  const gmail = device === "ios" ? `googlegmail:///co?to=${q(to)}&subject=${q(subject)}&body=${q(body)}` : device === "android" ? mail : `https://mail.google.com/mail/?view=cm&fs=1&to=${q(to)}&su=${q(subject)}&body=${q(body)}`;
  const phone = device !== "desktop";
  return (
    <div className="send-buttons">
      <a className="send-primary" href={gmail} target={phone ? undefined : "_blank"} rel="noreferrer">Open in Gmail</a>
      <a className="send-secondary" href={mail}>Open in Mail</a>
    </div>
  );
}

export function CopyButton({ text, label, wide }: { text: string; label: string; wide?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={wide ? "send-copy send-copy-wide" : "send-copy"} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* the text is on the page to select by hand */ } }}>
      {done ? "Copied" : label}
    </button>
  );
}
