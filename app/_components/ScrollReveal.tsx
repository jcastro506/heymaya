"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-triggered reveal wrapper.
 *
 * Uses IntersectionObserver to add `data-visible="true"` on the wrapper
 * when the element scrolls into a comfortable viewing zone (rootMargin
 * `-10% 0% -20% 0%` means: "fire when the element is ~20% past the
 * viewport bottom edge and ~10% from the top" — so the animation lands
 * when the section is genuinely on screen, not as it begins to peek in).
 *
 * Critical detail: the setVisible call is wrapped in two
 * requestAnimationFrames. The first frame guarantees the browser has
 * painted the initial `data-visible="false"` state (opacity 0 +
 * translated); the second frame schedules the state flip on the *next*
 * paint, so CSS gets a proper from-to transition. Without this,
 * elements that are already in view on mount snap straight to visible
 * with no animation.
 *
 * Animation: fade + 40px rise + tiny scale-up (0.97 → 1) over 1s on a
 * decelerate curve. Reduced-motion users get no transition.
 */
export function ScrollReveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reveal = () => {
      // Two-rAF defer: paint "false" state, then flip → real transition fires.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          reveal();
          observer.disconnect();
        }
      },
      {
        threshold: 0.15,
        rootMargin: "-10% 0% -20% 0%",
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-visible={visible ? "true" : "false"}
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
      className={`scroll-reveal ${className}`}
    >
      {children}
    </div>
  );
}
