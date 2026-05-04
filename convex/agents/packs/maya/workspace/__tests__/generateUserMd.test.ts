/**
 * generateUserMd — pure-logic unit tests.
 *
 * Coverage:
 *   - Determinism (same inputs twice → identical output).
 *   - Phase-B forward compatibility: when the 5 new optional fields are
 *     absent on `creatorPicture`, generator emits "not yet provided"
 *     placeholders instead of throwing.
 *   - Phase-B forward compatibility: when the 5 new optional fields ARE
 *     present (mocked as if phase B has shipped), generator emits the
 *     real values.
 *   - Handles missing picture gracefully (returns "not yet provided" for
 *     niche/audience/etc.).
 *   - Display name derivation from email (titlecase, splits on . _ -).
 */

import { describe, it, expect } from "vitest";
import { generateUserMd, deriveDisplayName } from "../generateUserMd";
import type { Doc } from "../../../../../_generated/dataModel";
import type { CreatorPictureExt } from "../types";

function makeCreator(over: Partial<Doc<"creators">> = {}): Doc<"creators"> {
  return {
    _id: "k_creator_test" as unknown as Doc<"creators">["_id"],
    _creationTime: 1_700_000_000_000,
    clerkUserId: "user_test",
    email: "joshua.castro@example.com",
    channelPreference: "imessage",
    timezone: "America/Los_Angeles",
    status: "active",
    plan: "manager",
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function makeHandles(): ReadonlyArray<Doc<"creatorHandles">> {
  return [
    {
      _id: "k_h1" as unknown as Doc<"creatorHandles">["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: "k_creator_test" as unknown as Doc<"creators">["_id"],
      platform: "tiktok",
      handle: "@joshuacastro",
      verified: true,
      followerCount: 47_321,
    },
    {
      _id: "k_h2" as unknown as Doc<"creatorHandles">["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: "k_creator_test" as unknown as Doc<"creators">["_id"],
      platform: "instagram",
      handle: "@joshuacastro",
      verified: false,
      followerCount: 8_900,
    },
  ];
}

describe("generateUserMd", () => {
  it("is deterministic for identical inputs", () => {
    const inputs = {
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager" as const,
    };
    const a = generateUserMd(inputs);
    const b = generateUserMd(inputs);
    expect(a).toBe(b);
  });

  it("emits 'not yet provided' for the 5 new fields when picture lacks them", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).toContain("**Career stage:** not yet provided");
    expect(md).toContain("**Geographic location:** not yet provided");
    expect(md).toContain("**Monthly revenue (rough):** not yet provided");
    expect(md).toContain("**Active revenue streams:** not yet provided");
  });

  it("emits real values for the 5 new fields when picture has them (post-phase-B schema)", () => {
    const futurePicture: CreatorPictureExt = {
      _id: "k_pic" as unknown as Doc<"creatorPicture">["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: "k_creator_test" as unknown as Doc<"creators">["_id"],
      niche: "fitness",
      audience: {
        ageRanges: ["18-24", "25-34"],
        topGeos: ["US", "CA"],
        interestTags: ["gym", "nutrition", "calisthenics"],
      },
      voiceFingerprint: "Direct, no fluff. Em-dashes. 'Let's go.'",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: 1_700_000_000_000,
      model: "gemini-3-flash",
      sourceCitations: [],
      // Phase B fields (extension shape)
      careerStage: "monetizing",
      locationSoul: { city: "Austin", state: "TX", country: "US" },
      monthlyRevenueUsd: 8_500,
      currentRevenueStreams: ["brand-deals", "ad-rev", "affiliate"],
      longTermGoals: {
        oneYear: "Hit 250K followers by end of year.",
        fiveYear: "Launch a digital training program.",
      },
    };
    const md = generateUserMd({
      creator: makeCreator(),
      picture: futurePicture,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).toContain("**Career stage:** monetizing");
    expect(md).toContain("**Geographic location:** Austin, TX, US");
    expect(md).toContain("**Monthly revenue (rough):** $8,500 / month");
    expect(md).toContain("`brand-deals`");
    expect(md).toContain("Hit 250K followers by end of year.");
  });

  it("formats follower counts in K/M shorthand", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    // 47321 -> 47.3K, 8900 -> 8.9K
    expect(md).toMatch(/47\.3K followers/);
    expect(md).toMatch(/8\.9K followers/);
  });

  it("notes unverified handles", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).toContain("(unverified)");
  });

  it("describes per-plan cadence", () => {
    const coach = generateUserMd({
      creator: makeCreator({ plan: "coach" }),
      picture: null,
      handles: makeHandles(),
      plan: "coach",
    });
    const manager = generateUserMd({
      creator: makeCreator({ plan: "manager" }),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    // Coach mentions "advisory only" / no auto-send.
    expect(coach).toMatch(/advisory only|never auto-sends/i);
    // Manager mentions Apollo/Hunter discovery.
    expect(manager).toContain("Apollo/Hunter");
  });
});

describe("deriveDisplayName", () => {
  it("titlecases simple email locals", () => {
    expect(deriveDisplayName("joshua@example.com")).toBe("Joshua");
  });

  it("splits on dots", () => {
    expect(deriveDisplayName("joshua.castro@example.com")).toBe("Joshua Castro");
  });

  it("splits on underscores and hyphens", () => {
    expect(deriveDisplayName("j_castro@x.com")).toBe("J Castro");
    expect(deriveDisplayName("j-castro@x.com")).toBe("J Castro");
  });

  it("handles all-uppercase local parts", () => {
    expect(deriveDisplayName("JOSHUA@example.com")).toBe("Joshua");
  });
});
