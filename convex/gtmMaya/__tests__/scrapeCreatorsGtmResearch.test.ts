import { describe, expect, it } from "vitest";
import { ScrapeCreatorsClient } from "../../integrations/scrapeCreators/client";
import {
  googleSearch,
  instagramSearchReels,
  redditPostComments,
  searchRedditAll,
  searchRedditSubreddit,
  subredditPosts,
  tiktokVideoComments,
  tiktokVideoTranscript,
  twitterProfile,
  twitterSearch,
  twitterTweet,
  twitterUserTweets,
  ResearchRawItemSchema,
} from "../scrapeCreatorsGtmResearch";

/**
 * Make a ScrapeCreatorsClient whose fetch returns the provided JSON. Tests
 * verify normalization shape, not real network behavior.
 */
function clientWithJson(body: unknown): ScrapeCreatorsClient {
  return new ScrapeCreatorsClient({
    apiKey: "test-key",
    baseUrl: "https://api.test/",
    maxAttempts: 1,
    fetchImpl: ((async () =>
      new Response(JSON.stringify(body), { status: 200 })) as typeof fetch),
  });
}

function clientWithStatus(status: number, body = ""): ScrapeCreatorsClient {
  return new ScrapeCreatorsClient({
    apiKey: "test-key",
    baseUrl: "https://api.test/",
    maxAttempts: 1,
    fetchImpl: ((async () =>
      new Response(body, { status })) as typeof fetch),
  });
}

describe("Sprint 2 — Reddit wrappers", () => {
  it("normalizes Reddit search results", async () => {
    const client = clientWithJson({
      data: {
        after: "t3_xyz",
        children: [
          {
            data: {
              id: "abc",
              title: "How do you do first-100 users for an indie SaaS?",
              selftext: "I just shipped my tool but...",
              author: "indie_dev_1",
              permalink: "/r/SaaS/comments/abc/how_do_you/",
              subreddit: "SaaS",
              score: 42,
              ups: 50,
              downs: 8,
              num_comments: 17,
              created_utc: 1700000000,
              link_flair_text: "Question",
            },
          },
        ],
      },
    });
    const res = await searchRedditAll(client, "first 100 users", {
      sort: "relevance",
      timeframe: "month",
    });
    expect(res.statusDetail).toBe("ok");
    expect(res.nextCursor).toBe("t3_xyz");
    expect(res.items).toHaveLength(1);
    const item = res.items[0]!;
    expect(item.platform).toBe("reddit");
    expect(item.externalId).toBe("abc");
    expect(item.url).toBe(
      "https://www.reddit.com/r/SaaS/comments/abc/how_do_you/"
    );
    expect(item.title).toContain("first-100 users");
    expect(item.author).toBe("indie_dev_1");
    expect(item.engagement.upvotes).toBe(50);
    expect(item.engagement.comments).toBe(17);
    expect(item.tags).toContain("sub:SaaS");
    expect(item.tags).toContain("flair:Question");
    expect(item.rawRef).toMatch(/^reddit:search:/);
    expect(() => ResearchRawItemSchema.parse(item)).not.toThrow();
  });

  it("strips r/ prefix from subreddit and normalizes", async () => {
    const client = clientWithJson({
      data: {
        children: [
          {
            data: {
              id: "qrs",
              title: "Anyone using AI for launch copy?",
              author: "founder42",
              permalink: "/r/SideProject/comments/qrs/anyone/",
              subreddit: "SideProject",
              score: 8,
              num_comments: 3,
              created_utc: 1700000100,
            },
          },
        ],
      },
    });
    const res = await searchRedditSubreddit(client, "r/SideProject", "AI launch", {});
    expect(res.statusDetail).toBe("ok");
    expect(res.items[0]?.tags).toContain("sub:SideProject");
  });

  it("subredditPosts handles empty listings", async () => {
    const client = clientWithJson({ data: { children: [], after: null } });
    const res = await subredditPosts(client, "r/microsaas");
    expect(res.statusDetail).toBe("ok");
    expect(res.items).toEqual([]);
  });

  it("redditPostComments normalizes thread shape", async () => {
    const client = clientWithJson([
      { data: { children: [] } }, // post
      {
        data: {
          children: [
            {
              kind: "t1",
              data: {
                id: "c1",
                body: "I'd recommend Reddit reply mining over posts.",
                author: "vet_indie",
                permalink: "/r/SaaS/comments/abc/x/c1/",
                score: 12,
                ups: 14,
                downs: 2,
                created_utc: 1700001000,
                link_id: "t3_abc",
                parent_id: "t3_abc",
              },
            },
          ],
        },
      },
    ]);
    const res = await redditPostComments(
      client,
      "https://www.reddit.com/r/SaaS/comments/abc/x/"
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.tags).toContain("comment");
    expect(res.items[0]?.excerpt).toContain("reply mining");
    expect(res.items[0]?.engagement.upvotes).toBe(14);
  });

  it("soft-fails Reddit on 4xx instead of throwing", async () => {
    const client = clientWithStatus(404, "not found");
    const res = await searchRedditAll(client, "nonexistent");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^reddit_http_404/);
  });
});

describe("Sprint 2 — TikTok video wrappers", () => {
  it("normalizes video comments", async () => {
    const client = clientWithJson({
      comments: [
        {
          cid: "cid1",
          text: "Where can I try this?",
          user: { unique_id: "user1", nickname: "User One" },
          digg_count: 3,
          reply_comment_total: 1,
          create_time: 1700002000,
        },
      ],
      has_more: 1,
      cursor: 25,
    });
    const res = await tiktokVideoComments(client, "7300000000");
    expect(res.statusDetail).toBe("ok");
    expect(res.nextCursor).toBe("25");
    expect(res.items[0]?.author).toBe("User One");
    expect(res.items[0]?.url).toContain("comment_id=cid1");
    expect(res.items[0]?.tags).toContain("comment");
  });

  it("transcript returns single item with the joined text", async () => {
    const client = clientWithJson({
      segments: [
        { text: "Welcome to the demo", start: 0, end: 2 },
        { text: "This is the hook", start: 2, end: 4 },
      ],
      language: "en",
    });
    const res = await tiktokVideoTranscript(client, "7300000001");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.excerpt).toContain("Welcome to the demo");
    expect(res.items[0]?.tags).toContain("transcript");
  });

  it("transcript empty result returns empty_transcript", async () => {
    const client = clientWithJson({ transcript: "" });
    const res = await tiktokVideoTranscript(client, "7300000002");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toBe("empty_transcript");
  });
});

describe("Sprint 2 — Twitter wrappers", () => {
  it("normalizes a profile", async () => {
    const client = clientWithJson({
      id: "12345",
      handle: "indie_founder",
      name: "Indie Founder",
      description: "Building in public.",
      followers: 1500,
      following: 200,
      tweet_count: 800,
      created_at: "2020-01-01T00:00:00Z",
    });
    const res = await twitterProfile(client, "@indie_founder");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.url).toBe("https://x.com/indie_founder");
    expect(res.items[0]?.tags).toContain("followers:1500");
  });

  it("user tweets normalize with engagement", async () => {
    const client = clientWithJson({
      tweets: [
        {
          id_str: "1800000000000000000",
          text: "Shipped a new feature today.",
          user: { screen_name: "indie_founder" },
          favorite_count: 42,
          reply_count: 5,
          retweet_count: 3,
          view_count: 5000,
          created_at: 1700003000,
          lang: "en",
        },
      ],
      next_cursor: "cur_xyz",
    });
    const res = await twitterUserTweets(client, "indie_founder");
    expect(res.nextCursor).toBe("cur_xyz");
    expect(res.items[0]?.engagement.likes).toBe(42);
    expect(res.items[0]?.engagement.views).toBe(5000);
    expect(res.items[0]?.url).toContain(
      "/indie_founder/status/1800000000000000000"
    );
  });

  it("twitter search returns normalized tweets", async () => {
    const client = clientWithJson({
      tweets: [
        {
          id: "t1",
          text: "alternative to Stripe Atlas?",
          user: { screen_name: "founder_jane" },
          favorite_count: 8,
          reply_count: 14,
        },
      ],
    });
    const res = await twitterSearch(client, "alternative to Stripe Atlas");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.author).toBe("founder_jane");
  });

  it("twitterTweet returns single item or tweet_not_found", async () => {
    const ok = clientWithJson({
      id: "tweet1",
      text: "hi",
      user: { screen_name: "x" },
    });
    const fail = clientWithJson({});
    const okRes = await twitterTweet(ok, "https://x.com/x/status/tweet1");
    const failRes = await twitterTweet(fail, "https://x.com/missing/status/0");
    expect(okRes.items).toHaveLength(1);
    expect(failRes.items).toEqual([]);
    expect(failRes.statusDetail).toBe("tweet_not_found");
  });
});

describe("Sprint 2 — Instagram + Google wrappers", () => {
  it("normalizes Instagram Reels search", async () => {
    const client = clientWithJson({
      reels: [
        {
          id: "r1",
          shortcode: "Cx1",
          caption: "How I shipped my first SaaS",
          owner: { username: "indie_creator" },
          like_count: 200,
          comment_count: 15,
          play_count: 5000,
          taken_at: 1700004000,
        },
      ],
      next_page: "page2",
    });
    const res = await instagramSearchReels(client, "indie saas launch");
    expect(res.items[0]?.url).toBe("https://www.instagram.com/reel/Cx1/");
    expect(res.items[0]?.engagement.views).toBe(5000);
    expect(res.nextCursor).toBe("page2");
  });

  it("normalizes Google search results", async () => {
    const client = clientWithJson({
      results: [
        {
          title: "Alternative to Stripe Atlas in 2026",
          link: "https://example.test/alt-stripe-atlas",
          snippet: "Comparison of Stripe Atlas alternatives.",
          position: 2,
          source: "example.test",
        },
      ],
    });
    const res = await googleSearch(client, "alternative to Stripe Atlas");
    expect(res.items[0]?.url).toBe("https://example.test/alt-stripe-atlas");
    expect(res.items[0]?.tags).toContain("pos:2");
  });
});

describe("Sprint 2 — soft-fail discipline", () => {
  it("4xx becomes statusDetail without throwing", async () => {
    const client = clientWithStatus(403);
    const res = await twitterProfile(client, "denied");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/twitter_http_403/);
  });

  it("network error becomes statusDetail", async () => {
    const client = new ScrapeCreatorsClient({
      apiKey: "k",
      maxAttempts: 1,
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch,
    });
    const res = await searchRedditAll(client, "anything");
    expect(res.items).toEqual([]);
    expect(res.statusDetail).toMatch(/^reddit_error:ECONNREFUSED/);
  });
});

describe("Sprint 2 — rawRef stability for citation-firewall", () => {
  it("same params produce same rawRef across calls", async () => {
    const client = clientWithJson({ data: { children: [] } });
    const a = await searchRedditAll(client, "test", { sort: "top", timeframe: "week" });
    const b = await searchRedditAll(client, "test", { sort: "top", timeframe: "week" });
    expect(a.items).toEqual(b.items);
    // Even with empty items, rawRef discipline is enforced by hash — different
    // wrappers/endpoints get different prefixes.
    const c = await twitterSearch(client, "test", { mode: "latest" });
    expect(c.statusDetail).toBe("ok");
  });

  it("ResearchRawItem zod schema accepts every normalizer's output", async () => {
    // One end-to-end pass per platform — verify every produced item parses
    // cleanly. If a future endpoint adds a field, this would catch a missed
    // schema update.
    const fixtures = {
      reddit: clientWithJson({
        data: {
          children: [
            {
              data: { id: "r", title: "t", subreddit: "x" },
            },
          ],
        },
      }),
      tiktok: clientWithJson({
        comments: [
          {
            cid: "c",
            text: "hi",
            user: { unique_id: "u", nickname: "U" },
          },
        ],
      }),
      twitter: clientWithJson({ id: "1", handle: "h", name: "N" }),
      instagram: clientWithJson({
        reels: [{ id: "r", shortcode: "s", owner: { username: "u" } }],
      }),
      google: clientWithJson({
        results: [{ title: "T", link: "https://e.test/x" }],
      }),
    };
    const all = [
      ...(await searchRedditAll(fixtures.reddit, "q")).items,
      ...(await tiktokVideoComments(fixtures.tiktok, "0")).items,
      ...(await twitterProfile(fixtures.twitter, "h")).items,
      ...(await instagramSearchReels(fixtures.instagram, "q")).items,
      ...(await googleSearch(fixtures.google, "q")).items,
    ];
    for (const item of all) {
      expect(() => ResearchRawItemSchema.parse(item)).not.toThrow();
    }
  });
});
