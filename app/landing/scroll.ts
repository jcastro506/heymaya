"use client";

/**
 * The scroll engine for the front door (2026-09-08): GSAP ScrollTrigger for pinned,
 * scrubbed stages and Lenis for the smooth scroll the good pages have. One hook mounts
 * both, and reduced motion mounts neither, so the page reads as a document for anyone who
 * asked for no motion.
 */

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

let registered = false;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Mounts Lenis + ScrollTrigger once for the page; `build` registers the page's timelines and returns a cleanup. */
export function useScrollStage(build: (ctx: { gsap: typeof gsap; ScrollTrigger: typeof ScrollTrigger }) => void | (() => void)) {
  useEffect(() => {
    if (reducedMotion()) {
      document.querySelectorAll<HTMLElement>(".ld [data-rv]").forEach((e) => e.classList.add("in"));
      return;
    }
    if (!registered) { gsap.registerPlugin(ScrollTrigger); registered = true; }
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    const ctx = gsap.context(() => {});
    let cleanup: void | (() => void);
    ctx.add(() => { cleanup = build({ gsap, ScrollTrigger }); });
    ScrollTrigger.refresh();
    return () => {
      if (typeof cleanup === "function") cleanup();
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [build]);
}
