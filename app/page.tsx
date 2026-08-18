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
/**
 * ⚠️ THIS overrides the layout's metadata, and it was the stale one — still
 * describing her as running "organic social" and quoting the old headline while
 * the page had moved to UGC. The tab title and the link preview are the first
 * words most people read, and they were selling the previous product.
 *
 * ⚠️ Names UGC without claiming she creates it: `tests/marketingCopy.test.ts`
 * bans a creation verb within 40 characters of the word, because she has never
 * rendered a video. No "AI" either, per the same guard.
 */
export const metadata: Metadata = {
  title: "HeyMaya, the UGC your app needs.",
  description:
    "Maya watches what's working in your niche, creates your TikToks, Reels and Shorts, and posts them for you. You never film a thing.",
};

export default function Home() {
  return <ClawLaunchLandingPage />;
}
