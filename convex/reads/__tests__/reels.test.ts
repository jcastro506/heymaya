/**
 * §27.3: Instagram Reels search returns posts with authors, from both recorded vendor shapes, and
 * they survive the cache. Before this, the kind returned a raw payload the cache stripped, and the
 * lane sweep stored zero Instagram posts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { instagramReelsPosts } from "../reels";
import { slimForCache } from "../read";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../integrations/scrapeCreators/${f}`, import.meta.url), "utf8")) as Record<string, unknown>;
const SPEC = load("fixtures.spec.json")["/v2/instagram/reels/search"];
const RECORDED = load("fixtures.recorded.json")["/v2/instagram/reels/search"];

describe("instagram reels search", () => {
  it("both recorded shapes give posts with an author, a caption, a millisecond date and likes; views are never invented", () => {
    for (const raw of [SPEC, RECORDED]) {
      const posts = instagramReelsPosts(raw);
      expect(posts.length).toBeGreaterThan(0);
      const p = posts[0];
      expect(p.authorHandle).toMatch(/^[a-z0-9._]+$/);
      expect(typeof p.caption).toBe("string");
      expect(p.postedAt).toBeGreaterThan(1e12);
      expect(p.metrics.viewCount).toBeNull();
      expect(p.url).toMatch(/^https:\/\/www\.instagram\.com\//);
    }
    expect(instagramReelsPosts(SPEC)[0].author.followerCount, "the spec shape carries the owner's followers").toEqual(expect.any(Number));
  });

  it("adversarial: junk and id-less rows give nothing, never a throw", () => {
    for (const bad of [null, undefined, 7, "x", {}, { reels: "no" }, { reels: [null, { owner: { username: "x" } }] }]) expect(instagramReelsPosts(bad)).toEqual([]);
    expect(instagramReelsPosts({ reels: [{ id: "1", taken_at: "not a date", owner: { username: "@Some.One" } }] })[0]).toMatchObject({ authorHandle: "some.one", postedAt: null });
  });

  it("the stored value keeps its posts and authors through the cache", () => {
    const value = { source: "instagram_reels_search", posts: instagramReelsPosts(RECORDED), credits_charged: 1 };
    const cached = slimForCache(value) as { posts: Array<{ authorHandle: string | null }> };
    expect(cached.posts.length).toBe(value.posts.length);
    expect(cached.posts[0].authorHandle).toBe(value.posts[0].authorHandle);
  });

  it("sibling coherence: the read kind uses the normalizer, and the sweep and suggestions read `posts`", () => {
    expect(readFileSync(new URL("../kinds.ts", import.meta.url), "utf8")).toMatch(/posts: instagramReelsPosts\(r\.raw\)/);
    expect(readFileSync(new URL("../../scout/sweep.ts", import.meta.url), "utf8")).toMatch(/value\?\.posts \?\? \[\]/);
    expect(readFileSync(new URL("../../onboarding/suggest.ts", import.meta.url), "utf8")).toMatch(/read\("search\.reels"/);
  });
});
