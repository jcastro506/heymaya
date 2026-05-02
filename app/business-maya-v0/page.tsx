import type { Metadata } from "next";
import { BusinessMayaV0Onboarding } from "@/components/businessMayaV0/Onboarding";

export const metadata: Metadata = {
  title: "Business Maya v0 · Powered by OpenClaw",
  description:
    "Set up Maya as the marketing manager for a founder-led or local business.",
};

export default function BusinessMayaV0Page() {
  return <BusinessMayaV0Onboarding />;
}
