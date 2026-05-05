"use client";

import type { ReactNode } from "react";
import { Heart, ThumbsUp, ThumbsDown, Laugh } from "lucide-react";

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
 *  - an optional plain-language caption beneath
 *
 * Authenticity layers (so a glance briefly registers as "real screenshot"):
 *  - SVG bubble tails on the LAST bubble of a same-side streak only
 *  - Grouped consecutive bubbles get uniform rounding; only the streak's
 *    final bubble shows the tail curl
 *  - "Delivered" indicator under the last right-side bubble (iMessage habit)
 *  - Optional tapback reaction (heart, thumbs, etc.) floating on a bubble's
 *    outer top corner — exactly where iOS draws them
 *  - iOS system font stack + ss01/ss03 features on the bubbles only
 *  - Slightly softer dual-layer shadow than the prior 1-px hairline
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

/* iOS system font stack + the ligature features iMessage actually ships with.
   Applied as inline style on each bubble — keeps Tailwind config untouched
   and is the lightest-touch way to swap the typeface for just the bubbles. */
const IOS_BUBBLE_STYLE: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
  fontFeatureSettings: '"ss01" on, "ss03" on',
};

/* iMessage tail SVG.
   The tail is a small "curl" attached to the bubble's bottom corner.
   - viewBox 8×13. Path traces the inner curl + the cleanup arc that fills
     the alcove between the rounded bubble corner and the tail tip.
   - On the LEFT (gray) bubble, anchored bottom-left, drawn pointing left.
   - On the RIGHT (blue) bubble, mirrored via scaleX(-1), anchored bottom-right.
   The path is intentionally subtle — iMessage's tail is small relative to
   the bubble, not a cartoon speech-bubble triangle. */
function BubbleTail({
  side,
  fill,
}: {
  side: "left" | "right";
  fill: string;
}) {
  // Path: starts inside the bubble corner, curves out to the tip, then arcs
  // back to fill the small notch beneath the bubble's rounded corner.
  // Drawn for the LEFT side; mirrored for right via transform.
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

/* Tapback reaction bubble. Small floating circle on the bubble's OUTER top
   corner (left bubble → right corner; right bubble → left corner), exactly
   how iOS positions tapbacks. Restrained palette: ink-2 fill with a thin
   hairline border. Glyph color is paper-dim except 'love' which keeps a
   muted rose tint — iMessage's only chromatic tapback. */
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

  // 'emphasize' (!!) and 'question' (?) are glyphs, not lucide icons.
  const glyph =
    reaction === "emphasize" ? "!!" : reaction === "question" ? "?" : null;

  const positional =
    side === "left"
      ? "-top-3 -right-2"
      : "-top-3 -left-2";

  // Heart gets a soft tint; everything else stays paper-dim to avoid
  // making the cards feel loud.
  const iconColor =
    reaction === "love" ? "text-rose" : "text-paper-dim";

  return (
    <span
      aria-hidden
      className={`absolute ${positional} flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[var(--hairline-strong)] bg-[var(--imessage-gray)] shadow-[0_1px_3px_rgba(0,0,0,0.4)]`}
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
  caption,
}: {
  timestamp: string;
  bubbles: Bubble[];
  caption?: string;
}) {
  // Index of the LAST right-side bubble, for the Delivered indicator.
  // -1 if there are no right-side bubbles in this card.
  const lastRightIndex = bubbles.reduce(
    (acc, b, i) => (b.side === "right" ? i : acc),
    -1,
  );

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
        <div className="mt-4 flex flex-col gap-[3px]">
          {bubbles.map((b, i) => {
            const isLeft = b.side === "left";
            // A bubble is "last in streak" if it's the final bubble OR the
            // next bubble is on the opposite side. Only last-in-streak gets
            // the tail; earlier streak bubbles get full uniform rounding.
            const next = bubbles[i + 1];
            const isLastInStreak = !next || next.side !== b.side;
            const fill = isLeft
              ? "var(--imessage-gray)"
              : "var(--imessage-blue)";

            // Slightly tighter vertical gap between same-side bubbles in a
            // streak (iMessage stacks them tight); a touch wider when the
            // side flips.
            const extraTopGap =
              i > 0 && bubbles[i - 1].side !== b.side ? "mt-[5px]" : "";

            return (
              <div key={i} className={extraTopGap}>
                <div
                  className={`flex ${isLeft ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`relative max-w-[88%] rounded-[20px] px-3.5 py-2 text-[14px] leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.28)] ${
                      isLeft
                        ? "bg-[var(--imessage-gray)] text-white"
                        : "bg-[var(--imessage-blue)] text-white"
                    } ${
                      // When the bubble carries a tapback, give it a hair
                      // more top margin so the badge clears the bubble above.
                      b.reaction ? "mt-3" : ""
                    }`}
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
                  <div className="mt-[3px] pr-[2px] text-right text-[9px] font-medium tracking-wide text-paper-faint">
                    Delivered
                  </div>
                ) : null}
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
