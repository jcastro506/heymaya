"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Holds a phone's motion (texts arriving, bars growing) until it scrolls into view, so a thread
 * halfway down the page plays when someone reaches it instead of at page load. The CSS in landing.css
 * pauses everything inside `.iv` until `.iv-go`; the page's <noscript> style lets it play without script.
 */
export function InView({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setGo(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setGo(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`iv${go ? " iv-go" : ""}${className ? ` ${className}` : ""}`}>{children}</div>;
}
