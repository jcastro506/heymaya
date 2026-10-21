/**
 * The day after they post (2026-10-21): an honest read is a candidate for her one text. A tester asked what
 * Maya thought of a post doing 0.41× her usual and got cheering.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { postReadCandidate } from "../readback";
import { laneFor } from "../../core/reachOut";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 21, 15, 0);
const post = (over: Record<string, unknown> = {}) => ({ postId: "p1", url: "https://www.tiktok.com/@a/video/1", caption: "me 🤝 wearing brown\n#fall", createTime: T0 - 24 * H, multiple: 0.41, metrics: { views: 352, likes: 20, comments: 2, shares: 0 }, ...over }) as never;

describe("the next-day read of their post", () => {
  it("a day old, not a win: honest wording of where it is, once; too new, too old or a win: none", () => {
    const c = postReadCandidate(post(), { hook: "opens on the jacket" }, T0)!;
    expect(c).toMatchObject({ kind: "post_read", sourceKey: "post_read:p1", link: "https://www.tiktok.com/@a/video/1" });
    expect(c.summary).toMatch(/below their usual/);
    expect(c.summary).toContain("opens on the jacket");
    expect(postReadCandidate(post({ createTime: T0 - 6 * H }), null, T0)).toBeNull();
    expect(postReadCandidate(post({ createTime: T0 - 60 * H }), null, T0)).toBeNull();
    expect(postReadCandidate(post({ multiple: 3.4 }), null, T0), "a win has its own path").toBeNull();
    expect(postReadCandidate(post({ multiple: undefined }), null, T0), "no normal yet, nothing to say").toBeNull();
    expect(laneFor("post_read", 10 * 24 * H), "it's about their own post").toBe("theirs");
  });

  it("the readback adds it to her candidates once, for their own post only", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => seedCreator(ctx, "a"));
    const b = await t.run((ctx) => seedCreator(ctx, "b"));
    await t.run((ctx) => ctx.db.insert("ownPosts", { creatorId: a, platform: "tiktok", postId: "p1", url: "https://www.tiktok.com/@a/video/1", caption: "fit", createTime: T0 - 24 * H, contentType: "video", hashtags: [], metrics: { views: 352, likes: 20, comments: 2, shares: 0 }, metricsAsOf: T0, source: "scrape", multiple: 0.41 } as never));
    expect(await t.mutation(internal.scout.readback.noticePostRead, { creatorId: a, now: T0 })).toEqual({ added: true });
    expect(await t.mutation(internal.scout.readback.noticePostRead, { creatorId: a, now: T0 + H })).toEqual({ added: false });
    expect(await t.mutation(internal.scout.readback.noticePostRead, { creatorId: b, now: T0 })).toEqual({ added: false });
    expect((await t.run((ctx) => ctx.db.get(a)))!.noticed!.map((n) => n.kind)).toEqual(["post_read"]);
  });
});
