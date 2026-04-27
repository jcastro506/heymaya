/**
 * Performance queries — Sprint 4 acceptance.
 *
 * Cross-tenant tests: every query is exercised with two creators and we
 * assert A never sees B's posts/hooks. The `postDetail` test specifically
 * tries to fetch B's post by id from A's identity (the canonical "stolen
 * id" attack) and asserts null.
 *
 * Plan-tier: hookLibrary read is unrestricted (writes are gated upstream
 * by the post-publish reaction, not the read). Documented in the query
 * comment; we assert the read works for Starter so a future tightening
 * doesn't break creators who downgrade.
 *
 * Adversarial: empty filters return everything; non-existent post id
 * returns null cleanly; postDetail with no annotation returns empty
 * comparable list.
 */

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../../tests/_modules";
import type { Id } from "../_generated/dataModel";

const NOW = 1_700_000_000_000;

async function insertCreator(
  t: ReturnType<typeof convexTest>,
  opts: { suffix: string; plan: "starter" | "pro" | "studio" }
): Promise<Id<"creators">> {
  return await t.run((ctx) =>
    ctx.db.insert("creators", {
      clerkUserId: `u_${opts.suffix}`,
      email: `${opts.suffix}@test.com`,
      channelPreference: "web",
      timezone: "America/Los_Angeles",
      status: "active",
      plan: opts.plan,
      createdAt: NOW,
    })
  );
}

function asUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.withIdentity({ subject: `u_${suffix}` });
}

async function insertPost(
  t: ReturnType<typeof convexTest>,
  creatorId: Id<"creators">,
  overrides: Partial<{
    platform: "tiktok" | "instagram" | "youtube" | "linkedin" | "x";
    mediaType: "video" | "image" | "carousel" | "text";
    caption: string;
    postedAt: number;
    annotation: { hookPattern: string; whyItWorked: string };
    platformPostId: string;
  }> = {}
): Promise<Id<"posts">> {
  return await t.run((ctx) =>
    ctx.db.insert("posts", {
      creatorId,
      platform: overrides.platform ?? "tiktok",
      platformPostId: overrides.platformPostId ?? `p${Math.random()}`,
      url: "https://tt/x",
      caption: overrides.caption ?? "",
      mediaType: overrides.mediaType ?? "video",
      postedAt: overrides.postedAt ?? NOW,
      mayaAnnotation: overrides.annotation
        ? {
            hookPattern: overrides.annotation.hookPattern,
            whyItWorked: overrides.annotation.whyItWorked,
            generatedAt: NOW,
            model: "google/gemini-3-flash-preview",
          }
        : undefined,
    })
  );
}

describe("performance.postsList", () => {
  it("returns empty + done when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.performance.postsList, {
      paginationOpts: { numItems: 30, cursor: null },
    });
    expect(r.page).toEqual([]);
    expect(r.isDone).toBe(true);
  });

  it("returns posts for the signed-in creator only", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await insertPost(t, a, { caption: "A post" });
    await insertPost(t, a, { caption: "A post 2" });
    await insertPost(t, b, { caption: "B post — should never leak" });
    const r = await asUser(t, "a").query(api.performance.postsList, {
      paginationOpts: { numItems: 30, cursor: null },
    });
    expect(r.page).toHaveLength(2);
    expect(r.page.every((p) => p.caption.startsWith("A"))).toBe(true);
  });

  it("filters by platform server-side", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertPost(t, a, { platform: "tiktok", caption: "tt" });
    await insertPost(t, a, { platform: "instagram", caption: "ig" });
    await insertPost(t, a, { platform: "youtube", caption: "yt" });
    const r = await asUser(t, "a").query(api.performance.postsList, {
      platform: "instagram",
      paginationOpts: { numItems: 30, cursor: null },
    });
    expect(r.page).toHaveLength(1);
    expect(r.page[0].platform).toBe("instagram");
  });

  it("filters by mediaType server-side", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertPost(t, a, { mediaType: "video" });
    await insertPost(t, a, { mediaType: "carousel" });
    const r = await asUser(t, "a").query(api.performance.postsList, {
      mediaType: "carousel",
      paginationOpts: { numItems: 30, cursor: null },
    });
    expect(r.page).toHaveLength(1);
    expect(r.page[0].mediaType).toBe("carousel");
  });

  it("orders by postedAt desc by default", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    await insertPost(t, a, { caption: "old", postedAt: NOW - 10_000 });
    await insertPost(t, a, { caption: "new", postedAt: NOW });
    const r = await asUser(t, "a").query(api.performance.postsList, {
      paginationOpts: { numItems: 30, cursor: null },
    });
    expect(r.page[0].caption).toBe("new");
    expect(r.page[1].caption).toBe("old");
  });
});

describe("performance.postDetail", () => {
  it("returns null when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const post = await insertPost(t, a);
    const detail = await t.query(api.performance.postDetail, { postId: post });
    expect(detail).toBeNull();
  });

  it("ADVERSARIAL: missing post id returns null cleanly", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const post = await insertPost(t, a);
    await t.run((ctx) => ctx.db.delete(post));
    const detail = await asUser(t, "a").query(api.performance.postDetail, {
      postId: post,
    });
    expect(detail).toBeNull();
  });

  it("CROSS-TENANT: A cannot fetch B's post detail by id", async () => {
    const t = convexTest(schema, modules);
    await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    const bPost = await insertPost(t, b, { caption: "B-only" });
    const detail = await asUser(t, "a").query(api.performance.postDetail, {
      postId: bPost,
    });
    expect(detail).toBeNull();
  });

  it("returns post + metrics + comparable posts with the same hook", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const post = await insertPost(t, a, {
      annotation: { hookPattern: "POV", whyItWorked: "fresh" },
    });
    await insertPost(t, a, {
      annotation: { hookPattern: "POV", whyItWorked: "also fresh" },
    });
    await insertPost(t, a, {
      annotation: { hookPattern: "wait-for-it", whyItWorked: "different" },
    });
    await t.run((ctx) =>
      ctx.db.insert("postMetrics", {
        creatorId: a,
        postId: post,
        ts: NOW,
        viewCount: 12_345,
      })
    );
    const detail = await asUser(t, "a").query(api.performance.postDetail, {
      postId: post,
    });
    expect(detail).not.toBeNull();
    expect(detail?.post._id).toBe(post);
    expect(detail?.metrics).toHaveLength(1);
    expect(detail?.comparable).toHaveLength(1);
    expect(detail?.comparable[0].mayaAnnotation?.hookPattern).toBe("POV");
  });

  it("returns empty comparable when post has no annotation", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const post = await insertPost(t, a);
    const detail = await asUser(t, "a").query(api.performance.postDetail, {
      postId: post,
    });
    expect(detail?.comparable).toEqual([]);
  });
});

describe("performance.hookLibrary", () => {
  it("returns empty + done when unauthenticated", async () => {
    const t = convexTest(schema, modules);
    const r = await t.query(api.performance.hookLibrary, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toEqual([]);
  });

  it("CROSS-TENANT: A only sees A's hooks", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "pro" });
    const b = await insertCreator(t, { suffix: "b", plan: "pro" });
    await t.run((ctx) =>
      ctx.db.insert("hookLibrary", {
        creatorId: a,
        pattern: "A's hook",
        firstSeconds: "0-2s",
        whyItWorked: "...",
        examplePostIds: [],
        extractedAt: NOW,
      })
    );
    await t.run((ctx) =>
      ctx.db.insert("hookLibrary", {
        creatorId: b,
        pattern: "B's hook",
        firstSeconds: "0-2s",
        whyItWorked: "...",
        examplePostIds: [],
        extractedAt: NOW,
      })
    );
    const r = await asUser(t, "a").query(api.performance.hookLibrary, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toHaveLength(1);
    expect(r.page[0].pattern).toBe("A's hook");
  });

  it("PLAN-TIER: read is allowed for Starter (writes are gated, not reads)", async () => {
    const t = convexTest(schema, modules);
    const a = await insertCreator(t, { suffix: "a", plan: "starter" });
    await t.run((ctx) =>
      ctx.db.insert("hookLibrary", {
        creatorId: a,
        pattern: "historical hook",
        firstSeconds: "0-2s",
        whyItWorked: "...",
        examplePostIds: [],
        extractedAt: NOW,
      })
    );
    const r = await asUser(t, "a").query(api.performance.hookLibrary, {
      paginationOpts: { numItems: 12, cursor: null },
    });
    expect(r.page).toHaveLength(1);
  });
});
