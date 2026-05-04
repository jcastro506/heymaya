import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Creator Maya v0 Debug Console (deprecated)",
  description:
    "Legacy creator-maya-v0 debug console — deprecated by the single-screen onboarding rewrite.",
};

/**
 * TODO(coach-manager-rewrite 2026-05-04): the legacy `CreatorMayaV0DebugConsole`
 * (formerly imported from `@/components/creatorMayaV0/MvpConsole`) was deleted
 * alongside the multi-step onboarding state machine. This debug page used to
 * render the internal mock-handoff / OpenClaw readiness console; until we
 * decide whether we still need a debug surface for the rewritten flow, render
 * a 404. The supporting Convex API in `convex/creatorMayaV0/backend.ts` is
 * preserved so we can stand a debug surface back up without re-wiring backend.
 */
export default function CreatorMayaV0DebugPage() {
  notFound();
}
