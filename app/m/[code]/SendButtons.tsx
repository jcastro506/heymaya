"use client";
import { useState } from "react";

const q = (s: string) => encodeURIComponent(s);

/** Gmail's app on an iPhone, Gmail on the web on a computer (Android opens Gmail from a mail link), and the default mail app. Picked at the tap. */
export function SendButtons({ to, subject, body }: { to: string; subject: string; body: string }) {
  const mail = `mailto:${to}?subject=${q(subject)}&body=${q(body)}`;
  const web = `https://mail.google.com/mail/?view=cm&fs=1&to=${q(to)}&su=${q(subject)}&body=${q(body)}`;
  const ios = `googlegmail:///co?to=${q(to)}&subject=${q(subject)}&body=${q(body)}`;
  const openGmail = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) { e.preventDefault(); window.location.href = ios; }
    else if (/Android/i.test(ua)) { e.preventDefault(); window.location.href = mail; }
  };
  return (
    <div className="send-buttons">
      <a className="send-primary" href={web} target="_blank" rel="noreferrer" onClick={openGmail}>Open in Gmail</a>
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
