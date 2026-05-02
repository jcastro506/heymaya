import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: {
      primaryEmailAddress: { emailAddress: "creator@example.com" },
    },
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => async () => ({}),
  useMutation: () => async () => ({}),
  useQuery: () => ({
    onboarding: { currentStep: "active", imessagePaired: false },
    calendar: { status: "active" },
    creator: { channelPreference: "imessage", phoneNumber: "+15555550123" },
    latestDeployment: { status: "deployed" },
    picture: {
      niche: "solo founder TikTok education",
      goal: "grow authority",
      stage: "growing_consistently",
    },
    tiktok: { handle: "founder_maya" },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { CreatorMayaV0DebugConsole, CreatorMayaV0Onboarding } from "../MvpConsole";

describe("CreatorMayaV0Onboarding", () => {
  it("renders the creator-first onboarding surface", () => {
    const html = renderToStaticMarkup(createElement(CreatorMayaV0Onboarding));

    expect(html).toContain("Back");
    expect(html).toContain("Step 6 of 6");
    expect(html).toContain("You&#x27;re all set. Maya will text you directly.");
    expect(html).toContain("Maya pulled your TikTok context");
    expect(html).toContain("OpenClaw");
  });

  it("keeps the internal debug console available", () => {
    const html = renderToStaticMarkup(createElement(CreatorMayaV0DebugConsole));

    expect(html).toContain("Creator Maya v0 · Powered by OpenClaw");
    expect(html).toContain("Onboard once. Maya manages TikTok from iMessage.");
    expect(html).toContain("Preview Beta Handoff");
    expect(html).toContain("Test Studio Brand Gate");
    expect(html).toContain("Connect TikTok");
    expect(html).toContain("Apple on iPhone");
    expect(html).toContain("Request iMessage pairing");
    expect(html).toContain("Pair iMessage");
    expect(html).toContain("Live on phone");
    expect(html).toContain("solo founder TikTok education");
    expect(html).toContain("@founder_maya");
  });
});
