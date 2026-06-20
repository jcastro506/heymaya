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
      telegramBotPerTenant: {
        validateAndSetPersonalTelegramBot:
          "validateAndSetPersonalTelegramBot",
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
    expect(html).toContain("I can record voiceover");
    expect(html).toContain("Walkthrough recording");
    expect(html).toContain("I can provide screenshots or slides");
    expect(html).toContain("I will manually post on TikTok");
    expect(html).toContain("connect Instagram so Maya posts for me");
    expect(html).toContain("TikTok profile, if any");
    // The TikTok-only account-status/age/check toggles were replaced by the
    // generalized per-channel warmth UI (shown only for channels the founder
    // actually connected), so they're no longer in the empty-form render.
    expect(html).toContain("Instagram profile, if any");
    // The creator-budget / UGC / visual-posts-per-week fields were removed from
    // intake (Phase 0) — Maya sets cadence + handles UGC herself, post-research.
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
