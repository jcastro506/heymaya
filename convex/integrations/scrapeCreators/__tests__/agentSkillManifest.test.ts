import { readFileSync } from "node:fs";
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

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

describe("ScrapeCreators agent skill manifest", () => {
  it("uses HeyMaya's canonical ScrapeCreators environment variable", () => {
    const manifest = loadManifest();
    const skill = readFileSync(SKILL_PATH, "utf8");

    expect(manifest.auth.envVar).toBe("SCRAPE_CREATORS_API_KEY");
    expect(skill).toContain("primaryEnv: SCRAPE_CREATORS_API_KEY");
    expect(skill).toContain("$SCRAPE_CREATORS_API_KEY");
    expect(skill).not.toContain("primaryEnv: SCRAPECREATORS_API_KEY");
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
