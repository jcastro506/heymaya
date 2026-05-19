"use client";

import type { ReactNode } from "react";
import { Heart, ThumbsUp, ThumbsDown, Laugh } from "lucide-react";

import { IPhoneFrame } from "./IPhoneFrame";

/**
 * Per-feature visual: a real-looking iPhone with an iMessage conversation
 * inside. Bubbles + streaks + tails + tapbacks + Delivered indicator all
 * intact from the prior flat-card version — only the wrapper changed.
 *
 * Each card carries:
 *  - a timestamp (rendered as iMessage's centered separator line)
 *  - 1-3 message bubbles ("from-maya" or "from-you")
 *
 * Authenticity layers (so a glance briefly registers as "real screenshot"):
 *  - SVG bubble tails on the LAST bubble of a same-side streak only
 *  - Grouped consecutive bubbles get uniform rounding; only the streak's
 *    final bubble shows the tail curl
 *  - "Delivered" indicator under the last right-side bubble
 *  - Optional tapback reaction (heart, thumbs, etc.) floating on a
 *    bubble's outer top corner — exactly where iOS draws them
 *  - iOS system font stack + ss01/ss03 features on bubbles
 */

export type Reaction =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question";

export type Bubble = {
  side: "left" | "right";
  body: ReactNode;
  /** Optional iMessage tapback reaction floating above the bubble. */
  reaction?: Reaction;
};

/* iOS system font stack + ligature features iMessage actually ships with.
   Applied inline on each bubble so this stays self-contained. */
const IOS_BUBBLE_STYLE: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
  fontFeatureSettings: '"ss01" on, "ss03" on',
};

function BubbleTail({
  side,
  fill,
}: {
  side: "left" | "right";
  fill: string;
}) {
  const path =
    "M8 0 C8 6 6.5 9.5 3 12 C2 12.5 0.5 13 0 13 C2.5 12 5 9 5 5.5 L5 0 Z";
  return (
    <svg
      aria-hidden
      width="8"
      height="13"
      viewBox="0 0 8 13"
      className={`pointer-events-none absolute bottom-0 ${
        side === "left" ? "-left-[5px]" : "-right-[5px] -scale-x-100"
      }`}
    >
      <path d={path} fill={fill} />
    </svg>
  );
}

function TapbackBadge({
  reaction,
  side,
}: {
  reaction: Reaction;
  side: "left" | "right";
}) {
  const Icon =
    reaction === "love"
      ? Heart
      : reaction === "like"
        ? ThumbsUp
        : reaction === "dislike"
          ? ThumbsDown
          : reaction === "laugh"
            ? Laugh
            : null;

  const glyph =
    reaction === "emphasize" ? "!!" : reaction === "question" ? "?" : null;

  const positional =
    side === "left" ? "-top-3 -right-2" : "-top-3 -left-2";

  const iconColor =
    reaction === "love" ? "text-rose" : "text-paper-dim";

  return (
    <span
      aria-hidden
      className={`absolute ${positional} flex h-[22px] w-[22px] items-center justify-center rounded-full border border-white/15 bg-[#2c2c2e] shadow-[0_1px_3px_rgba(0,0,0,0.4)]`}
    >
      {Icon ? (
        <Icon
          className={`h-[11px] w-[11px] ${iconColor}`}
          fill={reaction === "love" ? "currentColor" : "none"}
          strokeWidth={2.2}
        />
      ) : (
        <span
          className={`text-[10px] font-semibold leading-none ${iconColor}`}
          style={IOS_BUBBLE_STYLE}
        >
          {glyph}
        </span>
      )}
    </span>
  );
}

export function IMessageCard({
  timestamp,
  bubbles,
}: {
  timestamp: string;
  bubbles: Bubble[];
}) {
  const lastRightIndex = bubbles.reduce(
    (acc, b, i) => (b.side === "right" ? i : acc),
    -1,
  );

  return (
    <div className="flex flex-col items-center">
      <IPhoneFrame contactName="Maya">
        {/* iMessage timestamp separator — centered, very small, grayed */}
        <div
          className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-white/35"
          style={IOS_BUBBLE_STYLE}
        >
          {timestamp}
        </div>

        <div className="flex flex-col gap-[3px]">
          {bubbles.map((b, i) => {
            const isLeft = b.side === "left";
            const next = bubbles[i + 1];
            const isLastInStreak = !next || next.side !== b.side;
            const fill = isLeft ? "#2c2c2e" : "#1c8cff";

            const extraTopGap =
              i > 0 && bubbles[i - 1].side !== b.side ? "mt-[5px]" : "";

            return (
              <div key={i} className={extraTopGap}>
                <div
                  className={`flex ${isLeft ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`relative max-w-[82%] rounded-[18px] px-3 py-1.5 text-[13px] leading-snug ${
                      isLeft
                        ? "bg-[#2c2c2e] text-white"
                        : "bg-[#1c8cff] text-white"
                    } ${b.reaction ? "mt-3" : ""}`}
                    style={IOS_BUBBLE_STYLE}
                  >
                    {b.body}
                    {isLastInStreak ? (
                      <BubbleTail side={b.side} fill={fill} />
                    ) : null}
                    {b.reaction ? (
                      <TapbackBadge reaction={b.reaction} side={b.side} />
                    ) : null}
                  </div>
                </div>
                {i === lastRightIndex ? (
                  <div
                    className="mt-[2px] pr-[2px] text-right text-[9px] font-medium tracking-wide text-white/40"
                    style={IOS_BUBBLE_STYLE}
                  >
                    Delivered
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </IPhoneFrame>
    </div>
  );
}
