/**
 * §17.1 shape conformance against REAL recorded vendor payloads
 * (`fixtures.recorded.json`, recorded 2026-09-02 once credits existed).
 *
 * The spec fixtures come from the vendor's own OpenAPI examples, which are tidied and
 * occasionally wrong. These are what the API actually returns. Every assertion here is on
 * a field the product depends on, so a vendor shape change fails in CI rather than turning
 * into an empty niche, a post dated 1970, or a scout with nothing to say.
 *
 * Re-record with `npm run fixtures:record`.
 */
import { describe, expect, it } from "vitest";
import recorded from "../../integrations/scrapeCreators/fixtures.recorded.json";
import { tiktok } from "../../integrations/scrapeCreators/platforms/tiktok";
import { instagram } from "../../integrations/scrapeCreators/platforms/instagram";
import type { NormalizedPost } from "../../integrations/scrapeCreators/schemas";

const R = recorded as unknown as Record<string, unknown>;
const HANDLE = "stoolpresidente";
const AWEME = "7499229683859426602";

/** Answers one path from the recording so the platform module runs unchanged. */
function depsFor(path: string) {
  const body = R[path];
  if (body === undefined) throw new Error(`no recording for ${path}; run npm run fixtures:record`);
  return { client: { request: async () => structuredClone(body) } } as never;
}

/** Posts must be usable: an id, numbers a person can read, and a date in this decade. */
function assertUsablePosts(posts: NormalizedPost[], label: string, opts: { needViews?: boolean } = {}) {
  expect(posts.length, `${label}: no posts`).toBeGreaterThan(0);
  expect(posts.filter((p) => p.postId).length, `${label}: posts without an id`).toBe(posts.length);

  // ⚠️ The 1970 trap: TikTok returns create_time in SECONDS. Anything outside this window
  // means a unit bug, and a unit bug reads as an empty niche rather than as a defect.
  const dated = posts.filter((p) => p.postedAt !== null);
  expect(dated.length / posts.length, `${label}: most posts must carry a date`).toBeGreaterThan(0.8);
  for (const p of dated) {
    const ms = p.postedAt! < 1e12 ? p.postedAt! * 1000 : p.postedAt!;
    expect(ms, `${label}: ${p.postId} dated ${new Date(ms).toISOString()}`).toBeGreaterThan(Date.UTC(2019, 0, 1));
    expect(ms, `${label}: ${p.postId} dated in the future`).toBeLessThan(Date.now() + 86_400_000);
  }

  if (opts.needViews !== false) {
    const withViews = posts.filter((p) => (p.metrics.viewCount ?? 0) > 0);
    expect(withViews.length / posts.length, `${label}: views are the whole product`).toBeGreaterThan(0.5);
  }
  expect(posts.filter((p) => (p.metrics.likeCount ?? 0) > 0).length, `${label}: no likes anywhere`).toBeGreaterThan(0);
}

describe("recorded vendor shapes", () => {
  it("the recording covers every live path the belt can call", () => {
    const paths = Object.keys(R).filter((k) => !k.startsWith("_"));
    expect(paths.length).toBeGreaterThanOrEqual(16);
    for (const p of paths) expect(R[p], p).toBeTruthy();
  });

  it("tiktok profile: a handle and a follower count", async () => {
    const p = await tiktok.profile(HANDLE, depsFor("/v1/tiktok/profile"));
    expect(p.handle).toBeTruthy();
    expect(p.followerCount ?? 0).toBeGreaterThan(1000);
  });

  it("tiktok account posts: ids, seconds-era dates, views", async () => {
    const posts = await tiktok.lastPosts(HANDLE, 30, depsFor("/v3/tiktok/profile/videos"));
    assertUsablePosts(posts, "tiktok account posts");
  });

  it("tiktok post detail: the one post, unwrapped, with its counts", async () => {
    const p = await tiktok.post(HANDLE, AWEME, depsFor("/v2/tiktok/video"));
    expect(p, "post detail returned nothing").not.toBeNull();
    expect(p!.postId).toBeTruthy();
    expect(p!.metrics.viewCount ?? 0).toBeGreaterThan(0);
    expect(p!.metrics.likeCount ?? 0).toBeGreaterThan(0);
    expect(p!.caption, "no caption means the aweme_detail unwrap regressed").toBeTruthy();
  });

  it("tiktok transcript: words she can actually quote", async () => {
    const t = await tiktok.transcript(HANDLE, AWEME, depsFor("/v1/tiktok/video/transcript"));
    expect(t.transcript, "no transcript text").toBeTruthy();
    expect(t.transcript!.length).toBeGreaterThan(20);
  });

  it("tiktok comments: text and authors, the raw material of the buyer read", async () => {
    const c = await tiktok.comments(HANDLE, AWEME, depsFor("/v1/tiktok/video/comments"));
    expect(c.length).toBeGreaterThan(5);
    expect(c.filter((x) => x.text.trim().length > 0).length / c.length).toBeGreaterThan(0.8);
  });

  it("tiktok keyword search: posts WITH AN AUTHOR, or no watchlist can be built", async () => {
    const r = await tiktok.searchKeyword("marathon training", depsFor("/v1/tiktok/search/keyword"));
    assertUsablePosts(r.posts, "tiktok keyword search");
    const withAuthor = r.posts.filter((p) => p.authorHandle);
    expect(withAuthor.length / r.posts.length, "a search result nobody can be tracked from is useless").toBeGreaterThan(0.8);
  });

  it("tiktok hashtag search: usable posts", async () => {
    const r = await tiktok.searchHashtag("marathontraining", depsFor("/v1/tiktok/search/hashtag"));
    assertUsablePosts(r.posts, "tiktok hashtag search");
  });

  it("tiktok trending feed: usable posts", async () => {
    const r = await tiktok.trendingFeed("US", depsFor("/v1/tiktok/get-trending-feed"));
    assertUsablePosts(r.posts, "tiktok trending");
  });

  it("instagram profile: a handle and a follower count", async () => {
    const p = await instagram.profile("nike", depsFor("/v1/instagram/profile"));
    expect(p.handle).toBeTruthy();
    expect(p.followerCount ?? 0).toBeGreaterThan(1000);
  });

  it("instagram account posts: ids, dates, engagement", async () => {
    const posts = await instagram.lastPosts("nike", 30, depsFor("/v2/instagram/user/posts"));
    assertUsablePosts(posts, "instagram account posts", { needViews: false });
  });

  it("instagram reels search and trending answer with reels", async () => {
    const s = await instagram.reelsSearch("marathon training", depsFor("/v2/instagram/reels/search"));
    expect(Array.isArray((s.raw as { reels?: unknown[] }).reels), "reels search shape changed").toBe(true);
    const t = await instagram.reelsTrending(depsFor("/v1/instagram/reels/trending"));
    expect(((t.raw as { reels?: unknown[] }).reels ?? []).length, "trending reels empty").toBeGreaterThan(0);
  });
});

/**
 * Two shapes the recording never showed and a LIVE read of a connected account did
 * (2026-09-05, the operator's own throwaway accounts). Both broke the catalogue read.
 */
describe("live shapes the recording missed", () => {
  it("instagram: a numeric pk is still an id", async () => {
    const body = structuredClone(R["/v2/instagram/user/posts"]) as { items: Record<string, unknown>[] };
    for (const item of body.items) { item.pk = 3712345678901234567; item.id = 3712345678901234567; }
    const deps = { client: { request: async () => structuredClone(body) } } as never;
    const posts = await instagram.lastPosts("heymaya182", 30, deps);
    assertUsablePosts(posts, "instagram numeric pk", { needViews: false });
    for (const p of posts) expect(typeof p.postId).toBe("string");
  });

  it("tiktok: a photo carousel is an image, not a video to transcribe", async () => {
    const body = structuredClone(R["/v3/tiktok/profile/videos"]) as { aweme_list: Record<string, unknown>[] };
    const first = body.aweme_list[0];
    first.share_url = "https://www.tiktok.com/@kevin.castro9996/photo/7603160253638741262?_r=1";
    first.image_post_info = { images: [] };
    const deps = { client: { request: async () => structuredClone(body) } } as never;
    const posts = await tiktok.lastPosts("kevin.castro9996", 30, deps);
    expect(posts[0].mediaType).toBe("image");
    expect(posts.slice(1).every((p) => p.mediaType === "video")).toBe(true);
  });
});
