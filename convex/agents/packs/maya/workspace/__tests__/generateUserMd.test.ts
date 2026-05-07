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

describe("generateUserMd — Sprint 4 follower trend + audience", () => {
  const NOW = 1_700_000_000_000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function makeSnapshot(over: {
    platform: "tiktok" | "instagram";
    handle: string;
    followerCount: number;
    capturedAt: number;
  }) {
    return {
      _id: `k_snap_${over.platform}_${over.capturedAt}` as unknown as never,
      _creationTime: over.capturedAt,
      creatorId: "k_creator_test" as unknown as never,
      ...over,
    } as unknown as import("../../../../../_generated/dataModel").Doc<"creatorFollowerSnapshots">;
  }

  it("emits 'no prior snapshot' when no qualifying snapshots exist", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
      followerSnapshots: [],
      now: NOW,
    });
    // Both handles get 'no prior snapshot' on first run.
    const lines = md.split("\n").filter((l) => l.startsWith("- **tiktok**") || l.startsWith("- **instagram**"));
    for (const l of lines) expect(l).toContain("no prior snapshot");
  });

  it("computes 30-day delta when an old-enough snapshot exists", () => {
    const snaps = [
      // 30-day-old snapshot at 40K — current 47.3K → +7.3K delta.
      makeSnapshot({
        platform: "tiktok",
        handle: "@joshuacastro",
        followerCount: 40_000,
        capturedAt: NOW - 30 * DAY_MS,
      }),
    ];
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
      followerSnapshots: snaps,
      now: NOW,
    });
    expect(md).toMatch(/\+7\.3K in 30d/);
  });

  it("renders negative delta with a minus sign when followers decreased", () => {
    const snaps = [
      makeSnapshot({
        platform: "tiktok",
        handle: "@joshuacastro",
        followerCount: 50_000, // higher than current 47.3K
        capturedAt: NOW - 30 * DAY_MS,
      }),
    ];
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
      followerSnapshots: snaps,
      now: NOW,
    });
    // Delta = -2679 → −2.7K (using minus-sign per renderer).
    expect(md).toMatch(/−2\.7K in 30d/);
  });

  it("snapshots within the 7-day floor are ignored (too fresh)", () => {
    const snaps = [
      makeSnapshot({
        platform: "tiktok",
        handle: "@joshuacastro",
        followerCount: 47_000,
        capturedAt: NOW - 2 * DAY_MS,
      }),
    ];
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
      followerSnapshots: snaps,
      now: NOW,
    });
    // Filtered out → "no prior snapshot".
    const ttLine = md.split("\n").find((l) => l.startsWith("- **tiktok**"))!;
    expect(ttLine).toContain("no prior snapshot");
  });

  it("renders real audience age ranges + top geos when picture has them (no 'not yet provided')", () => {
    const realPicture = {
      _id: "k_pic" as unknown as never,
      _creationTime: NOW,
      creatorId: "k_creator_test" as unknown as never,
      niche: "fitness",
      audience: {
        ageRanges: ["18-24", "25-34"],
        topGeos: ["US", "CA", "GB"],
        interestTags: ["gym", "macros"],
        genderSplit: { male: 0.58, female: 0.41, other: 0.01 },
      },
      voiceFingerprint: "Direct.",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: NOW,
      model: "gemini-3-flash",
      sourceCitations: [],
    } as unknown as import("../types").CreatorPictureExt;

    const md = generateUserMd({
      creator: makeCreator(),
      picture: realPicture,
      handles: makeHandles(),
      plan: "manager",
      now: NOW,
    });
    expect(md).toContain("**Age ranges:** 18-24, 25-34");
    expect(md).toContain("**Top geographies:** US, CA, GB");
    expect(md).toContain("**Gender split:** male 58% / female 41%");
    // The "not yet provided" placeholder for the audience fields must NOT appear in the audience block.
    const audienceSlice = md.slice(
      md.indexOf("## Niche & audience"),
      md.indexOf("## Career snapshot")
    );
    expect(audienceSlice).not.toContain("not yet provided");
  });

  it("preserves 'not yet provided' fallback when picture is null (legitimate empty case)", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
      now: NOW,
    });
    // Audience block keeps the fallback.
    const audienceSlice = md.slice(
      md.indexOf("## Niche & audience"),
      md.indexOf("## Career snapshot")
    );
    expect(audienceSlice).toContain("not yet provided");
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

  /* ---- 2026-05-06 real-world test regression: prefer creator.displayName ---- */

  it("prefers creator.displayName over the email-derived fallback", () => {
    const name = deriveDisplayName(
      makeCreator({
        displayName: "Kevin Castro",
        email: "kevin@heymaya.local",
      })
    );
    expect(name).toBe("Kevin Castro");
  });

  it("falls back to email derivation when displayName is missing", () => {
    const name = deriveDisplayName(
      makeCreator({ email: "kevin.castro@heymaya.local" })
    );
    expect(name).toBe("Kevin Castro");
  });

  it("falls back to email when displayName is the empty string", () => {
    const name = deriveDisplayName(
      makeCreator({ displayName: "", email: "kevin@heymaya.local" })
    );
    expect(name).toBe("Kevin");
  });

  it("falls back to email when displayName is whitespace-only", () => {
    const name = deriveDisplayName(
      makeCreator({ displayName: "   ", email: "kevin@heymaya.local" })
    );
    expect(name).toBe("Kevin");
  });

  it("trims surrounding whitespace from displayName when present", () => {
    const name = deriveDisplayName(
      makeCreator({ displayName: "  Kevin Castro  ", email: "x@y.z" })
    );
    expect(name).toBe("Kevin Castro");
  });
});

describe("generateUserMd — displayName regression (real-world test 2026-05-06)", () => {
  it("USER.md heading uses creator.displayName, not email-derived name", () => {
    // The exact bug: creator.displayName='Kevin Castro' but USER.md
    // shipped as `# USER.md — Real World Test` (derived from
    // `real-world-test@heymaya.local`).
    const md = generateUserMd({
      creator: makeCreator({
        displayName: "Kevin Castro",
        email: "real-world-test@heymaya.local",
      }),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).toContain("# USER.md — Kevin Castro");
    expect(md).toContain("**Display name:** Kevin Castro");
    expect(md).toContain("**Preferred address:** Kevin Castro (first name).");
    expect(md).not.toContain("Real World Test");
  });

  it("USER.md heading falls back to email-derived name when displayName missing", () => {
    const md = generateUserMd({
      creator: makeCreator({
        // intentionally undefined displayName
        email: "kevin.castro@heymaya.local",
      }),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).toContain("# USER.md — Kevin Castro");
  });
});

/* -------------------------------------------------------------------------- */
/* Sprint 10 — multimodal observations section                                 */
/* -------------------------------------------------------------------------- */

describe("generateUserMd — Sprint 10 multimodal section", () => {
  function makeMultimodalPicture(): CreatorPictureExt {
    return {
      _id: "k_pic_test" as unknown as CreatorPictureExt["_id"],
      _creationTime: 1_700_000_000_000,
      creatorId: "k_creator_test" as unknown as CreatorPictureExt["creatorId"],
      niche: "Observational NYC lifestyle comedy",
      audience: { ageRanges: ["25-34"], topGeos: ["US"], interestTags: [] },
      voiceFingerprint: "Short declarative.",
      topHooks: [],
      bottomHooks: [],
      postingCadence: { perPlatform: [] },
      brandDealHistory: [],
      generatedAt: 1_700_000_000_000,
      model: "gemini-3-flash-preview",
      sourceCitations: [{ platform: "tiktok", postId: "p1", usedFor: "niche" }],
      voiceAndPersonality: {
        humorType: "self-deprecating",
        energyLevel: "low-key conversational",
        onCameraPersona:
          "An earnest observer of city life, occasional eye-roll for emphasis",
        dryWittyEarnest: "dry-witty",
        signaturePhrases: ["that's the move"],
      },
      visualStyle: {
        framing: "Tight handheld POV; eye-level dominates",
        aesthetic: ["high-contrast urban", "natural light"],
        settingsSeen: ["bodegas", "Washington Square"],
        strengths: ["good first-second hooks"],
        weaknesses: [],
      },
      recurringElements: [
        {
          kind: "pet",
          name: "Charlie (dog)",
          appearancesIn: ["p1", "p2", "p3"],
          roleSummary: "Charlie steals every shot — runs across frame in 3 of 5",
        },
      ],
      warmthMaterial: [
        {
          kind: "recurring-element-callout",
          text: "Your dog Charlie running across Washington Square — gorgeous",
          confidence: "safe-to-use",
          citationPostIds: ["p2"],
        },
        {
          kind: "compliment",
          text: "Your London street clips punching above your baseline",
          confidence: "check-with-creator",
          citationPostIds: ["p1"],
        },
      ],
    } as unknown as CreatorPictureExt;
  }

  it("renders the 'What I observed watching your videos' section when multimodal fields are populated", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: makeMultimodalPicture(),
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).toContain("## What I observed watching your videos");
    expect(md).toContain("Humor: self-deprecating");
    expect(md).toContain("Energy: low-key conversational");
    expect(md).toContain("Framing: Tight handheld POV");
    expect(md).toContain("Settings seen: bodegas, Washington Square");
    expect(md).toContain("Charlie (dog)");
    expect(md).toContain("Charlie steals every shot");
    expect(md).toContain("[safe-to-use]");
    expect(md).toContain("[check-with-creator]");
    expect(md).toContain(
      "Your dog Charlie running across Washington Square — gorgeous"
    );
  });

  it("OMITS the section entirely when multimodal fields are absent (text-only synth)", () => {
    const md = generateUserMd({
      creator: makeCreator(),
      picture: null,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).not.toContain("What I observed watching your videos");
  });

  it("OMITS the section when picture exists but multimodal fields are null/empty (text-only fallback)", () => {
    const pic = makeMultimodalPicture() as unknown as Record<string, unknown>;
    pic.voiceAndPersonality = null;
    pic.visualStyle = null;
    pic.recurringElements = [];
    pic.warmthMaterial = [];
    const md = generateUserMd({
      creator: makeCreator(),
      picture: pic as CreatorPictureExt,
      handles: makeHandles(),
      plan: "manager",
    });
    expect(md).not.toContain("What I observed watching your videos");
  });
});
