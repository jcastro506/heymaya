import type { Metadata } from "next";
import ClawLaunchLandingPage from "./clawlaunch/page";

/**
 * Home (`/`). ClawLaunch is the public surface for the Vercel
 * `clawlaunch.io` project.
 *
 * Sprint 2.31 — the landing client component lives in
 * app/clawlaunch/page.tsx ("use client" for scroll behavior).
 * Metadata stays here on the server boundary so Next can render
 * <head> at build time.
 */
export const metadata: Metadata = {
  title: "HeyMaya, the marketing hire for builders Cursor unlocked.",
  description:
    "Maya runs your product's organic social, every day. She finds where your customers already are, writes and posts in your voice, and shows you which post got the signup — so the graph stops being a flat line.",
};

export default function Home() {
  return <ClawLaunchLandingPage />;
}
