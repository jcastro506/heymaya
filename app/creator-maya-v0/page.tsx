import type { Metadata } from "next";
import { Suspense } from "react";
import { CreatorMayaV0Onboarding } from "@/components/creatorMayaV0/MvpConsole";

export const metadata: Metadata = {
  title: "Creator Maya v0 · Powered by OpenClaw",
  description:
    "TikTok-first Creator Maya onboarding for account setup, calendar-aware planning, native iMessage handoff, and OpenClaw-powered daily management.",
};

export default function CreatorMayaV0Page() {
  return (
    <Suspense fallback={null}>
      <CreatorMayaV0Onboarding />
    </Suspense>
  );
}
