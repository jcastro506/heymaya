/**
 * K1: the media kit v2. Categories: fail-closed (below the partnerships plan every door refuses and
 * the page is empty; a closed relationship's link is dead), cross-tenant (A's link never leads with
 * B's posts; B can't make a link on A's deal), adversarial (a one line with numbers or links, a
 * screenshot that doesn't add up, a bot "opening" the kit, a foreign post URL), sibling coherence
 * (the app and the tool change the same row; the public view never carries what the private one does).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../schema";
import { api, internal } from "../../_generated/api";
import { modules } from "../../../tests/_modules";
import { seedCreator } from "../../../tests/lib/creatorRow";
import type { Id } from "../../_generated/dataModel";
import { bestPosts, brandWorkIn, engagementOf, freshScreenshot, growthOf, publicCaption, publicView, servicesFrom, type KitV2 } from "../kitData";
import { checkOneLine, looksLikeBot, nextKitQuestion, photoTypeOk, samePost } from "../kitSettings";
import { audienceFromRead, audienceLine, kitImageIntent } from "../kitImage";
import { renderKit } from "../kitTools";

const D = 86_400_000;
const NOW = Date.UTC(2026, 8, 26, 12);
const post = (daysAgo: number, views: number, i = 0, extra: Partial<{ likes: number; comments: number; shares: number; saves: number }> = {}) => ({ createTime: NOW - daysAgo * D, metrics: { views, likes: extra.likes ?? views * 0.05, comments: extra.comments ?? 2, shares: extra.shares ?? 1, ...(extra.saves !== undefined ? { saves: extra.saves } : {}) }, i });

describe("engagement, growth, best posts (pure)", () => {
  it("engagement is the median of the last 90 days; too few posts is null, never zero", () => {
    expect(engagementOf([post(1, 1000), post(2, 1000)], 5000, NOW)).toBeNull();
    const e = engagementOf([post(1, 1000), post(2, 2000), post(3, 4000), post(200, 10, 0, { likes: 10 })], 5000, NOW)!;
    expect(e.posts).toBe(3); // the 200-day-old post is outside the window
    expect(e.perView).toBeCloseTo(0.0515, 3);
    expect(engagementOf([post(1, 1000), post(2, 2000), post(3, 4000)], null, NOW)!.perFollower).toBeNull();
  });
  it("growth nets the snapshot nearest 30 days back; gained/lost only where reported", () => {
    const day = (d: number) => new Date(NOW - d * D).toISOString().slice(0, 10);
    expect(growthOf([{ day: day(0), followers: 100 }], NOW)).toBeNull();
    expect(growthOf([{ day: day(40), followers: 900 }, { day: day(31), followers: 1000 }, { day: day(0), followers: 1200 }], NOW)).toEqual({ net: 200, gained: null, lost: null });
    expect(growthOf([{ day: day(31), followers: 1000 }, { day: day(10), followers: 1100, gained: 120, lost: 20 }, { day: day(0), followers: 1150, gained: 60, lost: 10 }], NOW)).toEqual({ net: 150, gained: 180, lost: 30 });
  });
  it("best posts are the last 6 months only, by views", () => {
    const xs = [{ createTime: NOW - 10 * D, views: 5 }, { createTime: NOW - 200 * D, views: 999 }, { createTime: NOW - 1 * D, views: 50 }];
    expect(bestPosts(xs, NOW).map((x) => x.views)).toEqual([50, 5]);
  });
  it("brand work is their own DISCLOSED posts, tagged brand, never their own handle", () => {
    const out = brandWorkIn([
      { url: "u1", caption: "loving these @hoka shoes #ad", createTime: 1 },
      { url: "u2", caption: "long run with @runwithrae", createTime: 2 },
      { url: "u3", caption: "@sam_runs x @gu paid partnership", createTime: 3 },
      { url: "u4", caption: "#ad @hoka again", createTime: 4 },
    ], ["sam_runs"]);
    expect(out.map((b) => b.brand)).toEqual(["@hoka", "@gu"]);
  });
  it("services come from the deal types they said yes to; paid-only drops gifting", () => {
    expect(servicesFrom(["sponsorship", "gifting", "ugc"], true)).toEqual(["Sponsored posts", "UGC (videos for the brand's own channels)"]);
    expect(servicesFrom([], false)).toEqual([]);
  });
  it("a screenshot audience is shown for 60 days", () => {
    expect(freshScreenshot(NOW - 59 * D, NOW)).toBe(true);
    expect(freshScreenshot(NOW - 61 * D, NOW)).toBe(false);
  });
});

describe("what she's allowed to put on it (adversarial)", () => {
  it("a one line is words: no numbers, links, handles; 8 to 140 characters", () => {
    expect(checkOneLine("  “Brisbane runner making honest early-morning running videos” ")).toBe("Brisbane runner making honest early-morning running videos");
    for (const bad of ["hi", "10k followers of runners", "runner, see www.x.com", "runner @sam", "#running daily", "x".repeat(141)]) expect(() => checkOneLine(bad)).toThrow();
  });
  it("a screenshot's audience must add up; countries may be a top few", () => {
    expect(audienceFromRead({ kind: "tiktok_audience", age: [{ label: "18-24", percent: 30 }, { label: "25-34", percent: 70 }], gender: [{ label: "Female", percent: 71 }, { label: "Male", percent: 29 }], countries: [{ label: "United States", percent: 58 }] })).toMatchObject({ ok: true, gender: [{ label: "Female", share: 0.71 }, { label: "Male", share: 0.29 }] });
    expect(audienceFromRead({ kind: "tiktok_audience", age: [{ label: "18-24", percent: 30 }, { label: "25-34", percent: 30 }] })).toMatchObject({ ok: false, reason: expect.stringContaining("60%") });
    expect(audienceFromRead({ kind: "tiktok_audience", countries: [{ label: "US", percent: 80 }, { label: "UK", percent: 40 }] })).toMatchObject({ ok: false });
    expect(audienceFromRead({ kind: "tiktok_audience" })).toMatchObject({ ok: false });
    expect(audienceFromRead({ kind: "tiktok_audience", gender: [{ label: "Female", percent: 101 }, { label: "<script>", percent: -5 }] })).toMatchObject({ ok: false }); // out-of-range dropped, nothing left, nothing invented
    expect(audienceLine({ age: [{ label: "25-34", share: 0.41 }, { label: "18-24", share: 0.34 }], gender: [{ label: "Female", share: 0.71 }] })).toBe("71% female, mostly 25-34");
  });
  it("an image goes to the kit only on their word or her ask in the last 48 h", () => {
    expect(kitImageIntent("use this one for my media kit", null, NOW)).toBe("photo");
    expect(kitImageIntent("here's my tiktok studio audience", null, NOW)).toBe("tiktok_audience");
    expect(kitImageIntent("", { kind: "photo", at: NOW - 3_600_000 }, NOW)).toBe("photo");
    expect(kitImageIntent("", { kind: "photo", at: NOW - 3 * D }, NOW)).toBeNull();
    expect(kitImageIntent("look at this sunset", null, NOW)).toBeNull();
  });
  it("link previews and crawlers are not a brand opening the kit", () => {
    for (const ua of [undefined, "", "facebookexternalhit/1.1 Facebot Twitterbot/1.0", "Slackbot-LinkExpanding", "WhatsApp/2.23", "curl/8"]) expect(looksLikeBot(ua)).toBe(true);
    expect(looksLikeBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
  });
  it("post URLs match without query strings or trailing slashes", () => {
    expect(samePost("https://www.tiktok.com/@a/video/1?is_from=x", "https://www.tiktok.com/@a/video/1/")).toBe(true);
    expect(samePost("https://www.tiktok.com/@a/video/1", "https://www.tiktok.com/@a/video/2")).toBe(false);
  });
  it("captions a brand sees carry no handles", () => {
    expect(publicCaption("long run fuel check with @trailfuel")).toBe("long run fuel check");
    expect(publicCaption("speed work with @runwithrae and friends")).toBe("speed work with and friends");
  });
});

describe("one question at a time, each once", () => {
  it("audience first (when there is one), then the one line, then a weak photo", () => {
    expect(nextKitQuestion({}, true)).toBe("audience");
    expect(nextKitQuestion({ asked: { audience: 1 } }, true)).toBe("oneLine");
    expect(nextKitQuestion({}, false)).toBe("oneLine");
    expect(nextKitQuestion({ asked: { oneLine: 1 }, photoCheck: { weak: true } }, false)).toBe("photo");
    expect(nextKitQuestion({ asked: { oneLine: 1 }, photoCheck: { weak: true, offeredAt: 5 } }, false)).toBeNull();
    expect(nextKitQuestion({ oneLine: { status: "approved" }, photoCheck: { weak: true }, photoSource: "upload" }, false)).toBeNull();
  });
});

const kit = (over: Partial<KitV2> = {}): KitV2 => ({
  name: "sam", lane: "running", asOf: NOW, photo: { url: "https://x/p.jpg", source: "instagram" }, photoSetting: "auto", photoCheck: null, oneLine: { text: "Honest early-morning running", approved: false }, showAudience: null, services: ["Sponsored posts"], region: "US", contactEmail: "sam@x.com", brandWork: [{ brand: "@hoka", source: "their_post", url: "u", at: 1 }],
  platforms: [{ platform: "instagram", handle: "sam", followers: 8050, followersAsOf: NOW, normalViews: 9000, posts: 20, engagement: { perView: 0.06, perFollower: 0.02, posts: 12 }, growth30d: { net: 214, gained: null, lost: null }, audience: { source: "connected", asOf: NOW, age: [{ label: "25-34", share: 0.41 }], gender: [{ label: "Women", share: 0.71 }], countries: [], cities: [] }, best: [{ url: "a", platform: "instagram", views: 30000, multiple: 3.1, caption: "hill @trailfuel", createTime: NOW, cover: null }, { url: "b", platform: "instagram", views: 12000, multiple: 1.3, caption: "track", createTime: NOW, cover: null }] }],
  ...over,
});

describe("the public view (sibling coherence with the private one)", () => {
  it("never the audience without their yes; an unapproved one line isn't shown", () => {
    const v = publicView(kit());
    expect(v.platforms[0].audience).toBeNull();
    expect(v.oneLine).toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/trailfuel|perFollowerX|minimumRate|paidOnly/);
    const yes = publicView(kit({ showAudience: true, oneLine: { text: "Honest early-morning running", approved: true } }));
    expect(yes.platforms[0].audience?.gender[0]).toEqual({ label: "Women", share: 0.71 });
    expect(yes.oneLine).toBe("Honest early-morning running");
  });
  it("a per-brand view leads with her picks and carries the idea", () => {
    const v = publicView(kit(), { brand: "Pacefern", idea: "a 15s hill-repeat with your gel at the top", postUrls: ["b"] });
    expect(v.platforms[0].best.map((b) => b.url)).toEqual(["b", "a"]);
    expect(v.forBrand).toEqual({ brand: "Pacefern", idea: "a 15s hill-repeat with your gel at the top" });
  });
  it("the tool's read labels private preferences as private, and says the one next thing", () => {
    const text = renderKit(kit(), null, { paidOnly: true, minimumRate: "$400", excludedBrands: [] }, "nothing missing");
    expect(text).toMatch(/PRIVATE, never on a kit.*\$400/);
    expect(text).toMatch(/engagement 6\.0% of views \(2\.0% of followers\)/);
    expect(text).toMatch(/next: nothing missing$/);
  });
});

// ------------------------------------------------------------------ the rows

const OPP = (brand: string, status = "shortlisted", extra: Record<string, unknown> = {}) => ({
  brand, campaign: "Creator program", type: "sponsorship", fit: "Running audience.", unknowns: [],
  assessment: { verdict: "recommend", goalAlignment: "paid running work", contentAlignment: "running", audienceFit: "unknown", commercialFit: "paid", concerns: [], creatorEvidence: [{ kind: "message", id: "m1", quote: "paid running deals", reason: "their goal" }] },
  eligibility: "US", compensation: "paid", route: "email", contactEmail: `creators@${brand.toLowerCase()}.com`,
  evidence: [{ url: `https://${brand.toLowerCase()}.com/creators`, excerpt: "creator program", checkedAt: 1, kind: "extract" }], status, ...extra,
});

async function world(tier: "solo" | "partner" = "partner") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await seedCreator(ctx, "a", { clerkUserId: "user_a", handles: { instagram: "sam" }, plan: { status: "active", founding: false, tier } } as never);
    const b = await seedCreator(ctx, "b", { clerkUserId: "user_b", handles: { instagram: "bee" }, plan: { status: "active", founding: false, tier: "partner" } } as never);
    for (const [who, h] of [[a, "sam"], [b, "bee"]] as const) for (let i = 0; i < 4; i++) await ctx.db.insert("ownPosts", { creatorId: who, platform: "instagram", postId: `${h}${i}`, url: `https://www.instagram.com/reel/${h}${i}/`, createTime: Date.now() - (i + 1) * D, contentType: "video", caption: `${h} run ${i}`, hashtags: [], metrics: { views: 1000 * (i + 1), likes: 50, comments: 5, shares: 2 }, metricsAsOf: Date.now(), source: "scrape" } as never);
    const oppA = await ctx.db.insert("partnershipOpportunities", { creatorId: a, brandDomain: "pacefern.com", data: OPP("Pacefern"), updatedAt: Date.now() });
    const oppB = await ctx.db.insert("partnershipOpportunities", { creatorId: b, brandDomain: "solebird.com", data: OPP("Solebird"), updatedAt: Date.now() });
    return { a, b, oppA, oppB };
  });
  return { t, ...ids };
}

describe("the kit's doors (fail-closed, sibling coherence)", () => {
  it("below the partnerships plan: every change, the link and the page refuse", async () => {
    const w = await world("solo");
    await expect(w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "audience", on: true } })).rejects.toThrow(/partnerships plan/);
    await expect(w.t.mutation(internal.partnerships.kitPage.kitLinkFor, { creatorId: w.a, on: true })).rejects.toThrow(/partnerships plan/);
    expect(await w.t.query(internal.partnerships.kitTools.kitFor, { creatorId: w.a })).toBeNull();
    await expect(w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/sam0/"], idea: "a hill idea for them" })).rejects.toThrow(/partnerships plan/);
    // off always works
    expect(await w.t.mutation(internal.partnerships.kitPage.kitLinkFor, { creatorId: w.a, on: false })).toEqual({ url: null });
  });
  it("a plan that lapses empties the page at once", async () => {
    const w = await world();
    const slug = (await w.t.mutation(internal.partnerships.kitPage.kitLinkFor, { creatorId: w.a, on: true })).url!.split("/k/")[1];
    expect(await w.t.query(api.partnerships.kitPage.publicKit, { slug })).not.toBeNull();
    await w.t.run(async (ctx) => { const c = (await ctx.db.get(w.a))!; await ctx.db.patch(w.a, { plan: { ...c.plan, tier: "solo" } }); });
    expect(await w.t.query(api.partnerships.kitPage.publicKit, { slug })).toBeNull();
  });
  it("the app and the tool change the same row; the app's approve is their tap", async () => {
    const w = await world();
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "propose_one_line", text: "Honest early-morning running, rain or shine" } });
    await expect(w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "approve_one_line" } })).rejects.toThrow(/haven't answered/);
    const asA = w.t.withIdentity({ subject: "user_a" });
    await asA.mutation(api.partnerships.kitSettings.update, { change: { op: "approve_one_line" } });
    await asA.mutation(api.partnerships.kitSettings.update, { change: { op: "audience", on: false } });
    const k = await w.t.query(internal.partnerships.kitTools.kitFor, { creatorId: w.a });
    expect(k?.kit.oneLine).toEqual({ text: "Honest early-morning running, rain or shine", approved: true });
    expect(k?.kit.showAudience).toBe(false);
    await expect(asA.mutation(api.partnerships.kitSettings.update, { change: { op: "tiktok_audience", age: [], gender: [], countries: [] } })).rejects.toThrow(/Not an app action/);
  });
  it("a text 'yes' after the proposal approves it", async () => {
    const w = await world();
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "propose_one_line", text: "Honest early-morning running" } });
    await w.t.run((ctx) => ctx.db.insert("messages", { creatorId: w.a, direction: "in", surface: "imessage", kind: "text", body: "yes love it", ts: Date.now() + 1000 } as never));
    expect(await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "approve_one_line" } })).toMatchObject({ ok: true });
  });
  it("a photo upload must be an image; 'no photo' deletes the upload", async () => {
    const w = await world();
    expect([photoTypeOk("text/plain"), photoTypeOk("image/svg+xml"), photoTypeOk("image/jpeg"), photoTypeOk(undefined)]).toEqual([false, false, true, true]);
    const img = await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })));
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "photo_upload", storageId: img } });
    expect((await w.t.query(internal.partnerships.kitTools.kitFor, { creatorId: w.a }))?.kit.photo?.source).toBe("upload");
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "photo", source: "none" } });
    expect(await w.t.run((ctx) => ctx.storage.getUrl(img))).toBeNull();
    expect((await w.t.query(internal.partnerships.kitTools.kitFor, { creatorId: w.a }))?.kit.photo).toBeNull();
  });
});

describe("per-brand links (cross-tenant, fail-closed)", () => {
  it("leads only with their own posts; never on someone else's deal", async () => {
    const w = await world();
    await expect(w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/bee0/"], idea: "a hill idea for them" })).rejects.toThrow(/Not one of their posts/);
    await expect(w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.b, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/bee0/"], idea: "a hill idea for them" })).rejects.toThrow(/unavailable/);
    const r = await w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/sam1?igsh=abc"], idea: "a 15 second hill repeat with the gel at the top" });
    const slug = r.url.split("/k/")[1];
    const page = await w.t.query(api.partnerships.kitPage.publicKit, { slug });
    expect(page?.forBrand?.brand).toBe("Pacefern");
    expect(page?.platforms[0].best[0].url).toBe("https://www.instagram.com/reel/sam1/");
    expect(JSON.stringify(page)).not.toContain("bee");
    // one link per deal: making it again updates it
    expect((await w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/sam2/"], idea: "another idea for the same brand" })).url).toBe(r.url);
  });
  it("dies when the relationship closes", async () => {
    const w = await world();
    const slug = (await w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/sam0/"], idea: "a hill idea for them" })).url.split("/k/")[1];
    await w.t.run((ctx) => ctx.db.patch(w.oppA, { data: OPP("Pacefern", "declined") }));
    expect(await w.t.query(api.partnerships.kitPage.publicKit, { slug })).toBeNull();
    await expect(w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/sam0/"], idea: "a hill idea for them" })).rejects.toThrow(/closed/);
  });
  it("an open counts only after the pitch went out, never a bot, never the creator", async () => {
    const w = await world();
    const slug = (await w.t.mutation(internal.partnerships.kitSettings.variantFor, { creatorId: w.a, opportunityId: w.oppA, postUrls: ["https://www.instagram.com/reel/sam0/"], idea: "a hill idea for them" })).url.split("/k/")[1];
    const human = "Mozilla/5.0 (Macintosh) Safari/605.1.15";
    expect(await w.t.mutation(api.partnerships.kitSettings.recordOpen, { slug, userAgent: human })).toEqual({ counted: false }); // not sent yet
    await w.t.run((ctx) => ctx.db.patch(w.oppA, { data: OPP("Pacefern", "contacted", { lastOutboundAt: Date.now() - 3_600_000 }) }));
    expect(await w.t.mutation(api.partnerships.kitSettings.recordOpen, { slug, userAgent: "facebookexternalhit/1.1" })).toEqual({ counted: false });
    expect(await w.t.withIdentity({ subject: "user_a" }).mutation(api.partnerships.kitSettings.recordOpen, { slug, userAgent: human })).toEqual({ counted: false });
    expect(await w.t.mutation(api.partnerships.kitSettings.recordOpen, { slug, userAgent: human })).toEqual({ counted: true });
    expect(await w.t.mutation(api.partnerships.kitSettings.recordOpen, { slug, userAgent: human })).toEqual({ counted: false }); // once
    expect(await w.t.query(internal.partnerships.kitSettings.openedUntold, { creatorId: w.a, opportunityId: w.oppA })).toMatchObject({ brand: "Pacefern" });
    expect(await w.t.query(internal.partnerships.kitSettings.openedUntold, { creatorId: w.b, opportunityId: w.oppA })).toBeNull();
  });
});

describe("account deletion takes the kit with it", () => {
  it("the kit photo is in the files to delete", async () => {
    const w = await world();
    const img = await w.t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })));
    await w.t.mutation(internal.partnerships.kitSettings.change, { creatorId: w.a, change: { op: "photo_upload", storageId: img } });
    const snap = await w.t.query(internal.account.deletion.snapshot, { creatorId: w.a as Id<"creators"> });
    expect(snap?.fileIds).toContain(img);
  });
});
