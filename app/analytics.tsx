"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";

/**
 * Product analytics on the website only (plan §7 S1: view, scroll depth, CTA click).
 * Off unless a key is set; no cookies beyond the vendor's own, and nothing personal is
 * sent: no handles, no emails, no message text. The app tabs are not tracked.
 */
let started = false;

function start(): boolean {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return false;
  if (!started) {
    posthog.init(key, { api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com", capture_pageview: false, persistence: "memory", autocapture: false, disable_session_recording: true });
    started = true;
  }
  return true;
}

export function track(event: string, props: Record<string, string | number | boolean> = {}): void {
  if (!start()) return;
  posthog.capture(event, props);
}

/** Mounted on the landing page only. */
export function LandingAnalytics() {
  const path = usePathname();
  useEffect(() => {
    if (!start()) return;
    posthog.capture("landing_view", { path });
    const marks = new Set<number>();
    const onScroll = () => {
      const h = document.documentElement;
      const depth = Math.round(((window.scrollY + window.innerHeight) / h.scrollHeight) * 100);
      for (const m of [25, 50, 75, 100]) if (depth >= m && !marks.has(m)) {
        marks.add(m);
        posthog.capture("landing_scroll", { depth: m });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [path]);
  return null;
}
