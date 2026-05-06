/**
 * Maya voice — banned-term firewall for generated workspace files.
 *
 * Sprint 2 Slice B. Operator's locked rule: Maya is positioned as a manager /
 * coach, never "AI". The word never appears in marketing copy or any
 * agent-readable workspace prose (SOUL.md, AGENTS.md, USER.md, MEMORY.md,
 * IDENTITY.md, BOOT.md, HEARTBEAT.md, DREAMING.md, per-skill SKILL.md body,
 * shared playbook.md / cron.md).
 *
 * This test runs every workspace generator we have today against a fixture
 * creator and asserts the output contains none of the banned terms. New
 * generators (e.g. SOUL.md / IDENTITY.md from Slice A) should be wired in
 * as they land — the helper at the bottom keeps the per-generator block
 * one-liner short.
 *
 * Banned-term list lives in BANNED_PROSE_TERMS below. Each term is a
 * case-insensitive substring match. Two terms (`your AI` / `an AI`) are
 * deliberately broad — generators don't need them, so a hit is always real.
 *
 * If a generator legitimately needs to enumerate a forbidden phrase as DATA
 * (e.g. a forbid-list in a service-side voice overlay), keep the phrase in
 * a `.ts` constant under `agents/skills/` — those files are NOT covered by
 * this test (this test only watches the workspace `.md` generators that
 * end up in the per-creator OpenClaw bundle).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateAgentsMd } from "../convex/agents/packs/maya/workspace/generateAgentsMd";
import { generateUserMd } from "../convex/agents/packs/maya/workspace/generateUserMd";
import { generateMemoryMdSeed } from "../convex/agents/packs/maya/workspace/generateMemoryMdSeed";
import { generateBootMd } from "../convex/agents/packs/maya/workspace/generateBootMd";
import { generateHeartbeatMd } from "../convex/agents/packs/maya/workspace/generateHeartbeatMd";
import { generateDreamingMd } from "../convex/agents/packs/maya/workspace/generateDreamingMd";

import type { Doc } from "../convex/_generated/dataModel";
import type { CreatorPictureExt } from "../convex/agents/packs/maya/workspace/types";

/**
 * Substrings that must never appear (case-insensitive) in any generated
 * agent-readable workspace file. The first five are the explicit ones from
 * the slice spec. The last two are intentionally broad to catch positional
 * variants like "your AI manager" / "an AI coach" without needing per-phrase
 * entries.
 */
const BANNED_PROSE_TERMS = [
  "AI creator manager",
  "AI manager",
  "as an AI",
  "I'm an AI",
  "AI assistant",
  "I'll synthesize",
  "your AI",
  "an AI",
] as const;

function makeCreator(): Doc<"creators"> {
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

function makePicture(): CreatorPictureExt {
  return {
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
    careerStage: "monetizing",
    locationSoul: { city: "Austin", state: "TX", country: "US" },
    monthlyRevenueUsd: 8_500,
    currentRevenueStreams: ["brand-deals", "ad-rev", "affiliate"],
    longTermGoals: {
      oneYear: "Hit 250K followers by end of year.",
      fiveYear: "Launch a digital training program.",
    },
  };
}

/**
 * Assert a single chunk of generated prose contains none of the banned
 * terms. Reports each hit individually so a regression points at the exact
 * offending substring — not a single "expected false to be true" line.
 */
function assertNoBannedTerms(label: string, content: string): void {
  for (const term of BANNED_PROSE_TERMS) {
    const lc = content.toLowerCase();
    const lcTerm = term.toLowerCase();
    if (lc.includes(lcTerm)) {
      // Surface the surrounding 60 chars so a regression is debuggable
      // without re-running with `vitest --reporter=verbose`.
      const idx = lc.indexOf(lcTerm);
      const ctx = content.slice(Math.max(0, idx - 30), idx + lcTerm.length + 30);
      throw new Error(
        `[${label}] contains banned term "${term}" — context: "...${ctx}..."`
      );
    }
  }
}

describe("Maya voice — banned-term firewall", () => {
  describe("workspace generators", () => {
    const baseDisplayName = "Joshua Castro";
    const handles = makeHandles();
    const picture = makePicture();
    const creator = makeCreator();
    const now = 1_700_000_000_000;

    // Run each generator under both a Coach and a Manager plan to make sure
    // tier-conditional copy in either branch doesn't slip a banned term in.
    for (const plan of ["coach", "manager"] as const) {
      it(`AGENTS.md (plan=${plan}, embedded) is voice-clean`, () => {
        const md = generateAgentsMd({
          creatorDisplayName: baseDisplayName,
          handles: handles.map((h) => ({
            platform: h.platform,
            handle: h.handle,
          })),
          plan,
          embedStandingOrders: true,
        });
        assertNoBannedTerms(`AGENTS.md(${plan},embedded)`, md);
      });

      it(`AGENTS.md (plan=${plan}, split) is voice-clean`, () => {
        const md = generateAgentsMd({
          creatorDisplayName: baseDisplayName,
          handles: handles.map((h) => ({
            platform: h.platform,
            handle: h.handle,
          })),
          plan,
          embedStandingOrders: false,
        });
        assertNoBannedTerms(`AGENTS.md(${plan},split)`, md);
      });

      it(`USER.md (plan=${plan}, with picture) is voice-clean`, () => {
        const md = generateUserMd({ creator, picture, handles, plan });
        assertNoBannedTerms(`USER.md(${plan},picture)`, md);
      });

      it(`USER.md (plan=${plan}, no picture) is voice-clean`, () => {
        const md = generateUserMd({ creator, picture: null, handles, plan });
        assertNoBannedTerms(`USER.md(${plan},nopic)`, md);
      });

      it(`MEMORY.md seed (plan=${plan}) is voice-clean`, () => {
        const md = generateMemoryMdSeed({ creator, picture, handles, now });
        assertNoBannedTerms(`MEMORY.md(${plan})`, md);
      });

      it(`HEARTBEAT.md (plan=${plan}) is voice-clean`, () => {
        const md = generateHeartbeatMd({ plan });
        assertNoBannedTerms(`HEARTBEAT.md(${plan})`, md);
      });
    }

    it("BOOT.md is voice-clean", () => {
      const md = generateBootMd({ creatorDisplayName: baseDisplayName });
      assertNoBannedTerms("BOOT.md", md);
    });

    it("DREAMING.md is voice-clean", () => {
      const md = generateDreamingMd();
      assertNoBannedTerms("DREAMING.md", md);
    });
  });

  describe("shared platform .md files (loaded into every Maya workspace)", () => {
    // These ship in the bundle as static `.md` files (not generated). They
    // get the same firewall treatment because every Maya reads them at
    // every cron tick / heartbeat.
    const root = join(__dirname, "..");

    const SHARED_MD_PATHS = [
      "agents/skills/maya-platform/playbook.md",
      "agents/skills/maya-platform/cron.md",
      "agents/skills/maya-platform/SKILL.md",
    ] as const;

    for (const rel of SHARED_MD_PATHS) {
      it(`${rel} is voice-clean`, () => {
        const content = readFileSync(join(root, rel), "utf8");
        assertNoBannedTerms(rel, content);
      });
    }
  });
});
