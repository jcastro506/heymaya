/**
 * The cache stores what the readers use, not the vendor's whole payload.
 *
 * A live TikTok keyword search is ~2.2 MiB against Convex's 1 MiB document limit, so every
 * lane sweep failed with "Value is too large" and the "shape" signal source had never once
 * worked in production. It passed on fixtures only because those are trimmed to six posts.
 */
import { describe, expect, it } from "vitest";
import { slimForCache } from "../read";

const bulky = (id: string) => ({
  postId: id,
  metrics: { viewCount: 1000 },
  raw: {
    is_ad: false,
    music: { id: 123, id_str: "123", title: "x" },
    author: { unique_id: "runner", follower_count: 5, avatar_larger: { url_list: Array.from({ length: 60 }, () => "https://cdn/".padEnd(400, "x")) } },
    video: { bit_rate: Array.from({ length: 40 }, () => ({ url_list: Array.from({ length: 20 }, () => "https://cdn/".padEnd(500, "x")) })) },
  },
});

describe("slimForCache", () => {
  it("keeps the three raw fields anything downstream actually reads", () => {
    const [p] = slimForCache([bulky("1")]) as Array<{ raw: { is_ad: unknown; music: { id_str: string }; author: { unique_id: string } } }>;
    expect(p.raw.is_ad).toBe(false);
    expect(p.raw.music.id_str).toBe("123");
    expect(p.raw.author.unique_id).toBe("runner");
  });

  it("throws away the bitrate ladders and avatars that blew the limit", () => {
    const before = JSON.stringify([bulky("1")]).length;
    const after = JSON.stringify(slimForCache([bulky("1")])).length;
    expect(after).toBeLessThan(before / 10);
  });

  it("drops the vendor's top-level payload but keeps the normalized posts", () => {
    const v = slimForCache({ source: "s", posts: [bulky("1")], raw: { enormous: "x".repeat(2_000_000) } }) as { posts: unknown[]; raw: unknown };
    expect(v.posts).toHaveLength(1);
    expect(v.raw).toBeUndefined();
  });

  it("a real-sized search result comes in under the document limit", () => {
    const posts = Array.from({ length: 30 }, (_, i) => bulky(String(i)));
    expect(JSON.stringify({ posts })).toHaveLength(JSON.stringify({ posts }).length); // sanity
    const slim = JSON.stringify(slimForCache({ source: "search", posts, raw: {} }));
    expect(slim.length).toBeLessThan(900_000);
  });

  it("leaves shapes it does not recognise alone", () => {
    expect(slimForCache({ transcript: "hello" })).toEqual({ transcript: "hello" });
  });
});
