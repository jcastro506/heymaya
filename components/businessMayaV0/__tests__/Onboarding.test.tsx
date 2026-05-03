import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: {
      primaryEmailAddress: { emailAddress: "business@example.com" },
    },
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => async () => ({}),
}));

import { BusinessMayaV0Onboarding } from "../Onboarding";

describe("BusinessMayaV0Onboarding", () => {
  it("renders the broader business beta onboarding surface", () => {
    const html = renderToStaticMarkup(createElement(BusinessMayaV0Onboarding));

    expect(html).toContain("Business Maya · Powered by OpenClaw");
    expect(html).toContain(
      "Give your business a marketing manager before you hire one."
    );
    expect(html).toContain("Business type");
    expect(html).toContain("What do you sell?");
    expect(html).toContain("Target customer");
    expect(html).toContain("Top marketing goal");
    expect(html).toContain("Channels Maya should know about");
    expect(html).toContain("Watch the work, plan the marketing");
    expect(html).toContain("Save business setup");
  });
});
