"use client";

import type { ReactNode } from "react";

/**
 * Compact iMessage-style card used as the per-feature visual.
 *
 * Differs from the full Phone mockup (Sprint-1 hero piece) in that it shows
 * only a few message bubbles in a borderless card — closer to a quoted
 * conversation than a phone screenshot. Cheaper to render, scans faster,
 * works at small sizes.
 *
 * Each card carries:
 *  - a timestamp tag (e.g., "Sun · 4:14 PM")
 *  - 1-3 message bubbles ("from-maya" or "from-you")
 *  - an optional caption beneath ("cited · @yourhandle/posts/...")
 */
export type Bubble = {
  side: "left" | "right";
  body: ReactNode;
};

export function IMessageCard({
  timestamp,
  bubbles,
  caption,
}: {
  timestamp: string;
  bubbles: Bubble[];
  caption?: string;
}) {
  return (
    <div className="relative">
      {/* shadow-tile behind, rotated, for editorial feel */}
      <div
        aria-hidden
        className="absolute -bottom-3 -right-3 -z-10 h-full w-full rounded-2xl border border-[var(--hairline)] bg-ink-3"
        style={{ transform: "rotate(1.5deg)" }}
      />
      <div className="relative overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-ink-2 p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] sm:p-6">
        <div className="text-center text-[10px] font-medium uppercase tracking-wider text-paper-faint">
          {timestamp}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {bubbles.map((b, i) => {
            const isLeft = b.side === "left";
            return (
              <div
                key={i}
                className={`flex ${isLeft ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[88%] rounded-[20px] px-3.5 py-2 text-[14px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.2)] ${
                    isLeft
                      ? "rounded-bl-[6px] bg-[var(--imessage-gray)] text-white"
                      : "rounded-br-[6px] bg-[var(--imessage-blue)] text-white"
                  }`}
                >
                  {b.body}
                </div>
              </div>
            );
          })}
        </div>
        {caption ? (
          <div className="mt-5 flex items-center justify-between border-t border-[var(--hairline)] pt-4 font-mono text-[10px] uppercase tracking-widest text-paper-faint">
            <span>{caption}</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              grounded
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
