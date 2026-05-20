"use client";

import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Video,
  Wifi,
  Signal,
  BatteryFull,
  Plus,
  Mic,
} from "lucide-react";

/**
 * Realistic iPhone shell rendering an iMessage conversation in dark mode.
 *
 * Used as the per-FeatureSection visual on /creators. Built from scratch
 * (no asset images) so it scales cleanly and stays in the page's dark
 * palette without color-conflicting with a screenshot.
 *
 * Anatomy (top → bottom):
 *   - matte-black outer bezel, generous corner radius
 *   - status bar: 9:41 time, Dynamic Island pill, signal/wifi/battery
 *   - iMessage header: back chevron, centered avatar + name + iMessage tag,
 *     right-side video icon
 *   - hairline divider
 *   - messages area (children)
 *   - input bar: + button, "iMessage" pill, mic icon
 *   - home indicator
 *
 * The chrome is intentionally restrained — it reads as an iPhone at a
 * glance, then disappears so the messages do the work.
 */
export function IPhoneFrame({
  contactName = "Maya",
  children,
}: {
  contactName?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto" style={{ width: 300 }}>
      {/* Phone bezel */}
      <div
        className="relative bg-black"
        style={{
          borderRadius: 44,
          padding: 10,
          boxShadow:
            "0 30px 60px -25px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255,255,255,0.04) inset",
        }}
      >
        {/* Screen */}
        <div
          className="relative overflow-hidden bg-black"
          style={{ borderRadius: 36 }}
        >
          {/* Status bar + Dynamic Island */}
          <div className="relative flex h-11 items-center justify-between px-7 pt-2 text-white">
            <span
              className="text-[14px] font-semibold leading-none"
              style={{
                fontFamily:
                  '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
              }}
            >
              9:41
            </span>

            {/* Dynamic Island — black pill, centered. Slightly above the
                vertical center so it looks correctly "raised" like the
                hardware piece on an iPhone 15+. */}
            <div
              aria-hidden
              className="absolute left-1/2 top-1.5 -translate-x-1/2 bg-black"
              style={{ width: 96, height: 30, borderRadius: 18 }}
            />

            <div className="flex items-center gap-1.5">
              <Signal className="h-3 w-3" strokeWidth={2.5} />
              <Wifi className="h-3 w-3" strokeWidth={2.5} />
              <BatteryFull className="h-3.5 w-3.5" strokeWidth={2} />
            </div>
          </div>

          {/* iMessage header */}
          <div className="relative grid grid-cols-[36px_1fr_36px] items-center px-3 pb-2 pt-1">
            {/* Back chevron + unread badge */}
            <button
              aria-hidden
              className="flex items-center justify-start text-[#1c8cff]"
              style={{ pointerEvents: "none" }}
            >
              <ChevronLeft className="h-6 w-6" strokeWidth={2.4} />
            </button>

            {/* Contact: avatar above name */}
            <div className="flex flex-col items-center gap-0.5">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                style={{
                  background:
                    "linear-gradient(135deg, #d6ff3d 0%, #7ed957 100%)",
                  color: "#0c0c0d",
                  fontFamily:
                    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                }}
              >
                M
              </div>
              <div
                className="flex items-center gap-0.5 text-[11px] text-white"
                style={{
                  fontFamily:
                    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                }}
              >
                {contactName}
                <ChevronRight className="h-2.5 w-2.5 text-[#8e8e93]" strokeWidth={3} />
              </div>
            </div>

            {/* Video call icon */}
            <div className="flex items-center justify-end text-[#1c8cff]">
              <Video className="h-4 w-4" strokeWidth={2.4} />
            </div>
          </div>

          {/* Header / messages divider */}
          <div className="h-px w-full bg-white/[0.06]" />

          {/* Messages area */}
          <div className="px-3 py-3">{children}</div>

          {/* Input bar */}
          <div className="border-t border-white/[0.06] px-3 pb-3 pt-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-white/60">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              </div>
              <div
                className="flex h-7 flex-1 items-center rounded-full border border-white/10 px-3 text-[12px] text-white/35"
                style={{
                  fontFamily:
                    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                }}
              >
                iMessage
              </div>
              <div className="flex h-7 w-7 items-center justify-center rounded-full text-white/60">
                <Mic className="h-3.5 w-3.5" strokeWidth={2.4} />
              </div>
            </div>
          </div>

          {/* Home indicator */}
          <div className="flex justify-center pb-1.5">
            <div
              aria-hidden
              className="h-[5px] w-[110px] rounded-full bg-white/70"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
