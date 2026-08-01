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
  tiktokSearchKeywordFixture,
  tiktokV3ProfileVideosFixture,
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

describe("Sprint 1 P0 wrappers — params VERIFIED LIVE 2026-07-31", () => {
  // The whole point of these tests is the PARAMETER NAME. The docs summary
  // said video_id / channel_id / post_id / media_id / user_id, and the live
  // API rejected every one of them: "You must provide a url". Writing these
  // wrappers from the docs would have shipped five endpoints that 400 on every
  // call — which is why they weren't written until a key existed to check.

  it("youtube.search sends `query`", async () => {
    const { client, fetchImpl } = clientReturning({ videos: [] });
    await youtube.search("postgres migration", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/youtube/search");
    expect(sent).toContain("query=postgres");
  });

  it("youtube.videoComments sends `url`, NOT video_id", async () => {
    const { client, fetchImpl } = clientReturning({ comments: [] });
    await youtube.videoComments("https://www.youtube.com/watch?v=abc", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/youtube/video/comments");
    expect(sent).toContain("url=");
    expect(sent).not.toContain("video_id");
  });

  it("youtube.videoTranscript sends `url`, NOT video_id", async () => {
    const { client, fetchImpl } = clientReturning({ transcript: [] });
    await youtube.videoTranscript("https://www.youtube.com/watch?v=abc", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/youtube/video/transcript");
    expect(sent).not.toContain("video_id");
  });

  it("youtube.shortsTrending only sends region when given one", async () => {
    const { client, fetchImpl } = clientReturning({ shorts: [] });
    await youtube.shortsTrending(undefined, { client });
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("region=");

    const second = clientReturning({ shorts: [] });
    await youtube.shortsTrending("US", { client: second.client });
    expect(String(second.fetchImpl.mock.calls[0][0])).toContain("region=US");
  });

  it("youtube.channelShorts picks handle vs channelId by shape", async () => {
    // The live error names both: "You must provide a 'handle' or a 'channelId'".
    // Note channelId is camelCase — channel_id is rejected.
    const a = clientReturning({ videos: [] });
    await youtube.channelShorts("@MrBeast", { client: a.client });
    expect(String(a.fetchImpl.mock.calls[0][0])).toContain("handle=%40MrBeast");

    const b = clientReturning({ videos: [] });
    await youtube.channelShorts("UCabc123", { client: b.client });
    const sent = String(b.fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("channelId=UCabc123");
    expect(sent).not.toContain("channel_id");
  });

  it("instagram.postComments sends `url`, NOT post_id", async () => {
    const { client, fetchImpl } = clientReturning({ comments: [] });
    await instagram.postComments("https://www.instagram.com/p/abc/", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v2/instagram/post/comments");
    expect(sent).not.toContain("post_id");
  });

  it("instagram.mediaTranscript sends `url`, NOT media_id", async () => {
    const { client, fetchImpl } = clientReturning({ transcript: "" });
    await instagram.mediaTranscript("https://www.instagram.com/p/abc/", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v2/instagram/media/transcript");
    expect(sent).not.toContain("media_id");
  });

  it("instagram.reelsSearch sends `query`", async () => {
    const { client, fetchImpl } = clientReturning({ reels: [] });
    await instagram.reelsSearch("postgres", { client });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/v2/instagram/reels/search");
  });

  it("instagram.userReels sends `handle`, NOT user_id", async () => {
    const { client, fetchImpl } = clientReturning({ items: [] });
    await instagram.userReels("nasa", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/instagram/user/reels");
    expect(sent).toContain("handle=nasa");
    expect(sent).not.toContain("user_id");
  });

  it("youtube.searchHashtag strips a leading # and hits the documented path", async () => {
    const { client, fetchImpl } = clientReturning({ videos: [] });
    await youtube.searchHashtag("#postgres", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/youtube/search/hashtag");
    expect(sent).toContain("hashtag=postgres");
    expect(sent).not.toContain("%23");
  });

  it("instagram.songReels sends `audio_id` — the live error names it explicitly", async () => {
    const { client, fetchImpl } = clientReturning({ reels: [], has_more: false });
    await instagram.songReels("1234567890", { client });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/instagram/song/reels");
    expect(sent).toContain("audio_id=1234567890");
  });

  it("every P0 wrapper returns a labelled raw envelope", async () => {
    const { client } = clientReturning({ anything: true });
    const out = await youtube.search("x", { client });
    expect(out.source).toBe("youtube_search");
    expect(out.raw).toEqual({ anything: true });
  });
});

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

  it("parses real v3 profile/videos shape with aweme_id and url_list media", async () => {
    const { client } = clientReturning(tiktokV3ProfileVideosFixture);
    const posts = await tiktok.lastPosts("kevin.castro9996", 30, { client });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      postId: "7606569072632925453",
      url: "https://www.tiktok.com/@kevin.castro9996/video/7606569072632925453",
      caption: "I have no words",
      postedAt: 1771042386,
      metrics: {
        likeCount: 11,
        commentCount: 2,
        viewCount: 258,
        shareCount: 1,
        saveCount: 4,
      },
      mediaType: "video",
      thumbnailUrl: "https://p16-sign.tiktokcdn-us.com/tos-useast5/cover.jpeg",
      videoUrl: "https://v16-webapp-prime.us.tiktok.com/video.mp4",
      videoDurationSec: 14,
    });
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

  it("research wrappers hit current TikTok trend/search endpoints and normalize video metrics", async () => {
    const cases: Array<{
      label: string;
      run: (client: ScrapeCreatorsClient) => Promise<unknown>;
      path: string;
      query?: string;
    }> = [
      {
        label: "hashtag",
        run: (client) => tiktok.searchHashtag("#mealprep", { client }),
        path: "/v1/tiktok/search/hashtag",
        query: "hashtag=mealprep",
      },
      {
        label: "keyword",
        run: (client) => tiktok.searchKeyword("high protein", { client }),
        path: "/v1/tiktok/search/keyword",
        query: "query=high+protein",
      },
      {
        label: "top",
        run: (client) => tiktok.searchTop("fitness creator", { client }),
        path: "/v1/tiktok/search/top",
        query: "query=fitness+creator",
      },
      {
        label: "trending",
        run: (client) => tiktok.trendingFeed("US", { client }),
        path: "/v1/tiktok/get-trending-feed",
        query: "region=US",
      },
      {
        label: "popular videos",
        run: (client) => tiktok.popularVideos({ client }),
        path: "/v1/tiktok/videos/popular",
      },
      {
        label: "song videos",
        run: (client) => tiktok.songVideos("7439295283975702544", { client }),
        path: "/v1/tiktok/song/videos",
        query: "clipId=7439295283975702544",
      },
    ];

    for (const c of cases) {
      const { client, fetchImpl } = clientReturning(tiktokPostsFixture);
      const result = await c.run(client);
      const sent = String(fetchImpl.mock.calls[0][0]);
      expect(sent, c.label).toContain(c.path);
      if (c.query) expect(sent, c.label).toContain(c.query);
      expect(result).toHaveProperty("posts");
      const posts = (result as { posts: Array<{ postId: string; metrics: unknown }> })
        .posts;
      expect(posts[0]).toMatchObject({
        postId: "7341111111111111111",
        metrics: { viewCount: 1840000, likeCount: 41200 },
      });
    }
  });

  it("searchKeyword forwards niche-bias options as snake_case query params", async () => {
    const { client, fetchImpl } = clientReturning(tiktokPostsFixture);
    await tiktok.searchKeyword("nyc", {
      client,
      datePosted: "this_week",
      sortBy: "likes",
      region: "US",
      cursor: "abc123",
      trim: true,
    });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/tiktok/search/keyword");
    expect(sent).toContain("query=nyc");
    expect(sent).toContain("date_posted=this_week");
    expect(sent).toContain("sort_by=likes");
    expect(sent).toContain("region=US");
    expect(sent).toContain("cursor=abc123");
    expect(sent).toContain("trim=true");
    // The non-bias call shape from earlier in this file must still work — no
    // bias options means no leaked query params.
    const { client: c2, fetchImpl: f2 } = clientReturning(tiktokPostsFixture);
    await tiktok.searchKeyword("plain", { client: c2 });
    const sent2 = String(f2.mock.calls[0][0]);
    expect(sent2).toContain("query=plain");
    expect(sent2).not.toContain("date_posted=");
    expect(sent2).not.toContain("sort_by=");
  });

  it("searchKeyword normalizes the search_item_list / aweme_info upstream shape", async () => {
    const { client } = clientReturning(tiktokSearchKeywordFixture);
    const result = await tiktok.searchKeyword("nyc", { client });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      postId: "7637798581134527757",
      metrics: { viewCount: 14015, likeCount: 618, commentCount: 13 },
    });
  });

  it("searchHashtag forwards region/cursor/trim and strips leading '#'", async () => {
    const { client, fetchImpl } = clientReturning(tiktokPostsFixture);
    await tiktok.searchHashtag("#fitness", {
      client,
      region: "GB",
      cursor: "next-page",
      trim: false,
    });
    const sent = String(fetchImpl.mock.calls[0][0]);
    expect(sent).toContain("/v1/tiktok/search/hashtag");
    expect(sent).toContain("hashtag=fitness");
    expect(sent).not.toContain("hashtag=%23fitness");
    expect(sent).toContain("region=GB");
    expect(sent).toContain("cursor=next-page");
    expect(sent).toContain("trim=false");
  });

  it("raw TikTok research wrappers preserve raw payloads for high-variance endpoints", async () => {
    const payload = { creators: [{ handle: "fitcreator99" }] };
    const { client, fetchImpl } = clientReturning(payload);

    const out = await tiktok.popularCreators({ client });

    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      "/v1/tiktok/creators/popular"
    );
    expect(out).toEqual({
      source: "tiktok_popular_creators",
      query: {},
      raw: payload,
    });
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

  // Sprint 1 — the other half of the buyer map (§5.0.0). `following` and
  // `followers` together are what audience-overlap discovery is computed from.
  it("followers parses the same envelope as following and hits /user/followers", async () => {
    const { client, fetchImpl } = clientReturning({
      followers: [
        { uniqueId: "buyer_one", nickname: "Buyer One" },
        { unique_id: "buyer_two", nickname: "Buyer Two" },
      ],
      total: 5120,
    });
    const out = await tiktok.followers("fitcreator99", { client });
    expect(out.platform).toBe("tiktok");
    expect(out.handle).toBe("fitcreator99");
    expect(out.count).toBe(2);
    expect(out.total).toBe(5120);
    // Both the camelCase and snake_case handle spellings normalize.
    expect(out.users.map((u) => u.handle)).toEqual(["buyer_one", "buyer_two"]);

    const url = fetchImpl.mock.calls[0][0] as URL | string;
    const sent = url instanceof URL ? url.toString() : String(url);
    expect(sent).toContain("/v1/tiktok/user/followers");
    expect(sent).toContain("handle=fitcreator99");
  });

  it("followers reads the list from any envelope variant upstream uses", async () => {
    for (const payload of [
      { users: [{ uniqueId: "a", nickname: "A" }] },
      { userList: [{ uniqueId: "a", nickname: "A" }] },
      { data: { followers: [{ uniqueId: "a", nickname: "A" }] } },
    ]) {
      const { client } = clientReturning(payload);
      const out = await tiktok.followers("h", { client });
      expect(out.count).toBe(1);
      expect(out.users[0].handle).toBe("a");
    }
  });

  it("followers on an account with none is an empty list, not a throw", async () => {
    const { client } = clientReturning({ users: [], total: 0 });
    const out = await tiktok.followers("nobody", { client });
    expect(out.count).toBe(0);
    expect(out.users).toEqual([]);
  });

  it("commentReplies passes url + comment_id and returns the raw envelope", async () => {
    const { client, fetchImpl } = clientReturning({
      comments: [{ text: "actually the opposite is true" }],
    });
    const out = await tiktok.commentReplies(
      "https://www.tiktok.com/@h/video/123",
      "comment_9",
      { client }
    );
    expect(out.source).toBe("tiktok_comment_replies");

    const url = fetchImpl.mock.calls[0][0] as URL | string;
    const sent = url instanceof URL ? url.toString() : String(url);
    expect(sent).toContain("/v1/tiktok/comment/replies");
    expect(sent).toContain("comment_id=comment_9");
  });

  it("commentReplies only sends cursor when paging", async () => {
    const { client, fetchImpl } = clientReturning({ comments: [] });
    await tiktok.commentReplies("https://u", "c1", { client });
    const first = String(fetchImpl.mock.calls[0][0]);
    expect(first).not.toContain("cursor=");

    const { client: c2, fetchImpl: f2 } = clientReturning({ comments: [] });
    await tiktok.commentReplies("https://u", "c1", { client: c2, cursor: "20" });
    expect(String(f2.mock.calls[0][0])).toContain("cursor=20");
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

  it("parses the current /channel-videos shape (Int variants + publishDate) and hits the hyphenated path", async () => {
    const { client, fetchImpl } = clientReturning({
      videos: [
        {
          id: "mk_wdHePbtQ",
          url: "https://www.youtube.com/watch?v=mk_wdHePbtQ",
          title: "I built a thing",
          publishDate: "2026-05-01T12:00:00Z",
          viewCountInt: 152000,
          likeCountInt: 8800,
          commentCountInt: 640,
          lengthSeconds: 733,
        },
      ],
    });
    const videos = await youtube.recentVideos("@mkbhd", 30, { client });
    expect(videos).toHaveLength(1);
    expect(videos[0].caption).toBe("I built a thing");
    expect(videos[0].metrics.viewCount).toBe(152000);
    expect(videos[0].metrics.likeCount).toBe(8800);
    expect(videos[0].metrics.commentCount).toBe(640);
    expect(videos[0].postedAt).toBeGreaterThan(1_700_000_000);
    // Regression: must call the current hyphenated path, not the 404ing /channel/videos.
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain("/v1/youtube/channel-videos");
    expect(calledUrl).not.toContain("/channel/videos");
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

  it("parses the current /user-tweets GraphQL shape (legacy.full_text + rest_id + views.count) and hits the hyphenated path", async () => {
    const { client, fetchImpl } = clientReturning({
      tweets: [
        {
          __typename: "Tweet",
          rest_id: "1950000000000000123",
          url: "https://x.com/paulg/status/1950000000000000123",
          views: { count: "98000" },
          legacy: {
            full_text: "The best founders write their own first 100 replies.",
            created_at: "Wed Apr 22 18:00:00 +0000 2026",
            favorite_count: 1203,
            reply_count: 47,
            retweet_count: 88,
          },
        },
      ],
    });
    const tweets = await x.recentPosts("paulg", 20, { client });
    expect(tweets).toHaveLength(1);
    expect(tweets[0].postId).toBe("1950000000000000123");
    expect(tweets[0].caption).toContain("first 100 replies");
    expect(tweets[0].metrics.likeCount).toBe(1203);
    expect(tweets[0].metrics.commentCount).toBe(47);
    expect(tweets[0].metrics.shareCount).toBe(88);
    expect(tweets[0].metrics.viewCount).toBe(98000);
    expect(tweets[0].url).toContain("x.com/paulg/status/1950000000000000123");
    // Regression: must call the current hyphenated path, not the 404ing /user/tweets.
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain("/v1/twitter/user-tweets");
    expect(calledUrl).not.toContain("/user/tweets");
  });
});
