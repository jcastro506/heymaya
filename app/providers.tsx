"use client";

import { ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const clerkAppearance = {
  variables: {
    colorPrimary: "#ffffff",
    colorBackground: "#fbf7ee",
    colorText: "#0c0c0d",
    colorTextSecondary: "#514c43",
    colorInputBackground: "#ffffff",
    colorInputText: "#0c0c0d",
    colorNeutral: "#514c43",
    borderRadius: "0.75rem",
  },
  elements: {
    cardBox:
      "shadow-2xl shadow-black/30 ring-1 ring-black/10 border border-black/10",
    card: "bg-[#fbf7ee] text-[#0c0c0d]",
    headerTitle: "text-[#0c0c0d]",
    headerSubtitle: "text-[#514c43]",
    socialButtonsBlockButton:
      "border border-[#d8d0c3] bg-white text-[#0c0c0d] shadow-sm hover:bg-[#f4f1ea]",
    socialButtonsBlockButtonText: "text-[#0c0c0d] font-medium",
    dividerLine: "bg-[#d8d0c3]",
    dividerText: "text-[#6e675c]",
    formFieldLabel: "text-[#2a2722] font-medium",
    formFieldInput:
      "border-[#cfc7b8] bg-white text-[#0c0c0d] placeholder:text-[#7a7267] focus:border-[#0c0c0d] focus:ring-[#0c0c0d]",
    formButtonPrimary: "heymaya-clerk-primary font-semibold",
    footerActionText: "text-[#514c43]",
    footerActionLink:
      "heymaya-clerk-link text-[#0c0c0d] font-semibold hover:text-[#514c43]",
    identityPreviewText: "text-[#0c0c0d]",
    formFieldAction: "text-[#0c0c0d]",
  },
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <PostHogProvider>{children}</PostHogProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
