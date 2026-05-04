import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Creator Maya v0 (deprecated)",
  description:
    "Legacy creator-maya-v0 demo console — deprecated by the single-screen onboarding rewrite.",
};

/**
 * TODO(coach-manager-rewrite 2026-05-04): the legacy `CreatorMayaV0Onboarding`
 * console (formerly imported from `@/components/creatorMayaV0/MvpConsole`)
 * was deleted as part of the single-screen onboarding rewrite. This route
 * previously rendered a 6-step demo console. The route is suppressed behind
 * `NEXT_PUBLIC_ENABLE_CREATOR_PRODUCT` middleware; we render a 404 here as a
 * defense-in-depth so a flag flip doesn't accidentally re-expose a broken
 * surface. If we want a working creator-maya-v0 demo again, replace this
 * with whatever the new product surface looks like.
 */
export default function CreatorMayaV0Page() {
  notFound();
}
