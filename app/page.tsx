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
  title: "HeyMaya — Maya runs your organic social.",
  description:
    "Your app is good. Nobody knows it exists. Maya runs your organic social — finds your buyers, posts in your voice, and shows you which post got the signup.",
};

export default function Home() {
  return <ClawLaunchLandingPage />;
}
