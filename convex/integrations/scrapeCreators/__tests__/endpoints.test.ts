/**
 * endpoints.ts — schema validation + normalization tests
 *
 * For each platform wrapper:
 *  - feed it a recorded fixture (recorded shapes from ScrapeCreators docs)
 *  - assert the parsed shape (handle, follower count, post count, etc.)
 *  - feed it garbage and assert it throws (Zod parse error)
 *
 * The HTTP layer is mocked — no real network. The client is constructed with a vi.fn()
 * fetchImpl so we can return canned responses.
 */

import { describe, it, expect, vi } from "vitest";
import {
  ScrapeCreatorsClient,
} from "../client";
import {
  tiktok,
  instagram,
  youtube,
  linkedin,
  x,
} from "../endpoints";
import {
  tiktokProfileFixture,
  tiktokPostsFixture,
  tiktokCommentsFixture,
  tiktokTranscriptFixture,
  tiktokAudienceFixture,
  tiktokFollowingFixture,
} from "./fixtures/tiktok";
import {
  igProfileFixture,
  igPostsFixture,
} from "./fixtures/instagram";
import {
  ytChannelFixture,
  ytVideosFixture,
} from "./fixtures/youtube";
import {
  liProfileFixture,
  liPostsFixture,
} from "./fixtures/linkedin";
import {
  xProfileFixture,
  xTweetsFixture,
} from "./fixtures/x";

function clientReturning(payload: unknown): { client: ScrapeCreatorsClient; fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  const client = new ScrapeCreatorsClient({
    apiKey: "test-key",
    baseUrl: "https://api.example-sc.test",
    fetchImpl,
    sleep: async () => {},
  });
  return { client, fetchImpl };
}

describe("endpoints — TikTok", () => {
  it("parses profile fixture into normalized shape", async () => {
    const { client } = clientReturning(tiktokProfileFixture);
    const out = await tiktok.profile("fitcreator99", { client });
    expect(out.platform).toBe("tiktok");
    expect(out.handle).toBe("fitcreator99");
    expect(out.displayName).toBe("Fit Creator");
    expect(out.followerCount).toBe(248311);
    expect(out.followingCount).toBe(412);
    expect(out.postCount).toBe(487);
    expect(out.verified).toBe(true);
    expect(out.externalUrl).toBe("https://linktr.ee/fitcreator99");
    expect(out.avatarUrl).toContain("avatar-large.jpg");
  });

  it("parses posts fixture, sorted by API order", async () => {
    const { client } = clientReturning(tiktokPostsFixture);
    const posts = await tiktok.lastPosts("fitcreator99", 30, { client });
    expect(posts).toHaveLength(2);
    expect(posts[0].postId).toBe("7341111111111111111");
    expect(posts[0].metrics.likeCount).toBe(41200);
    expect(posts[0].metrics.viewCount).toBe(1840000);
    expect(posts[0].mediaType).toBe("video");
    expect(posts[0].thumbnailUrl).toContain("cover-1.jpg");
  });

  it("parses comments + transcript", async () => {
    // Post-migration call shape: `(handle, awemeId)` — the wrapper builds the
    // public-share URL the v1/v2 single-video endpoints expect.
    const { client: c1 } = clientReturning(tiktokCommentsFixture);
    const cmts = await tiktok.comments("fitcreator99", "7341111111111111111", {
      client: c1,
    });
    expect(cmts).toHaveLength(2);
    expect(cmts[0].text).toContain("helpful");
    expect(cmts[0].likeCount).toBe(421);

    const { client: c2 } = clientReturning(tiktokTranscriptFixture);
    const tx = await tiktok.transcript(
      "fitcreator99",
      "7341111111111111111",
      { client: c2 }
    );
    expect(tx.transcript).toContain("Five high-protein");
  });

  it("transcript falls back to segments if no top-level transcript", async () => {
    const { client } = clientReturning({
      segments: [
        { text: "Part one.", startSec: 0, endSec: 1 },
        { text: "Part two.", startSec: 1, endSec: 2 },
      ],
    });
    const tx = await tiktok.transcript("creator", "p", { client });
    expect(tx.transcript).toBe("Part one. Part two.");
  });

  it("comments + transcript wrappers send a public-share URL (v1/v2 single-video endpoints)", async () => {
    const { client: c1, fetchImpl: f1 } = clientReturning(
      tiktokCommentsFixture
    );
    await tiktok.comments("@fitcreator99", "73411111", { client: c1 });
    const url1 = f1.mock.calls[0][0] as URL | string;
    const sent1 = url1 instanceof URL ? url1.toString() : String(url1);
    expect(sent1).toContain("/v1/tiktok/video/comments");
    expect(sent1).toContain(
      encodeURIComponent("https://www.tiktok.com/@fitcreator99/video/73411111")
    );

    const { client: c2, fetchImpl: f2 } = clientReturning(
      tiktokTranscriptFixture
    );
    await tiktok.transcript("fitcreator99", "73411111", { client: c2 });
    const url2 = f2.mock.calls[0][0] as URL | string;
    const sent2 = url2 instanceof URL ? url2.toString() : String(url2);
    expect(sent2).toContain("/v1/tiktok/video/transcript");
  });

  it("lastPosts hits the v3 profile/videos endpoint (no `limit` query param)", async () => {
    const { client, fetchImpl } = clientReturning(tiktokPostsFixture);
    await tiktok.lastPosts("fitcreator99", 30, { client });
    const url = fetchImpl.mock.calls[0][0] as URL | string;
    const sent = url instanceof URL ? url.toString() : String(url);
    expect(sent).toContain("/v3/tiktok/profile/videos");
    expect(sent).toContain("handle=fitcreator99");
    // The v3 endpoint doesn't accept `limit` — page size is fixed; ensure the
    // wrapper drops it so we don't get a 4xx for unexpected param.
    expect(sent).not.toContain("limit=");
  });

  it("throws on garbage profile shape", async () => {
    const { client } = clientReturning({ totally: "wrong shape", stats: "not-an-object" });
    await expect(tiktok.profile("x", { client })).rejects.toThrow();
  });

  // Sprint 4 — audience demographics endpoint (26 credits/call).
  it("parses audience fixture into normalized ageRanges + topGeos + genderSplit", async () => {
    const { client, fetchImpl } = clientReturning(tiktokAudienceFixture);
    const out = await tiktok.audience("fitcreator99", { client });
    expect(out.platform).toBe("tiktok");
    expect(out.handle).toBe("fitcreator99");
    expect(out.ageRanges).toContain("18-24");
    expect(out.ageRanges).toContain("25-34");
    expect(out.topGeos).toContain("US");
    expect(out.topGeos).toContain("CA");
    expect(out.genderSplit).not.toBeNull();
    expect(out.genderSplit?.male).toBeCloseTo(0.58, 2);

    // Verify the wrapper hit the right path.
    const url = fetchImpl.mock.calls[0][0] as URL | string;
    const sent = url instanceof URL ? url.toString() : String(url);
    expect(sent).toContain("/v1/tiktok/user/audience");
    expect(sent).toContain("handle=fitcreator99");
  });

  it("audience returns empty arrays + null gender on completely missing-shape payload", async () => {
    const { client } = clientReturning({});
    const out = await tiktok.audience("emptycreator", { client });
    expect(out.ageRanges).toEqual([]);
    expect(out.topGeos).toEqual([]);
    expect(out.genderSplit).toBeNull();
  });

  it("audience normalizes 0-100 percent gender to 0-1 ratios", async () => {
    const { client } = clientReturning({
      audience: { gender: { male: 60, female: 40 } },
    });
    const out = await tiktok.audience("h", { client });
    expect(out.genderSplit?.male).toBeCloseTo(0.6, 2);
    expect(out.genderSplit?.female).toBeCloseTo(0.4, 2);
  });

  // Sprint 4 — following list endpoint (1 credit; cheap probe).
  it("parses following fixture into normalized count + total + users", async () => {
    const { client, fetchImpl } = clientReturning(tiktokFollowingFixture);
    const out = await tiktok.following("fitcreator99", { client });
    expect(out.platform).toBe("tiktok");
    expect(out.count).toBe(3);
    expect(out.total).toBe(412);
    expect(out.users[0].handle).toBe("lifter_lee");
    expect(out.users[0].nickname).toBe("Lee Lifts");

    const url = fetchImpl.mock.calls[0][0] as URL | string;
    const sent = url instanceof URL ? url.toString() : String(url);
    expect(sent).toContain("/v1/tiktok/user/following");
    expect(sent).toContain("handle=fitcreator99");
  });

  it("following tolerates the `data.users` envelope shape", async () => {
    const { client } = clientReturning({
      data: { users: [{ unique_id: "peer1" }] },
    });
    const out = await tiktok.following("h", { client });
    expect(out.count).toBe(1);
    expect(out.users[0].handle).toBe("peer1");
  });
});

describe("endpoints — Instagram", () => {
  it("parses profile fixture", async () => {
    const { client } = clientReturning(igProfileFixture);
    const out = await instagram.profile("studio.lena", { client });
    expect(out.platform).toBe("instagram");
    expect(out.handle).toBe("studio.lena");
    expect(out.displayName).toBe("Lena Park");
    expect(out.followerCount).toBe(84211);
    expect(out.postCount).toBe(612);
    expect(out.verified).toBe(false);
    expect(out.externalUrl).toBe("https://lenapark.co");
  });

  it("parses posts fixture handling caption-as-object and caption-as-string", async () => {
    const { client } = clientReturning(igPostsFixture);
    const posts = await instagram.lastPosts("studio.lena", 30, { client });
    expect(posts).toHaveLength(2);
    expect(posts[0].caption).toContain("Golden hour");
    expect(posts[0].mediaType).toBe("video");
    expect(posts[0].videoUrl).toContain("video1.mp4");
    expect(posts[1].caption).toContain("carousel from");
    expect(posts[1].mediaType).toBe("carousel");
  });

  it("falls back gracefully when both user and data.user are missing (parseable but empty)", async () => {
    const { client } = clientReturning({ unrelated: 1 });
    // The schema treats both `user` and `data` as optional, so an empty-ish payload parses,
    // and we fall back to (handle from arg, followerCount=0). This is the "parseable garbage"
    // boundary — the upstream returned 200 with no useful data.
    const out = await instagram.profile("ghost", { client });
    expect(out.handle).toBe("ghost");
    expect(out.followerCount).toBe(0);
  });

  it("throws on completely malformed JSON-shape (e.g. user is array)", async () => {
    const { client } = clientReturning({ user: [1, 2, 3] });
    await expect(instagram.profile("x", { client })).rejects.toThrow();
  });
});

describe("endpoints — YouTube", () => {
  it("parses channel fixture", async () => {
    const { client } = clientReturning(ytChannelFixture);
    const out = await youtube.channel("@codecast", { client });
    expect(out.platform).toBe("youtube");
    expect(out.handle).toBe("@codecast");
    expect(out.displayName).toBe("Codecast");
    expect(out.followerCount).toBe(412000);
    expect(out.postCount).toBe(184);
    expect(out.verified).toBe(true);
  });

  it("parses videos fixture; converts ISO publishedAt to seconds", async () => {
    const { client } = clientReturning(ytVideosFixture);
    const videos = await youtube.recentVideos("@codecast", 30, { client });
    expect(videos).toHaveLength(2);
    expect(videos[0].postId).toBe("abc123XYZ");
    expect(videos[0].metrics.viewCount).toBe(88410);
    expect(videos[0].postedAt).toBeGreaterThan(1_700_000_000);
    expect(videos[0].url).toContain("watch?v=abc123XYZ");
  });

  it("throws on garbage videos shape (videos is a number)", async () => {
    const { client } = clientReturning({ videos: 42 });
    await expect(youtube.recentVideos("x", 30, { client })).rejects.toThrow();
  });
});

describe("endpoints — LinkedIn", () => {
  it("parses profile fixture", async () => {
    const { client } = clientReturning(liProfileFixture);
    const out = await linkedin.profile("joshua-castro-builder", { client });
    expect(out.platform).toBe("linkedin");
    expect(out.handle).toBe("joshua-castro-builder");
    expect(out.displayName).toBe("Joshua Castro");
    expect(out.followerCount).toBe(12480);
    expect(out.bio).toContain("HeyMaya");
  });

  it("parses posts fixture", async () => {
    const { client } = clientReturning(liPostsFixture);
    const posts = await linkedin.recentPosts("joshua-castro-builder", 10, { client });
    expect(posts).toHaveLength(1);
    expect(posts[0].postId).toContain("urn:li:activity");
    expect(posts[0].metrics.likeCount).toBe(412);
    expect(posts[0].mediaType).toBe("text");
  });
});

describe("endpoints — X (Twitter)", () => {
  it("parses profile fixture", async () => {
    const { client } = clientReturning(xProfileFixture);
    const out = await x.profile("saaspov", { client });
    expect(out.platform).toBe("x");
    expect(out.handle).toBe("saaspov");
    expect(out.followerCount).toBe(64211);
    expect(out.verified).toBe(true);
  });

  it("parses tweets fixture", async () => {
    const { client } = clientReturning(xTweetsFixture);
    const tweets = await x.recentPosts("saaspov", 20, { client });
    expect(tweets).toHaveLength(2);
    expect(tweets[0].postId).toBe("1788000000000000001");
    expect(tweets[0].metrics.likeCount).toBe(4012);
    expect(tweets[0].metrics.shareCount).toBe(188);
    expect(tweets[0].url).toContain("x.com/i/status/");
  });

  it("throws on tweets being a string", async () => {
    const { client } = clientReturning({ tweets: "nope" });
    await expect(x.recentPosts("y", 5, { client })).rejects.toThrow();
  });
});
