/**
 * ⭐ Channel expertise lives in markdown, and the bundle must still match it.
 *
 * `CONVENTIONS.md` states the rule:
 *
 * > *"In `PLATFORM_ALGO/{channel}.md`, as prose. Never as a branch in a skill,
 * > and **never hardcoded into a tool.** Each channel rewards a different shape
 * > and those shapes drift; prose can be edited when they do, a conditional
 * > can't."*
 *
 * ⚠️ It was hardcoded into a tool. `renderPlatformAlgo` held all four channels
 * as a `Record<MayaChannel, string>` of template literals, and printed a
 * closing line into each workspace file claiming *"platform knowledge lives
 * here as prose, never as a branch in code"* — a statement about where the
 * knowledge ought to live, sitting in the place it wasn't supposed to be.
 *
 * Moving it only helps if the two can't silently diverge, which is what this
 * asserts. Same mechanism as the skill-drift test: edit the markdown without
 * running `npm run sync:maya-skills` and CI fails rather than shipping norms
 * that disagree with the ones in the repo.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MAYA_PLATFORM_ALGO } from "../../agents/packs/maya/bundledSkills";

const ALGO_DIR = join(
  process.cwd(),
  "agents",
  "skills",
  "maya",
  "PLATFORM_ALGO"
);

/** The four channels, and no fifth. LinkedIn and Reddit are dead products. */
const CHANNELS = ["tiktok", "instagram", "youtube", "x"];

describe("PLATFORM_ALGO is markdown in the repo", () => {
  it("has a file for every channel we publish to", () => {
    const files = readdirSync(ALGO_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(files).toEqual([...CHANNELS].sort());
  });

  it("bundles byte-for-byte what's on disk", () => {
    for (const channel of CHANNELS) {
      const onDisk = readFileSync(join(ALGO_DIR, `${channel}.md`), "utf8");
      expect(
        MAYA_PLATFORM_ALGO[channel],
        `${channel}.md differs from the bundle — run \`npm run sync:maya-skills\` and commit both`
      ).toBe(onDisk);
    }
  });

  it("bundles nothing that isn't on disk", () => {
    // A stale key would ship norms for a channel whose file was deleted.
    expect(Object.keys(MAYA_PLATFORM_ALGO).sort()).toEqual([...CHANNELS].sort());
  });
});

describe("the facts a writer must not get wrong", () => {
  /**
   * These assert *rules*, never phrasing. The files are meant to be edited when
   * a platform changes — pinning sentences would make every genuine edit a test
   * failure, which trains people to loosen the test rather than read it.
   */
  const algo = (channel: string) => MAYA_PLATFORM_ALGO[channel] ?? "";

  it("TikTok says there is no comment API", () => {
    // She has claimed to be watching TikTok comments before. There is nothing
    // to watch — the endpoint does not exist.
    expect(algo("tiktok")).toMatch(/no comment api/i);
  });

  it("TikTok carries the consent requirement as TikTok's, not ours", () => {
    // ⚠️ It IS their legal requirement for API-published content. Framed as our
    // caution, a founder reasonably asks us to skip it.
    expect(algo("tiktok")).toMatch(/legal requirement/i);
    expect(algo("tiktok")).toMatch(/preview/i);
  });

  it("X carries the weighted-280 rule and the URL constant", () => {
    expect(algo("x")).toMatch(/weighted/i);
    expect(algo("x")).toMatch(/\bURL\b/);
    expect(algo("x")).toMatch(/\b23\b/);
  });

  it("every channel states a hashtag rule, since none of them agree", () => {
    // §7.5.9: the counts differ sharply per channel, and inventing tags is the
    // failure this prevents.
    for (const channel of CHANNELS) {
      expect(algo(channel), `${channel} has no hashtag guidance`).toMatch(
        /hashtag/i
      );
      expect(algo(channel), `${channel} doesn't say tags come from mined sets`).toMatch(
        /mined|never invented/i
      );
    }
  });

  it("names no dead channel", () => {
    // LinkedIn and Reddit belonged to products that were deleted. A mention
    // means the text was copied from the frozen pack.
    for (const channel of CHANNELS) {
      expect(algo(channel)).not.toMatch(/linkedin|reddit/i);
    }
  });
});
