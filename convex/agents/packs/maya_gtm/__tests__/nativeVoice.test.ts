import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Sprint I — Native Voice Fidelity.
 *
 * These assertions read the skill .md SOURCE files directly (not the bundled
 * copy) and confirm the Sprint I additions are present. The parent session
 * re-syncs the bundle after integrating these .md sources, so this test guards
 * the source of truth.
 *
 * The bar Sprint I enforces is NATIVE-VOICE FIDELITY, not detector-dodging:
 * grounding + founder voice + venue style exemplars + a structural AI-tell
 * critic. No file path here points at bundledLocalSkills.ts or any convex/
 * generator — only the skill .md sources under agents/skills/maya-gtm/.
 */

// From convex/agents/packs/maya_gtm/__tests__/ up to the repo root is 5 levels.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKILLS_DIR = resolve(REPO_ROOT, "agents/skills/maya-gtm");

function readSkill(slug: string): string {
  return readFileSync(resolve(SKILLS_DIR, slug, "SKILL.md"), "utf8");
}

const PER_CHANNEL_SKILLS = [
  "maya-reddit-demand-researcher",
  "maya-x-founder-led-researcher",
  "maya-linkedin-fit-researcher",
  "maya-tiktok-format-researcher",
  "maya-content-format-miner",
] as const;

describe("Sprint I — slop-critic becomes a structural AI-tell critic", () => {
  const src = readSkill("maya-slop-critic");

  it("keeps the existing banned-phrase content", () => {
    // A representative banned phrase + the banned-phrase rule must survive.
    expect(src).toContain("game changer");
    expect(src.toLowerCase()).toContain("banned-phrase");
  });

  it("adds a structural AI-tell section driven by LLM judgment, not regex", () => {
    expect(src).toMatch(/structural[\s-]?ai[\s-]?tell/i);
    expect(src).toMatch(/LLM[\s-]?JUDGMENT/i);
    // Explicitly NOT regex / hardcoded thresholds (the no-heuristics rule).
    expect(src.toLowerCase()).toContain("not regex");
  });

  it("catches the named structural tells", () => {
    const lower = src.toLowerCase();
    expect(lower).toContain("em-dash");
    expect(lower).toContain("tricolon");
    expect(src).toMatch(/it'?s not just x/i); // "it's not just X, it's Y"
    expect(lower).toContain("rhythm"); // uniform sentence rhythm
    expect(lower).toContain("hedg"); // over-hedging
    expect(lower).toContain("stance"); // zero opinion / no stance
    expect(lower).toContain("tidi"); // suspicious tidiness/symmetry
    expect(lower).toContain("specific"); // no concrete specifics
  });

  it("frames the judgment as 'would a real person in this community have written this?'", () => {
    expect(src).toMatch(/would (a |someone )?(real )?person.*(written|community)/i);
  });

  it("exposes the structural tell as an output hit type", () => {
    expect(src).toContain("structural_ai_tell");
  });

  it("does NOT chase an AI detector", () => {
    // Native + grounded, never 'undetectable'.
    expect(src.toLowerCase()).toContain("undetectable");
    expect(src).toMatch(/no reliable platform ai-detector|there is no reliable/i);
  });
});

describe("Sprint I — voice-matcher conditions on founder posts AND venue exemplars", () => {
  const src = readSkill("maya-voice-matcher");

  it("conditions on the founder's OWN real posts ingested in manager mode (Phase 0)", () => {
    expect(src).toMatch(/phase 0/i);
    expect(src).toMatch(/manager mode/i);
    expect(src.toLowerCase()).toContain("ingest");
  });

  it("conditions on the venue style exemplars", () => {
    expect(src).toMatch(/style[\s-]?exemplar/i);
    expect(src).toContain("styleExemplars");
    // Two named anchors: voice (founder) + register (venue).
    expect(src.toLowerCase()).toContain("register");
  });

  it("scores native-register fit as its own dimension", () => {
    expect(src.toLowerCase()).toContain("native-register");
  });
});

describe("Sprint I — each per-channel skill captures verbatim style exemplars", () => {
  for (const slug of PER_CHANNEL_SKILLS) {
    it(`${slug} captures 5-10 real human native posts as voice/register anchors`, () => {
      const src = readSkill(slug);
      expect(src).toMatch(/style[\s-]?exemplar/i);
      expect(src).toContain("styleExemplars");
      expect(src).toMatch(/5-10/);
      expect(src.toLowerCase()).toContain("verbatim");
      // Never copy content — match cadence/vocab/length/format only.
      expect(src.toLowerCase()).toContain("never copy");
      expect(src.toLowerCase()).toMatch(/cadence|register/);
    });
  }
});

describe("Sprint I — each per-channel skill encodes its caption craft", () => {
  const src = {
    reddit: readSkill("maya-reddit-demand-researcher"),
    x: readSkill("maya-x-founder-led-researcher"),
    linkedin: readSkill("maya-linkedin-fit-researcher"),
    tiktok: readSkill("maya-tiktok-format-researcher"),
    miner: readSkill("maya-content-format-miner"),
  };

  it("every channel skill exposes a captionCraft block", () => {
    for (const body of Object.values(src)) {
      expect(body).toContain("captionCraft");
    }
  });

  it("Reddit: title is everything", () => {
    expect(src.reddit.toLowerCase()).toMatch(/title is everything|title is the whole/);
  });

  it("X: the post is the caption", () => {
    expect(src.x.toLowerCase()).toMatch(/post is the caption|post text is the/);
  });

  it("LinkedIn: hook + link in first comment", () => {
    expect(src.linkedin.toLowerCase()).toContain("hook");
    expect(src.linkedin.toLowerCase()).toContain("first comment");
  });

  it("TikTok: hook-line + hashtags, and IG story + CTA", () => {
    expect(src.tiktok.toLowerCase()).toMatch(/hook[\s-]?line/);
    expect(src.tiktok.toLowerCase()).toContain("hashtag");
    expect(src.tiktok.toLowerCase()).toContain("story");
    expect(src.tiktok).toMatch(/CTA/);
  });

  it("content-format-miner rolls up YouTube title=CTR lever + description", () => {
    expect(src.miner.toLowerCase()).toContain("youtube");
    expect(src.miner.toLowerCase()).toMatch(/ctr lever|title = the ctr|title=ctr|title = ctr/);
    expect(src.miner.toLowerCase()).toContain("description");
  });
});
