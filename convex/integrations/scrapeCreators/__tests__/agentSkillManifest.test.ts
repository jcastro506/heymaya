import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "../../../..");
const MANIFEST_PATH = join(
  REPO_ROOT,
  "convex/integrations/scrapeCreators/agentSkill/manifest.json"
);
const SKILL_PATH = join(
  REPO_ROOT,
  "agents/skills/scrapecreators-api/SKILL.md"
);

type ManifestTool = {
  name: string;
  method: string;
  path: string;
  params?: Array<{ name: string; required?: boolean }>;
};

type Manifest = {
  auth: { envVar: string };
  tools: ManifestTool[];
};

const PLATFORMS_DIR = join(
  REPO_ROOT,
  "convex/integrations/scrapeCreators/platforms"
);

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

/**
 * Every `/vN/...` path our typed wrappers actually call.
 *
 * Reads the whole `platforms/` directory rather than a fixed file list, so
 * adding a channel can't quietly fall outside the comparison — which is the
 * same "nothing compared the two" failure this test exists to catch.
 */
function wrapperPaths(): Set<string> {
  const source = readdirSync(PLATFORMS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(join(PLATFORMS_DIR, file), "utf8"))
    .join("\n");
  return new Set(source.match(/"\/v[0-9]\/[^"]+"/g)?.map((m) => m.slice(1, -1)) ?? []);
}

/**
 * Manifest entries we knowingly advertise to the agent without a typed
 * wrapper behind them. The manifest is the AGENT's interface (it calls the
 * vendor directly); the wrapper is OUR interface. They don't have to be 1:1 —
 * but every gap has to be a decision someone wrote down, not a drift.
 */
const WRAPPERLESS_BY_DESIGN: Record<string, string> = {
  tiktok_live:
    "Live-stream state isn't read by any sweep — no v0 surface consumes it. " +
    "Left advertised because we have no evidence the path is wrong, only " +
    "that we never call it from TypeScript.",
};

describe("ScrapeCreators agent skill manifest", () => {
  it("every advertised path is one our wrappers actually call, or is waived", () => {
    // The defect this pins: the manifest advertised `/v1/youtube/channel/videos`
    // and `/v1/twitter/user/tweets` while the live paths — the ones our tested
    // wrappers call — are hyphenated. Any agent following the manifest got a
    // 404, and nothing in the repo noticed, because nothing compared the two.
    const paths = wrapperPaths();
    const unbacked = loadManifest()
      .tools.filter((tool) => !paths.has(tool.path))
      .filter((tool) => !(tool.name in WRAPPERLESS_BY_DESIGN))
      .map((tool) => `${tool.name} → ${tool.path}`);
    expect(unbacked).toEqual([]);
  });

  it("a waiver is only allowed while the entry really has no wrapper", () => {
    const paths = wrapperPaths();
    const byName = new Map(loadManifest().tools.map((t) => [t.name, t]));
    for (const name of Object.keys(WRAPPERLESS_BY_DESIGN)) {
      const tool = byName.get(name);
      expect(tool, `${name} is waived but no longer in the manifest`).toBeDefined();
      expect(
        paths.has(tool!.path),
        `${name} now has a wrapper — drop its waiver`
      ).toBe(false);
    }
  });

  it("the buyer map's follow pair is wrapped in both directions", () => {
    // Audience-overlap discovery needs `following` AND `followers`; shipping
    // only one silently halves the buyer map.
    const paths = wrapperPaths();
    expect(paths.has("/v1/tiktok/user/following")).toBe(true);
    expect(paths.has("/v1/tiktok/user/followers")).toBe(true);
  });

  it("ScrapeCreators env var spelling: manifest uses HeyMaya canonical, SKILL.md uses upstream", () => {
    // Two spellings exist in the wild:
    //   - HeyMaya canonical: SCRAPE_CREATORS_API_KEY (used by manifest +
    //     Convex backend integration code)
    //   - Upstream canonical: SCRAPECREATORS_API_KEY (used by the
    //     official ScrapeCreators agent-skill docs and our SKILL.md)
    // The deploy layer (convex/onboarding/gtm/deployMayaGtm.ts ~777-803)
    // bridges them — whichever the operator sets gets aliased to both
    // before being injected into the Fly machine. This test pins both
    // sides of that bridge so neither file drifts unilaterally.
    const manifest = loadManifest();
    const skill = readFileSync(SKILL_PATH, "utf8");

    expect(manifest.auth.envVar).toBe("SCRAPE_CREATORS_API_KEY");
    expect(skill).toContain("primaryEnv: SCRAPECREATORS_API_KEY");
    expect(skill).toContain("$SCRAPECREATORS_API_KEY");
    // SKILL.md must call out the HeyMaya-side alias so contributors
    // looking up the var find the bridge.
    expect(skill).toContain("SCRAPE_CREATORS_API_KEY");
  });

  it("does not expose stale TikTok v1 post/comment/transcript paths", () => {
    const manifest = loadManifest();
    const paths = manifest.tools.map((tool) => tool.path);

    expect(paths).not.toContain("/v1/tiktok/user/posts");
    expect(paths).not.toContain("/v1/tiktok/post");
    expect(paths).not.toContain("/v1/tiktok/comments");
    expect(paths).not.toContain("/v1/tiktok/transcript");
  });

  it("lists the current TikTok endpoints Maya can call from OpenClaw", () => {
    const manifest = loadManifest();
    const byName = new Map(manifest.tools.map((tool) => [tool.name, tool]));

    const required: Array<[string, string]> = [
      ["tiktok_profile", "/v1/tiktok/profile"],
      ["tiktok_user_posts", "/v3/tiktok/profile/videos"],
      ["tiktok_post", "/v2/tiktok/video"],
      ["tiktok_comments", "/v1/tiktok/video/comments"],
      ["tiktok_transcript", "/v1/tiktok/video/transcript"],
      ["tiktok_audience", "/v1/tiktok/user/audience"],
      ["tiktok_live", "/v1/tiktok/user/live"],
      ["tiktok_following", "/v1/tiktok/user/following"],
      ["tiktok_followers", "/v1/tiktok/user/followers"],
      ["tiktok_search_users", "/v1/tiktok/search/users"],
      ["tiktok_search_hashtag", "/v1/tiktok/search/hashtag"],
      ["tiktok_search_keyword", "/v1/tiktok/search/keyword"],
      ["tiktok_search_top", "/v1/tiktok/search/top"],
      ["tiktok_trending_feed", "/v1/tiktok/get-trending-feed"],
      ["tiktok_popular_videos", "/v1/tiktok/videos/popular"],
      ["tiktok_popular_creators", "/v1/tiktok/creators/popular"],
      ["tiktok_popular_hashtags", "/v1/tiktok/hashtags/popular"],
      ["tiktok_popular_songs", "/v1/tiktok/songs/popular"],
      ["tiktok_song", "/v1/tiktok/song"],
      ["tiktok_song_videos", "/v1/tiktok/song/videos"],
    ];

    for (const [name, path] of required) {
      expect(byName.get(name)?.path, name).toBe(path);
    }

    expect(
      byName.get("tiktok_post")?.params?.some((param) => param.name === "url")
    ).toBe(true);
    expect(
      byName.get("tiktok_comments")?.params?.some((param) => param.name === "url")
    ).toBe(true);
    expect(
      byName
        .get("tiktok_transcript")
        ?.params?.some((param) => param.name === "url")
    ).toBe(true);
  });
});
