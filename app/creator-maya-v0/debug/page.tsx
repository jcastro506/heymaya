import type { Metadata } from "next";
import { Suspense } from "react";
import { CreatorMayaV0DebugConsole } from "@/components/creatorMayaV0/MvpConsole";

export const metadata: Metadata = {
  title: "Creator Maya v0 Debug Console",
  description:
    "Internal Creator Maya controls for smoke testing, mock handoff, OpenClaw readiness, and brand gate validation.",
};

export default function CreatorMayaV0DebugPage() {
  return (
    <Suspense fallback={null}>
      <CreatorMayaV0DebugConsole />
    </Suspense>
  );
}
