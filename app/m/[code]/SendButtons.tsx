"use client";
import { useEffect } from "react";

const q = (s: string) => encodeURIComponent(s);

/** Pure: Gmail's compose for this email, per device: the app on iPhone, Gmail via a mail link on Android, Gmail on the web elsewhere. */
export function gmailLinks(to: string, subject: string, body: string) {
  return {
    ios: `googlegmail:///co?to=${q(to)}&subject=${q(subject)}&body=${q(body)}`,
    android: `mailto:${to}?subject=${q(subject)}&body=${q(body)}`,
    web: `https://mail.google.com/mail/?view=cm&fs=1&to=${q(to)}&su=${q(subject)}&body=${q(body)}`,
  };
}

/**
 * Opens the email in Gmail the moment the page loads (operator, 2026-10-12: "it should just open up with the full
 * email loaded in their Gmail"). On an iPhone without the Gmail app, it falls through to Gmail on the web. The one
 * button is there only if the phone asks first or blocks the jump.
 */
export function OpenInGmail({ to, subject, body }: { to: string; subject: string; body: string }) {
  const links = gmailLinks(to, subject, body);
  const go = () => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      window.location.href = links.ios;
      // No Gmail app: the page is still showing a moment later, so open Gmail on the web instead.
      setTimeout(() => { if (!document.hidden) window.location.href = links.web; }, 1500);
    } else if (/Android/i.test(ua)) window.location.href = links.android;
    else window.location.href = links.web;
  };
  useEffect(() => { go(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival: the whole point of the link
  return <button type="button" className="send-primary" onClick={go}>Open in Gmail</button>;
}
