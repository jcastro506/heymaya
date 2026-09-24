/**
 * Covers and avatars (convex/media.ts). Mandatory categories: adversarial input (the URLs
 * come from scraped data, so only platform image CDNs are ever fetched) and sibling
 * coherence (one cover key for a post, whichever surface asks).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../../tests/_modules";
import { seedCreator } from "../../tests/lib/creatorRow";
import { coverKey, fetchable } from "../media";

describe("media keys and hosts", () => {
  it("one post, one key, from any surface", () => {
    expect(coverKey("tiktok", "https://www.tiktok.com/@a/video/7682381346961886477?_r=1", "7682381346961886477")).toBe("7682381346961886477");
    expect(coverKey("instagram", "https://www.instagram.com/reel/DbrZ8lIlxma/", "3712345678901234567")).toBe("DbrZ8lIlxma");
    expect(coverKey("instagram", null, "3712345678901234567")).toBe("3712345678901234567");
  });

  it("only fetches the platforms' image CDNs over https", () => {
    expect(fetchable("https://p16-common-sign.tiktokcdn-us.com/tos/abc")).toBe(true);
    expect(fetchable("https://scontent-lax3-1.cdninstagram.com/v/t51/abc.jpg")).toBe(true);
    expect(fetchable("https://instagram.fsyd1-1.fna.fbcdn.net/v/abc.jpg")).toBe(true);
    for (const bad of ["http://p16.tiktokcdn.com/x", "https://169.254.169.254/latest/meta-data", "https://evil.com/tiktokcdn.com.jpg", "https://tiktokcdn.com.evil.io/x", "file:///etc/passwd", "not a url"]) {
      expect(fetchable(bad)).toBe(false);
    }
  });
});

describe("remembering and serving covers", () => {
  it("remembers each image once and never queues an unsafe URL", async () => {
    const t = convexTest(schema, modules);
    const n1 = await t.mutation(internal.media.remember, { items: [
      { platform: "tiktok", kind: "cover", key: "1", url: "https://p16.tiktokcdn.com/a.jpg" },
      { platform: "tiktok", kind: "cover", key: "1", url: "https://p16.tiktokcdn.com/a.jpg" },
      { platform: "tiktok", kind: "cover", key: "2", url: "https://169.254.169.254/x" },
    ] });
    const n2 = await t.mutation(internal.media.remember, { items: [{ platform: "tiktok", kind: "cover", key: "1", url: "https://p16.tiktokcdn.com/a.jpg" }] });
    expect([n1, n2]).toEqual([1, 0]);
    const rows = await t.run((ctx) => ctx.db.query("media").collect());
    expect(rows.map((r) => r.key)).toEqual(["1"]);
  });

  it("a stored cover and avatar come back through the app's queries", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", handles: { tiktok: "runner" }, channel: { paired: true } });
      const now = Date.now();
      await ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: "42", url: "https://www.tiktok.com/@runner/video/42", createTime: now, contentType: "video", caption: "", hashtags: [], metrics: { views: 10, likes: 1, comments: 0, shares: 0 }, metricsAsOf: now, source: "scrape" } as never);
      const cover = await ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }));
      const avatar = await ctx.storage.store(new Blob([new Uint8Array([4, 5])], { type: "image/jpeg" }));
      await ctx.db.insert("media", { platform: "tiktok", kind: "cover", key: "42", sourceUrl: "https://p16.tiktokcdn.com/c.jpg", state: "stored", storageId: cover, attempts: 0, at: now });
      await ctx.db.insert("media", { platform: "tiktok", kind: "avatar", key: "runner", sourceUrl: "https://p16.tiktokcdn.com/a.jpg", state: "stored", storageId: avatar, attempts: 0, at: now });
    });
    const asA = t.withIdentity({ subject: "user_a" });
    const today = await asA.query(api.ui.today, {});
    expect(today?.week[0].cover).toMatch(/^https?:\/\//);
    const settings = await asA.query(api.ui.settings, {});
    expect(settings?.avatars.tiktok).toMatch(/^https?:\/\//);
    expect(settings?.avatars.instagram).toBeNull();
  });
});
