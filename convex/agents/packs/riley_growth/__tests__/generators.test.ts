import { describe, expect, it } from "vitest";
import { buildRileyWorkspace } from "../generators";

describe("Builder Maya workspace generator", () => {
  it("boots the Builder vertical as Maya for Builders, not Riley", () => {
    const workspace = buildRileyWorkspace({
      creator: {
        _id: "creator_test" as never,
        email: "founder@example.com",
      },
      agent: {
        _id: "growth_agent_test" as never,
        _creationTime: 0,
        accountId: "creator_test" as never,
        onboardingStep: "deploy",
        productContext: {
          productName: "ShipFast",
          oneLiner: "Launch tiny SaaS products faster.",
          targetAudience: "builders who need distribution",
          focus: "X and LinkedIn launch loops",
        },
        voiceSamples: {
          linkedin: ["Here is a concrete launch lesson."],
          twitter: ["Shipping is easy. Distribution is the tax."],
        },
        linkedinConnection: {
          composioAccountId: "encrypted-linkedin",
          composioAccountIdHash: "hash-linkedin",
          connectedAt: 1,
        },
        twitterConnection: {
          composioAccountId: "encrypted-twitter",
          composioAccountIdHash: "hash-twitter",
          connectedAt: 1,
        },
        createdAt: 0,
        updatedAt: 0,
      },
    });

    const files = [...workspace.files.values()].join("\n\n");
    expect(files).toContain("Maya for Builders");
    expect(files).toContain("X and LinkedIn launch loops");
    expect(files).not.toContain("I am Riley");
    expect(files).not.toContain("Riley here");
    expect(files).not.toContain("Josh's browser");
  });
});
