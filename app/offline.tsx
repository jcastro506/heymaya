"use client";

import { useEffect, useState } from "react";

/** §17.2 S1–S5: the thin UI says when it is offline instead of showing stale rows as live. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-black text-center text-xs py-1">You&apos;re offline. What you see is as of the last time this loaded.</div>;
}
