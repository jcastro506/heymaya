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
  title: "HeyMaya — the GTM agent for builders Cursor unlocked.",
  description:
    "You shipped fast. Marketing is the wall. Maya finds where your users talk, drafts the replies, plans the week — so your signup graph stops being a flat line.",
};

export default function Home() {
  return <ClawLaunchLandingPage />;
}
