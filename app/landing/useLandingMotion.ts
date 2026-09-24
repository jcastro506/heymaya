"use client";

import { useEffect, type RefObject } from "react";

/** Motion enhances visible HTML. Nothing is hidden while waiting for JS or an observer. */
export function useLandingMotion(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.IntersectionObserver || !Element.prototype.animate)
      return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cleanup = () => {};

    const start = () => {
      cleanup();
      if (preference.matches) return;
      const animations = new Set<Animation>();
      const targets = root.querySelectorAll<HTMLElement>(
        [
          ".maya-hero-copy > *",
          ".idea-sheet",
          ".chat-preview",
          ".insight-sticker",
          ".calendar-sticker",
          ".platform-strip > *",
          ".messages-copy",
          ".messages-phone-stage",
          ".section-intro > *",
          ".feature-card",
          ".day-copy > :not(.day-tabs)",
          ".day-tabs",
          ".day-panel",
          ".performance-intro > *",
          ".performance-studio",
          ".performance-benefits > *",
          ".maya-manifesto > *",
          ".pricing-copy > *",
          ".price-card",
          ".maya-faq > *",
          ".maya-footer > *",
          ".chapter-divider",
        ].join(","),
      );
      const enter = (element: HTMLElement) => {
        const divider = element.classList.contains("chapter-divider");
        const card = element.matches(
          ".feature-card, .day-panel, .performance-studio, .price-card, .chat-preview, .idea-sheet",
        );
        const index = Array.from(element.parentElement?.children ?? []).indexOf(
          element,
        );
        const animation = element.animate(
          divider
            ? [
                { scale: "0 1", opacity: 0.3 },
                { scale: "1 1", opacity: 1 },
              ]
            : [
                {
                  translate: `0 ${card ? 46 : 26}px`,
                  opacity: 0.15,
                  scale: card ? "0.975" : "1",
                },
                { translate: "0 0", opacity: 1, scale: "1" },
              ],
          {
            id: "maya-section-enter",
            duration: divider ? 1300 : card ? 1050 : 850,
            delay: divider ? 0 : Math.min(Math.max(index, 0) * 65, 195),
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            fill: "backwards",
          },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            enter(entry.target as HTMLElement);
          }
        },
        { threshold: 0, rootMargin: "0px 0px 3% 0px" },
      );
      targets.forEach((element) => observer.observe(element));

      // A single passive listener, scheduled only on scroll. Keep text stationary;
      // the hero artwork drifts gently and keeps its existing responsive transforms.
      const studio = root.querySelector<HTMLElement>(".maya-studio");
      const progress = root.querySelector<HTMLElement>(".reading-progress");
      let frame = 0;
      const update = () => {
        frame = 0;
        const maximum =
          document.documentElement.scrollHeight - window.innerHeight;
        if (progress)
          progress.style.scale = `${maximum > 0 ? Math.min(1, Math.max(0, window.scrollY / maximum)) : 0} 1`;
        if (studio)
          studio.style.setProperty(
            "--studio-drift",
            `${Math.min(window.scrollY, 850) * (window.innerWidth > 800 ? 0.065 : 0.025)}px`,
          );
      };
      const schedule = () => {
        if (!frame) frame = window.requestAnimationFrame(update);
      };
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
      update();
      cleanup = () => {
        observer.disconnect();
        animations.forEach((animation) => animation.cancel());
        animations.clear();
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        window.cancelAnimationFrame(frame);
        studio?.style.removeProperty("--studio-drift");
        progress?.style.removeProperty("scale");
      };
    };
    start();
    preference.addEventListener("change", start);
    return () => {
      preference.removeEventListener("change", start);
      cleanup();
    };
  }, [rootRef]);
}
