/**
 * Day one after onboarding (2026-09-29): hello on START → a first glance from their numbers about a
 * minute in → her full read → a favorites offer only if they named nobody. Plus Today's live
 * "reading" card. Every text is grounded, sent once, and stands down when it would be redundant.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import { glanceLine, titleOf, FIRST_GLANCE } from "../firstGlanceRules";
import { offerLine } from "../suggest";
import type { Id } from "../../_generated/dataModel";
import { addTracked } from "../../agent/manage";

const NOW = Date.UTC(2026, 8, 29, 18, 0);
const D = 86_400_000;
const post = (i: number, multiple: number | null, caption = `post ${i} about coffee in jersey city`) => ({ caption, multiple, createTime: NOW - i * D });

describe("the first glance line (pure)", () => {
  it("names their best recent post against a real normal, and nothing else", () => {
    const posts = [post(1, 1.1), post(2, 3.42, "matcha review #jerseycity @cafe\nsecond line"), post(3, 0.8), post(4, 1.0), post(5, 0.9)];
    expect(glanceLine(posts, NOW)).toBe('first look: your best one lately is "matcha review", at 3.4x your normal. still watching the rest, more soon.');
  });
  it("says nothing without a real normal, without a standout, or from a runaway outlier", () => {
    expect(glanceLine([post(1, 9), post(2, 1)], NOW), "under five posts: no normal").toBeNull();
    expect(glanceLine([1, 2, 3, 4, 5].map((i) => post(i, 1.2)), NOW), "nothing at 1.5x").toBeNull();
    expect(glanceLine([post(1, 472), post(2, 1), post(3, 1), post(4, 1), post(5, 1)], NOW), "a 472x fluke is not a finding").toBeNull();
    expect(glanceLine([post(200, 5), post(201, 1), post(202, 1), post(203, 1), post(204, 1)], NOW), "old posts aren't 'lately'").toBeNull();
  });
  it("a caption becomes a short title (first line, no tags, cut on a word)", () => {
    expect(titleOf("#fyp #coffee")).toBeNull();
    expect(titleOf("the best iced latte in all of jersey city and honestly maybe the whole east coast")!.endsWith("…")).toBe(true);
    expect(glanceLine([post(1, 2, "#fyp"), post(2, 1), post(3, 1), post(4, 1), post(5, 1)], NOW)).toMatch(/your best one lately is a recent post/);
  });
});

async function world(t: ReturnType<typeof convexTest>, suffix: string, over: Record<string, unknown> = {}) {
  return await t.run((ctx) => seedCreator(ctx, suffix, { timezone: "UTC", channel: { paired: true, pairedAt: NOW, kind: "imessage" }, plan: { status: "trialing", founding: true }, ...over }));
}
const outOf = async (t: ReturnType<typeof convexTest>, c: Id<"creators">) => (await t.run((ctx) => ctx.db.query("messages").collect())).filter((m) => m.creatorId === c && m.direction === "out");
async function addPosts(t: ReturnType<typeof convexTest>, c: Id<"creators">, multiples: number[]) {
  await t.run(async (ctx) => {
    for (const [i, m] of multiples.entries()) await ctx.db.insert("ownPosts", { creatorId: c, platform: "tiktok", postId: `p${i}`, url: `https://t/${i}`, createTime: NOW - (i + 1) * D, contentType: "video", caption: i === 0 ? "matcha review" : `post ${i}`, hashtags: [], metrics: { views: 1000, likes: 1, comments: 0, shares: 0 }, metricsAsOf: NOW, source: "scrape", multiple: m } as never);
  });
}

describe("sending the first glance", () => {
  it("waits for their posts, sends once, and stands down after her full read or when unpaired", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "g1");
    expect(await t.action(internal.onboarding.firstGlance.send, { creatorId: c, attempt: 0, now: NOW })).toEqual({ sent: false, reason: "waiting for their posts" });
    expect(await t.action(internal.onboarding.firstGlance.send, { creatorId: c, attempt: FIRST_GLANCE.maxAttempts - 1, now: NOW })).toEqual({ sent: false, reason: "no posts yet; stood down" });
    await addPosts(t, c, [3.4, 1, 1, 0.9, 1.1]);
    expect((await t.action(internal.onboarding.firstGlance.send, { creatorId: c, attempt: 1, now: NOW })).sent).toBe(true);
    await t.action(internal.onboarding.firstGlance.send, { creatorId: c, attempt: 2, now: NOW });
    const glances = (await outOf(t, c)).filter((m) => m.dedupeKey === `first_glance:${c}`);
    expect(glances).toHaveLength(1);
    expect(glances[0]).toMatchObject({ kind: "status", proactive: true });
    expect(glances[0].body).toMatch(/^first look: your best one lately is "matcha review", at 3\.4x your normal/);

    const late = await world(t, "g2");
    await addPosts(t, late, [3.4, 1, 1, 1, 1]);
    await t.run((ctx) => ctx.db.insert("messages", { creatorId: late, direction: "out", surface: "imessage", kind: "first_read", body: "ok, watched your stuff", dedupeKey: `first_read:${late}`, ts: NOW } as never));
    expect(await t.action(internal.onboarding.firstGlance.send, { creatorId: late, attempt: 0, now: NOW })).toEqual({ sent: false, reason: "her full read already went out" });

    const unpaired = await world(t, "g3", { channel: { paired: false } });
    expect((await t.action(internal.onboarding.firstGlance.send, { creatorId: unpaired, attempt: 0, now: NOW })).reason).toBe("not paired");
  });

  it("is scheduled on START, on both pairing paths, only before her first read", () => {
    const src = readFileSync(new URL("../../core/pairing.ts", import.meta.url), "utf8");
    expect(src.match(/if \(!firstRead\) await ctx\.scheduler\.runAfter\(FIRST_GLANCE\.afterMs, internal\.onboarding\.firstGlance\.send/g)).toHaveLength(2);
  });
});

describe("the favorites offer", () => {
  const picks = [{ platform: "tiktok", handle: "stephanyaznar", followers: 35800, why: "North Jersey coffee reviews." }, { platform: "tiktok", handle: "wandering_with_mariam", followers: 116900, why: "Jersey City food spots." }];
  const readSent = (t: ReturnType<typeof convexTest>, c: Id<"creators">) => t.run((ctx) => ctx.db.insert("messages", { creatorId: c, direction: "out", surface: "imessage", kind: "first_read", body: "read", dedupeKey: `first_read:${c}`, ts: NOW } as never));

  it("reads as one text with names, never a list of reasons", () => {
    expect(offerLine(picks)).toBe("also: found 2 creators in your lane i can keep an eye on for you: @stephanyaznar and @wandering_with_mariam. want me to watch them?");
    expect(offerLine([picks[0]])).toMatch(/found a creator in your lane/);
  });

  it("offers once, with a one-tap yes, after pairing and her first read", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "o1", { picks: { at: NOW, items: picks } });
    expect((await t.action(internal.onboarding.suggest.offerPicks, { creatorId: c, attempt: 0 })).reason).toBe("waiting for her first read");
    await readSent(t, c);
    expect(await t.action(internal.onboarding.suggest.offerPicks, { creatorId: c, attempt: 1 })).toEqual({ offered: true, reason: "offered" });
    expect((await t.action(internal.onboarding.suggest.offerPicks, { creatorId: c, attempt: 2 })).reason).toBe("already offered");
    const offer = (await outOf(t, c)).filter((m) => m.dedupeKey === `favpicks:${c}`);
    expect(offer).toHaveLength(1);
    expect(offer[0].buttons?.map((b: { id: string }) => b.id)).toEqual(["favpicks:yes", "favpicks:no"]);
  });

  it("never searches or offers when they already named people to watch", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "o2"); // no stored picks: an offer here would have to search
    await readSent(t, c);
    await t.run((ctx) => addTracked(ctx as never, c, "tiktok", "theirfave", [], { addedBy: "creator" }));
    expect(await t.action(internal.onboarding.suggest.offerPicks, { creatorId: c, attempt: 0 })).toEqual({ offered: false, reason: "they already chose who to watch" });
    expect(await outOf(t, c)).toHaveLength(1); // only the read
  });

  it("their yes adds the offered picks to who she watches; nobody else's", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "o3", { picks: { at: NOW, items: picks } });
    const other = await world(t, "o4");
    expect((await t.mutation(internal.onboarding.suggest.acceptPicks, { creatorId: c })).added).toEqual(["stephanyaznar", "wandering_with_mariam"]);
    const tracked = await t.run((ctx) => ctx.db.query("trackedAccounts").collect());
    expect(tracked.filter((r) => r.creatorId === c).map((r) => r.handle).sort()).toEqual(["stephanyaznar", "wandering_with_mariam"]);
    expect(tracked.filter((r) => r.creatorId === other)).toHaveLength(0);
  });

  it("the button reply is handled in code, not by the model", () => {
    const src = readFileSync(new URL("../../agent/converse.ts", import.meta.url), "utf8");
    expect(src).toMatch(/\^favpicks:\(yes\|no\)\$/);
    expect(src).toMatch(/internal\.onboarding\.suggest\.acceptPicks/);
  });
});

describe("Today's reading card", () => {
  it("waiting → reading (live counts) → read (what she saw); signed out gets nothing; nobody sees another's", async () => {
    const t = convexTest(schema, modules);
    const c = await world(t, "r1");
    const other = await world(t, "r2");
    const as = async (id: Id<"creators">) => t.withIdentity({ subject: (await t.run((ctx) => ctx.db.get(id)))!.clerkUserId });
    const me = await as(c);
    expect(await t.query(api.onboarding.start.reading, {})).toBeNull();
    expect((await me.query(api.onboarding.start.reading, {}))?.stage).toBe("waiting");
    await addPosts(t, c, [3.4, 1, 1, 1, 1]);
    const firstPost = (await t.run((ctx) => ctx.db.query("ownPosts").collect())).find((p) => p.creatorId === c && p.caption === "matcha review")!;
    await t.run((ctx) => ctx.db.patch(firstPost._id, { sample: ["top"] } as never));
    await t.run((ctx) => ctx.db.insert("ownPostReads", { creatorId: c, ownPostId: firstPost._id, depth: "watch", card: {}, produced: { skillVersion: "t", model: "m", thresholdsVersion: "t" }, createdAt: NOW } as never));
    expect(await me.query(api.onboarding.start.reading, {})).toMatchObject({ stage: "reading", posts: 5, watched: 1, toWatch: 1, lastWatched: "matcha review", summary: null });
    await t.run((ctx) => ctx.db.patch(c, { dossier: { persona: { summary: "Jersey City coffee hunts" }, formatsUsed: [{ label: "walking taste test", count: 4 }, { label: "outfit", count: 2 }], rewrittenAt: new Date(NOW).toISOString() } } as never));
    expect(await me.query(api.onboarding.start.reading, {})).toMatchObject({ stage: "read", summary: "Jersey City coffee hunts", topFormat: "walking taste test", readAt: NOW });
    expect((await (await as(other)).query(api.onboarding.start.reading, {}))).toMatchObject({ stage: "waiting", posts: 0, watched: 0, summary: null });
  });
});
