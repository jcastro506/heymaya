import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Records which api ref each useAction(...) was created from, so we can prove
// the tier-selection step is wired to the real checkout action.
const requestedActions: unknown[] = [];

vi.mock("convex/react", () => ({
  useAction: (ref: unknown) => {
    requestedActions.push(ref);
    return async () => ({ url: "https://checkout.stripe.test/session" });
  },
  useMutation: () => async () => ({}),
  useQuery: () => null,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => createElement("a", { href, className }, children),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    gtmMaya: {
      appInspector: { inspectMyGtmApp: "inspectMyGtmApp" },
      researchLifecycle: {
        createResearchJob: "createResearchJob",
        getMyGtmSnapshot: "getMyGtmSnapshot",
        setAppProfile: "setAppProfile",
        startGtmOnboarding: "startGtmOnboarding",
      },
      researchWorker: {
        runBudgetedResearchSkeleton: "runBudgetedResearchSkeleton",
        runMyResearch: "runMyResearch",
      },
      walkthrough: {
        analyzeMyWalkthroughUpload: "analyzeMyWalkthroughUpload",
        generateWalkthroughUploadUrl: "generateWalkthroughUploadUrl",
        registerWalkthroughUpload: "registerWalkthroughUpload",
      },
      telegramPairing: {
        createPairingToken: "createPairingToken",
        getMyPairingStatus: "getMyPairingStatus",
      },
    },
    billing: {
      gtmBilling: {
        createGtmCheckoutSession: "createGtmCheckoutSession",
      },
    },
    onboarding: {
      gtm: {
        deployMayaGtm: { runMyGtmDeploy: "runMyGtmDeploy" },
      },
    },
  },
}));

describe("GTM onboarding page", () => {
  it("captures production reality before research starts", async () => {
    const Page = (await import("../page")).default;
    const html = renderToString(createElement(Page));

    // The differentiator field — the founder's own "what it does + what's
    // different", captured up front so Maya never guesses it.
    expect(html).toContain("What does it do, and what makes it different?");
    expect(html).toContain("Walkthrough recording");
    expect(html).toContain("TikTok profile, if any");
    expect(html).toContain("Instagram profile, if any");
    // The capability checkboxes (record screen/voice/face, manual-post toggles)
    // were removed — Maya figures out format/cadence herself. They must NOT
    // render anymore.
    expect(html).not.toContain("I can record voiceover");
    expect(html).not.toContain("I will manually post on TikTok");
    // Channel research is no longer pre-run in onboarding (Maya owns it in BOOT),
    // so the "where Maya wants to play" channel-ranking screen is gone.
    expect(html).not.toContain("Where Maya wants to play");
  });

  it("wires the tier-selection step to the GTM checkout action", async () => {
    requestedActions.length = 0;
    const Page = (await import("../page")).default;
    // Render is enough to register every useAction() the page sets up,
    // including the createGtmCheckoutSession action behind the tier step.
    renderToString(createElement(Page));
    expect(requestedActions).toContain("createGtmCheckoutSession");
  });
});
