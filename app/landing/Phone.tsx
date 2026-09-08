"use client";

/**
 * A phone in three dimensions, in CSS (2026-09-08). A perspective wrapper, a body with
 * real depth (side faces from box-shadow stacks), a bezel and a screen. The scroll engine
 * rotates and drifts it; the pointer tilts it a few degrees on hover. No WebGL: it has to
 * run at 60fps on a four-year-old phone, which is who this page is for.
 */

import { useRef, type ReactNode } from "react";

export function Phone({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  function tilt(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current; if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tx", `${(-y * 8).toFixed(2)}deg`);
    el.style.setProperty("--ty", `${(x * 10).toFixed(2)}deg`);
  }
  function reset() { const el = ref.current; if (!el) return; el.style.setProperty("--tx", "0deg"); el.style.setProperty("--ty", "0deg"); }
  return (
    <div className={`p3 ${className}`} id={id} onPointerMove={tilt} onPointerLeave={reset}>
      <div ref={ref} className="p3-body">
        <div className="p3-side" aria-hidden="true" />
        <div className="p3-bezel">
          <div className="p3-notch" aria-hidden="true" />
          <div className="p3-screen">{children}</div>
        </div>
        <div className="p3-glare" aria-hidden="true" />
      </div>
    </div>
  );
}
