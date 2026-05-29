import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useAction: () => async () => ({}),
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

    expect(html).toContain("I can record voiceover");
    expect(html).toContain("Mobile walkthrough recording");
    expect(html).toContain("I can provide screenshots or slides");
    expect(html).toContain("I will manually post on TikTok");
    expect(html).toContain("I will manually post on Instagram");
    expect(html).toContain("TikTok profile, if any");
    expect(html).toContain("TikTok account status");
    expect(html).toContain("TikTok account age in days");
    expect(html).toContain("I checked TikTok Account Check");
    expect(html).toContain("Instagram profile, if any");
    expect(html).toContain("I am open to UGC creators later");
    expect(html).toContain("Creator budget per month");
    expect(html).toContain("Visual posts per week");
  });
});
